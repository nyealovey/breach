import { z } from 'zod/v4';

import { requireAdmin } from '@/lib/auth/require-admin';
import { prisma } from '@/lib/db/prisma';
import { ErrorCode } from '@/lib/errors/error-codes';
import { getOrCreateRequestId } from '@/lib/http/request-id';
import { fail, ok } from '@/lib/http/response';
import { SourceType } from '@prisma/client';

const SourceUpdateSchema = z.object({
  name: z.string().min(1),
  sourceType: z.nativeEnum(SourceType),
  enabled: z.boolean().optional(),
  scheduleGroupId: z.string().min(1),
  config: z.object({
    endpoint: z.string().min(1),
  }),
});

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin(request);
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const source = await prisma.source.findFirst({
    where: { id, deletedAt: null },
    include: { scheduleGroup: { select: { name: true } } },
  });
  if (!source) {
    return fail(
      { code: ErrorCode.CONFIG_SOURCE_NOT_FOUND, category: 'config', message: 'Source not found', retryable: false },
      404,
      { requestId: auth.requestId },
    );
  }

  return ok(
    {
      sourceId: source.id,
      name: source.name,
      sourceType: source.sourceType,
      enabled: source.enabled,
      scheduleGroupId: source.scheduleGroupId,
      scheduleGroupName: source.scheduleGroup?.name ?? null,
      config: source.config,
      createdAt: source.createdAt.toISOString(),
      updatedAt: source.updatedAt.toISOString(),
    },
    { requestId: auth.requestId },
  );
}

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin(request);
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  let body: z.infer<typeof SourceUpdateSchema>;
  try {
    body = SourceUpdateSchema.parse(await request.json());
  } catch {
    return fail(
      { code: ErrorCode.CONFIG_INVALID_REQUEST, category: 'config', message: 'Validation failed', retryable: false },
      400,
      { requestId: auth.requestId },
    );
  }

  const existing = await prisma.source.findFirst({ where: { id, deletedAt: null } });
  if (!existing) {
    return fail(
      { code: ErrorCode.CONFIG_SOURCE_NOT_FOUND, category: 'config', message: 'Source not found', retryable: false },
      404,
      { requestId: auth.requestId },
    );
  }

  const duplicate = await prisma.source.findFirst({
    where: { name: body.name, deletedAt: null, NOT: { id } },
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

  const source = await prisma.source.update({
    where: { id },
    data: {
      name: body.name,
      sourceType: body.sourceType,
      enabled: body.enabled ?? true,
      scheduleGroupId: body.scheduleGroupId,
      config: body.config,
    },
  });

  return ok(
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
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin(request);
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const source = await prisma.source.findFirst({ where: { id, deletedAt: null } });
  if (!source) {
    return fail(
      { code: ErrorCode.CONFIG_SOURCE_NOT_FOUND, category: 'config', message: 'Source not found', retryable: false },
      404,
      { requestId: auth.requestId },
    );
  }

  const activeRun = await prisma.run.findFirst({
    where: { sourceId: id, status: { in: ['Queued', 'Running'] } },
    select: { id: true },
  });

  if (activeRun) {
    return fail(
      {
        code: ErrorCode.CONFIG_RESOURCE_CONFLICT,
        category: 'config',
        message: 'Active run exists for this source',
        retryable: false,
        redacted_context: { sourceId: id },
      },
      409,
      { requestId: auth.requestId },
    );
  }

  await prisma.source.update({
    where: { id },
    data: { deletedAt: new Date(), enabled: false },
  });

  const requestId = getOrCreateRequestId(auth.requestId);
  return new Response(null, { status: 204, headers: { 'X-Request-ID': requestId } });
}
