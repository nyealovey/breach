import { describe, expect, it, vi } from 'vitest';

import { POST } from '@/app/api/v1/agents/route';
import { requireAdmin } from '@/lib/auth/require-admin';
import { prisma } from '@/lib/db/prisma';

vi.mock('@/lib/auth/require-admin', () => ({ requireAdmin: vi.fn() }));
vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    agent: { count: vi.fn(), findMany: vi.fn(), create: vi.fn() },
    source: { groupBy: vi.fn() },
    $transaction: vi.fn(),
  },
}));

describe('POST /api/v1/agents', () => {
  it('returns 409 when name already exists', async () => {
    (requireAdmin as any).mockResolvedValue({
      ok: true,
      requestId: 'req_test',
      session: { user: { id: 'u1' } },
    } as any);
    (prisma.agent.create as any).mockRejectedValue({ code: 'P2002' } as any);

    const req = new Request('http://localhost/api/v1/agents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'a1',
        agentType: 'hyperv',
        endpoint: 'http://hyperv-agent.example.com:8787',
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(409);
    const body = (await res.json()) as any;
    expect(body.error.code).toBe('CONFIG_DUPLICATE_NAME');
  });

  it('creates agent when request is valid', async () => {
    (requireAdmin as any).mockResolvedValue({
      ok: true,
      requestId: 'req_test',
      session: { user: { id: 'u1' } },
    } as any);
    (prisma.agent.create as any).mockResolvedValue({
      id: 'a1',
      name: 'a1',
      agentType: 'hyperv',
      endpoint: 'http://hyperv-agent.example.com:8787',
      enabled: true,
      tlsVerify: true,
      timeoutMs: 60000,
      createdAt: new Date('2026-02-04T00:00:00Z'),
      updatedAt: new Date('2026-02-04T00:00:00Z'),
    } as any);

    const req = new Request('http://localhost/api/v1/agents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'a1',
        agentType: 'hyperv',
        endpoint: 'http://hyperv-agent.example.com:8787',
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(201);
    const body = (await res.json()) as any;
    expect(body.data.agentId).toBe('a1');
    expect(body.data.agentType).toBe('hyperv');
    expect(body.data.endpoint).toBe('http://hyperv-agent.example.com:8787');
  });
});
