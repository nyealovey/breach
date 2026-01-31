import { z } from 'zod/v4';

import { requireAdmin } from '@/lib/auth/require-admin';
import { prisma } from '@/lib/db/prisma';
import { ErrorCode } from '@/lib/errors/error-codes';
import { fail, ok } from '@/lib/http/response';
import { buildLedgerFieldsV1FromRow } from '@/lib/ledger/ledger-fields-v1';

const AssetUpdateBodySchema = z.object({
  machineNameOverride: z.string().nullable().optional(),
});

export async function GET(request: Request, context: { params: Promise<{ uuid: string }> }) {
  const auth = await requireAdmin(request);
  if (!auth.ok) return auth.response;

  const { uuid } = await context.params;

  const asset = await prisma.asset.findUnique({
    where: { uuid },
    select: {
      uuid: true,
      assetType: true,
      status: true,
      mergedIntoAssetUuid: true,
      displayName: true,
      machineNameOverride: true,
      lastSeenAt: true,
      ledgerFields: {
        select: {
          region: true,
          company: true,
          department: true,
          systemCategory: true,
          systemLevel: true,
          bizOwner: true,
          maintenanceDueDate: true,
          purchaseDate: true,
          bmcIp: true,
          cabinetNo: true,
          rackPosition: true,
          managementCode: true,
          fixedAssetNo: true,
        },
      },
    },
  });
  if (!asset) {
    return fail(
      { code: ErrorCode.CONFIG_ASSET_NOT_FOUND, category: 'config', message: 'Asset not found', retryable: false },
      404,
      { requestId: auth.requestId },
    );
  }

  const snapshot = await prisma.assetRunSnapshot.findFirst({
    where: { assetUuid: uuid },
    orderBy: { createdAt: 'desc' },
    select: { runId: true, canonical: true, createdAt: true },
  });

  return ok(
    {
      assetUuid: asset.uuid,
      assetType: asset.assetType,
      status: asset.status,
      mergedIntoAssetUuid: asset.mergedIntoAssetUuid ?? null,
      displayName: asset.displayName,
      machineNameOverride: asset.machineNameOverride,
      lastSeenAt: asset.lastSeenAt?.toISOString() ?? null,
      ledgerFields: buildLedgerFieldsV1FromRow(asset.ledgerFields),
      latestSnapshot: snapshot
        ? { runId: snapshot.runId, createdAt: snapshot.createdAt.toISOString(), canonical: snapshot.canonical }
        : null,
    },
    { requestId: auth.requestId },
  );
}

export async function PUT(request: Request, context: { params: Promise<{ uuid: string }> }) {
  const auth = await requireAdmin(request);
  if (!auth.ok) return auth.response;

  const { uuid } = await context.params;

  let body: z.infer<typeof AssetUpdateBodySchema>;
  try {
    body = AssetUpdateBodySchema.parse(await request.json());
  } catch {
    return fail(
      { code: ErrorCode.CONFIG_INVALID_REQUEST, category: 'config', message: 'Validation failed', retryable: false },
      400,
      { requestId: auth.requestId },
    );
  }

  if (body.machineNameOverride === undefined) {
    return fail(
      { code: ErrorCode.CONFIG_INVALID_REQUEST, category: 'config', message: 'No fields to update', retryable: false },
      400,
      { requestId: auth.requestId },
    );
  }

  const nextOverride =
    body.machineNameOverride === null ? null : body.machineNameOverride.trim() ? body.machineNameOverride.trim() : null;

  const existing = await prisma.asset.findUnique({ where: { uuid }, select: { uuid: true } });
  if (!existing) {
    return fail(
      { code: ErrorCode.CONFIG_ASSET_NOT_FOUND, category: 'config', message: 'Asset not found', retryable: false },
      404,
      { requestId: auth.requestId },
    );
  }

  try {
    const updated = await prisma.asset.update({
      where: { uuid },
      data: { machineNameOverride: nextOverride },
      select: { uuid: true, machineNameOverride: true, updatedAt: true },
    });

    return ok(
      { assetUuid: updated.uuid, machineNameOverride: updated.machineNameOverride },
      { requestId: auth.requestId },
    );
  } catch {
    return fail(
      { code: ErrorCode.DB_WRITE_FAILED, category: 'db', message: 'Failed to update asset', retryable: false },
      500,
      { requestId: auth.requestId },
    );
  }
}
