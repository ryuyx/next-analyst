"use client";

import { useRef, useEffect } from "react";
import type { Message } from "../hooks/useChat";
import { ConfirmationCard } from "./ConfirmationCard";
import { ToolCallCard } from "./ToolCallCard";
import ReactMarkdown from "react-markdown";

interface ChatMessagesProps {
  messages: Message[];
  onConfirm: (action: string) => void;
  onReject: (action: string) => void;
}

export function ChatMessages({
  messages,
  onConfirm,
  onReject,
}: ChatMessagesProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  if (messages.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 text-zinc-400">
        <div className="text-6xl">🤖</div>
        <div className="text-lg font-medium">Next Analyst</div>
        <div className="text-sm">智能数据分析助手 - 输入消息开始对话</div>
        <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {[
            "帮我分析一下今天的数据趋势",
            "计算 (245 * 18) + 3200 的结果",
            "搜索关于机器学习的知识",
            "删除所有临时数据文件",
          ].map((suggestion) => (
            <button
              key={suggestion}
              className="rounded-xl border border-zinc-200 bg-white px-4 py-3 text-left text-sm text-zinc-600 transition-colors hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400 dark:hover:border-zinc-600 dark:hover:bg-zinc-800"
            >
              {suggestion}
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto px-4 py-6">
      <div className="mx-auto max-w-3xl space-y-6">
        {messages.map((message) => (
          <div
            key={message.id}
            className={`flex ${
              message.role === "user" ? "justify-end" : "justify-start"
            }`}
          >
            <div
              className={`max-w-[85%] ${
                message.role === "user"
                  ? "rounded-2xl rounded-br-md bg-blue-600 px-4 py-3 text-white"
                  : "rounded-2xl rounded-bl-md bg-zinc-100 px-4 py-3 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200"
              }`}
            >
              {/* Tool calls */}
              {message.toolCalls?.map((tc, i) =>
                tc.tool === "confirm_action" ? (
                  <ConfirmationCard
                    key={i}
                    toolCall={tc}
                    onConfirm={onConfirm}
                    onReject={onReject}
                  />
                ) : (
                  <ToolCallCard key={i} toolCall={tc} />
                )
              )}

              {/* Message content */}
              {message.content && (
                <div className="prose prose-sm dark:prose-invert max-w-none">
                  <ReactMarkdown>{message.content}</ReactMarkdown>
                </div>
              )}

              {/* Streaming indicator */}
              {message.isStreaming && !message.content && (
                <div className="flex items-center gap-1.5">
                  <div className="h-2 w-2 animate-bounce rounded-full bg-zinc-400 [animation-delay:-0.3s]" />
                  <div className="h-2 w-2 animate-bounce rounded-full bg-zinc-400 [animation-delay:-0.15s]" />
                  <div className="h-2 w-2 animate-bounce rounded-full bg-zinc-400" />
                </div>
              )}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
