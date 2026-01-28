import { z } from 'zod/v4';

import { requireAdmin } from '@/lib/auth/require-admin';
import { prisma } from '@/lib/db/prisma';
import { encryptJson } from '@/lib/crypto/aes-gcm';
import { ErrorCode } from '@/lib/errors/error-codes';
import { buildPagination, parseBoolean, parsePagination } from '@/lib/http/pagination';
import { created, fail, okPaginated } from '@/lib/http/response';
import { SourceType } from '@prisma/client';

const SourceCreateSchema = z.object({
  name: z.string().min(1),
  sourceType: z.nativeEnum(SourceType),
  enabled: z.boolean().optional(),
  scheduleGroupId: z.string().min(1),
  config: z.object({
    endpoint: z.string().min(1),
  }),
  credential: z
    .object({
      username: z.string().min(1),
      password: z.string().min(1),
    })
    .optional(),
});

export async function GET(request: Request) {
  const auth = await requireAdmin(request);
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const { page, pageSize, skip, take } = parsePagination(url.searchParams);
  const enabled = parseBoolean(url.searchParams.get('enabled'));
  const sourceType = url.searchParams.get('sourceType') ?? undefined;
  const scheduleGroupId = url.searchParams.get('scheduleGroupId') ?? undefined;

  const where = {
    deletedAt: null,
    ...(enabled === undefined ? {} : { enabled }),
    ...(sourceType ? { sourceType: sourceType as SourceType } : {}),
    ...(scheduleGroupId ? { scheduleGroupId } : {}),
  };

  const [total, sources] = await prisma.$transaction([
    prisma.source.count({ where }),
    prisma.source.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take,
      include: { scheduleGroup: { select: { name: true } } },
    }),
  ]);

  const sourceIds = sources.map((s) => s.id);
  const runs =
    sourceIds.length > 0
      ? await prisma.run.findMany({
          where: { sourceId: { in: sourceIds } },
          orderBy: { createdAt: 'desc' },
        })
      : [];

  const lastRunMap = new Map<string, (typeof runs)[number]>();
  for (const run of runs) {
    if (!lastRunMap.has(run.sourceId)) lastRunMap.set(run.sourceId, run);
  }

  const data = sources.map((source) => {
    const lastRun = lastRunMap.get(source.id);
    return {
      sourceId: source.id,
      name: source.name,
      sourceType: source.sourceType,
      enabled: source.enabled,
      scheduleGroupId: source.scheduleGroupId,
      scheduleGroupName: source.scheduleGroup?.name ?? null,
      config: source.config,
      lastRun: lastRun
        ? {
            runId: lastRun.id,
            status: lastRun.status,
            finishedAt: lastRun.finishedAt?.toISOString() ?? null,
            mode: lastRun.mode,
          }
        : null,
      createdAt: source.createdAt.toISOString(),
      updatedAt: source.updatedAt.toISOString(),
    };
  });

  return okPaginated(data, buildPagination(total, page, pageSize), { requestId: auth.requestId });
}

export async function POST(request: Request) {
  const auth = await requireAdmin(request);
  if (!auth.ok) return auth.response;

  let body: z.infer<typeof SourceCreateSchema>;
  try {
    body = SourceCreateSchema.parse(await request.json());
  } catch {
    return fail(
      { code: ErrorCode.CONFIG_INVALID_REQUEST, category: 'config', message: 'Validation failed', retryable: false },
      400,
      { requestId: auth.requestId },
    );
  }

  const duplicate = await prisma.source.findFirst({
    where: { name: body.name, deletedAt: null },
    select: { id: true },
  });
  if (duplicate) {
    return fail(
      { code: ErrorCode.CONFIG_DUPLICATE_NAME, category: 'config', message: 'Name already exists', retryable: false },
      409,
      { requestId: auth.requestId },
    );
  }

  const group = await prisma.scheduleGroup.findUnique({ where: { id: body.scheduleGroupId } });
  if (!group) {
    return fail(
      {
        code: ErrorCode.CONFIG_SCHEDULE_GROUP_NOT_FOUND,
        category: 'config',
        message: 'Schedule group not found',
        retryable: false,
      },
      404,
      { requestId: auth.requestId },
    );
  }

  let credentialCiphertext: string | null = null;
  if (body.credential) {
    try {
      credentialCiphertext = encryptJson(body.credential);
    } catch (err) {
      return fail(
        {
          code: ErrorCode.INTERNAL_ERROR,
          category: 'unknown',
          message: err instanceof Error ? err.message : 'Credential encryption failed',
          retryable: false,
        },
        500,
        { requestId: auth.requestId },
      );
    }
  }

  try {
    const source = await prisma.source.create({
      data: {
        name: body.name,
        sourceType: body.sourceType,
        enabled: body.enabled ?? true,
        scheduleGroupId: body.scheduleGroupId,
        config: body.config,
        credentialCiphertext,
      },
    });

    return created(
      {
        sourceId: source.id,
        name: source.name,
        sourceType: source.sourceType,
        enabled: source.enabled,
        scheduleGroupId: source.scheduleGroupId,
        config: source.config,
        createdAt: source.createdAt.toISOString(),
        updatedAt: source.updatedAt.toISOString(),
      },
      { requestId: auth.requestId },
    );
  } catch {
    return fail(
      { code: ErrorCode.DB_WRITE_FAILED, category: 'db', message: 'Failed to create source', retryable: false },
      500,
      { requestId: auth.requestId },
    );
  }
}
