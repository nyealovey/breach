import { Suspense } from 'react';

import { requireServerAdminSession } from '@/lib/auth/require-server-session';
import { readDuplicateCandidatesListInitialData } from '@/lib/duplicate-candidates/server-data';

import PageClient from './page.client';

type DuplicateCandidatesPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function Page({ searchParams }: DuplicateCandidatesPageProps) {
  await requireServerAdminSession();
  const initialData = await readDuplicateCandidatesListInitialData(await searchParams);

  return (
    <Suspense fallback={<div className="p-6 text-sm text-muted-foreground">加载中...</div>}>
      <PageClient initialData={initialData} />
    </Suspense>
  );
}
