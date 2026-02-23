"use client";

import { useState } from "react";
import type { FileAttachment } from "../hooks/useChat";

interface FilePreviewModalProps {
  file: FileAttachment;
  onClose: () => void;
}

export function FilePreviewModal({ file, onClose }: FilePreviewModalProps) {
  const [activeTab, setActiveTab] = useState<"preview" | "stats" | "raw">("preview");

  const renderPreviewContent = () => {
    if (file.previewError) {
      return (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <div className="mb-3 text-4xl">⚠️</div>
          <div className="text-sm font-medium text-red-700 dark:text-red-300">
            预览失败
          </div>
          <div className="mt-1 text-xs text-red-600/80 dark:text-red-400/80">
            {file.previewError}
          </div>
        </div>
      );
    }

    if (file.isPreviewing) {
      return (
        <div className="flex flex-col items-center justify-center py-12">
          <svg
            className="h-8 w-8 animate-spin text-indigo-600"
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
          <div className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
            正在解析文件...
          </div>
        </div>
      );
    }

    if (!file.richPreview) {
      return (
        <div className="rounded-lg bg-zinc-50 p-4 dark:bg-zinc-900">
          <pre className="overflow-x-auto text-xs text-zinc-700 dark:text-zinc-300">
            {file.preview}
          </pre>
        </div>
      );
    }

    const rp = file.richPreview;

    if (activeTab === "preview") {
      return (
        <div className="space-y-4">
          {/* Data Overview */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-lg bg-indigo-50 p-3 dark:bg-indigo-950/30">
              <div className="text-xs text-indigo-600 dark:text-indigo-400">
                总行数
              </div>
              <div className="mt-1 text-lg font-semibold text-indigo-900 dark:text-indigo-200">
                {rp.shape[0].toLocaleString()}
              </div>
            </div>
            <div className="rounded-lg bg-emerald-50 p-3 dark:bg-emerald-950/30">
              <div className="text-xs text-emerald-600 dark:text-emerald-400">
                总列数
              </div>
              <div className="mt-1 text-lg font-semibold text-emerald-900 dark:text-emerald-200">
                {rp.shape[1]}
              </div>
            </div>
            <div className="rounded-lg bg-amber-50 p-3 dark:bg-amber-950/30">
              <div className="text-xs text-amber-600 dark:text-amber-400">
                缺失值
              </div>
              <div className="mt-1 text-lg font-semibold text-amber-900 dark:text-amber-200">
                {Object.values(rp.null_counts).reduce((a, b) => a + b, 0)}
              </div>
            </div>
            <div className="rounded-lg bg-blue-50 p-3 dark:bg-blue-950/30">
              <div className="text-xs text-blue-600 dark:text-blue-400">
                数据大小
              </div>
              <div className="mt-1 text-lg font-semibold text-blue-900 dark:text-blue-200">
                {formatFileSize(file.size)}
              </div>
            </div>
          </div>

          {/* Column Types */}
          <div>
            <div className="mb-2 text-sm font-semibold text-zinc-700 dark:text-zinc-300">
              列信息
            </div>
            <div className="max-h-48 overflow-y-auto rounded-lg border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-zinc-50 dark:bg-zinc-800">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium text-zinc-600 dark:text-zinc-400">
                      列名
                    </th>
                    <th className="px-3 py-2 text-left font-medium text-zinc-600 dark:text-zinc-400">
                      类型
                    </th>
                    <th className="px-3 py-2 text-right font-medium text-zinc-600 dark:text-zinc-400">
                      缺失值
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {rp.columns.map((col) => (
                    <tr key={col} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/50">
                      <td className="px-3 py-2 font-mono text-zinc-900 dark:text-zinc-100">
                        {col}
                      </td>
                      <td className="px-3 py-2 text-zinc-600 dark:text-zinc-400">
                        <span className="rounded bg-zinc-100 px-1.5 py-0.5 font-mono dark:bg-zinc-800">
                          {rp.dtypes[col]}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right">
                        {rp.null_counts[col] > 0 ? (
                          <span className="text-amber-600 dark:text-amber-400">
                            {rp.null_counts[col]}
                          </span>
                        ) : (
                          <span className="text-emerald-600 dark:text-emerald-400">
                            0
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Data Preview */}
          <div>
            <div className="mb-2 text-sm font-semibold text-zinc-700 dark:text-zinc-300">
              数据预览（前5行）
            </div>
            <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900">
              <pre className="p-3 text-xs text-zinc-700 dark:text-zinc-300">
                {rp.head}
              </pre>
            </div>
          </div>
        </div>
      );
    }

    if (activeTab === "stats") {
      return (
        <div>
          <div className="mb-2 text-sm font-semibold text-zinc-700 dark:text-zinc-300">
            统计摘要
          </div>
          <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900">
            <pre className="p-3 text-xs text-zinc-700 dark:text-zinc-300">
              {rp.describe}
            </pre>
          </div>
        </div>
      );
    }

    if (activeTab === "raw") {
      return (
        <div>
          <div className="mb-2 text-sm font-semibold text-zinc-700 dark:text-zinc-300">
            原始文本预览
          </div>
          <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900">
            <pre className="p-3 text-xs text-zinc-700 dark:text-zinc-300">
              {file.preview}
            </pre>
          </div>
        </div>
      );
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-4xl max-h-[90vh] overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-zinc-900"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-200 px-6 py-4 dark:border-zinc-800">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-100 text-lg dark:bg-indigo-950/50">
              📄
            </div>
            <div>
              <div className="font-semibold text-zinc-900 dark:text-zinc-100">
                {file.name}
              </div>
              <div className="text-xs text-zinc-500 dark:text-zinc-400">
                {formatFileSize(file.size)}
                {file.richPreview && (
                  <span className="ml-2">
                    · {file.richPreview.shape[0].toLocaleString()} 行 ×{" "}
                    {file.richPreview.shape[1]} 列
                  </span>
                )}
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
            aria-label="Close preview"
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
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {/* Tabs */}
        {file.richPreview && !file.previewError && !file.isPreviewing && (
          <div className="flex gap-1 border-b border-zinc-200 px-6 dark:border-zinc-800">
            <button
              onClick={() => setActiveTab("preview")}
              className={`px-4 py-2 text-sm font-medium transition-colors ${
                activeTab === "preview"
                  ? "border-b-2 border-indigo-600 text-indigo-600 dark:border-indigo-400 dark:text-indigo-400"
                  : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-200"
              }`}
            >
              数据预览
            </button>
            <button
              onClick={() => setActiveTab("stats")}
              className={`px-4 py-2 text-sm font-medium transition-colors ${
                activeTab === "stats"
                  ? "border-b-2 border-indigo-600 text-indigo-600 dark:border-indigo-400 dark:text-indigo-400"
                  : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-200"
              }`}
            >
              统计信息
            </button>
            <button
              onClick={() => setActiveTab("raw")}
              className={`px-4 py-2 text-sm font-medium transition-colors ${
                activeTab === "raw"
                  ? "border-b-2 border-indigo-600 text-indigo-600 dark:border-indigo-400 dark:text-indigo-400"
                  : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-200"
              }`}
            >
              原始文本
            </button>
          </div>
        )}

        {/* Content */}
        <div className="max-h-[calc(90vh-140px)] overflow-y-auto p-6">
          {renderPreviewContent()}
        </div>
      </div>
    </div>
  );
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
