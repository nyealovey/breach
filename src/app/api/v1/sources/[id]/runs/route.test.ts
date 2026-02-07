import { beforeEach, describe, expect, it, vi } from 'vitest';

import { POST } from '@/app/api/v1/sources/[id]/runs/route';
import { requireAdmin } from '@/lib/auth/require-admin';
import { prisma } from '@/lib/db/prisma';

vi.mock('@/lib/auth/require-admin', () => ({ requireAdmin: vi.fn() }));
vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    source: { findFirst: vi.fn() },
    run: { findFirst: vi.fn(), create: vi.fn() },
    auditEvent: { create: vi.fn() },
  },
}));

describe('POST /api/v1/sources/:id/runs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('accepts mode=detect and enqueues a run', async () => {
    (requireAdmin as any).mockResolvedValue({
      ok: true,
      requestId: 'req_test',
      session: { user: { id: 'u1' } },
    } as any);

    (prisma.source.findFirst as any).mockResolvedValue({ id: 'src_1', scheduleGroupId: 'sg_1' } as any);
    (prisma.run.findFirst as any).mockResolvedValue(null);
    (prisma.run.create as any).mockResolvedValue({
      id: 'run_1',
      sourceId: 'src_1',
      mode: 'detect',
      triggerType: 'manual',
      status: 'Queued',
      createdAt: new Date('2026-01-30T00:00:00.000Z'),
    } as any);

    const req = new Request('http://localhost/api/v1/sources/src_1/runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode: 'detect' }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: 'src_1' }) } as any);

    expect(prisma.run.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ sourceId: 'src_1', mode: 'detect' }),
      }),
    );

    expect(res.status).toBe(201);
    const body = (await res.json()) as any;
    expect(body.data).toMatchObject({ sourceId: 'src_1', mode: 'detect', triggerType: 'manual', status: 'Queued' });
  });

  it('rejects pve collect when scope is missing/auto', async () => {
    (requireAdmin as any).mockResolvedValue({
      ok: true,
      requestId: 'req_test',
      session: { user: { id: 'u1' } },
    } as any);

    (prisma.source.findFirst as any).mockResolvedValue({
      id: 'src_pve',
      scheduleGroupId: 'sg_1',
      sourceType: 'pve',
      config: { endpoint: 'host.example.com', scope: 'auto' },
    } as any);

    const req = new Request('http://localhost/api/v1/sources/src_pve/runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode: 'collect' }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: 'src_pve' }) } as any);

    expect(res.status).toBe(400);
    const body = (await res.json()) as any;
    expect(body.error?.code).toBe('CONFIG_INVALID_REQUEST');
    expect(body.error?.message).toContain('scope is required for pve collect runs');
    expect(prisma.run.findFirst).not.toHaveBeenCalled();
    expect(prisma.run.create).not.toHaveBeenCalled();
  });

  it('rejects hyperv winrm collect when auth_method is missing/auto', async () => {
    (requireAdmin as any).mockResolvedValue({
      ok: true,
      requestId: 'req_test',
      session: { user: { id: 'u1' } },
    } as any);

    (prisma.source.findFirst as any).mockResolvedValue({
      id: 'src_hyperv',
      scheduleGroupId: 'sg_1',
      sourceType: 'hyperv',
      config: { endpoint: 'host.example.com', scope: 'standalone', auth_method: 'auto' },
    } as any);

    const req = new Request('http://localhost/api/v1/sources/src_hyperv/runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode: 'collect' }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: 'src_hyperv' }) } as any);

    expect(res.status).toBe(400);
    const body = (await res.json()) as any;
    expect(body.error?.code).toBe('CONFIG_INVALID_REQUEST');
    expect(body.error?.message).toContain('auth_method is required for hyperv winrm collect runs');
    expect(prisma.run.findFirst).not.toHaveBeenCalled();
    expect(prisma.run.create).not.toHaveBeenCalled();
  });

  it('rejects activedirectory collect when purpose=auth_only', async () => {
    (requireAdmin as any).mockResolvedValue({
      ok: true,
      requestId: 'req_test',
      session: { user: { id: 'u1' } },
    } as any);

    (prisma.source.findFirst as any).mockResolvedValue({
      id: 'src_ad',
      scheduleGroupId: 'sg_1',
      sourceType: 'activedirectory',
      config: { endpoint: 'ldaps://dc01.example.com:636', purpose: 'auth_only' },
    } as any);

    const req = new Request('http://localhost/api/v1/sources/src_ad/runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode: 'collect' }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: 'src_ad' }) } as any);

    expect(res.status).toBe(400);
    const body = (await res.json()) as any;
    expect(body.error?.code).toBe('CONFIG_INVALID_REQUEST');
    expect(body.error?.message).toContain('purpose=auth_only');
    expect(prisma.run.findFirst).not.toHaveBeenCalled();
    expect(prisma.run.create).not.toHaveBeenCalled();
  });
});
