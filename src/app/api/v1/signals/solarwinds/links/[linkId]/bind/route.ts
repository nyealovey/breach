import { z } from 'zod/v4';

import { requireAdmin } from '@/lib/auth/require-admin';
import { prisma } from '@/lib/db/prisma';
import { ErrorCode } from '@/lib/errors/error-codes';
import { fail, ok } from '@/lib/http/response';
import { Prisma } from '@prisma/client';

function cleanString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function extractMonitor(normalized: unknown): { state: string; status: string | null } {
  if (!normalized || typeof normalized !== 'object' || Array.isArray(normalized))
    return { state: 'unknown', status: null };
  const attributes = (normalized as Record<string, unknown>).attributes;
  if (!attributes || typeof attributes !== 'object' || Array.isArray(attributes))
    return { state: 'unknown', status: null };
  const state = cleanString((attributes as Record<string, unknown>).monitor_status) ?? 'unknown';
  const status = cleanString((attributes as Record<string, unknown>).monitor_status_raw);
  return { state, status };
}

const BodySchema = z.object({ assetUuid: z.string().min(1) }).strict();

export async function POST(request: Request, context: { params: Promise<{ linkId: string }> }) {
  const auth = await requireAdmin(request);
  if (!auth.ok) return auth.response;

  const { linkId } = await context.params;

  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await request.json());
  } catch {
    return fail(
      { code: ErrorCode.CONFIG_INVALID_REQUEST, category: 'config', message: 'Validation failed', retryable: false },
      400,
      { requestId: auth.requestId },
    );
  }

  const link = await prisma.assetSignalLink.findUnique({
    where: { id: linkId },
    include: { source: { select: { sourceType: true } } },
  });
  if (!link || link.source.sourceType !== 'solarwinds') {
    return fail(
      {
        code: ErrorCode.CONFIG_SIGNAL_LINK_NOT_FOUND,
        category: 'config',
        message: 'Signal link not found',
        retryable: false,
      },
      404,
      { requestId: auth.requestId },
    );
  }

  const asset = await prisma.asset.findUnique({
    where: { uuid: body.assetUuid },
    select: { uuid: true, status: true },
  });
  if (!asset) {
    return fail(
      { code: ErrorCode.CONFIG_ASSET_NOT_FOUND, category: 'config', message: 'Asset not found', retryable: false },
      404,
      { requestId: auth.requestId },
    );
  }
  if (asset.status === 'merged') {
    return fail(
      {
        code: ErrorCode.CONFIG_INVALID_REQUEST,
        category: 'config',
        message: 'Cannot bind signals to merged assets',
        retryable: false,
      },
      400,
      { requestId: auth.requestId },
    );
  }

  const updated = await prisma.assetSignalLink.update({
    where: { id: linkId },
    data: {
      assetUuid: asset.uuid,
      matchType: 'manual',
      matchConfidence: 100,
      matchReason: 'manual',
      ambiguous: false,
      ambiguousCandidates: Prisma.DbNull,
    },
    select: {
      id: true,
      assetUuid: true,
      sourceId: true,
      externalKind: true,
      externalId: true,
      lastSeenAt: true,
    },
  });

  const record = await prisma.signalRecord.findFirst({
    where: { linkId: updated.id },
    orderBy: { collectedAt: 'desc' },
    select: { normalized: true, collectedAt: true },
  });

  const monitor = extractMonitor(record?.normalized);
  const monitorUpdatedAt = record?.collectedAt ?? updated.lastSeenAt;

  await prisma.assetOperationalState.upsert({
    where: { assetUuid: asset.uuid },
    update: {
      monitorCovered: true,
      monitorState: monitor.state,
      monitorStatus: monitor.status,
      monitorUpdatedAt,
    },
    create: {
      asset: { connect: { uuid: asset.uuid } },
      monitorCovered: true,
      monitorState: monitor.state,
      monitorStatus: monitor.status,
      monitorUpdatedAt,
    },
  });

  return ok(
    {
      linkId: updated.id,
      assetUuid: updated.assetUuid,
    },
    { requestId: auth.requestId },
  );
}
