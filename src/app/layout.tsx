import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'DeepWork — 集体意图，AI 合成',
  description: '多人协作的新范式：意图 + 合成',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh">
      <body className="bg-[#0a0a0a] text-white antialiased">{children}</body>
    </html>
  );
}
