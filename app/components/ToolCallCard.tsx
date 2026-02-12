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
    <div className="my-2 rounded-xl border border-blue-200 bg-blue-50 p-3 dark:border-blue-800 dark:bg-blue-950/40">
      <div className="mb-1 flex items-center gap-2 text-xs font-medium text-blue-600 dark:text-blue-400">
        <span className="flex h-5 w-5 items-center justify-center rounded bg-blue-200 text-[10px] dark:bg-blue-800">
          🔧
        </span>
        <span>工具调用: {tool}</span>
      </div>
      <div className="mb-1 text-xs text-blue-500 dark:text-blue-400">
        参数: {JSON.stringify(args)}
      </div>
      {result && (
        <div className="mt-1 rounded-lg bg-white/70 p-2 text-xs text-zinc-700 dark:bg-black/30 dark:text-zinc-300">
          <pre className="whitespace-pre-wrap">
            {JSON.stringify(result, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}
