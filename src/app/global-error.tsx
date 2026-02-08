'use client';

import Link from 'next/link';
import { useEffect } from 'react';

type GlobalErrorProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

export default function GlobalError({ error, reset }: GlobalErrorProps) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="zh-CN">
      <body className="min-h-screen bg-background text-foreground">
        <div className="mx-auto flex w-full max-w-lg flex-col gap-3 p-6 py-16">
          <h1 className="text-2xl font-semibold tracking-tight">应用发生异常</h1>
          <p className="text-sm text-muted-foreground">发生了一个影响全局布局的错误。你可以重试或返回概览页。</p>

          {error.digest ? <div className="font-mono text-xs text-muted-foreground">digest: {error.digest}</div> : null}

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
              onClick={() => reset()}
            >
              重试
            </button>
            <Link className="rounded-md border px-4 py-2 text-sm hover:bg-muted" href="/">
              返回概览
            </Link>
          </div>
        </div>
      </body>
    </html>
  );
}
