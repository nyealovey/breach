import { Geist } from 'next/font/google';
import Link from 'next/link';

import { Toaster } from '@/components/ui/sonner';
import { cn } from '@/lib/ui/cn';

import type { Metadata } from 'next';

import './globals.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: `资产台账`,
  description: `资产台账系统（vCenter MVP）`,
};
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className={cn(geistSans.variable, 'min-h-screen bg-background text-foreground antialiased')}>
        <div className="flex min-h-screen">
          <aside className="hidden w-64 shrink-0 border-r bg-muted/40 p-4 md:block">
            <div className="mb-4 text-sm font-semibold">资产台账</div>
            <nav className="space-y-1 text-sm">
              <Link className="block rounded px-2 py-1 hover:bg-muted" href="/">
                概览
              </Link>
              <Link className="block rounded px-2 py-1 hover:bg-muted" href="/schedule-groups">
                调度组
              </Link>
              <Link className="block rounded px-2 py-1 hover:bg-muted" href="/sources">
                来源
              </Link>
              <Link className="block rounded px-2 py-1 hover:bg-muted" href="/credentials">
                凭据
              </Link>
              <Link className="block rounded px-2 py-1 hover:bg-muted" href="/runs">
                运行
              </Link>
              <Link className="block rounded px-2 py-1 hover:bg-muted" href="/assets">
                资产
              </Link>
              <Link className="block rounded px-2 py-1 hover:bg-muted" href="/exports">
                导出
              </Link>
              <Link className="block rounded px-2 py-1 hover:bg-muted" href="/duplicate-candidates">
                重复中心
              </Link>
              <Link className="block rounded px-2 py-1 hover:bg-muted" href="/api/docs">
                API 文档
              </Link>
            </nav>
          </aside>

          <div className="flex min-w-0 flex-1 flex-col">
            <header className="flex h-14 items-center gap-2 border-b px-4">
              <div className="text-sm font-semibold">资产台账</div>
              <div className="ml-auto text-xs text-muted-foreground">vCenter MVP</div>
            </header>
            <main className="min-w-0 flex-1 p-4 md:p-6">{children}</main>
          </div>
        </div>

        <Toaster />
      </body>
    </html>
  );
}
