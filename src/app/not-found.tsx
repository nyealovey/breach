import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="mx-auto flex w-full max-w-lg flex-col items-center justify-center gap-3 py-16 text-center">
      <h1 className="text-2xl font-semibold tracking-tight">页面不存在</h1>
      <p className="text-sm text-muted-foreground">你访问的页面不存在或已被移动。</p>

      <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
        <Link className="rounded-md border px-4 py-2 text-sm hover:bg-muted" href="/">
          返回概览
        </Link>
        <Link className="rounded-md border px-4 py-2 text-sm hover:bg-muted" href="/assets">
          去资产列表
        </Link>
      </div>
    </div>
  );
}
