import { describe, expect, it, vi } from 'vitest';

import { DELETE } from '@/app/api/v1/users/[id]/route';
import { requireAdmin } from '@/lib/auth/require-admin';
import { prisma } from '@/lib/db/prisma';

vi.mock('@/lib/auth/require-admin', () => ({ requireAdmin: vi.fn() }));
vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    $transaction: vi.fn(),
    user: { findUnique: vi.fn() },
  },
}));

describe('DELETE /api/v1/users/:id', () => {
  it('soft deletes a user and clears sessions', async () => {
    (requireAdmin as any).mockResolvedValue({
      ok: true,
      requestId: 'req_test',
      session: { user: { id: 'u_admin', role: 'admin' } },
    } as any);
    (prisma.user.findUnique as any).mockResolvedValue({ id: 'u_1', username: 'user@example.com', deletedAt: null });

    const tx = {
      user: { update: vi.fn().mockResolvedValue({}) },
      session: { deleteMany: vi.fn().mockResolvedValue({ count: 1 }) },
    };
    (prisma.$transaction as any).mockImplementation(async (fn: (tx: any) => Promise<unknown>) => fn(tx));

    const req = new Request('http://localhost/api/v1/users/u_1', { method: 'DELETE' });
    const res = await DELETE(req, { params: Promise.resolve({ id: 'u_1' }) });
    expect(res.status).toBe(200);

    expect(tx.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'u_1' },
        data: expect.objectContaining({
          enabled: false,
          externalAuthId: null,
          passwordHash: null,
          username: expect.stringContaining('deleted:u_1:'),
          deletedAt: expect.any(Date),
        }),
      }),
    );
    expect(tx.session.deleteMany).toHaveBeenCalledWith({ where: { userId: 'u_1' } });
  });

  it('rejects deleting the current user', async () => {
    (requireAdmin as any).mockResolvedValue({
      ok: true,
      requestId: 'req_test',
      session: { user: { id: 'u_1', role: 'admin' } },
    } as any);

    const req = new Request('http://localhost/api/v1/users/u_1', { method: 'DELETE' });
    const res = await DELETE(req, { params: Promise.resolve({ id: 'u_1' }) });
    expect(res.status).toBe(400);
  });

  it('rejects deleting admin', async () => {
    (requireAdmin as any).mockResolvedValue({
      ok: true,
      requestId: 'req_test',
      session: { user: { id: 'u_admin', role: 'admin' } },
    } as any);
    (prisma.user.findUnique as any).mockResolvedValue({ id: 'u_admin', username: 'admin', deletedAt: null });

    const req = new Request('http://localhost/api/v1/users/u_admin', { method: 'DELETE' });
    const res = await DELETE(req, { params: Promise.resolve({ id: 'u_admin' }) });
    expect(res.status).toBe(400);
  });

  it('returns 404 when user is already soft-deleted', async () => {
    (requireAdmin as any).mockResolvedValue({
      ok: true,
      requestId: 'req_test',
      session: { user: { id: 'u_admin', role: 'admin' } },
    } as any);
    (prisma.user.findUnique as any).mockResolvedValue({
      id: 'u_1',
      username: 'user@example.com',
      deletedAt: new Date('2026-02-07T00:00:00Z'),
    });

    const req = new Request('http://localhost/api/v1/users/u_1', { method: 'DELETE' });
    const res = await DELETE(req, { params: Promise.resolve({ id: 'u_1' }) });
    expect(res.status).toBe(404);
  });
});
