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
    <div className="my-3 rounded-xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950/40">
      <div className="mb-2 flex items-center gap-2">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-amber-200 text-sm dark:bg-amber-800">
          ⚠️
        </span>
        <span className="font-semibold text-amber-800 dark:text-amber-200">
          需要确认操作
        </span>
      </div>
      <div className="mb-1 text-sm font-medium text-amber-900 dark:text-amber-100">
        {action}
      </div>
      <div className="mb-3 text-sm text-amber-700 dark:text-amber-300">
        {description}
      </div>

      {status === "pending" ? (
        <div className="flex gap-2">
          <button
            onClick={handleConfirm}
            className="rounded-lg bg-green-600 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-green-700"
          >
            ✓ 确认执行
          </button>
          <button
            onClick={handleReject}
            className="rounded-lg bg-red-600 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-red-700"
          >
            ✗ 取消
          </button>
        </div>
      ) : (
        <div
          className={`inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-sm font-medium ${
            status === "confirmed"
              ? "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300"
              : "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300"
          }`}
        >
          {status === "confirmed" ? "✓ 已确认" : "✗ 已取消"}
        </div>
      )}
    </div>
  );
}
