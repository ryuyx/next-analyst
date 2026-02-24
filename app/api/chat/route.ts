import { AIMessage } from "@langchain/core/messages";
import { createGraph, buildLangChainMessages, type FileInfo, type Plan } from "./agent";

export const runtime = "nodejs";
export const maxDuration = 60;

// Simple rate limiting: track requests per IP
const requestCounts = new Map<string, { count: number; resetTime: number }>();
const RATE_LIMIT_WINDOW = 60000; // 1 minute
const RATE_LIMIT_MAX = 30; // 30 requests per minute

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const record = requestCounts.get(ip);

  if (!record || now > record.resetTime) {
    requestCounts.set(ip, { count: 1, resetTime: now + RATE_LIMIT_WINDOW });
    return true;
  }

  if (record.count >= RATE_LIMIT_MAX) {
    return false;
  }

  record.count++;
  return true;
}

function validateInput(messages: unknown, files: unknown, toolResult: unknown): string | null {
  if (!Array.isArray(messages)) {
    return "Messages must be an array";
  }

  // Allow empty messages if toolResult is provided (follow-up after code execution)
  if (messages.length === 0 && !toolResult) {
    return "At least one message is required";
  }

  if (messages.length > 100) {
    return "Too many messages (max 100)";
  }

  for (const msg of messages) {
    if (typeof msg !== "object" || !msg) {
      return "Invalid message format";
    }
    const m = msg as Record<string, unknown>;
    if (typeof m.role !== "string" || typeof m.content !== "string") {
      return "Each message must have role and content";
    }
    if (m.content.length > 50000) {
      return "Message content too long (max 50KB)";
    }
  }

  if (files && !Array.isArray(files)) {
    return "Files must be an array";
  }

  return null;
}

