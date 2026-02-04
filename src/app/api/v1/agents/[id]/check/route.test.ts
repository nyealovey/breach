import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { POST } from '@/app/api/v1/agents/[id]/check/route';
import { requireAdmin } from '@/lib/auth/require-admin';
import { prisma } from '@/lib/db/prisma';

vi.mock('@/lib/auth/require-admin', () => ({ requireAdmin: vi.fn() }));
vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    agent: { findUnique: vi.fn() },
  },
}));

describe('POST /api/v1/agents/:id/check', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    (requireAdmin as any).mockResolvedValue({
      ok: true,
      requestId: 'req_test',
      session: { user: { id: 'u1' } },
    } as any);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('returns reachable=true when agent /health returns 200', async () => {
    (prisma.agent.findUnique as any).mockResolvedValue({
      id: 'a1',
      endpoint: 'http://hyperv-agent.example.com:8787',
      timeoutMs: 60000,
    } as any);

    globalThis.fetch = vi.fn().mockResolvedValue(new Response('ok', { status: 200 })) as any;

    const req = new Request('http://localhost/api/v1/agents/a1/check', { method: 'POST' });
    const res = await POST(req, { params: Promise.resolve({ id: 'a1' }) } as any);

    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data.reachable).toBe(true);
    expect(body.data.status).toBe(200);
  });

  it('returns reachable=false when fetch throws', async () => {
    (prisma.agent.findUnique as any).mockResolvedValue({
      id: 'a1',
      endpoint: 'http://hyperv-agent.example.com:8787',
      timeoutMs: 60000,
    } as any);

    globalThis.fetch = vi.fn().mockRejectedValue(new Error('network down')) as any;

    const req = new Request('http://localhost/api/v1/agents/a1/check', { method: 'POST' });
    const res = await POST(req, { params: Promise.resolve({ id: 'a1' }) } as any);

    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data.reachable).toBe(false);
    expect(body.data.error).toContain('network down');
  });
});
