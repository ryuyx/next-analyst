"use client";

import { useChat } from "./hooks/useChat";
import { ChatMessages } from "./components/ChatMessages";
import { ChatInput } from "./components/ChatInput";

export default function Home() {
  const { messages, isLoading, sendMessage, clearMessages } = useChat();

  const handleConfirm = (action: string) => {
    sendMessage(`我确认执行操作: ${action}`);
  };

  const handleReject = (action: string) => {
    sendMessage(`我取消了操作: ${action}`);
  };

  return (
    <div className="flex h-screen flex-col bg-white dark:bg-zinc-900">
      {/* Header */}
      <header className="flex items-center justify-between border-b border-zinc-200 px-6 py-3 dark:border-zinc-700">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-600 text-sm font-bold text-white">
            NA
          </div>
          <div>
            <h1 className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">
              Next Analyst
            </h1>
            <p className="text-xs text-zinc-400">LLM Agent · 数据分析助手</p>
          </div>
        </div>
        <button
          onClick={clearMessages}
          className="rounded-lg border border-zinc-200 px-3 py-1.5 text-xs text-zinc-500 transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
        >
          清空对话
        </button>
      </header>

      {/* Messages */}
      <ChatMessages
        messages={messages}
        onConfirm={handleConfirm}
        onReject={handleReject}
      />

      {/* Input */}
      <ChatInput onSend={sendMessage} isLoading={isLoading} />
    </div>
  );
}
