import { Suspense } from 'react';

import { buildAssetListUrlSearchParams, parseAssetListUrlState } from '@/lib/assets/asset-list-url';
import { requireServerSession } from '@/lib/auth/require-server-session';
import { readAssetsPageServerData } from '@/lib/assets/server-data';

import PageClient from './page.client';

import type { AssetListUrlState } from '@/lib/assets/asset-list-url';

import type { AssetListColumnId, AssetsPageInitialData } from './page.client';

type AssetsPageProps = {
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

function toAssetsApiQueryState(params: URLSearchParams): AssetListUrlState {
  const parsed = parseAssetListUrlState(params);

  const impliedAssetType =
    parsed.vmPowerState || parsed.ipMissing || parsed.machineNameMissing || parsed.machineNameVmNameMismatch
      ? ('vm' as const)
      : parsed.brand || parsed.model
        ? ('host' as const)
        : parsed.assetType;

  return {
    ...parsed,
    assetType: impliedAssetType,
    excludeAssetType: 'cluster',
  };
}

function readVisibleColumns(input: unknown): AssetListColumnId[] | null {
  if (!Array.isArray(input)) return null;
  const next = input
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

  return next.length > 0 ? (next as AssetListColumnId[]) : null;
}

export default async function AssetsPage({ searchParams }: AssetsPageProps) {
  const [session, resolvedSearchParams] = await Promise.all([requireServerSession(), searchParams]);

  const uiSearchParams = toUrlSearchParams(resolvedSearchParams);
  const queryState = toAssetsApiQueryState(uiSearchParams);
  const listQueryString = buildAssetListUrlSearchParams(queryState).toString();

  const serverData = await readAssetsPageServerData({
    userId: session.user.id,
    listQueryString,
  });

  const initialData: AssetsPageInitialData = {
    role: pickRole(session.user.role),
    sourceOptions: serverData.sourceOptions,
    ledgerFieldFilterOptions: serverData.ledgerFieldFilterOptions,
    visibleColumns: readVisibleColumns(serverData.visibleColumns),
    queryString: listQueryString,
    list: serverData.list,
  };

  return (
    <Suspense fallback={<div className="p-6 text-sm text-muted-foreground">加载中...</div>}>
      <PageClient initialData={initialData} />
    </Suspense>
  );
}
