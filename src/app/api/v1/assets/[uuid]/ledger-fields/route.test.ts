import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PUT } from '@/app/api/v1/assets/[uuid]/ledger-fields/route';
import { requireAdmin } from '@/lib/auth/require-admin';
import { prisma } from '@/lib/db/prisma';
import { ErrorCode } from '@/lib/errors/error-codes';

vi.mock('@/lib/auth/require-admin', () => ({ requireAdmin: vi.fn() }));
vi.mock('@/lib/db/prisma', () => {
  const asset = { findUnique: vi.fn() };
  const assetLedgerFields = { findUnique: vi.fn(), upsert: vi.fn() };
  const auditEvent = { create: vi.fn() };
  const assetHistoryEvent = { create: vi.fn() };

  const prismaMock = { asset, assetLedgerFields, auditEvent, assetHistoryEvent };
  return { prisma: { ...prismaMock, $transaction: vi.fn(async (cb: any) => cb(prismaMock)) } };
});

describe('PUT /api/v1/assets/:uuid/ledger-fields', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 404 when asset missing', async () => {
    (requireAdmin as any).mockResolvedValue({
      ok: true,
      requestId: 'req_test',
      session: { user: { id: 'u1', username: 'admin' } },
    });
    (prisma.asset.findUnique as any).mockResolvedValue(null);

    const req = new Request('http://localhost/api/v1/assets/a1/ledger-fields', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ledgerFieldOverrides: { company: 'ACME' } }),
    });

    const res = await PUT(req, { params: Promise.resolve({ uuid: 'a1' }) });
    expect(res.status).toBe(404);
    const body = (await res.json()) as any;
    expect(body.error.code).toBe(ErrorCode.CONFIG_ASSET_NOT_FOUND);
  });

  it('returns 400 when key is invalid', async () => {
    (requireAdmin as any).mockResolvedValue({
      ok: true,
      requestId: 'req_test',
      session: { user: { id: 'u1', username: 'admin' } },
    });
    (prisma.asset.findUnique as any).mockResolvedValue({ uuid: 'a1', assetType: 'host' });
    (prisma.assetLedgerFields.findUnique as any).mockResolvedValue(null);

    const req = new Request('http://localhost/api/v1/assets/a1/ledger-fields', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ledgerFieldOverrides: { nope: 'x' } }),
    });

    const res = await PUT(req, { params: Promise.resolve({ uuid: 'a1' }) });
    expect(res.status).toBe(400);
    const body = (await res.json()) as any;
    expect(body.error.code).toBe(ErrorCode.CONFIG_LEDGER_FIELD_KEY_INVALID);
  });

  it('returns 400 when writing host-only key to VM', async () => {
    (requireAdmin as any).mockResolvedValue({
      ok: true,
      requestId: 'req_test',
      session: { user: { id: 'u1', username: 'admin' } },
    });
    (prisma.asset.findUnique as any).mockResolvedValue({ uuid: 'a1', assetType: 'vm' });
    (prisma.assetLedgerFields.findUnique as any).mockResolvedValue(null);

    const req = new Request('http://localhost/api/v1/assets/a1/ledger-fields', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ledgerFieldOverrides: { bmcIp: '10.0.0.1' } }),
    });

    const res = await PUT(req, { params: Promise.resolve({ uuid: 'a1' }) });
    expect(res.status).toBe(400);
    const body = (await res.json()) as any;
    expect(body.error.code).toBe(ErrorCode.CONFIG_LEDGER_FIELD_ASSET_TYPE_MISMATCH);
  });

  it('upserts ledger fields and writes audit event', async () => {
    (requireAdmin as any).mockResolvedValue({
      ok: true,
      requestId: 'req_test',
      session: { user: { id: 'u1', username: 'admin' } },
    });
    (prisma.asset.findUnique as any).mockResolvedValue({ uuid: 'a1', assetType: 'host' });
    (prisma.assetLedgerFields.findUnique as any).mockResolvedValue({ companyOverride: 'OldCo', companySource: null });
    (prisma.assetLedgerFields.upsert as any).mockResolvedValue({
      companySource: null,
      companyOverride: 'ACME',
      departmentSource: null,
      departmentOverride: null,
      systemCategorySource: null,
      systemCategoryOverride: null,
      systemLevelSource: null,
      systemLevelOverride: null,
      regionSource: null,
      regionOverride: null,
      bizOwnerSource: null,
      bizOwnerOverride: null,
      maintenanceDueDateSource: null,
      maintenanceDueDateOverride: null,
      purchaseDateSource: null,
      purchaseDateOverride: new Date('2026-01-31T00:00:00.000Z'),
      bmcIpSource: null,
      bmcIpOverride: '10.0.0.1',
      cabinetNoSource: null,
      cabinetNoOverride: null,
      rackPositionSource: null,
      rackPositionOverride: null,
      managementCodeSource: null,
      managementCodeOverride: null,
      fixedAssetNoSource: null,
      fixedAssetNoOverride: null,
    });
    (prisma.auditEvent.create as any).mockResolvedValue({ id: 'ae_1' });
    (prisma.assetHistoryEvent.create as any).mockResolvedValue({ id: 'he_1' });

    const req = new Request('http://localhost/api/v1/assets/a1/ledger-fields', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ledgerFieldOverrides: { company: '  ACME  ', purchaseDate: '2026-01-31', bmcIp: '10.0.0.1' },
      }),
    });

    const res = await PUT(req, { params: Promise.resolve({ uuid: 'a1' }) });
    expect(res.status).toBe(200);

    expect(prisma.assetLedgerFields.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { assetUuid: 'a1' },
        update: expect.objectContaining({ companyOverride: 'ACME', bmcIpOverride: '10.0.0.1' }),
      }),
    );

    expect(prisma.auditEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          eventType: 'asset.ledger_fields_saved',
          actorUserId: 'u1',
          payload: expect.objectContaining({
            requestId: 'req_test',
            assetUuid: 'a1',
            updatedKeys: expect.arrayContaining(['company', 'purchaseDate', 'bmcIp']),
          }),
        }),
      }),
    );

    const body = (await res.json()) as any;
    expect(body.data.assetUuid).toBe('a1');
    expect(body.data.ledgerFields.company).toEqual({ source: null, override: 'ACME', effective: 'ACME' });
    expect(body.data.ledgerFields.purchaseDate).toEqual({
      source: null,
      override: '2026-01-31',
      effective: '2026-01-31',
    });
    expect(body.data.ledgerFields.bmcIp).toEqual({ source: null, override: '10.0.0.1', effective: '10.0.0.1' });
  });
});
