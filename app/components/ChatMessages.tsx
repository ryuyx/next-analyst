"use client";

import { useRef, useEffect, useState, memo, useCallback, useMemo } from "react";
import type { Message } from "../hooks/useChat";
import { ConfirmationCard } from "./ConfirmationCard";
import { ToolCallCard } from "./ToolCallCard";
import { CodeResultCard } from "./CodeResultCard";
import { InformationRequestCard } from "./InformationRequestCard";
import { FilePreviewModal } from "./FilePreviewModal";
import type { FileAttachment } from "../hooks/useChat";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkBreaks from "remark-breaks";
import rehypeKatex from "rehype-katex";
import rehypeHighlight from "rehype-highlight";

interface ChatMessagesProps {
  messages: Message[];
  onConfirm: (action: string) => void;
  onReject: (action: string) => void;
  onApproveToolCall: (messageId: string, toolCallIndex: number) => void;
  onRejectToolCall: (messageId: string, toolCallIndex: number) => void;
  onSuggestionClick?: (suggestion: string) => void;
}

// Memoized CodeBlock component
const CodeBlock = memo(function CodeBlock({ code, language }: { code: string; language?: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(code).catch(() => {
      const textarea = document.createElement("textarea");
      textarea.value = code;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
    });
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [code]);

  return (
    <div className="relative group my-2 not-prose">
      <button
        onClick={handleCopy}
        className="absolute right-2 top-2 opacity-0 group-hover:opacity-100 transition-opacity px-2 py-1 rounded bg-zinc-700 text-white text-xs hover:bg-zinc-600 z-10"
        title="Copy code"
      >
        {copied ? "✓ Copied" : "Copy"}
      </button>
      <div className="overflow-x-auto rounded-lg bg-zinc-900 p-4 text-sm text-zinc-100">
        <code className="font-mono whitespace-pre">{code}</code>
      </div>
    </div>
  );
});

