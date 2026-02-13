"use client";

import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import type { ToolCall } from "../hooks/useChat";

interface GeneratedFile {
  name: string;
  content: string;
  size: number;
}

interface CodeResultCardProps {
  toolCall: ToolCall;
  onApprove?: () => void;
  onReject?: () => void;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getMimeType(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() || "";
  const mimeTypes: Record<string, string> = {
    csv: "text/csv",
    json: "application/json",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    xls: "application/vnd.ms-excel",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    svg: "image/svg+xml",
    pdf: "application/pdf",
    txt: "text/plain",
    html: "text/html",
    parquet: "application/octet-stream",
    md: "text/markdown",
    py: "text/x-python",
  };
  return mimeTypes[ext] || "application/octet-stream";
}

function getFileIcon(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() || "";
  const icons: Record<string, string> = {
    csv: "📊",
    xlsx: "📊",
    xls: "📊",
    json: "📋",
    png: "🖼️",
    jpg: "🖼️",
    jpeg: "🖼️",
    svg: "🖼️",
    pdf: "📄",
    txt: "📝",
    html: "🌐",
    md: "📝",
    py: "🐍",
    parquet: "📦",
  };
  return icons[ext] || "📎";
}

function downloadBase64File(base64Data: string, filename: string, mimeType: string) {
  const byteCharacters = atob(base64Data);
  const byteNumbers = new Array(byteCharacters.length);
  for (let i = 0; i < byteCharacters.length; i++) {
    byteNumbers[i] = byteCharacters.charCodeAt(i);
  }
  const byteArray = new Uint8Array(byteNumbers);
  const blob = new Blob([byteArray], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function copyToClipboard(text: string) {
  navigator.clipboard.writeText(text).catch(() => {
    // Fallback for older browsers
    const textarea = document.createElement("textarea");
    textarea.value = text;
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    document.body.removeChild(textarea);
  });
}

function FilePreview({ file }: { file: GeneratedFile }) {
  const ext = file.name.split(".").pop()?.toLowerCase() || "";
  const isImage = ["png", "jpg", "jpeg", "gif", "svg"].includes(ext);
  const isCSV = ["csv", "tsv"].includes(ext);
  const isJSON = ext === "json";

  if (isImage) {
    return (
      <div className="rounded-lg overflow-hidden bg-white">
        <img
          src={`data:image/${ext === "svg" ? "svg+xml" : ext};base64,${file.content}`}
          alt={file.name}
          className="max-w-full h-auto"
        />
      </div>
    );
  }

  if (isCSV || isJSON) {
    try {
      let textContent = "";

      // Decode base64 with proper encoding handling
      try {
        const binaryString = atob(file.content);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        // Try UTF-8 first
        textContent = new TextDecoder("utf-8").decode(bytes);
      } catch {
        // Fallback to GBK/GB2312 if UTF-8 fails
        try {
          const binaryString = atob(file.content);
          const bytes = new Uint8Array(binaryString.length);
          for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
          }
          textContent = new TextDecoder("gbk").decode(bytes);
        } catch {
          textContent = atob(file.content);
        }
      }

      let data: any[] = [];
      let columns: string[] = [];

      if (isCSV) {
        const lines = textContent.split("\n").slice(0, 11);
        if (lines.length > 0) {
          columns = lines[0].split(",").map((c) => c.trim());
          data = lines.slice(1).filter(line => line.trim()).map((line) =>
            line.split(",").reduce((obj, val, idx) => {
              obj[columns[idx] || `col_${idx}`] = val.trim();
              return obj;
            }, {} as Record<string, string>)
          );
        }
      } else if (isJSON) {
        const parsed = JSON.parse(textContent);
        data = Array.isArray(parsed) ? parsed.slice(0, 10) : [parsed];
        if (data.length > 0) {
          columns = Object.keys(data[0]);
        }
      }

      if (data.length === 0) {
        return <div className="text-xs text-zinc-500 p-2">文件为空</div>;
      }

      return (
        <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-zinc-200 bg-zinc-50">
                {columns.map((col, i) => (
                  <th key={i} className="px-3 py-2 text-left font-medium text-zinc-700 whitespace-nowrap">
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.map((row, i) => (
                <tr key={i} className="border-b border-zinc-100 hover:bg-zinc-50">
                  {columns.map((col, j) => (
                    <td key={j} className="px-3 py-2 text-zinc-600 max-w-xs truncate">
                      {String(row[col] || "")}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    } catch (err) {
      return <div className="text-xs text-red-500 p-2">预览失败: {err instanceof Error ? err.message : "未知错误"}</div>;
    }
  }

  return <div className="text-xs text-zinc-500 p-2">不支持预览此文件类型</div>;
}

export function CodeResultCard({ toolCall, onApprove, onReject }: CodeResultCardProps) {
  const [showCode, setShowCode] = useState(true);
  const [copied, setCopied] = useState(false);
  const [expandedFileIndex, setExpandedFileIndex] = useState<number | null>(null);

  const { args, result, status } = toolCall;
  const code = (args as { code?: string }).code || "";
  const stdout = (result as { stdout?: string })?.stdout || "";
  const stderr = (result as { stderr?: string })?.stderr || "";
  const error = (result as { error?: string | null })?.error;
  const results = (result as { results?: Array<{ text?: string; png?: string; html?: string }> })?.results || [];
  const generatedFiles = (result as { generatedFiles?: GeneratedFile[] })?.generatedFiles || [];

  const hasOutput = stdout || stderr || error || results.length > 0 || generatedFiles.length > 0;
  const isPending = status === "pending";
  const isApproved = status === "approved";
  const isRejected = status === "rejected";
  const isCompleted = status === "completed";

  return (
    <div className={`my-3 overflow-hidden rounded-xl border ${
      isPending
        ? "border-amber-300 bg-amber-50"
        : isRejected
        ? "border-red-200 bg-red-50"
        : "border-zinc-200 bg-white"
    }`}>
      {/* Header */}
      <div className={`flex items-center justify-between border-b px-3 py-2 ${
        isPending
          ? "border-amber-100 bg-amber-50"
          : isRejected
          ? "border-red-100 bg-red-50"
          : "border-zinc-100 bg-zinc-50/50"
      }`}>
        <div className="flex items-center gap-2 text-xs font-medium text-zinc-600">
          <span className="flex h-5 w-5 items-center justify-center rounded bg-zinc-200 text-[10px] text-zinc-600">
            🐍
          </span>
          {isPending && (
            <>
              <span className="text-amber-700">Python 代码 — 等待确认</span>
              <span className="rounded-md bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
                待确认
              </span>
            </>
          )}
          {isApproved && (
            <>
              <span className="text-indigo-600">Python 代码执行中...</span>
              <span className="rounded-md bg-indigo-50 px-1.5 py-0.5 text-[10px] font-medium text-indigo-600">
                执行中
              </span>
            </>
          )}
          {isRejected && (
            <>
              <span className="text-red-600">Python 代码 — 已拒绝</span>
              <span className="rounded-md bg-red-100 px-1.5 py-0.5 text-[10px] font-medium text-red-600">
                已拒绝
              </span>
            </>
          )}
          {isCompleted && (
            <>
              <span>Python 代码执行</span>
              {error && (
                <span className="rounded-md bg-red-100 px-1.5 py-0.5 text-[10px] font-medium text-red-600">
                  错误
                </span>
              )}
              {!error && hasOutput && (
                <span className="rounded-md bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-600">
                  成功
                </span>
              )}
            </>
          )}
        </div>
        <div className="flex items-center gap-2">
          {showCode && code && (
            <button
              onClick={() => {
                copyToClipboard(code);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }}
              className="text-xs text-zinc-500 hover:text-zinc-700 px-2 py-1 rounded hover:bg-zinc-100"
              title="Copy code"
              aria-label="Copy code to clipboard"
            >
              {copied ? "✓ 已复制" : "复制"}
            </button>
          )}
          <button
            onClick={() => setShowCode(!showCode)}
            className="text-xs text-zinc-500 hover:text-zinc-700"
            aria-label={showCode ? "Hide code" : "Show code"}
          >
            {showCode ? "收起代码" : "展开代码"}
          </button>
        </div>
      </div>

      {/* Code */}
      {showCode && code && (
        <div className="border-b border-zinc-200 bg-white overflow-x-auto">
          <div className="p-3 text-xs leading-5">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              rehypePlugins={[rehypeHighlight]}
              components={{
                pre: ({ node, ...props }) => <pre className="m-0 p-0" {...props} />,
                code: ({ node, ...props }) => <code className="font-mono text-gray-800" {...props} />,
              }}
            >
              {`\`\`\`python\n${code}\n\`\`\``}
            </ReactMarkdown>
          </div>
        </div>
      )}

      {/* Pending: Confirm / Reject buttons */}
      {isPending && (
        <div className="flex items-center gap-3 px-3 py-3">
          <span className="text-xs text-amber-700">
            是否执行以上代码？
          </span>
          <button
            onClick={onApprove}
            className="rounded-lg bg-green-600 px-4 py-1.5 text-xs font-medium text-white transition-colors hover:bg-green-700"
          >
            ✓ 确认执行
          </button>
          <button
            onClick={onReject}
            className="rounded-lg bg-white border border-gray-200 px-4 py-1.5 text-xs font-medium transition-colors hover:bg-gray-100"
          >
            ✗ 拒绝
          </button>
        </div>
      )}

      {/* Approved: Loading spinner */}
      {isApproved && (
        <div className="flex items-center gap-2 px-3 py-3">
          <svg className="h-4 w-4 animate-spin text-blue-500" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          <span className="text-xs text-zinc-500">正在沙盒中执行代码...</span>
        </div>
      )}

      {/* Rejected: Message */}
      {isRejected && (
        <div className="px-3 py-3">
          <span className="text-xs text-red-600">代码执行已被用户拒绝</span>
        </div>
      )}

      {/* Completed: Output */}
      {isCompleted && hasOutput && (
        <div className="p-3">
          {/* Stdout */}
          {stdout && (
            <div className="mb-2">
              <div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-zinc-400">
                输出
              </div>
              <pre className="overflow-x-auto rounded-lg bg-white p-2 text-xs text-zinc-700">
                {stdout}
              </pre>
            </div>
          )}

          {/* Images (e.g. matplotlib charts) */}
          {results.map((r, i) => (
            <div key={i}>
              {r.png && (
                <div className="mb-2">
                  <div className="mb-1 flex items-center justify-between">
                    <span className="text-[10px] font-medium uppercase tracking-wider text-zinc-400">
                      图表
                    </span>
                    <button
                      onClick={() => downloadBase64File(r.png!, `chart-${i + 1}.png`, "image/png")}
                      className="flex items-center gap-1 rounded-md bg-zinc-100 px-2 py-0.5 text-[10px] font-medium text-zinc-600 transition-colors hover:bg-zinc-200 hover:text-zinc-800"
                    >
                      <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                      </svg>
                      下载图片
                    </button>
                  </div>
                  <div className="overflow-hidden rounded-lg bg-white">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={`data:image/png;base64,${r.png}`}
                      alt="Code output chart"
                      className="max-w-full"
                    />
                  </div>
                </div>
              )}
              {r.html && (
                <div className="mb-2">
                  <div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-zinc-400">
                    HTML 输出
                  </div>
                  <div
                    className="overflow-x-auto rounded-lg bg-white p-2 text-xs"
                    dangerouslySetInnerHTML={{ __html: r.html }}
                  />
                </div>
              )}
              {r.text && !r.png && !r.html && (
                <div className="mb-2">
                  <div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-zinc-400">
                    结果
                  </div>
                  <pre className="overflow-x-auto rounded-lg bg-white p-2 text-xs text-zinc-700">
                    {r.text}
                  </pre>
                </div>
              )}
            </div>
          ))}

          {/* Generated Files */}
          {generatedFiles.length > 0 && (
            <div className="mb-2">
              <div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-zinc-400">
                生成的文件
              </div>
              <div className="space-y-2">
                {generatedFiles.map((file, i) => (
                  <div key={i} className="rounded-lg border border-zinc-100 bg-zinc-50/50 overflow-hidden">
                    <div className="flex items-center justify-between px-3 py-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-sm shrink-0">{getFileIcon(file.name)}</span>
                        <span className="truncate text-xs font-medium text-zinc-700">{file.name}</span>
                        <span className="shrink-0 text-[10px] text-zinc-400">{formatFileSize(file.size)}</span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          onClick={() => setExpandedFileIndex(expandedFileIndex === i ? null : i)}
                          className="flex items-center gap-1 rounded-md bg-zinc-100 px-2 py-1 text-[11px] font-medium text-zinc-600 transition-colors hover:bg-zinc-200 hover:text-zinc-800"
                        >
                          {expandedFileIndex === i ? "收起" : "预览"}
                        </button>
                        <button
                          onClick={() => downloadBase64File(file.content, file.name, getMimeType(file.name))}
                          className="flex items-center gap-1 rounded-md bg-blue-50 px-2.5 py-1 text-[11px] font-medium text-blue-600 transition-colors hover:bg-blue-100 hover:text-blue-700"
                        >
                          <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                          </svg>
                          下载
                        </button>
                      </div>
                    </div>
                    {expandedFileIndex === i && (
                      <div className="border-t border-zinc-100 p-3 bg-white">
                        <FilePreview file={file} />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Stderr */}
          {stderr && (
            <div className="mb-2">
              <div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-amber-500">
                警告
              </div>
              <pre className="overflow-x-auto rounded-lg bg-amber-50 p-2 text-xs text-amber-700">
                {stderr}
              </pre>
            </div>
          )}

          {/* Error */}
          {error && (
            <div>
              <div className="mb-1 flex items-center justify-between">
                <span className="text-[10px] font-medium uppercase tracking-wider text-red-500">
                  错误
                </span>
              </div>
              <div className="overflow-x-auto rounded-lg bg-red-50 p-3 text-xs text-red-700 border border-red-200">
                <pre className="whitespace-pre-wrap wrap-break-words font-mono">{error}</pre>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
