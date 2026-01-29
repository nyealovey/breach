import { describe, expect, it, vi } from 'vitest';

import { POST } from '@/app/api/v1/schedule-groups/[id]/runs/route';
import { requireAdmin } from '@/lib/auth/require-admin';
import { prisma } from '@/lib/db/prisma';

vi.mock('@/lib/auth/require-admin', () => ({ requireAdmin: vi.fn() }));
vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    scheduleGroup: { findUnique: vi.fn() },
    $transaction: vi.fn(),
  },
}));

describe('POST /api/v1/schedule-groups/:id/runs', () => {
  it('returns queued=0 when all enabled sources missing credential', async () => {
    (requireAdmin as any).mockResolvedValue({
      ok: true,
      requestId: 'req_test',
      session: { user: { id: 'u1' } },
    } as any);
    (prisma.scheduleGroup.findUnique as any).mockResolvedValue({ id: 'g1' } as any);
    (prisma.$transaction as any).mockResolvedValue({
      queued: 0,
      skipped_active: 0,
      skipped_missing_credential: 2,
      message: 'no eligible sources',
    });

    const req = new Request('http://localhost/api/v1/schedule-groups/g1/runs', { method: 'POST' });
    const res = await POST(req, { params: Promise.resolve({ id: 'g1' }) } as any);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data.queued).toBe(0);
  });
});

