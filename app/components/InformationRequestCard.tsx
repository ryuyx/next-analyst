"use client";

import type { ToolCall } from "../hooks/useChat";

interface InformationRequestCardProps {
  toolCall: ToolCall;
}

export function InformationRequestCard({ toolCall }: InformationRequestCardProps) {
  const { question, context } = toolCall.args as {
    question: string;
    context?: string;
  };

  return (
    <div className="my-3 rounded-xl border border-blue-200/75 bg-blue-50/50 p-4 shadow-sm dark:border-blue-800 dark:bg-blue-950/20">
      <div className="mb-2 flex items-center gap-2">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-100 text-sm dark:bg-blue-900/50">
          💬
        </span>
        <span className="font-semibold text-blue-900 dark:text-blue-200">
          需要更多信息
        </span>
      </div>

      {context && (
        <div className="mb-2 text-xs text-blue-700/70 dark:text-blue-300/70">
          {context}
        </div>
      )}

      <div className="rounded-lg bg-white/60 p-3 text-sm text-blue-900 dark:bg-blue-950/40 dark:text-blue-100">
        <span className="font-medium">问题：</span>
        {question}
      </div>

      <div className="mt-3 text-xs text-blue-600/80 dark:text-blue-400/80">
        💡 请在下方输入框中回答这个问题
      </div>
    </div>
  );
}
