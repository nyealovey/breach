import { beforeEach, describe, expect, it, vi } from 'vitest';

import { POST } from '@/app/api/v1/assets/[uuid]/merge/route';
import { requireAdmin } from '@/lib/auth/require-admin';
import { prisma } from '@/lib/db/prisma';
import { ErrorCode } from '@/lib/errors/error-codes';

vi.mock('@/lib/auth/require-admin', () => ({ requireAdmin: vi.fn() }));
vi.mock('@/lib/db/prisma', () => {
  const asset = {
    findUnique: vi.fn(),
    findMany: vi.fn(),
    updateMany: vi.fn(),
  };

  const assetSourceLink = { updateMany: vi.fn() };
  const sourceRecord = { updateMany: vi.fn() };
  const relation = { findMany: vi.fn(), update: vi.fn(), delete: vi.fn() };
  const duplicateCandidate = { updateMany: vi.fn() };
  const mergeAudit = { create: vi.fn() };
  const auditEvent = { create: vi.fn() };

  const prismaMock = {
    asset,
    assetSourceLink,
    sourceRecord,
    relation,
    duplicateCandidate,
    mergeAudit,
    auditEvent,
  };

  return {
    prisma: {
      ...prismaMock,
      $transaction: vi.fn(async (cb: any) => cb(prismaMock)),
    },
  };
});

