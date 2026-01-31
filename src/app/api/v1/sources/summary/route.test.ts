import { describe, expect, it, vi } from 'vitest';

import { GET } from '@/app/api/v1/sources/summary/route';
import { requireUser } from '@/lib/auth/require-user';
import { prisma } from '@/lib/db/prisma';

vi.mock('@/lib/auth/require-user', () => ({ requireUser: vi.fn() }));
vi.mock('@/lib/db/prisma', () => {
  const source = { findMany: vi.fn() };
  return { prisma: { source } };
});

describe('GET /api/v1/sources/summary', () => {
  it('returns enabled sources without config/credential fields', async () => {
    (requireUser as any).mockResolvedValue({
      ok: true,
      requestId: 'req_test',
      session: { user: { id: 'u1' } },
    } as any);

    (prisma.source.findMany as any).mockResolvedValue([
      { id: 'src_1', name: 'vcenter-prod', sourceType: 'vcenter', enabled: true },
      { id: 'src_2', name: 'pve-lab', sourceType: 'pve', enabled: true },
    ]);

    const req = new Request('http://localhost/api/v1/sources/summary');
    const res = await GET(req);

    expect(prisma.source.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { enabled: true, deletedAt: null },
        select: { id: true, name: true, sourceType: true, enabled: true },
      }),
    );

    expect(res.status).toBe(200);
    expect(res.headers.get('X-Request-ID')).toBe('req_test');

    const body = (await res.json()) as any;
    expect(body.data).toEqual([
      { sourceId: 'src_1', name: 'vcenter-prod', sourceType: 'vcenter', enabled: true },
      { sourceId: 'src_2', name: 'pve-lab', sourceType: 'pve', enabled: true },
    ]);
  });
});