export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for") || "unknown";

  if (!checkRateLimit(ip)) {
    return new Response(
      `data: ${JSON.stringify({
        type: "error",
        content: "Rate limit exceeded. Please wait before sending another request.",
      })}\n\n`,
      { status: 429, headers: { "Content-Type": "text/event-stream" } }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return new Response(
      `data: ${JSON.stringify({
        type: "error",
        content: "Invalid JSON in request body",
      })}\n\n`,
      { status: 400, headers: { "Content-Type": "text/event-stream" } }
    );
  }

  const { messages, files, toolResult, sessionFiles } = body as Record<string, unknown>;

  const validationError = validateInput(messages, files, toolResult);
  if (validationError) {
    return new Response(
      `data: ${JSON.stringify({
        type: "error",
        content: `Validation error: ${validationError}`,
      })}\n\n`,
      { status: 400, headers: { "Content-Type": "text/event-stream" } }
    );
  }

  const graph = createGraph();
  const langchainMessages = buildLangChainMessages(
    messages as Array<{ role: string; content: string }>,
    files as FileInfo[] | undefined,
    toolResult as Record<string, unknown> | undefined,
    sessionFiles as FileInfo[] | undefined
  );

  // Extract plan info from request if continuing after HITL
  const currentPlan = (body as Record<string, unknown>).plan as Plan | undefined;
  const currentStepIndex = (body as Record<string, unknown>).currentStepIndex as number | undefined;

  const encoder = new TextEncoder();

  // Track plan state during streaming
  let activePlan: Plan | null = currentPlan || null;
  let activeStepIndex: number = currentStepIndex ?? 0;

  // Track accumulated content to detect and handle non-delta streaming
  let accumulatedContent = "";

  const stream = new ReadableStream({
    async start(controller) {
      try {
        // If continuing after HITL execution with a plan, mark current step as completed
        if (toolResult && activePlan && activeStepIndex < activePlan.steps.length) {
          const hasError = !!(toolResult as Record<string, unknown>).error;
          const status = hasError ? "failed" : "completed";

          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({
                type: "plan_step_update",
                stepIndex: activeStepIndex,
                status,
              })}\n\n`
            )
          );

          // Move to next step
          activeStepIndex++;
        }

        const eventStream = graph.streamEvents(
          { messages: langchainMessages, plan: activePlan, currentStepIndex: activeStepIndex },
          { version: "v2", recursionLimit: 25 }
        );

        for await (const event of eventStream) {
          // -- LLM starting a new generation (reset accumulated content) --
          if (event.event === "on_chat_model_start") {
            accumulatedContent = "";
          }

          // -- Token-level streaming from the LLM --
          else if (event.event === "on_chat_model_stream") {
            const chunk = event.data?.chunk;
            if (
              chunk?.content &&
              typeof chunk.content === "string" &&
              chunk.content.length > 0
            ) {
              let deltaContent = chunk.content;

              // Detect if the chunk is cumulative (contains previous content)
              // This handles models that return accumulated content instead of deltas
              if (accumulatedContent.length > 0 && deltaContent.startsWith(accumulatedContent)) {
                // Extract only the new content
                deltaContent = deltaContent.slice(accumulatedContent.length);
              }

              if (deltaContent.length > 0) {
                accumulatedContent += deltaContent;
                controller.enqueue(
                  encoder.encode(
                    `data: ${JSON.stringify({
                      type: "text_delta",
                      content: deltaContent,
                    })}\n\n`
                  )
                );
              }
            }
          }

          // -- LLM finished: check for HITL tool calls --
          else if (event.event === "on_chat_model_end") {
            const output = event.data?.output;
            // output may be AIMessage directly or wrapped in a generation
            const aiMsg: AIMessage | undefined =
              output?.message ?? output;

            if (aiMsg?.tool_calls?.length) {
              for (const tc of aiMsg.tool_calls) {
                if (tc.name === "execute_python") {
                  // If we have a plan, mark current step as in_progress
                  if (activePlan && activeStepIndex < activePlan.steps.length) {
                    controller.enqueue(
                      encoder.encode(
                        `data: ${JSON.stringify({
                          type: "plan_step_update",
                          stepIndex: activeStepIndex,
                          status: "in_progress",
                        })}\n\n`
                      )
                    );
                  }

                  controller.enqueue(
                    encoder.encode(
                      `data: ${JSON.stringify({
                        type: "pending_tool_call",
                        tool: tc.name,
                        args: tc.args,
                        // Include plan context for HITL continuation
                        planContext: activePlan ? {
                          plan: activePlan,
                          currentStepIndex: activeStepIndex,
                        } : undefined,
                      })}\n\n`
                    )
                  );
                }
                // Safe tool calls are NOT emitted here -- they will be
                // handled when on_tool_end fires from the ToolNode.
              }
            }
          }

          // -- Safe tool finished execution --
          else if (event.event === "on_tool_end") {
            const toolName = event.name;
            const toolOutput = event.data?.output;
            const toolInput = event.data?.input;

            let result: unknown;
            // toolOutput could be a string or a ToolMessage with content property
            let outputStr: string | undefined;
            if (typeof toolOutput === "string") {
              outputStr = toolOutput;
            } else if (toolOutput && typeof toolOutput === "object" && "content" in toolOutput) {
              // ToolMessage object - extract content
              outputStr = String((toolOutput as { content: unknown }).content);
            }

            if (outputStr) {
              try {
                result = JSON.parse(outputStr);
              } catch {
                result = { text: outputStr };
              }
            } else {
              result = toolOutput ?? { text: "" };
            }

            // Special handling for create_plan tool - emit plan_created event and track plan
            if (toolName === "create_plan" && result && typeof result === "object" && "type" in result && (result as { type: string }).type === "plan_created") {
              const planResult = result as { type: string; plan: Plan };
              activePlan = planResult.plan;
              activeStepIndex = 0;

              controller.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify({
                    type: "plan_created",
                    plan: planResult.plan,
                  })}\n\n`
                )
              );
            } else {
              controller.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify({
                    type: "tool_call",
                    tool: toolName,
                    args: toolInput ?? {},
                    result,
                  })}\n\n`
                )
              );
            }
          }
        }

        // -- Graph finished --
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ type: "done" })}\n\n`)
        );
        controller.close();
      } catch (error: unknown) {
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error";
        const errorType =
          error instanceof Error && error.name === "RecursionError"
            ? "recursion_limit"
            : "execution_error";
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({
              type: "error",
              errorType,
              content: `Error: ${errorMessage}`,
            })}\n\n`
          )
        );
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
