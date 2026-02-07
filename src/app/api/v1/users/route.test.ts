import { describe, expect, it, vi } from 'vitest';

import { GET } from '@/app/api/v1/users/route';
import { requireAdmin } from '@/lib/auth/require-admin';
import { prisma } from '@/lib/db/prisma';

vi.mock('@/lib/auth/require-admin', () => ({ requireAdmin: vi.fn() }));
vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    $transaction: vi.fn(),
    user: { count: vi.fn(), findMany: vi.fn(), create: vi.fn() },
  },
}));

describe('GET /api/v1/users', () => {
  it('filters out soft-deleted users by default (deletedAt IS NULL)', async () => {
    (requireAdmin as any).mockResolvedValue({
      ok: true,
      requestId: 'req_test',
      session: { user: { id: 'u_admin' } },
    } as any);

    (prisma.user.count as any).mockResolvedValue(0);
    (prisma.user.findMany as any).mockResolvedValue([]);
    (prisma.$transaction as any).mockImplementation(async (promises: Promise<unknown>[]) => Promise.all(promises));

    const req = new Request('http://localhost/api/v1/users?pageSize=200', { method: 'GET' });
    const res = await GET(req);
    expect(res.status).toBe(200);

    expect(prisma.user.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ deletedAt: null }),
      }),
    );
    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ deletedAt: null }),
      }),
    );
  });
});
