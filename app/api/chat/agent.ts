import {
  StateGraph,
  MessagesAnnotation,
  Annotation,
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
// Plan Types
// ============================================================

export interface PlanStep {
  id: string;
  title: string;
  description?: string;
  status: "pending" | "in_progress" | "completed" | "failed";
  result?: string;
}

export interface Plan {
  id: string;
  steps: PlanStep[];
  currentStepIndex: number;
  isComplete: boolean;
}

// Extended State with Plan support
const PlanAnnotation = Annotation.Root({
  ...MessagesAnnotation.spec,
  plan: Annotation<Plan | null>({
    default: () => null,
    reducer: (_, newPlan) => newPlan,
  }),
  currentStepIndex: Annotation<number>({
    default: () => 0,
    reducer: (_, newVal) => newVal,
  }),
  // Pending step updates to emit to client
  pendingStepUpdates: Annotation<Array<{ stepIndex: number; status: string }>>({
    default: () => [],
    reducer: (_, newVal) => newVal,
  }),
});

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

// create_plan: Used by planner to create a structured plan
const createPlan = tool(
  async ({ steps }) => {
    const planSteps: PlanStep[] = steps.map((step, index) => ({
      id: `step-${index + 1}`,
      title: step.title,
      description: step.description,
      status: "pending" as const,
    }));

    return JSON.stringify({
      type: "plan_created",
      plan: {
        id: `plan-${Date.now()}`,
        steps: planSteps,
        currentStepIndex: 0,
        isComplete: false,
      },
    });
  },
  {
    name: "create_plan",
    description:
      "Create a structured execution plan with multiple steps. Use this when the user's request requires multiple operations. Each step should be a discrete, actionable task.",
    schema: z.object({
      steps: z
        .array(
          z.object({
            title: z.string().describe("Brief title of the step (e.g., '数据清洗', '绘制分布图')"),
            description: z.string().describe("Detailed description of what this step will do").optional(),
          })
        )
        .min(1)
        .max(10)
        .describe("List of steps to execute in order"),
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
const allTools = [...safeTools, executePython, createPlan];

// ============================================================
// System Prompt
// ============================================================

const SYSTEM_PROMPT = `你是 Next Analyst，一个数据分析助手。请用中文回答。

## 可用工具
- execute_python: 在隔离沙盒中执行Python代码（pandas/numpy/matplotlib/seaborn/sklearn已预装）
- create_plan: 创建执行计划，将复杂任务分解为多个步骤（计划步骤状态会自动更新，无需手动管理）
- present_analysis_options: 【必须调用】上传数据后展示分析选项，禁止用文本列出选项
- ask_for_information: 需要更多信息时向用户提问
- confirm_action: 危险操作前获取用户确认
- search_knowledge: 搜索知识库
- calculate: 简单数学计算

## 核心规则

### 1. 任务规划（重要）
当用户请求涉及多个步骤的分析任务时：
1. 首先调用 create_plan 工具创建执行计划
2. 然后按顺序执行每个步骤（系统会自动更新步骤状态）
3. 每个步骤对应一次 execute_python 调用

不需要创建计划的情况：
- 简单的单步操作（如"查看数据前5行"）
- 用户只是上传数据还未指定分析任务
- 用户询问问题而非请求执行任务

### 2. 数据上传后的处理流程
用户上传数据且未指定分析方向时：
1. 简述数据概况（1-2句）
2. 调用 present_analysis_options 工具（禁止用文字/表格列出选项）
3. 等待用户选择后执行分析

### 3. 代码执行规范
- 每次 execute_python 都是全新沙盒，变量不保留
- 每个代码块必须完整独立：包含所有import、数据加载、变量定义
- 文件路径: /home/user/文件名
- 生成的文件会自动保留，后续可直接使用

### 4. 图表规范
\`\`\`python
plt.savefig('output.png', dpi=150, bbox_inches='tight')
\`\`\`
不要同时使用 savefig 和 show，不要提及文件保存路径。

### 5. 数据清洗
根据预览信息自主判断是否需要清洗（缺失值、类型异常、异常值、重复数据），无需询问用户。清洗后保存为新文件供后续使用。

### 6. 其他
- 系统会提供数据预览（列名、类型、统计摘要、空值情况）和推荐分析策略，据此制定分析方案
- 危险操作（删除数据等）需先用 confirm_action 确认
- 执行代码后解释结果`;

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
 * - If the model called `create_plan` → route to "plan_tools" for plan creation
 * - Otherwise → route to the "tools" node for auto-execution.
 */
function routeAfterAgent(
  state: typeof PlanAnnotation.State
): typeof END | "tools" | "plan_tools" {
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

    // create_plan → route to plan_tools node
    if (toolCalls.some((tc) => tc.name === "create_plan")) {
      return "plan_tools";
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
 *                 ├─ (plan tools)        → plan_tools → agent
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
  const callModel = async (state: typeof PlanAnnotation.State) => {
    const response = await model.invoke(state.messages);
    return { messages: [response] };
  };

  // Tool node — auto-execute safe tools only
  const toolNode = new ToolNode(safeTools);

  // Plan tools node — handle create_plan tool and store plan in state
  const planToolNode = async (state: typeof PlanAnnotation.State) => {
    const lastMsg = state.messages[state.messages.length - 1] as AIMessage;
    const toolCalls = lastMsg.tool_calls || [];

    const createPlanCall = toolCalls.find((tc) => tc.name === "create_plan");
    if (!createPlanCall) {
      // Fallback to regular tool node
      const node = new ToolNode([createPlan]);
      return node.invoke(state);
    }

    // Execute create_plan tool
    const result = await createPlan.invoke(createPlanCall.args as { steps: Array<{ title: string; description?: string }> });
    const parsed = JSON.parse(result);
    const plan = parsed.plan as Plan;

    // Import ToolMessage for proper response
    const { ToolMessage } = await import("@langchain/core/messages");

    return {
      messages: [new ToolMessage({ content: result, tool_call_id: createPlanCall.id! })],
      plan,
      currentStepIndex: 0,
      pendingStepUpdates: [],
    };
  };

  const graph = new StateGraph(PlanAnnotation)
    .addNode("agent", callModel)
    .addNode("tools", toolNode)
    .addNode("plan_tools", planToolNode)
    .addEdge(START, "agent")
    .addConditionalEdges("agent", routeAfterAgent)
    .addEdge("tools", "agent")
    .addEdge("plan_tools", "agent")
    .compile();

  return graph;
}
