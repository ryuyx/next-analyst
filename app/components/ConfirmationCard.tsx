"use client";

import { useState } from "react";
import type { ToolCall } from "../hooks/useChat";

interface ConfirmationCardProps {
  toolCall: ToolCall;
  onConfirm: (action: string) => void;
  onReject: (action: string) => void;
}

export function ConfirmationCard({
  toolCall,
  onConfirm,
  onReject,
}: ConfirmationCardProps) {
  const [status, setStatus] = useState<"pending" | "confirmed" | "rejected">(
    "pending"
  );

  const { action, description } = toolCall.args as {
    action: string;
    description: string;
  };

  const handleConfirm = () => {
    setStatus("confirmed");
    onConfirm(action);
  };

  const handleReject = () => {
    setStatus("rejected");
    onReject(action);
  };

  return (
    <div className="my-3 rounded-xl border border-amber-200/75 bg-amber-50/50 p-4 shadow-sm dark:border-amber-800 dark:bg-amber-950/20">
      <div className="mb-2 flex items-center gap-2">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-amber-100 text-sm text-amber-600 dark:bg-amber-900/50 dark:text-amber-400">
          ⚠️
        </span>
        <span className="font-semibold text-amber-900 dark:text-amber-200">
          需要确认操作
        </span>
      </div>
      <div className="mb-1 text-sm font-medium text-amber-900 dark:text-amber-100">
        {action}
      </div>
      <div className="mb-3 text-sm text-amber-700/80 dark:text-amber-300/80">
        {description}
      </div>

      {status === "pending" ? (
        <div className="flex gap-2">
          <button
            onClick={handleConfirm}
            className="rounded-lg bg-emerald-600 px-4 py-1.5 text-sm font-medium text-white shadow-sm transition-all hover:bg-emerald-700 hover:shadow-md"
          >
            ✓ 确认执行
          </button>
          <button
            onClick={handleReject}
            className="rounded-lg bg-white px-4 py-1.5 text-sm font-medium text-zinc-600 shadow-sm ring-1 ring-inset ring-zinc-300 transition-all hover:bg-zinc-50 hover:text-zinc-900 dark:bg-transparent dark:text-zinc-300 dark:ring-zinc-700 dark:hover:bg-zinc-800"
          >
            ✗ 取消
          </button>
        </div>
      ) : (
        <div
          className={`inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-sm font-medium ${
            status === "confirmed"
              ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300"
              : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
          }`}
        >
          {status === "confirmed" ? "✓ 已确认" : "✗ 已取消"}
        </div>
      )}
    </div>
  );
}
