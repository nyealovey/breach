import { Geist } from 'next/font/google';
import Link from 'next/link';

import { Toaster } from '@/components/ui/sonner';
import { getServerSession } from '@/lib/auth/server-session';
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

const NAV_ITEMS: Array<{ href: string; label: string; adminOnly?: boolean }> = [
  { href: '/', label: '概览' },
  { href: '/runs', label: '运行' },
  { href: '/assets', label: '资产' },
  { href: '/schedule-groups', label: '调度组', adminOnly: true },
  { href: '/sources', label: '来源', adminOnly: true },
  { href: '/credentials', label: '凭据', adminOnly: true },
  { href: '/exports', label: '导出', adminOnly: true },
  { href: '/duplicate-candidates', label: '重复中心', adminOnly: true },
  { href: '/api/docs', label: 'API 文档', adminOnly: true },
];

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = await getServerSession();
  const isAdmin = session?.user.role === 'admin';

  return (
    <html lang="zh-CN">
      <body className={cn(geistSans.variable, 'min-h-screen bg-background text-foreground antialiased')}>
        <div className="flex min-h-screen">
          {session ? (
            <aside className="hidden w-64 shrink-0 border-r bg-muted/40 p-4 md:block">
              <div className="mb-4 text-sm font-semibold">资产台账</div>
              <nav className="space-y-1 text-sm">
                {NAV_ITEMS.filter((it) => isAdmin || !it.adminOnly).map((it) => (
                  <Link key={it.href} className="block rounded px-2 py-1 hover:bg-muted" href={it.href}>
                    {it.label}
                  </Link>
                ))}
              </nav>
            </aside>
          ) : null}

          <div className="flex min-w-0 flex-1 flex-col">
            <header className="flex h-14 items-center gap-2 border-b px-4">
              <div className="text-sm font-semibold">资产台账</div>
              {session ? (
                <div className="ml-auto text-xs text-muted-foreground">{isAdmin ? 'admin' : 'user'}</div>
              ) : (
                <div className="ml-auto text-xs text-muted-foreground">未登录</div>
              )}
            </header>
            <main className="min-w-0 flex-1 p-4 md:p-6">{children}</main>
          </div>
        </div>

        <Toaster />
      </body>
    </html>
  );
}
