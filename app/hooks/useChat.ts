"use client";

import { useState, useCallback } from "react";

export interface FilePreview {
  fileName: string;
  shape: [number, number];
  columns: string[];
  dtypes: Record<string, string>;
  head: string;
  describe: string;
  null_counts: Record<string, number>;
}

export interface FileAttachment {
  id: string;
  name: string;
  type: string;
  size: number;
  content: string;
  preview: string;
  richPreview?: FilePreview;
  isPreviewing?: boolean;
  previewError?: string;
  isGenerated?: boolean;
}

export interface MessagePart {
  type: "text" | "tool_call" | "plan";
  text?: string;
  toolCall?: ToolCall;
  plan?: Plan;
}

export interface Plan {
  id: string;
  steps: PlanStep[];
  currentStepIndex: number;
  isComplete: boolean;
}

export interface PlanStep {
  id: string;
  title: string;
  description?: string;
  status: "pending" | "in_progress" | "completed" | "failed";
  result?: string;
}

export interface Message {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  files?: FileAttachment[];
  toolCalls?: ToolCall[];
  parts?: MessagePart[];
  plan?: Plan;
  isStreaming?: boolean;
}

export interface ToolCall {
  tool: string;
  args: Record<string, unknown>;
  status: "pending" | "approved" | "rejected" | "completed";
  result?: {
    type: string;
    [key: string]: unknown;
  };
  // Plan context for HITL continuation
  planContext?: {
    plan: Plan;
    currentStepIndex: number;
  };
}

