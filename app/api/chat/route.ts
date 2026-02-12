import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, AIMessage, SystemMessage, ToolMessage, BaseMessage, AIMessageChunk } from "@langchain/core/messages";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { Sandbox } from "@e2b/code-interpreter";

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

const executePython = tool(
  async ({ code }) => {
    let sandbox: Sandbox | null = null;
    try {
      sandbox = await Sandbox.create({
        apiKey: process.env.E2B_API_KEY,
      });
      const execution = await sandbox.runCode(code);

      // Collect all output
      const stdout = execution.logs.stdout.join("\n");
      const stderr = execution.logs.stderr.join("\n");
      const results = execution.results.map((r) => ({
        text: r.text,
        png: r.png,  // base64 encoded image if any
        html: r.html,
      }));

      return JSON.stringify({
        type: "code_execution",
        code,
        stdout,
        stderr,
        results,
        error: execution.error ? execution.error.name + ": " + execution.error.value : null,
      });
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : "Unknown error";
      return JSON.stringify({
        type: "code_execution_error",
        code,
        error: errMsg,
      });
    } finally {
      if (sandbox) {
        await sandbox.kill().catch(() => {});
      }
    }
  },
  {
    name: "execute_python",
    description:
      "Execute Python code in a fresh Jupyter notebook sandbox and return the result. IMPORTANT: Each invocation creates a NEW isolated sandbox — variables, imports, and files from previous executions are NOT available. Every code block MUST be fully self-contained with all imports, file reads (e.g. pd.read_csv('/home/user/xxx.csv')), and variable definitions. If a task has multiple steps, combine them into a single code block. The sandbox has common data science packages pre-installed (pandas, numpy, matplotlib, seaborn, scikit-learn, etc.).",
    schema: z.object({
      code: z
        .string()
        .describe(
          "The complete, self-contained Python code to execute. MUST include all necessary imports, data loading, and variable definitions — do NOT reference variables from previous executions."
        ),
    }),
  }
);

const tools = [confirmAction, searchKnowledge, calculateData, executePython];

function createModel() {
  return new ChatOpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    configuration: {
      baseURL: process.env.OPENAI_BASE_URL,
    },
    model: "qwen3-coder",
    temperature: 0.7,
    streaming: true,
  }).bindTools(tools);
}

