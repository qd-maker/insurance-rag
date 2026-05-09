import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "智析保险知识引擎",
  description: "基于 RAG 的保险产品信息结构化提取系统，将条款查阅时间从 10-30 分钟缩短到 10-30 秒",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}
