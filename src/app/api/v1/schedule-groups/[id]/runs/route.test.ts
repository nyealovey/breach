import { describe, expect, it, vi } from 'vitest';

import { POST } from '@/app/api/v1/schedule-groups/[id]/runs/route';
import { requireAdmin } from '@/lib/auth/require-admin';
import { prisma } from '@/lib/db/prisma';

vi.mock('@/lib/auth/require-admin', () => ({ requireAdmin: vi.fn() }));
vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    scheduleGroup: { findUnique: vi.fn() },
    $transaction: vi.fn(),
  },
}));

type TxSourceRow = { id: string; credentialId: string | null; sourceType: string; config: unknown };
type TxActiveRun = { sourceId: string; mode: string };

function makeTxMock(input: { sources: TxSourceRow[]; active: TxActiveRun[] }) {
  const createMany = vi.fn().mockResolvedValue({ count: 0 });
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue(input.sources),
    run: {
      findMany: vi.fn().mockResolvedValue(input.active),
      createMany,
    },
  } as any;
  return { tx, createMany };
}

describe('POST /api/v1/schedule-groups/:id/runs', () => {
  it('defaults to collect when body is empty', async () => {
    (requireAdmin as any).mockResolvedValue({
      ok: true,
      requestId: 'req_test',
      session: { user: { id: 'u1' } },
    } as any);
    (prisma.scheduleGroup.findUnique as any).mockResolvedValue({ id: 'g1' } as any);

    const { tx, createMany } = makeTxMock({
      sources: [
        {
          id: 's1',
          credentialId: 'c1',
          sourceType: 'hyperv',
          config: { endpoint: 'host.example.com', scope: 'standalone', auth_method: 'kerberos' },
        },
      ],
      active: [],
    });
    (prisma.$transaction as any).mockImplementation(async (fn: any) => await fn(tx));

    const req = new Request('http://localhost/api/v1/schedule-groups/g1/runs', { method: 'POST' });
    const res = await POST(req, { params: Promise.resolve({ id: 'g1' }) } as any);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data.queued).toBe(1);
    expect(createMany).toHaveBeenCalledTimes(1);
    expect(createMany.mock.calls[0]?.[0]?.data?.[0]?.mode).toBe('collect');
  });

  it('enqueues detect runs when mode=detect', async () => {
    (requireAdmin as any).mockResolvedValue({
      ok: true,
      requestId: 'req_test',
      session: { user: { id: 'u1' } },
    } as any);
    (prisma.scheduleGroup.findUnique as any).mockResolvedValue({ id: 'g1' } as any);

    const { tx, createMany } = makeTxMock({
      sources: [
        { id: 's1', credentialId: 'c1', sourceType: 'hyperv', config: { endpoint: 'host.example.com' } },
        { id: 's2', credentialId: 'c2', sourceType: 'vcenter', config: {} },
      ],
      active: [],
    });
    (prisma.$transaction as any).mockImplementation(async (fn: any) => await fn(tx));

    const req = new Request('http://localhost/api/v1/schedule-groups/g1/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'detect' }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: 'g1' }) } as any);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data.queued).toBe(2);
    expect(createMany).toHaveBeenCalledTimes(1);
    const data = createMany.mock.calls[0]?.[0]?.data ?? [];
    expect(data.map((r: any) => r.mode)).toEqual(['detect', 'detect']);
  });

  it('enqueues vcenter collect as collect_hosts + collect_vms', async () => {
    (requireAdmin as any).mockResolvedValue({
      ok: true,
      requestId: 'req_test',
      session: { user: { id: 'u1' } },
    } as any);
    (prisma.scheduleGroup.findUnique as any).mockResolvedValue({ id: 'g1' } as any);

    const { tx, createMany } = makeTxMock({
      sources: [
        {
          id: 'v1',
          credentialId: 'c1',
          sourceType: 'vcenter',
          config: { preferred_vcenter_version: '7.0-8.x' },
        },
        {
          id: 'h1',
          credentialId: 'c2',
          sourceType: 'hyperv',
          config: { endpoint: 'host.example.com', scope: 'standalone', auth_method: 'kerberos' },
        },
      ],
      active: [],
    });
    (prisma.$transaction as any).mockImplementation(async (fn: any) => await fn(tx));

    const req = new Request('http://localhost/api/v1/schedule-groups/g1/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'collect' }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: 'g1' }) } as any);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data.queued).toBe(3);
    // hostRuns + vmRuns + collectRuns
    expect(createMany).toHaveBeenCalledTimes(3);
    const allModes = createMany.mock.calls.flatMap((call) => (call?.[0] as any)?.data?.map((r: any) => r.mode) ?? []);
    expect(allModes.sort()).toEqual(['collect', 'collect_hosts', 'collect_vms'].sort());
  });

  it('does not require preferred_vcenter_version for detect/healthcheck', async () => {
    (requireAdmin as any).mockResolvedValue({
      ok: true,
      requestId: 'req_test',
      session: { user: { id: 'u1' } },
    } as any);
    (prisma.scheduleGroup.findUnique as any).mockResolvedValue({ id: 'g1' } as any);

    const { tx, createMany } = makeTxMock({
      sources: [{ id: 'v1', credentialId: 'c1', sourceType: 'vcenter', config: {} }],
      active: [],
    });
    (prisma.$transaction as any).mockImplementation(async (fn: any) => await fn(tx));

    const req = new Request('http://localhost/api/v1/schedule-groups/g1/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'healthcheck' }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: 'g1' }) } as any);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data.queued).toBe(1);
    expect(createMany).toHaveBeenCalledTimes(1);
    expect(createMany.mock.calls[0]?.[0]?.data?.[0]?.mode).toBe('healthcheck');
  });

  it('skips collect runs when required explicit config is missing', async () => {
    (requireAdmin as any).mockResolvedValue({
      ok: true,
      requestId: 'req_test',
      session: { user: { id: 'u1' } },
    } as any);
    (prisma.scheduleGroup.findUnique as any).mockResolvedValue({ id: 'g1' } as any);

    const { tx, createMany } = makeTxMock({
      sources: [
        { id: 'v_bad', credentialId: 'c1', sourceType: 'vcenter', config: {} },
        { id: 'p_bad', credentialId: 'c2', sourceType: 'pve', config: { endpoint: 'host.example.com' } },
        {
          id: 'h_bad',
          credentialId: 'c3',
          sourceType: 'hyperv',
          config: { endpoint: 'host.example.com', scope: 'auto', auth_method: 'kerberos' },
        },
        {
          id: 'h_ok',
          credentialId: 'c4',
          sourceType: 'hyperv',
          config: { endpoint: 'host.example.com', scope: 'standalone', auth_method: 'kerberos' },
        },
      ],
      active: [],
    });
    (prisma.$transaction as any).mockImplementation(async (fn: any) => await fn(tx));

    const req = new Request('http://localhost/api/v1/schedule-groups/g1/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'collect' }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: 'g1' }) } as any);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;

    expect(body.data).toMatchObject({ queued: 1, skipped_missing_config: 3, skipped_missing_credential: 0 });
    expect(createMany).toHaveBeenCalledTimes(1);
    expect(createMany.mock.calls[0]?.[0]?.data?.[0]?.mode).toBe('collect');
  });
});
