import { describe, expect, it, vi } from 'vitest';

import { DELETE, GET } from '@/app/api/v1/agents/[id]/route';
import { requireAdmin } from '@/lib/auth/require-admin';
import { prisma } from '@/lib/db/prisma';

vi.mock('@/lib/auth/require-admin', () => ({ requireAdmin: vi.fn() }));
vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    agent: { findUnique: vi.fn(), delete: vi.fn() },
    source: { count: vi.fn() },
  },
}));

describe('GET /api/v1/agents/:id', () => {
  it('returns 404 when agent does not exist', async () => {
    (requireAdmin as any).mockResolvedValue({
      ok: true,
      requestId: 'req_test',
      session: { user: { id: 'u1' } },
    } as any);
    (prisma.agent.findUnique as any).mockResolvedValue(null as any);

    const req = new Request('http://localhost/api/v1/agents/a1');
    const res = await GET(req, { params: Promise.resolve({ id: 'a1' }) } as any);
    expect(res.status).toBe(404);
    const body = (await res.json()) as any;
    expect(body.error.code).toBe('CONFIG_AGENT_NOT_FOUND');
  });
});

describe('DELETE /api/v1/agents/:id', () => {
  it('returns 409 when agent is still referenced by sources', async () => {
    (requireAdmin as any).mockResolvedValue({
      ok: true,
      requestId: 'req_test',
      session: { user: { id: 'u1' } },
    } as any);
    (prisma.agent.findUnique as any).mockResolvedValue({ id: 'a1' } as any);
    (prisma.source.count as any).mockResolvedValue(1);

    const req = new Request('http://localhost/api/v1/agents/a1', { method: 'DELETE' });
    const res = await DELETE(req, { params: Promise.resolve({ id: 'a1' }) } as any);
    expect(res.status).toBe(409);
    const body = (await res.json()) as any;
    expect(body.error.code).toBe('CONFIG_RESOURCE_CONFLICT');
  });
});
