import { describe, expect, it } from 'vitest';

import { buildAssetListWhere, isUuid, parseAssetListQuery } from '@/lib/assets/asset-list-query';

describe('asset list query', () => {
  it('parses supported query params and trims q', () => {
    const params = new URLSearchParams({ asset_type: 'vm', source_id: 'src_1', q: '  host-01  ' });
    expect(parseAssetListQuery(params)).toEqual({
      assetType: 'vm',
      excludeAssetType: undefined,
      sourceId: 'src_1',
      q: 'host-01',
    });
  });

  it('treats unknown asset_type as undefined', () => {
    const params = new URLSearchParams({ asset_type: 'nope' });
    expect(parseAssetListQuery(params)).toEqual({
      assetType: undefined,
      excludeAssetType: undefined,
      sourceId: undefined,
      q: undefined,
    });
  });

  it('parses exclude_asset_type', () => {
    const params = new URLSearchParams({ exclude_asset_type: 'cluster' });
    expect(parseAssetListQuery(params)).toEqual({
      assetType: undefined,
      excludeAssetType: 'cluster',
      sourceId: undefined,
      q: undefined,
    });
  });

  it('detects uuid strings', () => {
    expect(isUuid('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
    expect(isUuid('not-a-uuid')).toBe(false);
  });

  it('builds where with filters and non-uuid search', () => {
    const where = buildAssetListWhere({ assetType: 'host', sourceId: 'src_1', q: 'esx' });
    expect(where).toMatchObject({
      AND: [
        { assetType: 'host' },
        { sourceLinks: { some: { sourceId: 'src_1' } } },
        {
          OR: expect.arrayContaining([
            { displayName: { contains: 'esx', mode: 'insensitive' } },
            { machineNameOverride: { contains: 'esx', mode: 'insensitive' } },
            { sourceLinks: { some: { externalId: { contains: 'esx', mode: 'insensitive' } } } },
            {
              outgoingRelations: {
                some: { relationType: 'runs_on', toAsset: { displayName: { contains: 'esx', mode: 'insensitive' } } },
              },
            },
            {
              runSnapshots: {
                some: {
                  canonical: { path: ['fields', 'os', 'name', 'value'], string_contains: 'esx', mode: 'insensitive' },
                },
              },
            },
          ]),
        },
      ],
    });
  });

  it('builds where with exclude_asset_type', () => {
    const where = buildAssetListWhere({ excludeAssetType: 'cluster' });
    expect(where).toEqual({ AND: [{ assetType: { not: 'cluster' } }] });
  });

  it('builds where with uuid equality search (not contains)', () => {
    const uuid = '550e8400-e29b-41d4-a716-446655440000';
    const where = buildAssetListWhere({ q: uuid });
    expect(where).toMatchObject({
      AND: [
        {
          OR: expect.arrayContaining([
            { displayName: { contains: uuid, mode: 'insensitive' } },
            { machineNameOverride: { contains: uuid, mode: 'insensitive' } },
            { sourceLinks: { some: { externalId: { contains: uuid, mode: 'insensitive' } } } },
            { uuid },
          ]),
        },
      ],
    });
  });

  it('restricts os.fingerprint search to VMs (host build is not searchable)', () => {
    const q = '20036589';
    const where = buildAssetListWhere({ q });

    const and = (where as any).AND as any[];
    const or = and?.find((c) => c && typeof c === 'object' && 'OR' in c)?.OR as any[];

    expect(or).toContainEqual({
      assetType: 'vm',
      runSnapshots: {
        some: {
          canonical: { path: ['fields', 'os', 'fingerprint', 'value'], string_contains: q, mode: 'insensitive' },
        },
      },
    });

    // Must not include an unscoped fingerprint clause that would also match hosts.
    expect(or).not.toContainEqual({
      runSnapshots: {
        some: {
          canonical: { path: ['fields', 'os', 'fingerprint', 'value'], string_contains: q, mode: 'insensitive' },
        },
      },
    });
  });
});
