import { beforeEach, describe, expect, it, vi } from 'vitest';

import { POST } from '@/app/api/v1/assets/ledger-fields/bulk-set/route';
import { requireAdmin } from '@/lib/auth/require-admin';
import { prisma } from '@/lib/db/prisma';
import { ErrorCode } from '@/lib/errors/error-codes';

vi.mock('@/lib/auth/require-admin', () => ({ requireAdmin: vi.fn() }));
vi.mock('@/lib/db/prisma', () => {
  const asset = { findMany: vi.fn() };
  const assetLedgerFields = { upsert: vi.fn() };
  const auditEvent = { create: vi.fn() };
  const assetHistoryEvent = { createMany: vi.fn() };

  const prismaMock = { asset, assetLedgerFields, auditEvent, assetHistoryEvent };
  return {
    prisma: {
      ...prismaMock,
      $transaction: vi.fn(async (cb: any) => cb(prismaMock)),
    },
  };
});

describe('POST /api/v1/assets/ledger-fields/bulk-set', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 400 when assetUuids exceed limit', async () => {
    (requireAdmin as any).mockResolvedValue({
      ok: true,
      requestId: 'req_test',
      session: { user: { id: 'u1', username: 'admin' } },
    });

    const assetUuids = Array.from({ length: 101 }).map(
      (_, i) => `550e8400-e29b-41d4-a716-44665544${String(i).padStart(4, '0')}`,
    );
    const req = new Request('http://localhost/api/v1/assets/ledger-fields/bulk-set', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ assetUuids, key: 'company', value: 'ACME' }),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = (await res.json()) as any;
    expect(body.error.code).toBe(ErrorCode.CONFIG_LEDGER_FIELD_LIMIT_EXCEEDED);
  });

  it('returns 400 when key not allowed for asset type', async () => {
    (requireAdmin as any).mockResolvedValue({
      ok: true,
      requestId: 'req_test',
      session: { user: { id: 'u1', username: 'admin' } },
    });
    (prisma.asset.findMany as any).mockResolvedValue([{ uuid: 'a1', assetType: 'vm' }]);

    const req = new Request('http://localhost/api/v1/assets/ledger-fields/bulk-set', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ assetUuids: ['a1'], key: 'bmcIp', value: '10.0.0.1' }),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = (await res.json()) as any;
    expect(body.error.code).toBe(ErrorCode.CONFIG_LEDGER_FIELD_ASSET_TYPE_MISMATCH);
  });

  it('upserts all assets and writes audit event', async () => {
    (requireAdmin as any).mockResolvedValue({
      ok: true,
      requestId: 'req_test',
      session: { user: { id: 'u1', username: 'admin' } },
    });
    (prisma.asset.findMany as any).mockResolvedValue([
      { uuid: 'a1', assetType: 'host' },
      { uuid: 'a2', assetType: 'host' },
    ]);
    (prisma.assetLedgerFields.upsert as any).mockResolvedValue({ assetUuid: 'a1' });
    (prisma.auditEvent.create as any).mockResolvedValue({ id: 'ae_1' });

    const req = new Request('http://localhost/api/v1/assets/ledger-fields/bulk-set', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ assetUuids: ['a1', 'a2'], key: 'company', value: 'ACME' }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    expect(prisma.assetLedgerFields.upsert).toHaveBeenCalledTimes(2);
    expect(prisma.auditEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          eventType: 'asset.ledger_fields_bulk_set',
          actorUserId: 'u1',
          payload: expect.objectContaining({
            requestId: 'req_test',
            assetUuids: ['a1', 'a2'],
            key: 'company',
            valueSummary: 'ACME',
          }),
        }),
      }),
    );

    const body = (await res.json()) as any;
    expect(body.data).toEqual({ updated: 2 });
  });
});
