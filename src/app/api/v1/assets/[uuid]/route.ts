import { z } from 'zod/v4';

import { requireAdmin } from '@/lib/auth/require-admin';
import { requireUser } from '@/lib/auth/require-user';
import { prisma } from '@/lib/db/prisma';
import { ErrorCode } from '@/lib/errors/error-codes';
import { fail, ok } from '@/lib/http/response';
import { buildLedgerFieldsV1FromRow, LEDGER_FIELDS_V1_DB_SELECT } from '@/lib/ledger/ledger-fields-v1';

const AssetUpdateBodySchema = z.object({
  machineNameOverride: z.string().nullable().optional(),
  ipOverrideText: z.string().nullable().optional(),
  osOverrideText: z.string().nullable().optional(),
});

export async function GET(request: Request, context: { params: Promise<{ uuid: string }> }) {
  const auth = await requireUser(request);
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
      ipOverrideText: true,
      osOverrideText: true,
      lastSeenAt: true,
      operationalState: {
        select: {
          monitorCovered: true,
          monitorState: true,
          monitorStatus: true,
          monitorUpdatedAt: true,
        },
      },
      ledgerFields: {
        select: LEDGER_FIELDS_V1_DB_SELECT,
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
      ipOverrideText: asset.ipOverrideText ?? null,
      osOverrideText: asset.osOverrideText ?? null,
      lastSeenAt: asset.lastSeenAt?.toISOString() ?? null,
      ledgerFields: buildLedgerFieldsV1FromRow(asset.ledgerFields),
      operationalState: {
        monitorCovered: asset.operationalState?.monitorCovered ?? null,
        monitorState: asset.operationalState?.monitorState ?? null,
        monitorStatus: asset.operationalState?.monitorStatus ?? null,
        monitorUpdatedAt: asset.operationalState?.monitorUpdatedAt?.toISOString() ?? null,
      },
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

  if (
    body.machineNameOverride === undefined &&
    body.ipOverrideText === undefined &&
    body.osOverrideText === undefined
  ) {
    return fail(
      { code: ErrorCode.CONFIG_INVALID_REQUEST, category: 'config', message: 'No fields to update', retryable: false },
      400,
      { requestId: auth.requestId },
    );
  }

  const nextMachineNameOverride =
    body.machineNameOverride === null
      ? null
      : body.machineNameOverride?.trim()
        ? body.machineNameOverride.trim()
        : null;
  const nextIpOverrideText =
    body.ipOverrideText === null ? null : body.ipOverrideText?.trim() ? body.ipOverrideText.trim() : null;
  const nextOsOverrideText =
    body.osOverrideText === null ? null : body.osOverrideText?.trim() ? body.osOverrideText.trim() : null;

  const existing = await prisma.asset.findUnique({ where: { uuid }, select: { uuid: true } });
  if (!existing) {
    return fail(
      { code: ErrorCode.CONFIG_ASSET_NOT_FOUND, category: 'config', message: 'Asset not found', retryable: false },
      404,
      { requestId: auth.requestId },
    );
  }

  try {
    const data: Record<string, unknown> = {};
    if (body.machineNameOverride !== undefined) data.machineNameOverride = nextMachineNameOverride;
    if (body.ipOverrideText !== undefined) data.ipOverrideText = nextIpOverrideText;
    if (body.osOverrideText !== undefined) data.osOverrideText = nextOsOverrideText;

    const updated = await prisma.asset.update({
      where: { uuid },
      data,
      select: { uuid: true, machineNameOverride: true, ipOverrideText: true, osOverrideText: true, updatedAt: true },
    });

    return ok(
      {
        assetUuid: updated.uuid,
        machineNameOverride: updated.machineNameOverride,
        ipOverrideText: updated.ipOverrideText ?? null,
        osOverrideText: updated.osOverrideText ?? null,
      },
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
