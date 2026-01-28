import { describe, expect, it } from 'vitest';

import { buildAssetListWhere, isUuid, parseAssetListQuery } from '@/lib/assets/asset-list-query';

describe('asset list query', () => {
  it('parses supported query params and trims q', () => {
    const params = new URLSearchParams({ asset_type: 'vm', source_id: 'src_1', q: '  host-01  ' });
    expect(parseAssetListQuery(params)).toEqual({ assetType: 'vm', sourceId: 'src_1', q: 'host-01' });
  });

  it('treats unknown asset_type as undefined', () => {
    const params = new URLSearchParams({ asset_type: 'nope' });
    expect(parseAssetListQuery(params)).toEqual({ assetType: undefined, sourceId: undefined, q: undefined });
  });

  it('detects uuid strings', () => {
    expect(isUuid('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
    expect(isUuid('not-a-uuid')).toBe(false);
  });

  it('builds where with filters and non-uuid search', () => {
    const where = buildAssetListWhere({ assetType: 'host', sourceId: 'src_1', q: 'esx' });
    expect(where).toEqual({
      AND: [
        { assetType: 'host' },
        { sourceLinks: { some: { sourceId: 'src_1' } } },
        {
          OR: [
            { displayName: { contains: 'esx', mode: 'insensitive' } },
            { sourceLinks: { some: { externalId: { contains: 'esx', mode: 'insensitive' } } } },
          ],
        },
      ],
    });
  });

  it('builds where with uuid equality search (not contains)', () => {
    const uuid = '550e8400-e29b-41d4-a716-446655440000';
    const where = buildAssetListWhere({ q: uuid });
    expect(where).toEqual({
      AND: [
        {
          OR: [
            { displayName: { contains: uuid, mode: 'insensitive' } },
            { sourceLinks: { some: { externalId: { contains: uuid, mode: 'insensitive' } } } },
            { uuid },
          ],
        },
      ],
    });
  });
});
