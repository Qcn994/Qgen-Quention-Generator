import type { ReactNode } from 'react';

export const metadata = {
  title: 'QGen 知题',
  description: '上传材料，生成题目，练到会为止',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN">
      <body style={{ fontFamily: 'system-ui, sans-serif', margin: 0, padding: 24 }}>{children}</body>
    </html>
  );
}
