import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "そろばん塾ピコ 勤怠管理",
  description: "そろばん塾ピコ 講師勤怠管理システム",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja" className="h-full">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
