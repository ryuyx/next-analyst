"use client";

import type { ToolCall } from "../hooks/useChat";

interface ToolCallCardProps {
  toolCall: ToolCall;
}

export function ToolCallCard({ toolCall }: ToolCallCardProps) {
  const { tool, args, result } = toolCall;

  if (tool === "confirm_action") {
    return null; // Handled by ConfirmationCard
  }

  return (
    <div className="my-2 rounded-xl border border-indigo-100 bg-indigo-50/50 p-3 dark:border-indigo-900/30 dark:bg-indigo-950/20">
      <div className="mb-1 flex items-center gap-2 text-xs font-medium text-indigo-600 dark:text-indigo-400">
        <span className="flex h-5 w-5 items-center justify-center rounded bg-indigo-100 text-[10px] text-indigo-600 dark:bg-indigo-900/50 dark:text-indigo-400">
          🔧
        </span>
        <span>工具调用: {tool}</span>
      </div>
      <div className="mb-1 text-xs text-indigo-500/80 dark:text-indigo-400/80">
        参数: {JSON.stringify(args)}
      </div>
      {result && (
        <div className="mt-1 rounded-lg bg-white/60 p-2 text-xs text-zinc-600 dark:bg-black/30 dark:text-zinc-400">
          <pre className="whitespace-pre-wrap">
            {JSON.stringify(result, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}
