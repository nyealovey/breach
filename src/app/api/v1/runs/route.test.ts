import { describe, expect, it, vi } from 'vitest';

import { GET } from '@/app/api/v1/runs/route';
import { requireUser } from '@/lib/auth/require-user';
import { prisma } from '@/lib/db/prisma';

vi.mock('@/lib/auth/require-user', () => ({ requireUser: vi.fn() }));
vi.mock('@/lib/db/prisma', () => {
  const run = {
    count: vi.fn(),
    findMany: vi.fn(),
  };

  return {
    prisma: {
      run,
      $transaction: vi.fn(async (ops: unknown[]) => Promise.all(ops as Promise<unknown>[])),
    },
  };
});

describe('GET /api/v1/runs', () => {
  it('returns okPaginated list', async () => {
    (requireUser as any).mockResolvedValue({
      ok: true,
      requestId: 'req_test',
      session: { user: { id: 'u1' } },
    } as any);

    (prisma.run.count as any).mockResolvedValue(1);
    (prisma.run.findMany as any).mockResolvedValue([
      {
        id: 'run_1',
        sourceId: 'src_1',
        source: { name: 'vcenter-prod' },
        mode: 'collect',
        triggerType: 'schedule',
        status: 'Succeeded',
        startedAt: new Date('2026-01-31T00:00:00.000Z'),
        finishedAt: new Date('2026-01-31T00:00:01.000Z'),
        stats: { ok: true },
        warnings: [],
        errors: [{ code: 'X', message: 'oops' }],
      },
    ] as any);

    const req = new Request('http://localhost/api/v1/runs?page=1&pageSize=20');
    const res = await GET(req);

    expect(res.status).toBe(200);
    expect(res.headers.get('X-Request-ID')).toBe('req_test');

    const body = (await res.json()) as any;
    expect(body.pagination).toEqual({ page: 1, pageSize: 20, total: 1, totalPages: 1 });
    expect(body.data).toEqual([
      {
        runId: 'run_1',
        sourceId: 'src_1',
        sourceName: 'vcenter-prod',
        mode: 'collect',
        triggerType: 'schedule',
        status: 'Succeeded',
        startedAt: '2026-01-31T00:00:00.000Z',
        finishedAt: '2026-01-31T00:00:01.000Z',
        durationMs: 1000,
        stats: { ok: true },
        warningsCount: 0,
        errorsCount: 1,
      },
    ]);
  });
});
