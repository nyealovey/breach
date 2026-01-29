import { describe, expect, it, vi } from 'vitest';

import { GET } from '@/app/api/v1/assets/[uuid]/source-records/route';
import { requireAdmin } from '@/lib/auth/require-admin';
import { prisma } from '@/lib/db/prisma';

vi.mock('@/lib/auth/require-admin', () => ({ requireAdmin: vi.fn() }));
vi.mock('@/lib/db/prisma', () => {
  const asset = { findUnique: vi.fn() };
  const sourceRecord = { findMany: vi.fn() };
  return { prisma: { asset, sourceRecord } };
});

describe('GET /api/v1/assets/:uuid/source-records', () => {
  it('returns normalized source records for asset', async () => {
    (requireAdmin as any).mockResolvedValue({
      ok: true,
      requestId: 'req_test',
      session: { user: { id: 'u1' } },
    } as any);
    (prisma.asset.findUnique as any).mockResolvedValue({ uuid: '550e8400-e29b-41d4-a716-446655440000' } as any);
    (prisma.sourceRecord.findMany as any).mockResolvedValue([
      {
        id: 'rec_1',
        collectedAt: new Date('2026-01-28T00:00:00.000Z'),
        runId: 'run_1',
        sourceId: 'src_1',
        externalKind: 'vm',
        externalId: 'vm-123',
        normalized: { version: 'normalized-v1', kind: 'vm', identity: { hostname: 'vm-01' } },
      },
    ] as any);

    const req = new Request('http://localhost/api/v1/assets/550e8400-e29b-41d4-a716-446655440000/source-records');
    const res = await GET(req, { params: Promise.resolve({ uuid: '550e8400-e29b-41d4-a716-446655440000' }) });

    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data).toEqual([
      {
        recordId: 'rec_1',
        collectedAt: '2026-01-28T00:00:00.000Z',
        runId: 'run_1',
        sourceId: 'src_1',
        externalKind: 'vm',
        externalId: 'vm-123',
        normalized: { version: 'normalized-v1', kind: 'vm', identity: { hostname: 'vm-01' } },
      },
    ]);
  });
});
