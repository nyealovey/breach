import { z } from 'zod/v4';

import { requireAdmin } from '@/lib/auth/require-admin';
import { prisma } from '@/lib/db/prisma';
import { ErrorCode } from '@/lib/errors/error-codes';
import { fail, ok } from '@/lib/http/response';
import {
  getLedgerFieldDbColumnV1,
  getLedgerFieldMetaV1,
  isLedgerFieldAllowedForAssetType,
  normalizeLedgerFieldValueV1,
  summarizeLedgerValue,
} from '@/lib/ledger/ledger-fields-v1';

import type { AppError } from '@/lib/errors/error';
import type { Prisma } from '@prisma/client';

const BodySchema = z.object({
  assetUuids: z.array(z.string().min(1)).min(1),
  key: z.string().min(1),
  value: z.union([z.string(), z.null()]),
});

function isAppError(err: unknown): err is AppError {
  return !!err && typeof err === 'object' && 'code' in err && 'category' in err && 'message' in err;
}

export async function POST(request: Request) {
  const auth = await requireAdmin(request);
  if (!auth.ok) return auth.response;
  const now = new Date();

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

  const assetUuids = Array.from(new Set(body.assetUuids.map((u) => u.trim()).filter((u) => u.length > 0)));
  if (assetUuids.length < 1) {
    return fail(
      { code: ErrorCode.CONFIG_INVALID_REQUEST, category: 'config', message: 'Invalid assetUuids', retryable: false },
      400,
      { requestId: auth.requestId },
    );
  }
  if (assetUuids.length > 100) {
    return fail(
      {
        code: ErrorCode.CONFIG_LEDGER_FIELD_LIMIT_EXCEEDED,
        category: 'config',
        message: 'Too many assets',
        retryable: false,
      },
      400,
      { requestId: auth.requestId },
    );
  }

  const key = body.key.trim();
  const meta = getLedgerFieldMetaV1(key);
  if (!meta) {
    return fail(
      {
        code: ErrorCode.CONFIG_LEDGER_FIELD_KEY_INVALID,
        category: 'config',
        message: 'Invalid ledger field key',
        retryable: false,
        redacted_context: { key },
      },
      400,
      { requestId: auth.requestId },
    );
  }

  try {
    const normalized = normalizeLedgerFieldValueV1(meta, body.value);
    const overrideColumn = getLedgerFieldDbColumnV1(meta.key, 'override');

    const assets = await prisma.asset.findMany({
      where: { uuid: { in: assetUuids } },
      select: { uuid: true, assetType: true },
    });

    const foundSet = new Set(assets.map((a) => a.uuid));
    const missing = assetUuids.filter((u) => !foundSet.has(u));
    if (missing.length > 0) {
      return fail(
        {
          code: ErrorCode.CONFIG_ASSET_NOT_FOUND,
          category: 'config',
          message: 'Asset not found',
          retryable: false,
          redacted_context: { missing: missing.slice(0, 20) },
        },
        404,
        { requestId: auth.requestId },
      );
    }

    for (const asset of assets) {
      if (!isLedgerFieldAllowedForAssetType(meta, asset.assetType)) {
        return fail(
          {
            code: ErrorCode.CONFIG_LEDGER_FIELD_ASSET_TYPE_MISMATCH,
            category: 'config',
            message: 'Ledger field not allowed for asset type',
            retryable: false,
            redacted_context: { key: meta.key, assetType: asset.assetType },
          },
          400,
          { requestId: auth.requestId },
        );
      }
    }

    await prisma.$transaction(async (tx) => {
      await Promise.all(
        assetUuids.map((assetUuid) =>
          tx.assetLedgerFields.upsert({
            where: { assetUuid },
            create: { assetUuid, [overrideColumn]: normalized.dbValue } as any,
            update: { [overrideColumn]: normalized.dbValue } as any,
            select: { assetUuid: true },
          }),
        ),
      );

      const audit = await tx.auditEvent.create({
        data: {
          eventType: 'asset.ledger_fields_bulk_set',
          actorUserId: auth.session.user.id,
          payload: {
            requestId: auth.requestId,
            assetUuids,
            key: meta.key,
            layer: 'override',
            valueSummary: summarizeLedgerValue(normalized.displayValue),
          },
        },
        select: { id: true },
      });

      await tx.assetHistoryEvent.createMany({
        data: assetUuids.map((assetUuid) => ({
          assetUuid,
          eventType: 'ledger_fields.changed',
          occurredAt: now,
          title: '台账字段变更',
          summary: {
            actor: { userId: auth.session.user.id, username: auth.session.user.username },
            requestId: auth.requestId,
            mode: 'manual_bulk',
            key: meta.key,
            layer: 'override',
            valueSummary: summarizeLedgerValue(normalized.displayValue),
          } as Prisma.InputJsonValue,
          refs: { auditEventId: audit.id } as Prisma.InputJsonValue,
        })),
      });
    });

    return ok({ updated: assetUuids.length }, { requestId: auth.requestId });
  } catch (err) {
    if (isAppError(err)) {
      const status =
        err.code === ErrorCode.CONFIG_LEDGER_FIELD_KEY_INVALID ||
        err.code === ErrorCode.CONFIG_LEDGER_FIELD_ASSET_TYPE_MISMATCH ||
        err.code === ErrorCode.CONFIG_LEDGER_FIELD_VALUE_INVALID ||
        err.code === ErrorCode.CONFIG_LEDGER_FIELD_LIMIT_EXCEEDED
          ? 400
          : 500;
      return fail(err, status, { requestId: auth.requestId });
    }

    return fail(
      {
        code: ErrorCode.DB_WRITE_FAILED,
        category: 'db',
        message: 'Failed to bulk set ledger fields',
        retryable: false,
      },
      500,
      { requestId: auth.requestId },
    );
  }
}
