import { describe, expect, it, vi } from 'vitest';

import { POST } from '@/app/api/v1/sources/route';
import { requireAdmin } from '@/lib/auth/require-admin';
import { prisma } from '@/lib/db/prisma';

vi.mock('@/lib/auth/require-admin', () => ({ requireAdmin: vi.fn() }));
vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    source: { findFirst: vi.fn(), create: vi.fn() },
    scheduleGroup: { findUnique: vi.fn() },
    credential: { findUnique: vi.fn() },
    agent: { findUnique: vi.fn() },
  },
}));

describe('POST /api/v1/sources', () => {
  it('returns 404 when credentialId does not exist', async () => {
    (requireAdmin as any).mockResolvedValue({
      ok: true,
      requestId: 'req_test',
      session: { user: { id: 'u1' } },
    } as any);
    (prisma.source.findFirst as any).mockResolvedValue(null as any);
    (prisma.scheduleGroup.findUnique as any).mockResolvedValue({ id: 'g1' } as any);
    (prisma.credential.findUnique as any).mockResolvedValue(null as any);

    const req = new Request('http://localhost/api/v1/sources', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 's1',
        sourceType: 'vcenter',
        scheduleGroupId: 'g1',
        enabled: true,
        config: { endpoint: 'https://example.invalid' },
        credentialId: 'c1',
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(404);
    const body = (await res.json()) as any;
    expect(body.error.code).toBe('CONFIG_CREDENTIAL_NOT_FOUND');
  });

  it('returns 400 when hyperv agent config is missing endpoint', async () => {
    (requireAdmin as any).mockResolvedValue({
      ok: true,
      requestId: 'req_test',
      session: { user: { id: 'u1' } },
    } as any);
    (prisma.source.findFirst as any).mockResolvedValue(null as any);

    const req = new Request('http://localhost/api/v1/sources', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'h1',
        sourceType: 'hyperv',
        enabled: true,
        config: { connection_method: 'agent', agent_url: 'http://hyperv-agent.example.com:8787' },
      }),
    });
    const res = await POST(req);
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
    (prisma.source.findFirst as any).mockResolvedValue(null as any);

    const req = new Request('http://localhost/api/v1/sources', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'h1',
        sourceType: 'hyperv',
        enabled: true,
        config: { connection_method: 'agent', endpoint: 'host01.example.com' },
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = (await res.json()) as any;
    expect(body.error.code).toBe('CONFIG_INVALID_REQUEST');
    expect(body.error.message).toBe('agentId or agent_url is required when connection_method=agent');
  });

  it('creates hyperv agent source when endpoint + agent_url are present', async () => {
    (requireAdmin as any).mockResolvedValue({
      ok: true,
      requestId: 'req_test',
      session: { user: { id: 'u1' } },
    } as any);
    (prisma.source.findFirst as any).mockResolvedValue(null as any);
    (prisma.source.create as any).mockImplementation(async (args: any) => ({
      id: 'src_1',
      name: args.data.name,
      sourceType: args.data.sourceType,
      enabled: args.data.enabled,
      scheduleGroupId: args.data.scheduleGroupId ?? null,
      config: args.data.config,
      credential: null,
      createdAt: new Date('2026-02-04T00:00:00Z'),
      updatedAt: new Date('2026-02-04T00:00:00Z'),
    }));

    const req = new Request('http://localhost/api/v1/sources', {
      method: 'POST',
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

    const res = await POST(req);
    expect(res.status).toBe(201);
    const body = (await res.json()) as any;
    expect(body.data.sourceId).toBe('src_1');
    expect(body.data.config.endpoint).toBe('host01.example.com');
    expect(body.data.config.agent_url).toBe('http://hyperv-agent.example.com:8787');
  });
});
