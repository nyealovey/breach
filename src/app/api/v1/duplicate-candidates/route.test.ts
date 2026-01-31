import { describe, expect, it, vi } from 'vitest';

import { GET } from '@/app/api/v1/duplicate-candidates/route';
import { requireAdmin } from '@/lib/auth/require-admin';
import { prisma } from '@/lib/db/prisma';

vi.mock('@/lib/auth/require-admin', () => ({ requireAdmin: vi.fn() }));
vi.mock('@/lib/db/prisma', () => {
  const duplicateCandidate = {
    count: vi.fn(),
    findMany: vi.fn(),
  };

  return {
    prisma: {
      duplicateCandidate,
      $transaction: vi.fn(async (ops: unknown[]) => Promise.all(ops as Promise<unknown>[])),
    },
  };
});

describe('GET /api/v1/duplicate-candidates', () => {
  it('returns okPaginated with default status=open', async () => {
    (requireAdmin as any).mockResolvedValue({
      ok: true,
      requestId: 'req_test',
      session: { user: { id: 'u1' } },
    });

    (prisma.duplicateCandidate.count as any).mockResolvedValue(1);
    (prisma.duplicateCandidate.findMany as any).mockResolvedValue([
      {
        id: 'dc_1',
        status: 'open',
        score: 95,
        lastObservedAt: new Date('2026-01-31T00:00:00.000Z'),
        assetA: {
          uuid: 'a',
          displayName: 'vm-a',
          assetType: 'vm',
          status: 'in_service',
          lastSeenAt: new Date('2026-01-30T00:00:00.000Z'),
        },
        assetB: {
          uuid: 'b',
          displayName: 'vm-b',
          assetType: 'vm',
          status: 'offline',
          lastSeenAt: new Date('2026-01-29T00:00:00.000Z'),
        },
      },
    ]);

    const req = new Request('http://localhost/api/v1/duplicate-candidates?page=1&pageSize=20');
    const res = await GET(req);

    expect(res.status).toBe(200);
    expect(res.headers.get('X-Request-ID')).toBe('req_test');

    expect(prisma.duplicateCandidate.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ status: 'open' }) }),
    );

    const body = (await res.json()) as any;
    expect(body.pagination).toEqual({ page: 1, pageSize: 20, total: 1, totalPages: 1 });
    expect(body.data[0]).toMatchObject({
      candidateId: 'dc_1',
      status: 'open',
      score: 95,
      confidence: 'High',
      assetA: { assetUuid: 'a', assetType: 'vm' },
      assetB: { assetUuid: 'b', assetType: 'vm' },
    });
  });

  it('applies confidence=Medium filter (70<=score<90)', async () => {
    (requireAdmin as any).mockResolvedValue({
      ok: true,
      requestId: 'req_test',
      session: { user: { id: 'u1' } },
    });

    (prisma.duplicateCandidate.count as any).mockResolvedValue(0);
    (prisma.duplicateCandidate.findMany as any).mockResolvedValue([]);

    const req = new Request('http://localhost/api/v1/duplicate-candidates?confidence=Medium');
    const res = await GET(req);

    expect(res.status).toBe(200);
    expect(prisma.duplicateCandidate.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ score: { gte: 70, lt: 90 } }),
      }),
    );
  });
});
