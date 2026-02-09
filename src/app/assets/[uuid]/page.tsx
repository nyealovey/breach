import { redirect } from 'next/navigation';

import { parseAssetDetailTab } from '@/lib/assets/page-data';
import { readAssetDetailPageServerData } from '@/lib/assets/server-data';
import { requireServerSession } from '@/lib/auth/require-server-session';

import PageClient from './page.client';

import type { AssetDetailPageInitialData } from './page.client';

type AssetDetailPageProps = {
  params: Promise<{ uuid: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function pickRole(input: string): 'admin' | 'user' | null {
  return input === 'admin' || input === 'user' ? input : null;
}

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

export default async function AssetDetailPage({ params, searchParams }: AssetDetailPageProps) {
  const [session, { uuid }, resolvedSearchParams] = await Promise.all([requireServerSession(), params, searchParams]);
  const query = toUrlSearchParams(resolvedSearchParams);

  const serverData = await readAssetDetailPageServerData({ uuid, historyLimit: 20 });

  if (
    serverData.asset?.mergedIntoAssetUuid &&
    serverData.asset.status === 'merged' &&
    serverData.asset.mergedIntoAssetUuid !== uuid
  ) {
    redirect(`/assets/${encodeURIComponent(serverData.asset.mergedIntoAssetUuid)}`);
  }

  const initialData: AssetDetailPageInitialData = {
    uuid,
    tab: parseAssetDetailTab(query.get('tab')),
    role: pickRole(session.user.role),
    asset: serverData.asset,
    relations: serverData.relations,
    history: serverData.history,
  };

  return <PageClient initialData={initialData} />;
}
