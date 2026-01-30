import { describe, expect, it, vi } from 'vitest';

import { POST } from '@/app/api/v1/sources/[id]/runs/route';
import { requireAdmin } from '@/lib/auth/require-admin';
import { prisma } from '@/lib/db/prisma';

vi.mock('@/lib/auth/require-admin', () => ({ requireAdmin: vi.fn() }));
vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    source: { findFirst: vi.fn() },
    run: { findFirst: vi.fn(), create: vi.fn() },
    auditEvent: { create: vi.fn() },
  },
}));

describe('POST /api/v1/sources/:id/runs', () => {
  it('accepts mode=detect and enqueues a run', async () => {
    (requireAdmin as any).mockResolvedValue({
      ok: true,
      requestId: 'req_test',
      session: { user: { id: 'u1' } },
    } as any);

    (prisma.source.findFirst as any).mockResolvedValue({ id: 'src_1', scheduleGroupId: 'sg_1' } as any);
    (prisma.run.findFirst as any).mockResolvedValue(null);
    (prisma.run.create as any).mockResolvedValue({
      id: 'run_1',
      sourceId: 'src_1',
      mode: 'detect',
      triggerType: 'manual',
      status: 'Queued',
      createdAt: new Date('2026-01-30T00:00:00.000Z'),
    } as any);

    const req = new Request('http://localhost/api/v1/sources/src_1/runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode: 'detect' }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: 'src_1' }) } as any);

    expect(prisma.run.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ sourceId: 'src_1', mode: 'detect' }),
      }),
    );

    expect(res.status).toBe(201);
    const body = (await res.json()) as any;
    expect(body.data).toMatchObject({ sourceId: 'src_1', mode: 'detect', triggerType: 'manual', status: 'Queued' });
  });
});
