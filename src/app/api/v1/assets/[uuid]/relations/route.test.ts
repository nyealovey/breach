import { describe, expect, it, vi } from 'vitest';

import { GET } from '@/app/api/v1/assets/[uuid]/relations/route';
import { requireAdmin } from '@/lib/auth/require-admin';
import { prisma } from '@/lib/db/prisma';

vi.mock('@/lib/auth/require-admin', () => ({ requireAdmin: vi.fn() }));
vi.mock('@/lib/db/prisma', () => {
  const asset = { findUnique: vi.fn() };
  const relation = { findMany: vi.fn() };
  return { prisma: { asset, relation } };
});

describe('GET /api/v1/assets/:uuid/relations', () => {
  it('returns outgoing relations for asset', async () => {
    (requireAdmin as any).mockResolvedValue({
      ok: true,
      requestId: 'req_test',
      session: { user: { id: 'u1' } },
    } as any);
    (prisma.asset.findUnique as any).mockResolvedValue({ uuid: '550e8400-e29b-41d4-a716-446655440000' } as any);
    (prisma.relation.findMany as any).mockResolvedValue([
      {
        id: 'rel_1',
        relationType: 'runs_on',
        toAssetUuid: '11111111-1111-1111-1111-111111111111',
        sourceId: 'src_1',
        lastSeenAt: new Date('2026-01-28T00:00:00.000Z'),
        toAsset: { uuid: '11111111-1111-1111-1111-111111111111', assetType: 'host', displayName: 'esx-01' },
      },
    ] as any);

    const req = new Request('http://localhost/api/v1/assets/550e8400-e29b-41d4-a716-446655440000/relations');
    const res = await GET(req, { params: Promise.resolve({ uuid: '550e8400-e29b-41d4-a716-446655440000' }) });

    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data).toEqual([
      {
        relationId: 'rel_1',
        relationType: 'runs_on',
        toAssetUuid: '11111111-1111-1111-1111-111111111111',
        toAssetType: 'host',
        toDisplayName: 'esx-01',
        sourceId: 'src_1',
        lastSeenAt: '2026-01-28T00:00:00.000Z',
      },
    ]);
  });
});
