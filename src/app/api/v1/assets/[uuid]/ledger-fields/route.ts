import { z } from 'zod/v4';

import { requireAdmin } from '@/lib/auth/require-admin';
import { prisma } from '@/lib/db/prisma';
import { ErrorCode } from '@/lib/errors/error-codes';
import { fail, ok } from '@/lib/http/response';
import {
  buildLedgerFieldsV1FromRow,
  computeLedgerFieldEffectiveValueV1,
  getLedgerFieldDbColumnV1,
  getLedgerFieldMetaV1,
  isLedgerFieldAllowedForAssetType,
  LEDGER_FIELDS_V1_DB_SELECT,
  normalizeLedgerFieldValueV1,
  summarizeLedgerValue,
} from '@/lib/ledger/ledger-fields-v1';

import type { AppError } from '@/lib/errors/error';
import type { Prisma } from '@prisma/client';

const BodySchema = z.object({
  ledgerFieldOverrides: z.record(z.string(), z.union([z.string(), z.null()])),
});

function isAppError(err: unknown): err is AppError {
  return !!err && typeof err === 'object' && 'code' in err && 'category' in err && 'message' in err;
}

export async function PUT(request: Request, context: { params: Promise<{ uuid: string }> }) {
  const auth = await requireAdmin(request);
  if (!auth.ok) return auth.response;

  const { uuid } = await context.params;
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

  const updates = Object.entries(body.ledgerFieldOverrides)
    .map(([k, v]) => ({ key: k.trim(), value: v }))
    .filter((p) => p.key.length > 0);

  if (updates.length < 1) {
    return fail(
      { code: ErrorCode.CONFIG_INVALID_REQUEST, category: 'config', message: 'No fields to update', retryable: false },
      400,
      { requestId: auth.requestId },
    );
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const asset = await tx.asset.findUnique({
        where: { uuid },
        select: { uuid: true, assetType: true },
      });

      if (!asset) {
        return { ok: false as const, error: { type: 'not_found' as const } };
      }

      const existing = await tx.assetLedgerFields.findUnique({
        where: { assetUuid: uuid },
        select: LEDGER_FIELDS_V1_DB_SELECT,
      });

      const updateData: Prisma.AssetLedgerFieldsUncheckedUpdateInput = {};
      const createData: Prisma.AssetLedgerFieldsUncheckedCreateInput = { assetUuid: uuid };
      const updatedKeys: string[] = [];
      const changes: Array<{
        key: string;
        layer: 'override';
        beforeOverride: string | null;
        afterOverride: string | null;
        beforeEffective: string | null;
        afterEffective: string | null;
      }> = [];
      const beforeFields = buildLedgerFieldsV1FromRow(existing);

      for (const { key, value } of updates) {
        const meta = getLedgerFieldMetaV1(key);
        if (!meta) {
          throw {
            code: ErrorCode.CONFIG_LEDGER_FIELD_KEY_INVALID,
            category: 'config',
            message: 'Invalid ledger field key',
            retryable: false,
            redacted_context: { key },
          } satisfies AppError;
        }

        if (!isLedgerFieldAllowedForAssetType(meta, asset.assetType)) {
          throw {
            code: ErrorCode.CONFIG_LEDGER_FIELD_ASSET_TYPE_MISMATCH,
            category: 'config',
            message: 'Ledger field not allowed for asset type',
            retryable: false,
            redacted_context: { key: meta.key, assetType: asset.assetType },
          } satisfies AppError;
        }

        const normalized = normalizeLedgerFieldValueV1(meta, value);
        const overrideColumn = getLedgerFieldDbColumnV1(meta.key, 'override');
        updateData[overrideColumn] = normalized.dbValue as any;
        createData[overrideColumn] = normalized.dbValue as any;
        updatedKeys.push(meta.key);

        const before = beforeFields[meta.key];
        const nextOverride = normalized.displayValue;
        const nextEffective = computeLedgerFieldEffectiveValueV1({
          source: before.source,
          override: nextOverride,
        });
        changes.push({
          key: meta.key,
          layer: 'override',
          beforeOverride: summarizeLedgerValue(before.override),
          afterOverride: summarizeLedgerValue(nextOverride),
          beforeEffective: summarizeLedgerValue(before.effective),
          afterEffective: summarizeLedgerValue(nextEffective),
        });
      }

      const saved = await tx.assetLedgerFields.upsert({
        where: { assetUuid: uuid },
        create: createData,
        update: updateData,
        select: LEDGER_FIELDS_V1_DB_SELECT,
      });

      const audit = await tx.auditEvent.create({
        data: {
          eventType: 'asset.ledger_fields_saved',
          actorUserId: auth.session.user.id,
          payload: {
            requestId: auth.requestId,
            assetUuid: uuid,
            updatedKeys,
            changes,
          },
        },
        select: { id: true },
      });

      await tx.assetHistoryEvent.create({
        data: {
          assetUuid: uuid,
          eventType: 'ledger_fields.changed',
          occurredAt: now,
          title: '台账字段变更',
          summary: {
            actor: { userId: auth.session.user.id, username: auth.session.user.username },
            requestId: auth.requestId,
            mode: 'manual_single',
            updatedKeys,
            changes,
          } as Prisma.InputJsonValue,
          refs: { auditEventId: audit.id } as Prisma.InputJsonValue,
        },
      });

      return { ok: true as const, ledgerFields: buildLedgerFieldsV1FromRow(saved), updatedKeys };
    });

    if (!result.ok) {
      return fail(
        { code: ErrorCode.CONFIG_ASSET_NOT_FOUND, category: 'config', message: 'Asset not found', retryable: false },
        404,
        { requestId: auth.requestId },
      );
    }

    return ok(
      { assetUuid: uuid, updatedKeys: result.updatedKeys, ledgerFields: result.ledgerFields },
      { requestId: auth.requestId },
    );
  } catch (err) {
    if (isAppError(err)) {
      // M8 PRD: ledger field validation errors are client-visible and stable.
      const status =
        err.code === ErrorCode.CONFIG_LEDGER_FIELD_KEY_INVALID ||
        err.code === ErrorCode.CONFIG_LEDGER_FIELD_ASSET_TYPE_MISMATCH ||
        err.code === ErrorCode.CONFIG_LEDGER_FIELD_VALUE_INVALID
          ? 400
          : 500;
      return fail(err, status, { requestId: auth.requestId });
    }

    return fail(
      { code: ErrorCode.DB_WRITE_FAILED, category: 'db', message: 'Failed to save ledger fields', retryable: false },
      500,
      { requestId: auth.requestId },
    );
  }
}
