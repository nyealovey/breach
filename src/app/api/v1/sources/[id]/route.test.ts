import { describe, expect, it, vi } from 'vitest';

import { PUT } from '@/app/api/v1/sources/[id]/route';
import { requireAdmin } from '@/lib/auth/require-admin';
import { prisma } from '@/lib/db/prisma';

vi.mock('@/lib/auth/require-admin', () => ({ requireAdmin: vi.fn() }));
vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    source: { findFirst: vi.fn(), update: vi.fn() },
    scheduleGroup: { findUnique: vi.fn() },
    credential: { findUnique: vi.fn() },
  },
}));

describe('PUT /api/v1/sources/:id', () => {
  it('returns 400 when hyperv agent config is missing endpoint', async () => {
    (requireAdmin as any).mockResolvedValue({
      ok: true,
      requestId: 'req_test',
      session: { user: { id: 'u1' } },
    } as any);

    (prisma.source.findFirst as any)
      // existing source
      .mockResolvedValueOnce({ id: 'src_1', deletedAt: null, scheduleGroupId: null, credentialId: null } as any)
      // duplicate name check
      .mockResolvedValueOnce(null as any);

    const req = new Request('http://localhost/api/v1/sources/src_1', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'h1',
        sourceType: 'hyperv',
        enabled: true,
        config: { connection_method: 'agent', agent_url: 'http://hyperv-agent.example.com:8787' },
      }),
    });

    const res = await PUT(req, { params: Promise.resolve({ id: 'src_1' }) } as any);
    expect(res.status).toBe(400);
    const body = (await res.json()) as any;
    expect(body.error.code).toBe('CONFIG_INVALID_REQUEST');
    expect(body.error.message).toBe('endpoint is required');
  });

  it('returns 400 when hyperv agent config is missing agent_url', async () => {
    (requireAdmin as any).mockResolvedValue({
      ok: true,
      requestId: 'req_test',
      session: { user: { id: 'u1' } },
    } as any);

    (prisma.source.findFirst as any)
      .mockResolvedValueOnce({ id: 'src_1', deletedAt: null, scheduleGroupId: null, credentialId: null } as any)
      .mockResolvedValueOnce(null as any);

    const req = new Request('http://localhost/api/v1/sources/src_1', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'h1',
        sourceType: 'hyperv',
        enabled: true,
        config: { connection_method: 'agent', endpoint: 'host01.example.com' },
      }),
    });

    const res = await PUT(req, { params: Promise.resolve({ id: 'src_1' }) } as any);
    expect(res.status).toBe(400);
    const body = (await res.json()) as any;
    expect(body.error.code).toBe('CONFIG_INVALID_REQUEST');
    expect(body.error.message).toBe('agent_url is required when connection_method=agent');
  });

  it('updates hyperv agent source when endpoint + agent_url are present', async () => {
    (requireAdmin as any).mockResolvedValue({
      ok: true,
      requestId: 'req_test',
      session: { user: { id: 'u1' } },
    } as any);

    (prisma.source.findFirst as any)
      .mockResolvedValueOnce({ id: 'src_1', deletedAt: null, scheduleGroupId: null, credentialId: null } as any)
      .mockResolvedValueOnce(null as any);

    (prisma.source.update as any).mockResolvedValue({
      id: 'src_1',
      name: 'h1',
      sourceType: 'hyperv',
      enabled: true,
      scheduleGroupId: null,
      config: {
        connection_method: 'agent',
        endpoint: 'host01.example.com',
        agent_url: 'http://hyperv-agent.example.com:8787',
      },
      credential: null,
      createdAt: new Date('2026-02-04T00:00:00Z'),
      updatedAt: new Date('2026-02-04T00:00:00Z'),
    } as any);

    const req = new Request('http://localhost/api/v1/sources/src_1', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'h1',
        sourceType: 'hyperv',
        enabled: true,
        config: {
          connection_method: 'agent',
          endpoint: 'host01.example.com',
          agent_url: 'http://hyperv-agent.example.com:8787',
        },
      }),
    });

    const res = await PUT(req, { params: Promise.resolve({ id: 'src_1' }) } as any);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data.sourceId).toBe('src_1');
    expect(body.data.config.endpoint).toBe('host01.example.com');
  });
});
