import type { Metadata } from "next";
import "./globals.css";
import "katex/dist/katex.min.css";
import "highlight.js/styles/github.css";

export const metadata: Metadata = {
  title: "Next Analyst - LLM Agent",
  description: "智能数据分析助手 powered by LangChain",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}
