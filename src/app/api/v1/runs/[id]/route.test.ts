import { describe, expect, it, vi } from 'vitest';

import { GET } from '@/app/api/v1/runs/[id]/route';
import { requireUser } from '@/lib/auth/require-user';
import { prisma } from '@/lib/db/prisma';

vi.mock('@/lib/auth/require-user', () => ({ requireUser: vi.fn() }));
vi.mock('@/lib/db/prisma', () => {
  const run = { findUnique: vi.fn() };
  return { prisma: { run } };
});

describe('GET /api/v1/runs/:id', () => {
  it('returns 404 when run missing', async () => {
    (requireUser as any).mockResolvedValue({
      ok: true,
      requestId: 'req_test',
      session: { user: { id: 'u1' } },
    } as any);

    (prisma.run.findUnique as any).mockResolvedValue(null);

    const req = new Request('http://localhost/api/v1/runs/run_missing');
    const res = await GET(req, { params: Promise.resolve({ id: 'run_missing' }) });

    expect(res.status).toBe(404);
    const body = (await res.json()) as any;
    expect(body.error.code).toBe('CONFIG_RUN_NOT_FOUND');
  });

  it('returns run detail', async () => {
    (requireUser as any).mockResolvedValue({
      ok: true,
      requestId: 'req_test',
      session: { user: { id: 'u1' } },
    } as any);

    (prisma.run.findUnique as any).mockResolvedValue({
      id: 'run_1',
      sourceId: 'src_1',
      source: { name: 'vcenter-prod' },
      mode: 'collect',
      triggerType: 'schedule',
      status: 'Failed',
      startedAt: new Date('2026-01-31T00:00:00.000Z'),
      finishedAt: new Date('2026-01-31T00:00:02.000Z'),
      detectResult: { driver: 'vcenter-rest' },
      stats: { assets: 10 },
      warnings: [],
      errors: [{ code: 'X', message: 'oops' }],
      errorSummary: 'failed',
    } as any);

    const req = new Request('http://localhost/api/v1/runs/run_1');
    const res = await GET(req, { params: Promise.resolve({ id: 'run_1' }) });

    expect(res.status).toBe(200);
    expect(res.headers.get('X-Request-ID')).toBe('req_test');

    const body = (await res.json()) as any;
    expect(body.data).toEqual({
      runId: 'run_1',
      sourceId: 'src_1',
      sourceName: 'vcenter-prod',
      mode: 'collect',
      triggerType: 'schedule',
      status: 'Failed',
      startedAt: '2026-01-31T00:00:00.000Z',
      finishedAt: '2026-01-31T00:00:02.000Z',
      durationMs: 2000,
      detectResult: { driver: 'vcenter-rest' },
      stats: { assets: 10 },
      warnings: [],
      errors: [{ code: 'X', message: 'oops' }],
      errorSummary: 'failed',
    });
  });
});
