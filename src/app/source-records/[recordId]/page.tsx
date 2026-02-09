import { Suspense } from 'react';

import { getSourceRecordNormalizedAction, getSourceRecordRawAction } from '@/lib/actions/source-records';
import { requireServerSession } from '@/lib/auth/require-server-session';
import { parseSourceRecordTab } from '@/lib/source-records/page-data';

import PageClient from './page.client';

import type { SourceRecordPageInitialData } from '@/lib/source-records/page-data';

type SourceRecordPageProps = {
  params: Promise<{ recordId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function toUrlSearchParams(input: Record<string, string | string[] | undefined>): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(input)) {
    if (typeof value === 'string') {
      params.set(key, value);
      continue;
    }
    if (Array.isArray(value) && typeof value[0] === 'string') {
      params.set(key, value[0]);
    }
  }
  return params;
}

export default async function Page({ params, searchParams }: SourceRecordPageProps) {
  const [session, { recordId }, resolvedSearchParams] = await Promise.all([
    requireServerSession(),
    params,
    searchParams,
  ]);
  const query = toUrlSearchParams(resolvedSearchParams);
  const isAdmin = session.user.role === 'admin';
  const tab = parseSourceRecordTab(query.get('tab'), isAdmin);

  const initialData: SourceRecordPageInitialData = {
    recordId,
    isAdmin,
    tab,
    normalized: null,
    raw: null,
    loadError: null,
  };

  if (tab === 'raw') {
    const result = await getSourceRecordRawAction(recordId);
    if (result.ok) {
      initialData.raw = result.data;
    } else {
      initialData.loadError = result.error;
    }
  } else {
    const result = await getSourceRecordNormalizedAction(recordId);
    if (result.ok) {
      initialData.normalized = result.data;
    } else {
      initialData.loadError = result.error;
    }
  }

  return (
    <Suspense fallback={<div className="p-6 text-sm text-muted-foreground">加载中...</div>}>
      <PageClient initialData={initialData} />
    </Suspense>
  );
}