export async function POST(req: Request) {
  const { messages, files, toolResult, sessionFiles } = await req.json();

  const model = createModel();

  type ChatMsg = { role: string; content: string; tool_call_id?: string };
  interface FileInfo {
    name: string;
    size: number;
    preview: string;
    isGenerated?: boolean;
    richPreview?: {
      fileName: string;
      shape: [number, number];
      columns: string[];
      dtypes: Record<string, string>;
      head: string;
      describe: string;
      null_counts: Record<string, number>;
    };
  }

  // Helper: format a single file's context string
  function formatFileContext(f: FileInfo): string {
    const sourceTag = f.isGenerated ? " [代码执行生成]" : " [用户上传]";
    if (f.richPreview) {
      const rp = f.richPreview;
      const nullInfo = Object.entries(rp.null_counts)
        .filter(([, v]) => v > 0)
        .map(([k, v]) => `  ${k}: ${v}个空值`)
        .join("\n");
      return `📎 文件: ${f.name}${sourceTag} (${f.size} bytes)
📊 数据概况: ${rp.shape[0]}行 × ${rp.shape[1]}列
📋 列名: ${rp.columns.join(", ")}
📋 列类型:\n${Object.entries(rp.dtypes).map(([k, v]) => `  ${k}: ${v}`).join("\n")}
📋 前5行数据:\n\`\`\`\n${rp.head}\n\`\`\`
📋 统计摘要:\n\`\`\`\n${rp.describe}\n\`\`\`${nullInfo ? `\n⚠️ 空值情况:\n${nullInfo}` : ""}
在Python代码中使用路径: /home/user/${f.name}`;
    }
    return `📎 文件: ${f.name}${sourceTag} (${f.size} bytes)\n文件内容预览(前几行):\n\`\`\`\n${f.preview}\n\`\`\`\n在Python代码中使用路径: /home/user/${f.name}`;
  }

  // Build session-level file context (injected into system prompt so it's always visible)
  let sessionFileContext = "";
  const effectiveSessionFiles: FileInfo[] = sessionFiles && Array.isArray(sessionFiles) && sessionFiles.length > 0
    ? sessionFiles
    : files && Array.isArray(files) && files.length > 0
      ? files
      : [];
  if (effectiveSessionFiles.length > 0) {
    sessionFileContext = "\n\n【当前会话中可用的数据文件】\n" +
      effectiveSessionFiles.map((f: FileInfo) => formatFileContext(f)).join("\n\n");
  }

  // Inject NEW file context into the last user message (so the LLM knows this turn has new files)
  let processedMessages: ChatMsg[] = messages;
  if (files && Array.isArray(files) && files.length > 0) {
    const newFileContext = files
      .map((f: FileInfo) => `\n\n` + formatFileContext(f))
      .join("");
    processedMessages = messages.map((msg: ChatMsg, index: number) => {
      if (index === messages.length - 1 && msg.role === "user") {
        return { ...msg, content: msg.content + newFileContext };
      }
      return msg;
    });
  }

  // Convert messages to LangChain format
  const langchainMessages = [
    new SystemMessage(
      `你是一个智能数据分析助手 (Next Analyst)。你可以帮助用户进行数据分析、回答问题、执行计算、编写和运行Python代码。
      
你有以下工具可以使用:
- execute_python: 在Jupyter沙盒中执行Python代码，适用于数据分析、数据处理、生成图表、复杂计算等场景。沙盒已预装 pandas, numpy, matplotlib, seaborn, scikit-learn 等常用库。
- confirm_action: 当需要用户确认重要操作时使用
- search_knowledge: 搜索知识库获取信息
- calculate: 执行简单数学计算

重要规则:
1. 当用户需要数据分析、处理数据、生成图表、或任何需要编程解决的问题时，优先使用 execute_python 工具。
2. 请用中文回答问题。
3. 如果用户要求执行重要操作（如删除数据、修改配置等），请先使用 confirm_action 工具获取用户确认。
4. 执行代码后，请解释代码的执行结果。
5. 当用户上传文件时，文件会自动上传到沙箱环境的 /home/user/ 目录。在Python代码中通过该路径读取文件，例如: pd.read_csv('/home/user/data.csv')。
6. 你会收到系统通过沙盒自动解析的数据文件结构信息，包括：列名、数据类型、前5行数据、统计摘要和空值情况。请充分利用这些结构化信息来制定准确的数据分析方案，不要假设文件有你未看到的列或数据结构。
7. 如果收到文件的结构化预览信息，请先向用户简要描述数据概况（行列数、主要字段、数据类型等），然后根据用户需求制定分析方案，最后生成执行代码。
8. 【代码块独立完整原则】每次调用 execute_python 时，沙盒环境都是全新的，前一次执行的变量、导入的库、加载的数据在下一次执行中不可用。因此，每个代码块必须是完全独立的、可直接运行的完整代码，包括:
   - 所有必要的 import 语句
   - 重新读取/加载数据文件（如 pd.read_csv('/home/user/xxx.csv')）
   - 重新定义所有需要用到的变量和函数
   - 不得引用或依赖前一个代码块中定义的任何变量
   绝对不要假设之前的代码块已经执行过或其变量仍然存在。如果一个分析任务需要多个步骤，尽量将它们合并到一个代码块中执行。
9. 【生成文件自动保留】代码执行中生成的新文件（如清洗后的数据集、处理结果等）会自动保留在会话中。后续代码执行时，这些文件会被自动上传到沙盒的 /home/user/ 目录，可直接通过路径访问。当会话文件列表中同时存在原始文件和处理后的文件时，请根据用户需求选择合适的文件进行操作（通常应使用最新处理过的文件）。
10. 【matplotlib 图表规范】生成图表时务必遵守以下规范以避免重复显示：
   - 调用 plt.savefig() 保存图片后，必须紧接着调用 plt.close('all') 关闭图形
   - 不要在保存后再调用 plt.show()
   - 不要用 PIL/Image 打开刚保存的图片文件来显示
   - 正确模式: plt.savefig('output.png', dpi=150, bbox_inches='tight'); plt.close('all'); print('图表已保存为 output.png')
   - 如果不需要保存为文件只是展示，可以使用 plt.show() 但不要同时 savefig${sessionFileContext}`
    ),
    ...processedMessages.map(
      (msg: { role: string; content: string; tool_call_id?: string }) => {
        if (msg.role === "user") return new HumanMessage(msg.content);
        if (msg.role === "assistant") return new AIMessage(msg.content);
        return new HumanMessage(msg.content);
      }
    ),
  ];

  // If this is a continuation after HITL tool execution, add the result context
  if (toolResult) {
    const resultParts: string[] = [];
    if (toolResult.code) resultParts.push(`执行的代码:\n\`\`\`python\n${toolResult.code}\n\`\`\``);
    if (toolResult.stdout) resultParts.push(`标准输出:\n${toolResult.stdout}`);
    if (toolResult.stderr) resultParts.push(`标准错误:\n${toolResult.stderr}`);
    if (toolResult.error) resultParts.push(`错误: ${toolResult.error}`);
    if (toolResult.results && toolResult.results.length > 0) {
      const descriptions = toolResult.results
        .map((r: { text?: string; png?: string; html?: string }) => {
          if (r.png) return "[生成了图表]";
          if (r.text) return r.text;
          if (r.html) return "[生成了HTML内容]";
          return "";
        })
        .filter(Boolean);
      if (descriptions.length > 0) resultParts.push(`执行结果:\n${descriptions.join("\n")}`);
    }
    if (toolResult.generatedFiles && Array.isArray(toolResult.generatedFiles) && toolResult.generatedFiles.length > 0) {
      const fileDescs = toolResult.generatedFiles
        .map((f: { name: string; size: number }) => `- /home/user/${f.name} (${f.size} bytes)`)
        .join("\n");
      resultParts.push(`生成的新文件:\n${fileDescs}\n这些文件已保存在会话中，后续代码执行时可通过上述路径访问。`);
    }
    langchainMessages.push(
      new HumanMessage(
        `[系统消息] 之前请求的Python代码已执行完毕，结果如下:\n\n${resultParts.join("\n\n")}\n\n请根据执行结果为用户提供分析和解释。`
      )
    );
  }

  // Create a streaming response with agent loop
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        let currentMessages: BaseMessage[] = [...langchainMessages];
        const MAX_ITERATIONS = 10;

        for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
          let response = new AIMessageChunk({ content: "" });
          const stream = await model.stream(currentMessages);

          for await (const chunk of stream) {
            response = response.concat(chunk);
            if (chunk.content && typeof chunk.content === "string") {
              const content = chunk.content;
              if (content) {
                controller.enqueue(
                  encoder.encode(
                    `data: ${JSON.stringify({
                      type: "text_delta",
                      content: content,
                    })}\n\n`
                  )
                );
              }
            }
          }

          // Check if there are tool calls
          if (response.tool_calls && response.tool_calls.length > 0) {
            // Text content was already streamed via text_delta

            let hasPendingToolCall = false;
            const toolMessages: ToolMessage[] = [];

            for (const toolCall of response.tool_calls) {
              const matchedTool = tools.find((t) => t.name === toolCall.name);
              if (!matchedTool) continue;

              if (toolCall.name === "execute_python") {
                hasPendingToolCall = true;
                controller.enqueue(
                  encoder.encode(
                    `data: ${JSON.stringify({
                      type: "pending_tool_call",
                      tool: toolCall.name,
                      args: toolCall.args,
                    })}\n\n`
                  )
                );
              } else {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const toolExecResult = await (matchedTool as any).invoke(
                  toolCall.args
                );
                controller.enqueue(
                  encoder.encode(
                    `data: ${JSON.stringify({
                      type: "tool_call",
                      tool: toolCall.name,
                      args: toolCall.args,
                      result: JSON.parse(toolExecResult as string),
                    })}\n\n`
                  )
                );
                toolMessages.push(
                  new ToolMessage({
                    tool_call_id: toolCall.id!,
                    content: toolExecResult as string,
                  })
                );
              }
            }

            if (hasPendingToolCall) {
              // Can't continue loop - need user approval first
              break;
            }

            // All tools executed, feed results back to model for follow-up
            // We use the full accumulated response as the AI message
            currentMessages = [...currentMessages, response, ...toolMessages];
            continue;
          }

          // No tool calls - streaming already finished
          break;
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
