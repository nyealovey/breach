import { Geist } from 'next/font/google';
import Link from 'next/link';
import { Suspense } from 'react';

import { AppTopNav } from '@/components/nav/app-top-nav';
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

function AppTopNavFallback({ isAdmin }: { isAdmin: boolean }) {
  return (
    <div className="flex h-14 items-center gap-3 px-4">
      <Link className="shrink-0 text-sm font-semibold" href="/">
        资产台账
      </Link>
      <div className="ml-auto text-xs text-muted-foreground">{isAdmin ? 'admin' : 'user'}</div>
    </div>
  );
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = await getServerSession();
  const isAdmin = session?.user.role === 'admin';

  return (
    <html lang="zh-CN">
      <body className={cn(geistSans.variable, 'min-h-screen font-sans bg-background text-foreground antialiased')}>
        <div className="flex min-h-screen flex-col">
          <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
            {session ? (
              <Suspense fallback={<AppTopNavFallback isAdmin={isAdmin} />}>
                <AppTopNav isAdmin={isAdmin} />
              </Suspense>
            ) : (
              <div className="flex h-14 items-center gap-3 px-4">
                <Link className="shrink-0 text-sm font-semibold" href="/login">
                  资产台账
                </Link>
                <div className="ml-auto flex shrink-0 items-center gap-3 text-xs">
                  <span className="text-muted-foreground">未登录</span>
                  <Link className="text-primary underline-offset-4 hover:underline" href="/login">
                    登录
                  </Link>
                </div>
              </div>
            )}
          </header>

          <main className="min-w-0 flex-1 bg-muted/30 p-4 md:p-6">
            <div className="mx-auto w-full max-w-[1600px]">{children}</div>
          </main>
        </div>

        <Toaster />
      </body>
    </html>
  );
}
