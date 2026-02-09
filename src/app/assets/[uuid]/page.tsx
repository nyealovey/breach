import { redirect } from 'next/navigation';

import { readAssetDetailPageServerData } from '@/lib/assets/server-data';
import { requireServerSession } from '@/lib/auth/require-server-session';

import PageClient from './page.client';

import type { AssetDetailPageInitialData } from './page.client';

type AssetDetailPageProps = {
  params: Promise<{ uuid: string }>;
};

function pickRole(input: string): 'admin' | 'user' | null {
  return input === 'admin' || input === 'user' ? input : null;
}

export default async function AssetDetailPage({ params }: AssetDetailPageProps) {
  const [session, { uuid }] = await Promise.all([requireServerSession(), params]);

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
    role: pickRole(session.user.role),
    asset: serverData.asset,
    sourceRecords: serverData.sourceRecords,
    relations: serverData.relations,
    history: serverData.history,
  };

  return <PageClient initialData={initialData} />;
}
