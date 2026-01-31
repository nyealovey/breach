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

  const prismaMock = { asset, assetLedgerFields, auditEvent };
  return { prisma: { ...prismaMock, $transaction: vi.fn(async (cb: any) => cb(prismaMock)) } };
});

describe('PUT /api/v1/assets/:uuid/ledger-fields', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 404 when asset missing', async () => {
    (requireAdmin as any).mockResolvedValue({ ok: true, requestId: 'req_test', session: { user: { id: 'u1' } } });
    (prisma.asset.findUnique as any).mockResolvedValue(null);

    const req = new Request('http://localhost/api/v1/assets/a1/ledger-fields', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ledgerFields: { company: 'ACME' } }),
    });

    const res = await PUT(req, { params: Promise.resolve({ uuid: 'a1' }) });
    expect(res.status).toBe(404);
    const body = (await res.json()) as any;
    expect(body.error.code).toBe(ErrorCode.CONFIG_ASSET_NOT_FOUND);
  });

  it('returns 400 when key is invalid', async () => {
    (requireAdmin as any).mockResolvedValue({ ok: true, requestId: 'req_test', session: { user: { id: 'u1' } } });
    (prisma.asset.findUnique as any).mockResolvedValue({ uuid: 'a1', assetType: 'host' });
    (prisma.assetLedgerFields.findUnique as any).mockResolvedValue(null);

    const req = new Request('http://localhost/api/v1/assets/a1/ledger-fields', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ledgerFields: { nope: 'x' } }),
    });

    const res = await PUT(req, { params: Promise.resolve({ uuid: 'a1' }) });
    expect(res.status).toBe(400);
    const body = (await res.json()) as any;
    expect(body.error.code).toBe(ErrorCode.CONFIG_LEDGER_FIELD_KEY_INVALID);
  });

  it('returns 400 when writing host-only key to VM', async () => {
    (requireAdmin as any).mockResolvedValue({ ok: true, requestId: 'req_test', session: { user: { id: 'u1' } } });
    (prisma.asset.findUnique as any).mockResolvedValue({ uuid: 'a1', assetType: 'vm' });
    (prisma.assetLedgerFields.findUnique as any).mockResolvedValue(null);

    const req = new Request('http://localhost/api/v1/assets/a1/ledger-fields', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ledgerFields: { bmcIp: '10.0.0.1' } }),
    });

    const res = await PUT(req, { params: Promise.resolve({ uuid: 'a1' }) });
    expect(res.status).toBe(400);
    const body = (await res.json()) as any;
    expect(body.error.code).toBe(ErrorCode.CONFIG_LEDGER_FIELD_ASSET_TYPE_MISMATCH);
  });

  it('upserts ledger fields and writes audit event', async () => {
    (requireAdmin as any).mockResolvedValue({ ok: true, requestId: 'req_test', session: { user: { id: 'u1' } } });
    (prisma.asset.findUnique as any).mockResolvedValue({ uuid: 'a1', assetType: 'host' });
    (prisma.assetLedgerFields.findUnique as any).mockResolvedValue({ company: 'OldCo' });
    (prisma.assetLedgerFields.upsert as any).mockResolvedValue({
      company: 'ACME',
      department: null,
      systemCategory: null,
      systemLevel: null,
      region: null,
      bizOwner: null,
      maintenanceDueDate: null,
      purchaseDate: new Date('2026-01-31T00:00:00.000Z'),
      bmcIp: '10.0.0.1',
      cabinetNo: null,
      rackPosition: null,
      managementCode: null,
      fixedAssetNo: null,
    });

    const req = new Request('http://localhost/api/v1/assets/a1/ledger-fields', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ledgerFields: { company: '  ACME  ', purchaseDate: '2026-01-31', bmcIp: '10.0.0.1' } }),
    });

    const res = await PUT(req, { params: Promise.resolve({ uuid: 'a1' }) });
    expect(res.status).toBe(200);

    expect(prisma.assetLedgerFields.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { assetUuid: 'a1' },
        update: expect.objectContaining({ company: 'ACME', bmcIp: '10.0.0.1' }),
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
    expect(body.data.ledgerFields.company).toBe('ACME');
    expect(body.data.ledgerFields.purchaseDate).toBe('2026-01-31');
    expect(body.data.ledgerFields.bmcIp).toBe('10.0.0.1');
  });
});
