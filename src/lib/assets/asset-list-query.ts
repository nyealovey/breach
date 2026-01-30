import { AssetType } from '@prisma/client';

import type { Prisma } from '@prisma/client';

export type AssetListQuery = {
  assetType: AssetType | undefined;
  excludeAssetType: AssetType | undefined;
  sourceId: string | undefined;
  q: string | undefined;
};

function parseAssetType(input: string | null): AssetType | undefined {
  if (!input) return undefined;
  if ((Object.values(AssetType) as string[]).includes(input)) return input as AssetType;
  return undefined;
}

function parseOptionalString(input: string | null): string | undefined {
  if (!input) return undefined;
  const trimmed = input.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function parseAssetListQuery(params: URLSearchParams): AssetListQuery {
  return {
    assetType: parseAssetType(params.get('asset_type')),
    excludeAssetType: parseAssetType(params.get('exclude_asset_type')),
    sourceId: parseOptionalString(params.get('source_id')),
    q: parseOptionalString(params.get('q')),
  };
}

export function isUuid(input: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input);
}

export function buildAssetListWhere(query: {
  assetType?: AssetType;
  excludeAssetType?: AssetType;
  sourceId?: string;
  q?: string;
}): Prisma.AssetWhereInput {
  const and: Prisma.AssetWhereInput[] = [];

  if (query.assetType) and.push({ assetType: query.assetType });
  if (query.excludeAssetType) and.push({ assetType: { not: query.excludeAssetType } });
  if (query.sourceId) and.push({ sourceLinks: { some: { sourceId: query.sourceId } } });

  if (query.q) {
    const q = query.q;
    const or: Prisma.AssetWhereInput[] = [
      { displayName: { contains: q, mode: 'insensitive' } },
      { machineNameOverride: { contains: q, mode: 'insensitive' } },
      { sourceLinks: { some: { externalId: { contains: q, mode: 'insensitive' } } } },
      // 宿主机名：VM --runs_on--> Host 的 displayName
      {
        outgoingRelations: {
          some: { relationType: 'runs_on', toAsset: { displayName: { contains: q, mode: 'insensitive' } } },
        },
      },
      // 操作系统/机器名/虚拟机名（caption）：从 canonical JSON 中做简单 substring 匹配（任意历史快照命中即可）
      {
        runSnapshots: {
          some: { canonical: { path: ['fields', 'os', 'name', 'value'], string_contains: q, mode: 'insensitive' } },
        },
      },
      {
        runSnapshots: {
          some: { canonical: { path: ['fields', 'os', 'version', 'value'], string_contains: q, mode: 'insensitive' } },
        },
      },
      {
        // NOTE: Host 的 os.fingerprint 用于承接 ESXi build（不纳入 q 搜索）。
        // VM 的 os.fingerprint 仍用于承接 guest_OS 等指纹（需可搜索）。
        assetType: AssetType.vm,
        runSnapshots: {
          some: {
            canonical: { path: ['fields', 'os', 'fingerprint', 'value'], string_contains: q, mode: 'insensitive' },
          },
        },
      },
      {
        runSnapshots: {
          some: {
            canonical: { path: ['fields', 'identity', 'hostname', 'value'], string_contains: q, mode: 'insensitive' },
          },
        },
      },
      {
        runSnapshots: {
          some: {
            canonical: { path: ['fields', 'identity', 'caption', 'value'], string_contains: q, mode: 'insensitive' },
          },
        },
      },
    ];

    // Avoid UUID contains search; UUID columns do not support LIKE without casting.
    if (isUuid(q)) or.push({ uuid: q });

    and.push({ OR: or });
  }

  return and.length > 0 ? { AND: and } : {};
}
