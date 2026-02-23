import {
  StateGraph,
  MessagesAnnotation,
  START,
  END,
} from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { ChatOpenAI } from "@langchain/openai";
import { tool } from "@langchain/core/tools";
import {
  AIMessage,
  SystemMessage,
  HumanMessage,
  BaseMessage,
} from "@langchain/core/messages";
import { z } from "zod";
import { classifyDataset, formatStrategyPrompt } from "./analysis-strategies";

// ============================================================
// Tool Definitions
// ============================================================

const confirmAction = tool(
  async ({ action, description }) => {
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
      expression: z
        .string()
        .describe("The mathematical expression to evaluate"),
    }),
  }
);

const askForInformation = tool(
  async ({ question, context }) => {
    return JSON.stringify({
      type: "information_request",
      question,
      context,
      status: "waiting_for_response",
    });
  },
  {
    name: "ask_for_information",
    description:
      "When you need more information from the user to complete a task, use this tool to ask specific questions. This helps you gather requirements, clarify ambiguities, or understand user preferences before proceeding with analysis or code execution.",
    schema: z.object({
      question: z
        .string()
        .describe(
          "The specific question you want to ask the user. Be clear and concise."
        ),
      context: z
        .string()
        .describe(
          "Brief context explaining why you need this information (optional)"
        )
        .optional(),
    }),
  }
);

