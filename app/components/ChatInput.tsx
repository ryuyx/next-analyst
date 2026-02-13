"use client";

import { useState, useRef, useEffect, type FormEvent } from "react";
import type { FileAttachment } from "../hooks/useChat";

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.split(",")[1] || "";
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function readFilePreview(
  file: File,
  maxLines = 6
): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const text = reader.result as string;
      const lines = text.split("\n").slice(0, maxLines);
      resolve(lines.join("\n"));
    };
    reader.onerror = reject;
    const blob = file.slice(0, 8192);
    reader.readAsText(blob);
  });
}

interface ChatInputProps {
  onSend: (content: string) => void;
  isLoading: boolean;
  isPreviewingFiles: boolean;
  pendingFiles: FileAttachment[];
  onAddFiles: (files: FileAttachment[]) => void;
  onRemoveFile: (id: string) => void;
  input: string;
  onInputChange: (value: string) => void;
}

export function ChatInput({
  onSend,
  isLoading,
  isPreviewingFiles,
  pendingFiles,
  onAddFiles,
  onRemoveFile,
  input,
  onInputChange,
}: ChatInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${Math.min(
        textareaRef.current.scrollHeight,
        200
      )}px`;
    }
  }, [input]);

  const handleFileSelect = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const fileList = e.target.files;
    if (!fileList) return;
    const MAX_SIZE = 10 * 1024 * 1024;
    const attachments: FileAttachment[] = [];
    const errors: string[] = [];

    for (const file of Array.from(fileList)) {
      if (file.size > MAX_SIZE) {
        errors.push(`${file.name}: 超过 10MB 限制`);
        continue;
      }
      try {
        const content = await readFileAsBase64(file);
        const preview = await readFilePreview(file);
        attachments.push({
          id: crypto.randomUUID(),
          name: file.name,
          type: file.type || "text/plain",
          size: file.size,
          content,
          preview,
        });
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : "读取失败";
        errors.push(`${file.name}: ${errMsg}`);
      }
    }

    if (errors.length > 0) {
      alert("文件上传出错:\n" + errors.join("\n"));
    }

    if (attachments.length > 0) {
      onAddFiles(attachments);
    }
    e.target.value = "";
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const hasFiles = pendingFiles.length > 0;
    const anyPreviewing = pendingFiles.some((f) => f.isPreviewing);
    if ((!input.trim() && !hasFiles) || isLoading || anyPreviewing) return;
    onSend(input.trim() || "请分析上传的文件");
    onInputChange("");
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  return (
    <div className="border-t border-zinc-200 bg-white px-4 py-3 dark:border-zinc-700 dark:bg-zinc-900">
      {/* File chips */}
      {pendingFiles.length > 0 && (
        <div className="mx-auto mb-2 flex max-w-3xl flex-wrap gap-2">
          {pendingFiles.map((file) => (
            <div
              key={file.id}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium border ${
                file.previewError
                  ? "border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-300"
                  : file.isPreviewing
                  ? "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-900/30 dark:text-amber-300"
                  : file.richPreview
                  ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300"
                  : "border-indigo-200 bg-indigo-50 text-indigo-700 dark:border-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300"
              }`}
              title={file.previewError ? `预览失败: ${file.previewError}` : ""}
            >
              {file.previewError ? (
                <span>⚠️</span>
              ) : file.isPreviewing ? (
                <svg className="h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              ) : file.richPreview ? (
                <span>✅</span>
              ) : (
                <span>📄</span>
              )}
              <span className="max-w-[150px] truncate">{file.name}</span>
              {file.previewError ? (
                <span className="text-red-600 dark:text-red-400 text-xs">预览失败</span>
              ) : file.isPreviewing ? (
                <span className="text-amber-600 dark:text-amber-400">解析中...</span>
              ) : file.richPreview ? (
                <span className="text-emerald-600 dark:text-emerald-400">
                  ({file.richPreview.shape[0]}行 × {file.richPreview.shape[1]}列)
                </span>
              ) : (
                <span className="text-indigo-400 dark:text-indigo-400">
                  ({formatFileSize(file.size)})
                </span>
              )}
              <button
                type="button"
                onClick={() => onRemoveFile(file.id)}
                className="ml-1 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
                aria-label="Remove file"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
      <form
        onSubmit={handleSubmit}
        className="mx-auto flex max-w-3xl items-end gap-3"
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".csv,.tsv,.txt,.json,.xlsx,.xls,.parquet"
          onChange={handleFileSelect}
          className="hidden"
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={isLoading}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-zinc-200 text-zinc-400 transition-all hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-600 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-500 dark:hover:border-indigo-700 dark:hover:bg-indigo-950/30 dark:hover:text-indigo-400"
          aria-label="Upload file"
          title="上传文件 (CSV, JSON, Excel, Parquet 等)"
        >
          <svg
            className="h-5 w-5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13"
            />
          </svg>
        </button>
        <div className="relative flex-1">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => onInputChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="输入消息... (Shift+Enter 换行)"
            rows={1}
            className="w-full resize-none rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3 pr-12 text-sm outline-none transition-all placeholder:text-zinc-400 focus:border-indigo-400 focus:bg-white focus:ring-4 focus:ring-indigo-400/10 dark:border-zinc-700 dark:bg-zinc-800/50 dark:text-zinc-200 dark:focus:border-indigo-500 dark:focus:bg-zinc-900 dark:focus:ring-indigo-500/10"
            disabled={isLoading}
          />
        </div>
        <button
          type="submit"
          disabled={isLoading || isPreviewingFiles || (!input.trim() && pendingFiles.length === 0)}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-indigo-600 text-white shadow-sm transition-all hover:bg-indigo-700 hover:shadow-md disabled:bg-zinc-200 disabled:text-zinc-400 disabled:shadow-none dark:disabled:bg-zinc-800 dark:disabled:text-zinc-600"
          aria-label="Send message"
        >
          {isLoading ? (
            <svg
              className="h-5 w-5 animate-spin"
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
              />
            </svg>
          ) : (
            <svg
              className="h-5 w-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5"
              />
            </svg>
          )}
        </button>
      </form>
      <p className="mx-auto mt-1.5 max-w-3xl text-center text-xs text-zinc-400">
        Next Analyst MVP · LangChain + OpenAI Compatible API
      </p>
    </div>
  );
}
