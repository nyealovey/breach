import { describe, expect, it, vi } from 'vitest';

import { DELETE } from '@/app/api/v1/credentials/[id]/route';
import { requireAdmin } from '@/lib/auth/require-admin';
import { prisma } from '@/lib/db/prisma';

vi.mock('@/lib/auth/require-admin', () => ({ requireAdmin: vi.fn() }));
vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    credential: { findUnique: vi.fn(), delete: vi.fn(), update: vi.fn() },
    source: { count: vi.fn() },
  },
}));

describe('DELETE /api/v1/credentials/:id', () => {
  it('returns 409 when usageCount>0', async () => {
    (requireAdmin as any).mockResolvedValue({
      ok: true,
      requestId: 'req_test',
      session: { user: { id: 'u1' } },
    } as any);
    (prisma.credential.findUnique as any).mockResolvedValue({ id: 'c1' } as any);
    (prisma.source.count as any).mockResolvedValue(1);

    const req = new Request('http://localhost/api/v1/credentials/c1', { method: 'DELETE' });
    const res = await DELETE(req, { params: Promise.resolve({ id: 'c1' }) } as any);

    expect(res.status).toBe(409);
    const body = (await res.json()) as any;
    expect(body.error.code).toBe('CONFIG_RESOURCE_CONFLICT');
  });
});
