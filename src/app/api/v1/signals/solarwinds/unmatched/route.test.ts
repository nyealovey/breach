import { describe, expect, it, vi } from 'vitest';

import { GET } from '@/app/api/v1/signals/solarwinds/unmatched/route';
import { requireAdmin } from '@/lib/auth/require-admin';
import { prisma } from '@/lib/db/prisma';

vi.mock('@/lib/auth/require-admin', () => ({ requireAdmin: vi.fn() }));
vi.mock('@/lib/db/prisma', () => {
  const assetSignalLink = { count: vi.fn(), findMany: vi.fn() };
  return {
    prisma: {
      assetSignalLink,
      $transaction: vi.fn(async (ops: unknown[]) => Promise.all(ops as Promise<unknown>[])),
    },
  };
});

describe('GET /api/v1/signals/solarwinds/unmatched', () => {
  it('returns okPaginated data', async () => {
    (requireAdmin as any).mockResolvedValue({
      ok: true,
      requestId: 'req_test',
      session: { user: { id: 'u1' } },
    } as any);

    (prisma.assetSignalLink.count as any).mockResolvedValue(1);
    (prisma.assetSignalLink.findMany as any).mockResolvedValue([
      {
        id: 'link1',
        sourceId: 'src_sw',
        externalKind: 'host',
        externalId: '123',
        firstSeenAt: new Date('2026-02-01T00:00:00.000Z'),
        lastSeenAt: new Date('2026-02-06T00:00:00.000Z'),
        matchEvidence: { hostname: 'vm-01.example.com', caption: null, ip_addresses: ['192.0.2.10'] },
        source: { name: 'orion' },
      },
    ]);

    const req = new Request('http://localhost/api/v1/signals/solarwinds/unmatched?page=1&pageSize=20');
    const res = await GET(req);

    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data).toEqual([
      {
        linkId: 'link1',
        sourceId: 'src_sw',
        sourceName: 'orion',
        externalKind: 'host',
        externalId: '123',
        firstSeenAt: '2026-02-01T00:00:00.000Z',
        lastSeenAt: '2026-02-06T00:00:00.000Z',
        matchEvidence: { hostname: 'vm-01.example.com', caption: null, ip_addresses: ['192.0.2.10'] },
      },
    ]);
  });
});
