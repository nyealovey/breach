import { describe, expect, it, vi } from 'vitest';

import { PATCH } from '@/app/api/v1/users/[id]/role/route';
import { requireAdmin } from '@/lib/auth/require-admin';
import { prisma } from '@/lib/db/prisma';

vi.mock('@/lib/auth/require-admin', () => ({ requireAdmin: vi.fn() }));
vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    user: { findUnique: vi.fn(), update: vi.fn() },
  },
}));

describe('PATCH /api/v1/users/:id/role', () => {
  it('rejects editing admin role', async () => {
    (requireAdmin as any).mockResolvedValue({
      ok: true,
      requestId: 'req_test',
      session: { user: { id: 'u_admin' } },
    } as any);
    (prisma.user.findUnique as any).mockResolvedValue({ id: 'u_admin', username: 'admin', deletedAt: null } as any);

    const req = new Request('http://localhost/api/v1/users/u_admin/role', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ role: 'user' }),
    });
    const res = await PATCH(req, { params: Promise.resolve({ id: 'u_admin' }) });
    expect(res.status).toBe(400);
  });

  it('rejects editing soft-deleted users', async () => {
    (requireAdmin as any).mockResolvedValue({
      ok: true,
      requestId: 'req_test',
      session: { user: { id: 'u_admin' } },
    } as any);
    (prisma.user.findUnique as any).mockResolvedValue({
      id: 'u_1',
      username: 'user@example.com',
      deletedAt: new Date('2026-02-07T00:00:00Z'),
    } as any);

    const req = new Request('http://localhost/api/v1/users/u_1/role', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ role: 'admin' }),
    });
    const res = await PATCH(req, { params: Promise.resolve({ id: 'u_1' }) });
    expect(res.status).toBe(404);
  });
});
