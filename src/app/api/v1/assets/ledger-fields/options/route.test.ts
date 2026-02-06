import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GET } from '@/app/api/v1/assets/ledger-fields/options/route';
import { requireUser } from '@/lib/auth/require-user';
import { prisma } from '@/lib/db/prisma';

vi.mock('@/lib/auth/require-user', () => ({ requireUser: vi.fn() }));
vi.mock('@/lib/db/prisma', () => {
  const assetLedgerFields = { findMany: vi.fn() };
  return { prisma: { assetLedgerFields, $queryRaw: vi.fn() } };
});

describe('GET /api/v1/assets/ledger-fields/options', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns auth response when requireUser fails', async () => {
    (requireUser as any).mockResolvedValue({ ok: false, response: new Response('unauthorized', { status: 401 }) });

    const res = await GET(new Request('http://localhost/api/v1/assets/ledger-fields/options'));
    expect(res.status).toBe(401);
  });

  it('returns distinct, trimmed option lists and request id header', async () => {
    (requireUser as any).mockResolvedValue({
      ok: true,
      requestId: 'req_test',
      session: { user: { id: 'u1' } },
    } as any);

    (prisma.assetLedgerFields.findMany as any)
      .mockResolvedValueOnce([{ region: '  cn-shanghai ' }, { region: '' }, { region: 'cn-beijing' }])
      .mockResolvedValueOnce([{ company: '  ACME  ' }, { company: '' }, { company: 'Beta' }, { company: 'ACME' }])
      .mockResolvedValueOnce([{ department: ' Dev ' }, { department: null }, { department: 'Ops' }])
      .mockResolvedValueOnce([{ systemCategory: ' 业务系统 ' }, { systemCategory: '' }, { systemCategory: '业务系统' }])
      .mockResolvedValueOnce([{ systemLevel: 'L2' }, { systemLevel: 'L1' }, { systemLevel: '  ' }])
      .mockResolvedValueOnce([{ bizOwner: ' Alice ' }, { bizOwner: null }, { bizOwner: 'Bob' }]);

    (prisma.$queryRaw as any)
      .mockResolvedValueOnce([{ osName: '  Ubuntu  ' }, { osName: '' }, { osName: 'Windows' }])
      .mockResolvedValueOnce([{ brand: '  Dell  ' }, { brand: '' }, { brand: 'Dell' }, { brand: null }])
      .mockResolvedValueOnce([{ model: ' R740 ' }, { model: '' }, { model: 'R640' }, { model: 'R740' }]);

    const res = await GET(new Request('http://localhost/api/v1/assets/ledger-fields/options'));

    expect(res.status).toBe(200);
    expect(res.headers.get('X-Request-ID')).toBe('req_test');

    expect(prisma.assetLedgerFields.findMany).toHaveBeenCalledTimes(6);
    expect(prisma.assetLedgerFields.findMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        distinct: ['region'],
        where: expect.objectContaining({ region: { not: null }, asset: { status: { not: 'merged' } } }),
        select: { region: true },
      }),
    );
    expect(prisma.assetLedgerFields.findMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        distinct: ['company'],
        where: expect.objectContaining({ company: { not: null }, asset: { status: { not: 'merged' } } }),
        select: { company: true },
      }),
    );
    expect(prisma.assetLedgerFields.findMany).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        distinct: ['department'],
        where: expect.objectContaining({ department: { not: null }, asset: { status: { not: 'merged' } } }),
        select: { department: true },
      }),
    );
    expect(prisma.assetLedgerFields.findMany).toHaveBeenNthCalledWith(
      4,
      expect.objectContaining({
        distinct: ['systemCategory'],
        where: expect.objectContaining({ systemCategory: { not: null }, asset: { status: { not: 'merged' } } }),
        select: { systemCategory: true },
      }),
    );
    expect(prisma.assetLedgerFields.findMany).toHaveBeenNthCalledWith(
      5,
      expect.objectContaining({
        distinct: ['systemLevel'],
        where: expect.objectContaining({ systemLevel: { not: null }, asset: { status: { not: 'merged' } } }),
        select: { systemLevel: true },
      }),
    );
    expect(prisma.assetLedgerFields.findMany).toHaveBeenNthCalledWith(
      6,
      expect.objectContaining({
        distinct: ['bizOwner'],
        where: expect.objectContaining({ bizOwner: { not: null }, asset: { status: { not: 'merged' } } }),
        select: { bizOwner: true },
      }),
    );
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(3);

    const body = (await res.json()) as any;
    expect(body.data).toEqual({
      regions: ['cn-beijing', 'cn-shanghai'],
      companies: ['ACME', 'Beta'],
      departments: ['Dev', 'Ops'],
      systemCategories: ['业务系统'],
      systemLevels: ['L1', 'L2'],
      bizOwners: ['Alice', 'Bob'],
      osNames: ['Ubuntu', 'Windows'],
      brands: ['Dell'],
      models: ['R640', 'R740'],
    });
  });
});