export const ChatMessages = memo(function ChatMessages({
  messages,
  onConfirm,
  onReject,
  onApproveToolCall,
  onRejectToolCall,
  onSuggestionClick,
}: ChatMessagesProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [shouldAutoScroll, setShouldAutoScroll] = useState(true);
  const [previewingFile, setPreviewingFile] = useState<FileAttachment | null>(null);

  // Check if user is near bottom
  const isNearBottom = useCallback(() => {
    if (!containerRef.current) return true;
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
    // Consider "near bottom" if within 100px of the bottom
    return scrollHeight - scrollTop - clientHeight < 100;
  }, []);

  // Auto-scroll to bottom when messages change, but only if user is near bottom
  useEffect(() => {
    if (shouldAutoScroll && isNearBottom()) {
      const timer = setTimeout(() => {
        bottomRef.current?.scrollIntoView({ behavior: "smooth" });
      }, 0);
      return () => clearTimeout(timer);
    }
  }, [messages, shouldAutoScroll, isNearBottom]);

  // Detect user scrolling away from bottom
  const handleScroll = useCallback(() => {
    const nearBottom = isNearBottom();
    setShouldAutoScroll(nearBottom);
  }, [isNearBottom]);

  // Plugin configuration for ReactMarkdown - memoized to prevent recreation
  const remarkPlugins = useMemo(() => [remarkGfm, remarkMath, remarkBreaks], []);
  const rehypePlugins = useMemo(() => [rehypeKatex, rehypeHighlight], []);

  const markdownComponents = useMemo(() => ({
    code: ({ node, inline, className, children, ...props }: any) => {
      const match = /language-(\w+)/.exec(className || "");
      const language = match ? match[1] : "";
      const code = String(children).replace(/\n$/, "");

      // If there's no language class, it's inline code
      if (!language || inline) {
        return (
          <code className="px-1 py-0.5 rounded text-sm font-mono bg-opacity-0 text-zinc-700 dark:text-zinc-300" {...props}>
            {children}
          </code>
        );
      }

      return <CodeBlock code={code} language={language} />;
    },
  }), []);

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
              onClick={() => onSuggestionClick?.(suggestion)}
              className="rounded-xl border border-zinc-200 bg-white px-4 py-3 text-left text-sm text-zinc-600 transition-all hover:border-indigo-300 hover:bg-indigo-50 hover:shadow-sm"
            >
              {suggestion}
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="flex-1 overflow-y-scroll px-4 py-6"
      style={{ scrollbarGutter: "stable" }}
      onScroll={handleScroll}
    >
      {/* File Preview Modal */}
      {previewingFile && (
        <FilePreviewModal
          file={previewingFile}
          onClose={() => setPreviewingFile(null)}
        />
      )}

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
                  ? "rounded-2xl rounded-br-sm bg-indigo-600 px-5 py-3.5 text-white shadow-md"
                  : "rounded-2xl rounded-bl-sm border border-zinc-200 bg-white px-5 py-3.5 text-zinc-800 shadow-sm"
              }`}
            >
              {/* File attachments */}
              {message.files && message.files.length > 0 && (
                <div className="mb-3 flex flex-wrap gap-2">
                  {message.files.map((file) => (
                    <div
                      key={file.id}
                      onClick={() => setPreviewingFile(file)}
                      className={`flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium cursor-pointer transition-all hover:shadow-md ${
                        message.role === "user"
                          ? "bg-white/20 text-white hover:bg-white/30"
                          : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"
                      }`}
                      title="点击查看详细预览"
                    >
                      <span>📄</span>
                      <span>{file.name}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Message content (Parts based or legacy fallback) */}
              {message.parts && message.parts.length > 0 ? (
                (() => {
                  let toolCallIndex = 0;
                  return message.parts.map((part, index) => {
                    if (part.type === "text" && part.text) {
                      return (
                        <div
                          key={index}
                          className={`prose prose-sm max-w-none mb-2 last:mb-0 text-wrap wrap-break-words ${
                            message.role === "user" ? "prose-invert text-white" : ""
                          }`}
                        >
                          <ReactMarkdown
                            remarkPlugins={remarkPlugins}
                            rehypePlugins={rehypePlugins}
                            components={markdownComponents}
                          >
                            {part.text}
                          </ReactMarkdown>
                        </div>
                      );
                    }
                    if (part.type === "tool_call" && part.toolCall) {
                      const tc = part.toolCall;
                      const currentIndex = toolCallIndex++;

                      if (tc.tool === "confirm_action") {
                        return (
                          <ConfirmationCard
                            key={index}
                            toolCall={tc}
                            onConfirm={onConfirm}
                            onReject={onReject}
                          />
                        );
                      }
                      if (tc.tool === "ask_for_information") {
                        return (
                          <InformationRequestCard
                            key={index}
                            toolCall={tc}
                          />
                        );
                      }
                      if (tc.tool === "execute_python") {
                        return (
                          <CodeResultCard
                            key={index}
                            toolCall={tc}
                            onApprove={() =>
                              onApproveToolCall(message.id, currentIndex)
                            }
                            onReject={() =>
                              onRejectToolCall(message.id, currentIndex)
                            }
                          />
                        );
                      }
                      return <ToolCallCard key={index} toolCall={tc} />;
                    }
                    return null;
                  });
                })()
              ) : (
                <>
                  {/* Legacy rendering for messages without parts */}
                  {message.content && (
                    <div
                      className={`prose prose-sm max-w-none text-wrap wrap-break-words ${
                        message.role === "user" ? "prose-invert text-white" : ""
                      }`}
                    >
                      <ReactMarkdown
                        remarkPlugins={remarkPlugins}
                        rehypePlugins={rehypePlugins}
                        components={markdownComponents}
                      >
                        {message.content}
                      </ReactMarkdown>
                    </div>
                  )}

                  {/* Tool calls */}
                  {message.toolCalls?.map((tc, i) =>
                    tc.tool === "confirm_action" ? (
                      <ConfirmationCard
                        key={i}
                        toolCall={tc}
                        onConfirm={onConfirm}
                        onReject={onReject}
                      />
                    ) : tc.tool === "ask_for_information" ? (
                      <InformationRequestCard
                        key={i}
                        toolCall={tc}
                      />
                    ) : tc.tool === "execute_python" ? (
                      <CodeResultCard
                        key={i}
                        toolCall={tc}
                        onApprove={() => onApproveToolCall(message.id, i)}
                        onReject={() => onRejectToolCall(message.id, i)}
                      />
                    ) : (
                      <ToolCallCard key={i} toolCall={tc} />
                    )
                  )}
                </>
              )}

              {/* Streaming indicator */}
              {message.isStreaming && (
                <div className="flex items-center gap-1.5 mt-2">
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
});
