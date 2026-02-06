import { z } from 'zod/v4';

import { requireUser } from '@/lib/auth/require-user';
import { prisma } from '@/lib/db/prisma';
import { ErrorCode } from '@/lib/errors/error-codes';
import { fail, ok } from '@/lib/http/response';

import type { Prisma } from '@prisma/client';

const AssetsTableColumnsKeyV1 = 'assets.table.columns.v1' as const;
const AssetsTableColumnsKeyV2 = 'assets.table.columns.v2' as const;
const AllowedPreferenceKeySchema = z.union([z.literal(AssetsTableColumnsKeyV1), z.literal(AssetsTableColumnsKeyV2)]);

const AssetsTableColumnsValueSchema = z.object({
  visibleColumns: z.array(z.string().min(1)).min(1),
});

export async function GET(request: Request) {
  const auth = await requireUser(request);
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);

  let key: z.infer<typeof AllowedPreferenceKeySchema>;
  try {
    key = AllowedPreferenceKeySchema.parse(url.searchParams.get('key')?.trim());
  } catch {
    return fail(
      {
        code: ErrorCode.CONFIG_INVALID_REQUEST,
        category: 'config',
        message: 'Invalid preference key',
        retryable: false,
      },
      400,
      { requestId: auth.requestId },
    );
  }

  const pref = await prisma.userPreference.findUnique({
    where: { userId_key: { userId: auth.session.user.id, key } },
    select: { key: true, value: true },
  });

  if (!pref) {
    return fail(
      {
        code: ErrorCode.CONFIG_PREFERENCE_NOT_FOUND,
        category: 'config',
        message: 'Preference not found',
        retryable: false,
      },
      404,
      { requestId: auth.requestId },
    );
  }

  return ok({ key: pref.key, value: pref.value }, { requestId: auth.requestId });
}

export async function PUT(request: Request) {
  const auth = await requireUser(request);
  if (!auth.ok) return auth.response;

  const BodySchema = z.object({
    key: z.string().min(1),
    value: z.unknown(),
  });

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

  let key: z.infer<typeof AllowedPreferenceKeySchema>;
  try {
    key = AllowedPreferenceKeySchema.parse(body.key.trim());
  } catch {
    return fail(
      {
        code: ErrorCode.CONFIG_INVALID_REQUEST,
        category: 'config',
        message: 'Invalid preference key',
        retryable: false,
      },
      400,
      { requestId: auth.requestId },
    );
  }

  let value: Prisma.InputJsonValue;
  if (key === AssetsTableColumnsKeyV1 || key === AssetsTableColumnsKeyV2) {
    let parsedValue: z.infer<typeof AssetsTableColumnsValueSchema>;
    try {
      parsedValue = AssetsTableColumnsValueSchema.parse(body.value);
    } catch {
      return fail(
        {
          code: ErrorCode.CONFIG_INVALID_REQUEST,
          category: 'config',
          message: 'Invalid preference value',
          retryable: false,
        },
        400,
        { requestId: auth.requestId },
      );
    }

    const visibleColumns = Array.from(
      new Set(parsedValue.visibleColumns.map((c) => c.trim()).filter((c) => c.length > 0)),
    );

    if (visibleColumns.length < 1) {
      return fail(
        {
          code: ErrorCode.CONFIG_INVALID_REQUEST,
          category: 'config',
          message: 'Invalid preference value',
          retryable: false,
        },
        400,
        { requestId: auth.requestId },
      );
    }

    value = { visibleColumns };
  } else {
    // Defensive default: should never happen due to AllowedPreferenceKeySchema.
    return fail(
      {
        code: ErrorCode.CONFIG_INVALID_REQUEST,
        category: 'config',
        message: 'Invalid preference key',
        retryable: false,
      },
      400,
      { requestId: auth.requestId },
    );
  }

  try {
    const saved = await prisma.userPreference.upsert({
      where: { userId_key: { userId: auth.session.user.id, key } },
      create: { userId: auth.session.user.id, key, value },
      update: { value },
      select: { key: true, value: true },
    });

    return ok({ key: saved.key, value: saved.value }, { requestId: auth.requestId });
  } catch {
    return fail(
      { code: ErrorCode.DB_WRITE_FAILED, category: 'db', message: 'Failed to save preference', retryable: false },
      500,
      { requestId: auth.requestId },
    );
  }
}
