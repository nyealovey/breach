import { Suspense } from 'react';

import PageClient from './page.client';

export default function Page() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-muted-foreground">加载中...</div>}>
      <PageClient />
    </Suspense>
  );
}
