import type { Metadata } from "next";
import "./globals.css";

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
