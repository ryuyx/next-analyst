import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, AIMessage, SystemMessage } from "@langchain/core/messages";
import { tool } from "@langchain/core/tools";
import { z } from "zod";

export const runtime = "nodejs";
export const maxDuration = 60;

// Define tools the agent can use
const confirmAction = tool(
  async ({ action, description }) => {
    // This tool signals the frontend to show a confirmation dialog
    return JSON.stringify({
      type: "confirmation_required",
      action,
      description,
      status: "pending",
    });
  },
  {
    name: "confirm_action",
    description:
      "When you need user confirmation before performing a potentially dangerous or important action, use this tool. It will display a confirmation dialog to the user.",
    schema: z.object({
      action: z.string().describe("The action name that needs confirmation"),
      description: z
        .string()
        .describe("A detailed description of what will happen if confirmed"),
    }),
  }
);

const searchKnowledge = tool(
  async ({ query }) => {
    // Simulated knowledge search tool
    return JSON.stringify({
      type: "search_result",
      query,
      results: [
        `Found relevant information about: ${query}`,
        "This is a simulated search result for the MVP demo.",
      ],
    });
  },
  {
    name: "search_knowledge",
    description:
      "Search the knowledge base for relevant information. Use this when the user asks about specific topics.",
    schema: z.object({
      query: z.string().describe("The search query"),
    }),
  }
);

const calculateData = tool(
  async ({ expression }) => {
    try {
      // Simple safe eval for basic math (MVP demo)
      const result = Function(`"use strict"; return (${expression})`)();
      return JSON.stringify({ type: "calculation", expression, result });
    } catch {
      return JSON.stringify({
        type: "calculation_error",
        expression,
        error: "Invalid expression",
      });
    }
  },
  {
    name: "calculate",
    description: "Perform a mathematical calculation.",
    schema: z.object({
      expression: z.string().describe("The mathematical expression to evaluate"),
    }),
  }
);

const tools = [confirmAction, searchKnowledge, calculateData];

function createModel() {
  return new ChatOpenAI({
    apiKey: "sk-eBYkmLFglabxkLKT4svGlHRQX2c8TJleviMWSnJIgTc7o9Tm",
    configuration: {
      baseURL: "http://10.191.46.2:3000/v1",
    },
    model: "qwen3-coder",
    temperature: 0.7,
    streaming: true,
  }).bindTools(tools);
}

export async function POST(req: Request) {
  const { messages } = await req.json();

  const model = createModel();

  // Convert messages to LangChain format
  const langchainMessages = [
    new SystemMessage(
      `你是一个智能数据分析助手 (Next Analyst)。你可以帮助用户进行数据分析、回答问题、执行计算。
      
你有以下工具可以使用:
- confirm_action: 当需要用户确认重要操作时使用
- search_knowledge: 搜索知识库获取信息
- calculate: 执行数学计算

请用中文回答问题。如果用户要求执行重要操作（如删除数据、修改配置等），请先使用 confirm_action 工具获取用户确认。`
    ),
    ...messages.map(
      (msg: { role: string; content: string; tool_call_id?: string }) => {
        if (msg.role === "user") return new HumanMessage(msg.content);
        if (msg.role === "assistant") return new AIMessage(msg.content);
        return new HumanMessage(msg.content);
      }
    ),
  ];

  // Create a streaming response
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        const response = await model.invoke(langchainMessages);

        // Check if there are tool calls
        if (
          response.tool_calls &&
          response.tool_calls.length > 0
        ) {
          for (const toolCall of response.tool_calls) {
            const matchedTool = tools.find(
              (t) => t.name === toolCall.name
            );
            if (matchedTool) {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const toolResult = await (matchedTool as any).invoke(
                toolCall.args
              );

              // Send tool call event
              controller.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify({
                    type: "tool_call",
                    tool: toolCall.name,
                    args: toolCall.args,
                    result: JSON.parse(toolResult as string),
                  })}\n\n`
                )
              );
            }
          }

          // After tool execution, get final response
          // For MVP, include the tool results in a follow-up
          const textContent =
            typeof response.content === "string"
              ? response.content
              : "";
          if (textContent) {
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({
                  type: "text",
                  content: textContent,
                })}\n\n`
              )
            );
          }
        } else {
          // Stream the text response
          const textContent =
            typeof response.content === "string"
              ? response.content
              : "";

          // Simulate streaming by chunking the response
          const chunks = textContent.match(/.{1,10}/g) || [];
          for (const chunk of chunks) {
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({
                  type: "text_delta",
                  content: chunk,
                })}\n\n`
              )
            );
            // Small delay for streaming effect
            await new Promise((r) => setTimeout(r, 30));
          }
        }

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