describe('POST /api/v1/assets/:uuid/merge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 404 when primary asset is not found', async () => {
    (requireAdmin as any).mockResolvedValue({ ok: true, requestId: 'req_test', session: { user: { id: 'u1' } } });
    (prisma.asset.findUnique as any).mockResolvedValue(null);

    const req = new Request('http://localhost/api/v1/assets/a1/merge', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mergedAssetUuids: ['b1'] }),
    });

    const res = await POST(req, { params: Promise.resolve({ uuid: 'a1' }) });
    expect(res.status).toBe(404);

    const body = (await res.json()) as any;
    expect(body.error.code).toBe(ErrorCode.CONFIG_ASSET_NOT_FOUND);
  });

  it('returns 400 when asset types mismatch', async () => {
    (requireAdmin as any).mockResolvedValue({ ok: true, requestId: 'req_test', session: { user: { id: 'u1' } } });
    (prisma.asset.findUnique as any).mockResolvedValue({
      uuid: 'a1',
      assetType: 'vm',
      status: 'in_service',
      mergedIntoAssetUuid: null,
    });
    (prisma.asset.findMany as any).mockResolvedValue([
      { uuid: 'b1', assetType: 'host', status: 'offline', mergedIntoAssetUuid: null },
    ]);

    const req = new Request('http://localhost/api/v1/assets/a1/merge', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mergedAssetUuids: ['b1'] }),
    });

    const res = await POST(req, { params: Promise.resolve({ uuid: 'a1' }) });
    expect(res.status).toBe(400);

    const body = (await res.json()) as any;
    expect(body.error.code).toBe(ErrorCode.CONFIG_ASSET_MERGE_ASSET_TYPE_MISMATCH);
  });

  it('returns 400 when VM merge requires primary in_service and secondary offline', async () => {
    (requireAdmin as any).mockResolvedValue({ ok: true, requestId: 'req_test', session: { user: { id: 'u1' } } });
    (prisma.asset.findUnique as any).mockResolvedValue({
      uuid: 'a1',
      assetType: 'vm',
      status: 'offline',
      mergedIntoAssetUuid: null,
    });
    (prisma.asset.findMany as any).mockResolvedValue([
      { uuid: 'b1', assetType: 'vm', status: 'in_service', mergedIntoAssetUuid: null },
    ]);

    const req = new Request('http://localhost/api/v1/assets/a1/merge', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mergedAssetUuids: ['b1'] }),
    });

    const res = await POST(req, { params: Promise.resolve({ uuid: 'a1' }) });
    expect(res.status).toBe(400);

    const body = (await res.json()) as any;
    expect(body.error.code).toBe(ErrorCode.CONFIG_ASSET_MERGE_VM_REQUIRES_OFFLINE);
  });

  it('returns 400 when cycle is detected via mergedIntoAssetUuid', async () => {
    (requireAdmin as any).mockResolvedValue({ ok: true, requestId: 'req_test', session: { user: { id: 'u1' } } });
    (prisma.asset.findUnique as any).mockResolvedValue({
      uuid: 'a1',
      assetType: 'host',
      status: 'in_service',
      mergedIntoAssetUuid: 'x',
    });

    const req = new Request('http://localhost/api/v1/assets/a1/merge', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mergedAssetUuids: ['b1'] }),
    });

    const res = await POST(req, { params: Promise.resolve({ uuid: 'a1' }) });
    expect(res.status).toBe(400);

    const body = (await res.json()) as any;
    expect(body.error.code).toBe(ErrorCode.CONFIG_ASSET_MERGE_CYCLE_DETECTED);
  });

  it('merges assets and writes audits (host happy path)', async () => {
    (requireAdmin as any).mockResolvedValue({ ok: true, requestId: 'req_test', session: { user: { id: 'u1' } } });
    (prisma.asset.findUnique as any).mockResolvedValue({
      uuid: 'a1',
      assetType: 'host',
      status: 'in_service',
      mergedIntoAssetUuid: null,
    });
    (prisma.asset.findMany as any).mockResolvedValue([
      { uuid: 'b1', assetType: 'host', status: 'offline', mergedIntoAssetUuid: null },
    ]);

    (prisma.asset.updateMany as any).mockResolvedValue({ count: 1 });
    (prisma.assetSourceLink.updateMany as any).mockResolvedValue({ count: 2 });
    (prisma.sourceRecord.updateMany as any).mockResolvedValue({ count: 3 });
    (prisma.relation.findMany as any).mockResolvedValue([]);
    (prisma.duplicateCandidate.updateMany as any).mockResolvedValue({ count: 4 });
    (prisma.mergeAudit.create as any).mockResolvedValue({ id: 'ma_1' });
    (prisma.auditEvent.create as any).mockResolvedValue({ id: 'ae_1' });

    const req = new Request('http://localhost/api/v1/assets/a1/merge', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mergedAssetUuids: ['b1'], conflictStrategy: 'primary_wins' }),
    });

    const res = await POST(req, { params: Promise.resolve({ uuid: 'a1' }) });
    expect(res.status).toBe(200);

    expect(prisma.asset.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ uuid: { in: ['b1'] } }),
        data: expect.objectContaining({ status: 'merged', mergedIntoAssetUuid: 'a1' }),
      }),
    );

    expect(prisma.assetSourceLink.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { assetUuid: { in: ['b1'] } }, data: { assetUuid: 'a1' } }),
    );

    expect(prisma.sourceRecord.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { assetUuid: { in: ['b1'] } }, data: { assetUuid: 'a1' } }),
    );

    expect(prisma.duplicateCandidate.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [{ assetUuidA: { in: ['a1', 'b1'] } }, { assetUuidB: { in: ['a1', 'b1'] } }],
        }),
        data: { status: 'merged' },
      }),
    );

    expect(prisma.mergeAudit.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          primaryAssetUuid: 'a1',
          mergedAssetUuid: 'b1',
          performedByUserId: 'u1',
          conflictStrategy: 'primary_wins',
        }),
      }),
    );

    expect(prisma.auditEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          eventType: 'asset.merged',
          actorUserId: 'u1',
          payload: expect.objectContaining({
            primaryAssetUuid: 'a1',
            mergedAssetUuids: ['b1'],
            requestId: 'req_test',
          }),
        }),
      }),
    );

    const body = (await res.json()) as any;
    expect(body.data).toMatchObject({
      primaryAssetUuid: 'a1',
      mergedAssetUuids: ['b1'],
      conflictStrategy: 'primary_wins',
    });
  });
});