export function useChat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<FileAttachment[]>([]);
  const [sessionFiles, setSessionFiles] = useState<FileAttachment[]>([]);
  const [isPreviewingFiles, setIsPreviewingFiles] = useState(false);

  // Fetch rich preview (first 5 rows + dtypes + shape) from sandbox
  const fetchRichPreview = useCallback(async (file: FileAttachment) => {
    try {
      const response = await fetch("/api/chat/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          file: { name: file.name, content: file.content },
        }),
      });
      const data = await response.json();
      if (data.success && data.preview) {
        return { preview: data.preview as FilePreview, error: undefined };
      }
      return { preview: undefined, error: data.error || "Failed to preview file" };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : "Preview failed";
      return { preview: undefined, error: errMsg };
    }
  }, []);

  const addFiles = useCallback(
    (files: FileAttachment[]) => {
      // Add files immediately with isPreviewing flag
      const filesWithFlag = files.map((f) => ({ ...f, isPreviewing: true }));
      setPendingFiles((prev) => [...prev, ...filesWithFlag]);

      // Trigger sandbox preview for each data file
      setIsPreviewingFiles(true);
      const previewPromises = filesWithFlag.map(async (file) => {
        const ext = file.name.split(".").pop()?.toLowerCase() || "";
        const dataExts = ["csv", "tsv", "txt", "json", "xlsx", "xls", "parquet"];
        if (!dataExts.includes(ext)) {
          // Not a data file, skip sandbox preview
          setPendingFiles((prev) =>
            prev.map((f) => (f.id === file.id ? { ...f, isPreviewing: false } : f))
          );
          return;
        }

        const richPreview = await fetchRichPreview(file);
        setPendingFiles((prev) =>
          prev.map((f) =>
            f.id === file.id
              ? {
                  ...f,
                  richPreview: richPreview.preview || undefined,
                  previewError: richPreview.error,
                  isPreviewing: false
                }
              : f
          )
        );
      });

      Promise.all(previewPromises).finally(() => {
        setIsPreviewingFiles(false);
      });
    },
    [fetchRichPreview]
  );

  const removeFile = useCallback((id: string) => {
    setPendingFiles((prev) => prev.filter((f) => f.id !== id));
  }, []);

  const sendMessage = useCallback(
    async (content: string) => {
      const currentFiles = [...pendingFiles];

      const userMessage: Message = {
        id: Date.now().toString(),
        role: "user",
        content,
        files: currentFiles.length > 0 ? currentFiles : undefined,
      };

      // Move pending files to session files
      if (currentFiles.length > 0) {
        setSessionFiles((prev) => [...prev, ...currentFiles]);
        setPendingFiles([]);
      }

      setMessages((prev) => [...prev, userMessage]);
      setIsLoading(true);

      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: "",
        toolCalls: [],
        isStreaming: true,
      };

      setMessages((prev) => [...prev, assistantMessage]);

      try {
        const allMessages = [
          ...messages.map((m) => ({
            role: m.role,
            content: m.content,
          })),
          { role: "user" as const, content },
        ];

        // Build file context: prefer rich preview from sandbox, fallback to raw text
        const fileContext =
          currentFiles.length > 0
            ? currentFiles.map((f) => ({
                name: f.name,
                size: f.size,
                type: f.type,
                preview: f.preview,
                richPreview: f.richPreview || undefined,
              }))
            : undefined;

        // Always send session files metadata so the LLM knows about all uploaded files
        const allSessionFiles = [...sessionFiles, ...currentFiles];
        const sessionFilesContext =
          allSessionFiles.length > 0
            ? allSessionFiles.map((f) => ({
                name: f.name,
                size: f.size,
                type: f.type,
                preview: f.preview,
                richPreview: f.richPreview || undefined,
                isGenerated: f.isGenerated || false,
              }))
            : undefined;

        const response = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: allMessages,
            files: fileContext,
            sessionFiles: sessionFilesContext,
          }),
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const reader = response.body?.getReader();
        if (!reader) throw new Error("No reader");

        const decoder = new TextDecoder();
        let accContent = "";
        const accToolCalls: ToolCall[] = [];
        const accParts: MessagePart[] = [];

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const text = decoder.decode(value, { stream: true });
          const lines = text.split("\n");

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const jsonStr = line.slice(6).trim();
            if (!jsonStr) continue;

            try {
              const data = JSON.parse(jsonStr);

              if (data.type === "text_delta") {
                accContent += data.content;

                // Directly update accParts - single source of truth
                if (accParts.length > 0 && accParts[accParts.length - 1].type === "text") {
                   const lastPart = accParts[accParts.length - 1];
                   accParts[accParts.length - 1] = {
                     type: "text",
                     text: (lastPart.text || "") + data.content
                   };
                } else {
                  accParts.push({ type: "text", text: data.content });
                }

                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantMessage.id
                      ? { ...m, content: accContent, parts: [...accParts] }
                      : m
                  )
                );
              } else if (data.type === "text") {
                accContent += data.content;

                // Directly update accParts - single source of truth
                if (accParts.length > 0 && accParts[accParts.length - 1].type === "text") {
                   const lastPart = accParts[accParts.length - 1];
                   accParts[accParts.length - 1] = {
                     type: "text",
                     text: (lastPart.text || "") + data.content
                   };
                } else {
                  accParts.push({ type: "text", text: data.content });
                }

                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantMessage.id
                      ? { ...m, content: accContent, parts: [...accParts] }
                      : m
                  )
                );
              } else if (data.type === "tool_call") {
                const newToolCall: ToolCall = {
                  tool: data.tool,
                  args: data.args,
                  status: "completed",
                  result: data.result,
                };
                accToolCalls.push(newToolCall);
                const newPart: MessagePart = { type: "tool_call", toolCall: newToolCall };
                accParts.push(newPart);

                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantMessage.id
                      ? { ...m, toolCalls: [...accToolCalls], parts: [...accParts] }
                      : m
                  )
                );
              } else if (data.type === "pending_tool_call") {
                // HITL: code execution requires user confirmation
                const newToolCall: ToolCall = {
                  tool: data.tool,
                  args: data.args,
                  status: "pending",
                  planContext: data.planContext,
                };
                accToolCalls.push(newToolCall);
                 const newPart: MessagePart = { type: "tool_call", toolCall: newToolCall };
                 accParts.push(newPart);

                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantMessage.id
                      ? { ...m, toolCalls: [...accToolCalls], parts: [...accParts] }
                      : m
                  )
                );
              } else if (data.type === "plan_created") {
                // Plan created by agent
                const plan = data.plan as Plan;
                const newPart: MessagePart = { type: "plan", plan };
                accParts.push(newPart);

                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantMessage.id
                      ? { ...m, plan, parts: [...accParts] }
                      : m
                  )
                );
              } else if (data.type === "plan_step_update") {
                // Update plan step status - find the message with the plan
                const { stepIndex, status } = data as { stepIndex: number; status: string };
                setMessages((prev) => {
                  // Find the message that has a plan (could be current or previous message)
                  const planMsgIndex = prev.findIndex((m) => m.plan != null);
                  if (planMsgIndex === -1) return prev;

                  return prev.map((m, idx) => {
                    if (idx !== planMsgIndex || !m.plan) return m;
                    const updatedSteps = m.plan.steps.map((step, i) =>
                      i === stepIndex ? { ...step, status: status as PlanStep["status"] } : step
                    );
                    const completedCount = updatedSteps.filter((s) => s.status === "completed").length;
                    const updatedPlan = {
                      ...m.plan,
                      steps: updatedSteps,
                      currentStepIndex: stepIndex,
                      isComplete: completedCount === updatedSteps.length,
                    };
                    const updatedParts = m.parts?.map((p) =>
                      p.type === "plan" ? { ...p, plan: updatedPlan } : p
                    );
                    return { ...m, plan: updatedPlan, parts: updatedParts };
                  });
                });
              } else if (data.type === "error") {
                accContent += data.content;
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantMessage.id
                      ? { ...m, content: accContent }
                      : m
                  )
                );
              } else if (data.type === "done") {
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantMessage.id
                      ? { ...m, isStreaming: false }
                      : m
                  )
                );
              }
            } catch {
              // skip invalid JSON
            }
          }
        }
      } catch (error: unknown) {
        const errorMsg =
          error instanceof Error ? error.message : "Unknown error";
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMessage.id
              ? {
                  ...m,
                  content: `发生错误: ${errorMsg}`,
                  isStreaming: false,
                }
              : m
          )
        );
      } finally {
        setIsLoading(false);
      }
    },
    [messages, pendingFiles, sessionFiles]
  );

  // HITL: Approve a pending tool call, execute the code, then get AI follow-up
  const approveToolCall = useCallback(
    async (messageId: string, toolCallIndex: number) => {
      const msg = messages.find((m) => m.id === messageId);
      const tc = msg?.toolCalls?.[toolCallIndex];
      if (!tc || tc.status !== "pending") return;

      // Mark as approved (loading)
      setMessages((prev) =>
        prev.map((m) => {
          if (m.id !== messageId) return m;

          let toolCallCounter = 0;
          const newParts = m.parts?.map((part) => {
            if (part.type === "tool_call" && part.toolCall) {
              if (toolCallCounter === toolCallIndex) {
                toolCallCounter++;
                return {
                  ...part,
                  toolCall: { ...part.toolCall, status: "approved" as const },
                };
              }
              toolCallCounter++;
            }
            return part;
          });

          return {
            ...m,
            toolCalls: m.toolCalls?.map((t, i) =>
              i === toolCallIndex ? { ...t, status: "approved" as const } : t
            ),
            parts: newParts,
          };
        })
      );

      let executionResult: Record<string, unknown> | null = null;

      try {
        const response = await fetch("/api/chat/execute", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tool: tc.tool,
            args: tc.args,
            files: sessionFiles.map((f) => ({
              name: f.name,
              content: f.content,
            })),
          }),
        });

        executionResult = await response.json();

        setMessages((prev) =>
          prev.map((m) =>
            m.id === messageId
              ? {
                  ...m,
                  toolCalls: m.toolCalls?.map((t, i) =>
                    i === toolCallIndex
                      ? { ...t, status: "completed" as const, result: executionResult as ToolCall["result"] }
                      : t
                  ),
                }
              : m
          )
        );
      } catch (error: unknown) {
        const errMsg = error instanceof Error ? error.message : "执行失败";
        setMessages((prev) =>
          prev.map((m) =>
            m.id === messageId
              ? {
                  ...m,
                  toolCalls: m.toolCalls?.map((t, i) =>
                    i === toolCallIndex
                      ? {
                          ...t,
                          status: "completed" as const,
                          result: { type: "code_execution_error", error: errMsg },
                        }
                      : t
                  ),
                }
              : m
          )
        );
        return; // Don't trigger follow-up if execution request itself failed
      }

      // Add generated files to session for future sandbox executions
      interface GeneratedFileInfo {
        name: string;
        content: string;
        size: number;
        richPreview?: FilePreview;
      }
      const genFiles = ((executionResult as Record<string, unknown>)?.generatedFiles as GeneratedFileInfo[] | undefined) || [];
      const newGenSessionFiles: FileAttachment[] = genFiles.map((gf) => {
        const ext = gf.name.split(".").pop()?.toLowerCase() || "";
        const mimeMap: Record<string, string> = {
          csv: "text/csv", json: "application/json", txt: "text/plain",
          xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          xls: "application/vnd.ms-excel", parquet: "application/octet-stream",
          png: "image/png", jpg: "image/jpeg", html: "text/html", md: "text/markdown",
        };
        return {
          id: `gen-${Date.now()}-${Math.random().toString(36).slice(2)}-${gf.name}`,
          name: gf.name,
          type: mimeMap[ext] || "application/octet-stream",
          size: gf.size,
          content: gf.content,
          preview: "(代码执行生成的文件)",
          richPreview: gf.richPreview as FilePreview | undefined,
          isPreviewing: false,
          isGenerated: true,
        };
      });

      if (newGenSessionFiles.length > 0) {
        setSessionFiles((prev) => {
          const newNames = new Set(newGenSessionFiles.map((f) => f.name));
          return [...prev.filter((f) => !newNames.has(f.name)), ...newGenSessionFiles];
        });
      }

      // --- Follow-up: Send tool result to AI for analysis ---
      if (!executionResult) return;

      // Get the latest message state to avoid stale closure
      setMessages((prev) => {
        const currentMsg = prev.find((m) => m.id === messageId);
        if (!currentMsg) return prev;

        return prev.map((m) =>
          m.id === messageId ? { ...m, isStreaming: true } : m
        );
      });
      setIsLoading(true);

      try {
        // Build conversation history up to the assistant message
        const msgIndex = messages.findIndex((m) => m.id === messageId);
        const conversationHistory = messages.slice(0, msgIndex).map((m) => ({
          role: m.role,
          content: m.content,
        }));

        // Add the assistant's existing content as context
        if (msg?.content) {
          conversationHistory.push({
            role: "assistant",
            content: msg.content,
          });
        }

        // Include session files metadata (merged with newly generated files)
        const effectiveSessionFiles = (() => {
          const newNames = new Set(newGenSessionFiles.map((f) => f.name));
          return [...sessionFiles.filter((f) => !newNames.has(f.name)), ...newGenSessionFiles];
        })();
        const sessionFilesContext =
          effectiveSessionFiles.length > 0
            ? effectiveSessionFiles.map((f) => ({
                name: f.name,
                size: f.size,
                type: f.type,
                preview: f.preview,
                richPreview: f.richPreview || undefined,
                isGenerated: f.isGenerated || false,
              }))
            : undefined;

        const followUpResponse = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: conversationHistory,
            toolResult: executionResult,
            sessionFiles: sessionFilesContext,
            // Pass plan context for automatic step status updates
            plan: tc.planContext?.plan,
            currentStepIndex: tc.planContext?.currentStepIndex,
          }),
        });

        if (!followUpResponse.ok) throw new Error(`HTTP ${followUpResponse.status}`);

        const reader = followUpResponse.body?.getReader();
        if (!reader) throw new Error("No reader");

        const decoder = new TextDecoder();

        // Initialize accumulators from current message state
        let accContent = msg?.content || "";
        if (accContent) accContent += "\n\n";

        // Build initial state from the updated tool call result
        const initialToolCalls = msg?.toolCalls?.map((t, i) =>
             i === toolCallIndex
               ? { ...t, status: "completed" as const, result: executionResult as ToolCall["result"] }
               : t
        ) || [];

        let toolCallCounter = 0;
        const initialParts = msg?.parts?.map(part => {
             if (part.type === 'tool_call' && part.toolCall) {
                if (toolCallCounter === toolCallIndex) {
                   toolCallCounter++;
                   return { ...part, toolCall: { ...part.toolCall, status: "completed" as const, result: executionResult as ToolCall["result"] } };
                }
                toolCallCounter++;
             }
             return part;
        }) || [];

        const accToolCalls = [...initialToolCalls];
        const accParts = [...initialParts];

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const text = decoder.decode(value, { stream: true });
          const lines = text.split("\n");

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const jsonStr = line.slice(6).trim();
            if (!jsonStr) continue;

            try {
              const data = JSON.parse(jsonStr);

              if (data.type === "text_delta" || data.type === "text") {
                accContent += data.content;

                // Directly update accParts - single source of truth
                if (accParts.length > 0 && accParts[accParts.length - 1].type === "text") {
                   const lastPart = accParts[accParts.length - 1];
                   accParts[accParts.length - 1] = {
                     type: "text",
                     text: (lastPart.text || "") + data.content
                   };
                } else {
                  accParts.push({ type: "text", text: data.content });
                }

                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === messageId ? { ...m, content: accContent, parts: [...accParts] } : m
                  )
                );
              } else if (data.type === "tool_call") {
                const newToolCall: ToolCall = {
                   tool: data.tool,
                   args: data.args,
                   status: "completed",
                   result: data.result,
                };
                accToolCalls.push(newToolCall);
                accParts.push({ type: "tool_call", toolCall: newToolCall });

                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === messageId
                      ? {
                          ...m,
                          toolCalls: [...accToolCalls],
                          parts: [...accParts]
                        }
                      : m
                  )
                );
              } else if (data.type === "pending_tool_call") {
                const newToolCall: ToolCall = {
                   tool: data.tool,
                   args: data.args,
                   status: "pending",
                   planContext: data.planContext,
                };
                accToolCalls.push(newToolCall);
                accParts.push({ type: "tool_call", toolCall: newToolCall });

                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === messageId
                      ? {
                          ...m,
                          toolCalls: [...accToolCalls],
                          parts: [...accParts],
                        }
                      : m
                  )
                );
              } else if (data.type === "plan_created") {
                // Plan created by agent during follow-up
                const plan = data.plan as Plan;
                accParts.push({ type: "plan", plan });

                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === messageId
                      ? { ...m, plan, parts: [...accParts] }
                      : m
                  )
                );
              } else if (data.type === "plan_step_update") {
                // Update plan step status during follow-up - find the message with the plan
                const { stepIndex, status } = data as { stepIndex: number; status: string };
                setMessages((prev) => {
                  const planMsgIndex = prev.findIndex((m) => m.plan != null);
                  if (planMsgIndex === -1) return prev;

                  return prev.map((m, idx) => {
                    if (idx !== planMsgIndex || !m.plan) return m;
                    const updatedSteps = m.plan.steps.map((step, i) =>
                      i === stepIndex ? { ...step, status: status as PlanStep["status"] } : step
                    );
                    const completedCount = updatedSteps.filter((s) => s.status === "completed").length;
                    const updatedPlan = {
                      ...m.plan,
                      steps: updatedSteps,
                      currentStepIndex: stepIndex,
                      isComplete: completedCount === updatedSteps.length,
                    };
                    const updatedParts = m.parts?.map((p) =>
                      p.type === "plan" ? { ...p, plan: updatedPlan } : p
                    );
                    return { ...m, plan: updatedPlan, parts: updatedParts };
                  });
                });
              } else if (data.type === "done") {
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === messageId ? { ...m, isStreaming: false } : m
                  )
                );
              }
            } catch {
              // skip invalid JSON
            }
          }
        }
      } catch (error: unknown) {
        const errMsg = error instanceof Error ? error.message : "分析失败";
        setMessages((prev) =>
          prev.map((m) =>
            m.id === messageId
              ? {
                  ...m,
                  content: (m.content || "") + `\n\n分析结果时出错: ${errMsg}`,
                  isStreaming: false,
                }
              : m
          )
        );
      } finally {
        setIsLoading(false);
      }
    },
    [messages, sessionFiles]
  );

  // HITL: Reject a pending tool call
  const rejectToolCall = useCallback(
    (messageId: string, toolCallIndex: number) => {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === messageId
            ? {
                ...m,
                toolCalls: m.toolCalls?.map((t, i) =>
                  i === toolCallIndex
                    ? { ...t, status: "rejected" as const }
                    : t
                ),
              }
            : m
        )
      );
    },
    []
  );

  const clearMessages = useCallback(() => {
    setMessages([]);
    setPendingFiles([]);
    setSessionFiles([]);
  }, []);

  return {
    messages,
    isLoading,
    isPreviewingFiles,
    sendMessage,
    clearMessages,
    approveToolCall,
    rejectToolCall,
    pendingFiles,
    sessionFiles,
    addFiles,
    removeFile,
  };
}
