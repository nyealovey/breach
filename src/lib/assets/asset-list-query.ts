import { AssetType } from '@prisma/client';

import type { Prisma } from '@prisma/client';

export type AssetListQuery = {
  assetType: AssetType | undefined;
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
    sourceId: parseOptionalString(params.get('source_id')),
    q: parseOptionalString(params.get('q')),
  };
}

export function isUuid(input: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input);
}

export function buildAssetListWhere(query: {
  assetType?: AssetType;
  sourceId?: string;
  q?: string;
}): Prisma.AssetWhereInput {
  const and: Prisma.AssetWhereInput[] = [];

  if (query.assetType) and.push({ assetType: query.assetType });
  if (query.sourceId) and.push({ sourceLinks: { some: { sourceId: query.sourceId } } });

  if (query.q) {
    const q = query.q;
    const or: Prisma.AssetWhereInput[] = [
      { displayName: { contains: q, mode: 'insensitive' } },
      { sourceLinks: { some: { externalId: { contains: q, mode: 'insensitive' } } } },
    ];

    // Avoid UUID contains search; UUID columns do not support LIKE without casting.
    if (isUuid(q)) or.push({ uuid: q });

    and.push({ OR: or });
  }

  return and.length > 0 ? { AND: and } : {};
}