// execute_python: bound to the model so it can call it,
// but never executed server-side — handled via HITL on the client.
const executePython = tool(
  async () => {
    return JSON.stringify({ type: "hitl_required" });
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

/** Safe tools — auto-executed by the ToolNode inside the graph */
const safeTools = [confirmAction, searchKnowledge, calculateData, askForInformation];

/** All tools — bound to the model so the LLM can call any of them */
const allTools = [...safeTools, executePython];

// ============================================================
// System Prompt
// ============================================================

const SYSTEM_PROMPT = `你是一个智能数据分析助手 (Next Analyst)。你可以帮助用户进行数据分析、回答问题、执行计算、编写和运行Python代码。

你有以下工具可以使用:
- execute_python: 在Jupyter沙盒中执行Python代码，适用于数据分析、数据处理、生成图表、复杂计算等场景。沙盒已预装 pandas, numpy, matplotlib, seaborn, scikit-learn 等常用库。
- ask_for_information: 当你需要更多信息才能完成任务时，使用此工具向用户提问。这有助于你收集需求、澄清歧义、了解用户偏好。
- confirm_action: 当需要用户确认重要操作时使用
- search_knowledge: 搜索知识库获取信息
- calculate: 执行简单数学计算

重要规则:
1. 当用户需要数据分析、处理数据、生成图表、或任何需要编程解决的问题时，优先使用 execute_python 工具。
2. 【主动询问信息】当遇到以下情况时，应该使用 ask_for_information 工具主动向用户索取信息，而不是做出假设：
   a) 用户的需求不够明确或存在多种理解方式
   b) 需要了解用户的具体偏好（如图表类型、颜色方案、分析维度等）
   c) 数据分析方向不明确，有多种可能的分析路径
   d) 需要确认数据处理的具体方式（如缺失值处理策略、异常值阈值等）
   e) 用户提供的信息不足以完成高质量的分析
   例如：用户说"分析这个数据"但没有说明分析目标时，应该询问"您希望关注哪些方面？例如：趋势分析、异常检测、相关性分析、分类预测等"
3. 请用中文回答问题。
4. 如果用户要求执行重要操作（如删除数据、修改配置等），请先使用 confirm_action 工具获取用户确认。
5. 执行代码后，请解释代码的执行结果。
5. 当用户上传文件时，文件会自动上传到沙箱环境的 /home/user/ 目录。在Python代码中通过该路径读取文件，例如: pd.read_csv('/home/user/data.csv')。
6. 你会收到系统通过沙盒自动解析的数据文件结构信息，包括：列名、数据类型、前5行数据、统计摘要和空值情况。此外，系统还会自动生成【数据画像】和【推荐分析策略】，包含数据类型分类、适配的分析方法、具体步骤和推荐工具。请充分利用这些信息来制定准确的分析方案，不要假设文件有你未看到的列或数据结构。
7. 如果收到文件的结构化预览信息和分析策略推荐，请：
   a) 先向用户简要描述数据概况（行列数、主要字段、数据类型、数据集类型）
   b) 结合【推荐分析策略】和用户的具体问题，选择最合适的分析路径
   c) 如果用户没有明确指定分析方向，优先执行EDA探索性分析，再根据发现推荐深入分析方向
   d) 生成的代码应遵循推荐策略中的步骤和工具建议
8. 【数据清洗自主决策】你应该根据数据预览信息自主判断是否需要进行数据清洗，无需询问用户。判断依据包括：
   a) 空值情况：如果 null_counts 显示存在缺失值，根据缺失比例和列的重要性决定处理策略（删除、填充、保留）
   b) 数据类型异常：如果某列的 dtype 与其语义不符（如日期列是 object 类型），需要进行类型转换
   c) 异常值检测：通过 describe 统计信息（min/max/std）识别可能的异常值或不合理数据
   d) 重复数据：对于可能存在重复记录的数据集，检查并处理重复行
   e) 数据一致性：检查分类变量的取值是否一致（大小写、空格、拼写等）
   当检测到数据质量问题时，应该：
   - 简要说明发现的问题（如"数据中存在15%的缺失值和3个异常值"）
   - 直接执行清洗操作，无需征求用户同意
   - 将清洗后的数据保存为新文件（如 data_cleaned.csv）
   - 说明清洗操作的具体内容和影响
   - 后续分析使用清洗后的数据
   如果数据质量良好（无明显缺失值、类型正确、无异常值），则直接进行分析，无需提及数据清洗。
8. 【数据清洗自主决策】你应该根据数据预览信息自主判断是否需要进行数据清洗，无需询问用户。判断依据包括：
   a) 空值情况：如果 null_counts 显示存在缺失值，根据缺失比例和列的重要性决定处理策略（删除、填充、保留）
   b) 数据类型异常：如果某列的 dtype 与其语义不符（如日期列是 object 类型），需要进行类型转换
   c) 异常值检测：通过 describe 统计信息（min/max/std）识别可能的异常值或不合理数据
   d) 重复数据：对于可能存在重复记录的数据集，检查并处理重复行
   e) 数据一致性：检查分类变量的取值是否一致（大小写、空格、拼写等）
   当检测到数据质量问题时，应该：
   - 简要说明发现的问题（如"数据中存在15%的缺失值和3个异常值"）
   - 直接执行清洗操作，无需征求用户同意
   - 将清洗后的数据保存为新文件（如 data_cleaned.csv）
   - 说明清洗操作的具体内容和影响
   - 后续分析使用清洗后的数据
   如果数据质量良好（无明显缺失值、类型正确、无异常值），则直接进行分析，无需提及数据清洗。
9. 【代码块独立完整原则】每次调用 execute_python 时，沙盒环境都是全新的，前一次执行的变量、导入的库、��载的数据在下一次执行中不可用。因此，每个代码块必须是完全独立的、可直接运行的完整代码，包括:
   - 所有必要的 import 语句
   - 重新读取/加载数据文件（如 pd.read_csv('/home/user/xxx.csv')）
   - 重新定义所有需要用到的变量和函数
   - 不得引用或依赖前一个代码块中定义的任何变量
   绝对不要假设之前的代码块已经执行过或其变量仍然存在。如果一个分析任务需要多个步骤，尽量将它们合并到一个代码块中执行。
10. 【生成文件自动保留】代码执行中生成的新文件（如清洗后的数据集、处理结果等）会自动保留在会话中。后续代码执行时，这些文件会被自动上传到沙盒的 /home/user/ 目录，可直接通过路径访问。当会话文件列表中同时存在原始文件和处理后的文件时，请根据用户需求选择合适的文件进行操作（通常应使用最新处理过的文件）。
11. 【matplotlib 图表规范】生成图表时务必遵守以下规范以避免重复显示：
   - 调用 plt.savefig() 保存图片后，必须紧接着调用 plt.close('all') 关闭图形
   - 不要在保存后再调用 plt.show()
   - 不要用 PIL/Image 打开刚保存的图片文件来显示
   - 正确模式: plt.savefig('output.png', dpi=150, bbox_inches='tight'); plt.close('all')
   - 如果不需要保存为文件只是展示，可以使用 plt.show() 但不要同时 savefig
12. 【文件保存无感】生成的文件、图表等会自动保存到系统中，用户无需关心保存位置。不要向用户输出"文件已保存至xxx"、"图表已保存为xxx"等消息。文件保存对用户应该是完全无感的。`;

// ============================================================
// Helpers — File Context & Message Building
// ============================================================

export interface FileInfo {
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

function formatFileContext(f: FileInfo): string {
  const sourceTag = f.isGenerated ? " [代码执行生成]" : " [用户上传]";
  if (f.richPreview) {
    const rp = f.richPreview;
    const nullInfo = Object.entries(rp.null_counts)
      .filter(([, v]) => v > 0)
      .map(([k, v]) => `  ${k}: ${v}个空值`)
      .join("\n");

    let baseInfo = `📎 文件: ${f.name}${sourceTag} (${f.size} bytes)
📊 数据概况: ${rp.shape[0]}行 × ${rp.shape[1]}列
📋 列名: ${rp.columns.join(", ")}
📋 列类型:\n${Object.entries(rp.dtypes).map(([k, v]) => `  ${k}: ${v}`).join("\n")}
📋 前5行数据:\n\`\`\`\n${rp.head}\n\`\`\`
📋 统计摘要:\n\`\`\`\n${rp.describe}\n\`\`\`${nullInfo ? `\n⚠️ 空值情况:\n${nullInfo}` : ""}
在Python代码中使用路径: /home/user/${f.name}`;

    // Auto-classify dataset and inject analysis strategy recommendations
    const classification = classifyDataset(f);
    if (classification) {
      baseInfo += "\n" + formatStrategyPrompt(
        f.name,
        classification.profile,
        classification.strategies
      );
    }

    return baseInfo;
  }
  return `📎 文件: ${f.name}${sourceTag} (${f.size} bytes)\n文件内容预览(前几行):\n\`\`\`\n${f.preview}\n\`\`\`\n在Python代码中使用路径: /home/user/${f.name}`;
}

interface ToolResultPayload {
  code?: string;
  stdout?: string;
  stderr?: string;
  error?: string;
  results?: Array<{ text?: string; png?: string; html?: string }>;
  generatedFiles?: Array<{ name: string; size: number }>;
}

/**
 * Build the LangChain message array from the HTTP request payload.
 */
export function buildLangChainMessages(
  messages: Array<{ role: string; content: string }>,
  files: FileInfo[] | undefined,
  toolResult: ToolResultPayload | undefined,
  sessionFiles: FileInfo[] | undefined
): BaseMessage[] {
  // --- Session-level file context (injected into the system prompt) ---
  let sessionFileContext = "";
  const effectiveSessionFiles: FileInfo[] =
    sessionFiles && Array.isArray(sessionFiles) && sessionFiles.length > 0
      ? sessionFiles
      : files && Array.isArray(files) && files.length > 0
        ? files
        : [];
  if (effectiveSessionFiles.length > 0) {
    sessionFileContext =
      "\n\n【当前会话中可用的数据文件】\n" +
      effectiveSessionFiles.map((f) => formatFileContext(f)).join("\n\n");
  }

  // --- Inject new file context into the last user message ---
  let processedMessages = messages;
  if (files && Array.isArray(files) && files.length > 0) {
    const newFileContext = files
      .map((f) => `\n\n` + formatFileContext(f))
      .join("");
    processedMessages = messages.map((msg, index) => {
      if (index === messages.length - 1 && msg.role === "user") {
        return { ...msg, content: msg.content + newFileContext };
      }
      return msg;
    });
  }

  // --- Convert to LangChain message objects ---
  const langchainMessages: BaseMessage[] = [
    new SystemMessage(SYSTEM_PROMPT + sessionFileContext),
    ...processedMessages.map((msg) => {
      if (msg.role === "user") return new HumanMessage(msg.content);
      if (msg.role === "assistant") return new AIMessage(msg.content);
      return new HumanMessage(msg.content);
    }),
  ];

  // --- If continuing after HITL execution, append the result ---
  if (toolResult) {
    const resultParts: string[] = [];
    if (toolResult.code)
      resultParts.push(
        `执行的代码:\n\`\`\`python\n${toolResult.code}\n\`\`\``
      );
    if (toolResult.stdout)
      resultParts.push(`标准输出:\n${toolResult.stdout}`);
    if (toolResult.stderr)
      resultParts.push(`标准错误:\n${toolResult.stderr}`);
    if (toolResult.error)
      resultParts.push(`错误: ${toolResult.error}`);
    if (toolResult.results && toolResult.results.length > 0) {
      const descriptions = toolResult.results
        .map((r) => {
          if (r.png) return "[生成了图表]";
          if (r.text) return r.text;
          if (r.html) return "[生成了HTML内容]";
          return "";
        })
        .filter(Boolean);
      if (descriptions.length > 0)
        resultParts.push(`执行结果:\n${descriptions.join("\n")}`);
    }
    if (
      toolResult.generatedFiles &&
      Array.isArray(toolResult.generatedFiles) &&
      toolResult.generatedFiles.length > 0
    ) {
      const fileDescs = toolResult.generatedFiles
        .map((f) => `- /home/user/${f.name} (${f.size} bytes)`)
        .join("\n");
      resultParts.push(
        `生成的新文件:\n${fileDescs}\n这些文件已保存在会话中，后续代码执行时可通过上述路径访问。`
      );
    }
    langchainMessages.push(
      new HumanMessage(
        `[系统消息] 之前请求的Python代码已执行完毕，结果如下:\n\n${resultParts.join("\n\n")}\n\n请根据执行结果为用户提供分析和解释。`
      )
    );
  }

  return langchainMessages;
}

// ============================================================
// LangGraph — Graph Definition
// ============================================================

/**
 * Conditional router executed after the "agent" node.
 *
 * - If the model produced NO tool calls → END (text-only response).
 * - If the model called `execute_python` → END (HITL — the client
 *   will show a confirmation card, execute the code, and send a
 *   follow-up request with the result).
 * - Otherwise → route to the "tools" node for auto-execution.
 */
function routeAfterAgent(
  state: typeof MessagesAnnotation.State
): typeof END | "tools" {
  const lastMsg = state.messages[state.messages.length - 1];

  if (
    "tool_calls" in lastMsg &&
    Array.isArray((lastMsg as AIMessage).tool_calls) &&
    (lastMsg as AIMessage).tool_calls!.length > 0
  ) {
    const toolCalls = (lastMsg as AIMessage).tool_calls!;

    // execute_python requires human-in-the-loop → stop the graph
    if (toolCalls.some((tc) => tc.name === "execute_python")) {
      return END;
    }

    // All tool calls are safe — let the ToolNode handle them
    return "tools";
  }

  // No tool calls — done
  return END;
}

/**
 * Create and compile the LangGraph agent graph.
 *
 * ```
 * START → agent ─┬─ (no tools)          → END
 *                 ├─ (execute_python)    → END  (HITL)
 *                 └─ (safe tools)        → tools → agent
 * ```
 */
export function createGraph() {
  const model = new ChatOpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    configuration: {
      baseURL: process.env.OPENAI_BASE_URL,
    },
    model: process.env.LLM_MODEL || "qwen3-coder",
    temperature: 0.7,
    streaming: true,
  }).bindTools(allTools);

  // Agent node — invoke the LLM
  const callModel = async (state: typeof MessagesAnnotation.State) => {
    const response = await model.invoke(state.messages);
    return { messages: [response] };
  };

  // Tool node — auto-execute safe tools only
  const toolNode = new ToolNode(safeTools);

  const graph = new StateGraph(MessagesAnnotation)
    .addNode("agent", callModel)
    .addNode("tools", toolNode)
    .addEdge(START, "agent")
    .addConditionalEdges("agent", routeAfterAgent)
    .addEdge("tools", "agent")
    .compile();

  return graph;
}
