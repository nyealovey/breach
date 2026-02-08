import { Suspense } from 'react';

import { requireServerAdminSession } from '@/lib/auth/require-server-session';

import PageClient from './page.client';

export default async function Page() {
  await requireServerAdminSession();

  return (
    <Suspense fallback={<div className="p-6 text-sm text-muted-foreground">加载中...</div>}>
      <PageClient />
    </Suspense>
  );
}
