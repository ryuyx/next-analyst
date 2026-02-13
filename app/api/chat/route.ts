import { AIMessage } from "@langchain/core/messages";
import { createGraph, buildLangChainMessages } from "./agent";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  const { messages, files, toolResult, sessionFiles } = await req.json();

  const graph = createGraph();
  const langchainMessages = buildLangChainMessages(
    messages,
    files,
    toolResult,
    sessionFiles
  );

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      try {
        const eventStream = graph.streamEvents(
          { messages: langchainMessages },
          { version: "v2", recursionLimit: 25 }
        );

        for await (const event of eventStream) {
          // -- Token-level streaming from the LLM --
          if (event.event === "on_chat_model_stream") {
            const chunk = event.data?.chunk;
            if (
              chunk?.content &&
              typeof chunk.content === "string" &&
              chunk.content.length > 0
            ) {
              controller.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify({
                    type: "text_delta",
                    content: chunk.content,
                  })}\n\n`
                )
              );
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
                  controller.enqueue(
                    encoder.encode(
                      `data: ${JSON.stringify({
                        type: "pending_tool_call",
                        tool: tc.name,
                        args: tc.args,
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
            if (typeof toolOutput === "string") {
              try {
                result = JSON.parse(toolOutput);
              } catch {
                result = { text: toolOutput };
              }
            } else {
              result = toolOutput ?? { text: "" };
            }

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

        // -- Graph finished --
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ type: "done" })}\n\n`)
        );
        controller.close();
      } catch (error: unknown) {
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error";
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({
              type: "error",
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
