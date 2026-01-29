import { describe, expect, it, vi } from 'vitest';

import { GET } from '@/app/api/v1/assets/route';
import { requireAdmin } from '@/lib/auth/require-admin';
import { prisma } from '@/lib/db/prisma';

vi.mock('@/lib/auth/require-admin', () => ({ requireAdmin: vi.fn() }));
vi.mock('@/lib/db/prisma', () => {
  const asset = {
    count: vi.fn(),
    findMany: vi.fn(),
  };

  return {
    prisma: {
      asset,
      $transaction: vi.fn(async (ops: unknown[]) => Promise.all(ops as Promise<unknown>[])),
    },
  };
});

describe('GET /api/v1/assets', () => {
  it('returns okPaginated with request id header', async () => {
    (requireAdmin as any).mockResolvedValue({
      ok: true,
      requestId: 'req_test',
      session: { user: { id: 'u1' } },
    } as any);

    (prisma.asset.count as any).mockResolvedValue(1);
    (prisma.asset.findMany as any).mockResolvedValue([
      {
        uuid: '550e8400-e29b-41d4-a716-446655440000',
        assetType: 'vm',
        status: 'in_service',
        displayName: 'vm-01',
        lastSeenAt: new Date('2026-01-28T00:00:00.000Z'),
        createdAt: new Date('2026-01-28T00:00:00.000Z'),
        sourceLinks: [
          {
            sourceId: 'src_1',
            source: { id: 'src_1', name: 'vcenter-1' },
          },
        ],
      },
    ] as any);

    const req = new Request('http://localhost/api/v1/assets?page=1&pageSize=20');
    const res = await GET(req);

    expect(res.status).toBe(200);
    expect(res.headers.get('X-Request-ID')).toBe('req_test');

    const body = (await res.json()) as any;
    expect(body.pagination).toEqual({ page: 1, pageSize: 20, total: 1, totalPages: 1 });
    expect(body.data).toEqual([
      {
        assetUuid: '550e8400-e29b-41d4-a716-446655440000',
        assetType: 'vm',
        status: 'in_service',
        displayName: 'vm-01',
        lastSeenAt: '2026-01-28T00:00:00.000Z',
        sources: [{ sourceId: 'src_1', name: 'vcenter-1' }],
      },
    ]);
  });
});
