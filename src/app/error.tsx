'use client';

import Link from 'next/link';
import { useEffect } from 'react';

type ErrorProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

export default function Error({ error, reset }: ErrorProps) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-3 py-16">
      <h1 className="text-2xl font-semibold tracking-tight">页面出错了</h1>
      <p className="text-sm text-muted-foreground">渲染过程中发生异常。你可以尝试重试，或返回概览页。</p>

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
  );
}
