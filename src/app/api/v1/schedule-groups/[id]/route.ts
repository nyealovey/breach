import { z } from 'zod/v4';

import { requireAdmin } from '@/lib/auth/require-admin';
import { prisma } from '@/lib/db/prisma';
import { ErrorCode } from '@/lib/errors/error-codes';
import { getOrCreateRequestId } from '@/lib/http/request-id';
import { fail, ok } from '@/lib/http/response';

const ScheduleGroupSchema = z.object({
  name: z.string().min(1),
  timezone: z.string().min(1),
  runAtHhmm: z.string().min(1),
  enabled: z.boolean().optional(),
  maxParallelSources: z.number().int().positive().optional().nullable(),
  sourceIds: z.array(z.string().min(1)).optional(),
});

function isValidTimezone(timezone: string) {
  try {
    Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

function isValidHhmm(value: string) {
  return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin(request);
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const group = await prisma.scheduleGroup.findUnique({ where: { id } });
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

  const sourceCount = await prisma.source.count({ where: { scheduleGroupId: id, deletedAt: null } });

  return ok(
    {
      groupId: group.id,
      name: group.name,
      enabled: group.enabled,
      timezone: group.timezone,
      runAtHhmm: group.runAtHhmm,
      maxParallelSources: group.maxParallelSources ?? null,
      sourceCount,
      lastTriggeredOn: group.lastTriggeredOn?.toISOString().slice(0, 10) ?? null,
      createdAt: group.createdAt.toISOString(),
      updatedAt: group.updatedAt.toISOString(),
    },
    { requestId: auth.requestId },
  );
}

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin(request);
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  let body: z.infer<typeof ScheduleGroupSchema>;
  try {
    body = ScheduleGroupSchema.parse(await request.json());
  } catch {
    return fail(
      { code: ErrorCode.CONFIG_INVALID_REQUEST, category: 'config', message: 'Validation failed', retryable: false },
      400,
      { requestId: auth.requestId },
    );
  }

  if (!isValidTimezone(body.timezone)) {
    return fail(
      { code: ErrorCode.CONFIG_INVALID_TIMEZONE, category: 'config', message: 'Invalid timezone', retryable: false },
      400,
      { requestId: auth.requestId },
    );
  }

  if (!isValidHhmm(body.runAtHhmm)) {
    return fail(
      { code: ErrorCode.CONFIG_INVALID_HHMM, category: 'config', message: 'Invalid HH:mm', retryable: false },
      400,
      { requestId: auth.requestId },
    );
  }

  const sourceIds = body.sourceIds ? Array.from(new Set(body.sourceIds)) : null;
  if (sourceIds) {
    const sources = await prisma.source.findMany({
      where: { id: { in: sourceIds }, deletedAt: null, enabled: true },
      select: { id: true },
    });
    if (sources.length !== sourceIds.length) {
      return fail(
        {
          code: ErrorCode.CONFIG_INVALID_REQUEST,
          category: 'config',
          message: 'Invalid sourceIds (only enabled sources can be selected)',
          retryable: false,
          redacted_context: { requested: sourceIds.length, valid: sources.length },
        },
        400,
        { requestId: auth.requestId },
      );
    }
  }

  try {
    const group = await prisma.$transaction(async (tx) => {
      const group = await tx.scheduleGroup.update({
        where: { id },
        data: {
          name: body.name,
          timezone: body.timezone,
          runAtHhmm: body.runAtHhmm,
          enabled: body.enabled ?? true,
          maxParallelSources: body.maxParallelSources ?? null,
        },
      });

      if (sourceIds) {
        // Only manage enabled sources for selection; disabled sources remain untouched.
        await tx.source.updateMany({
          where: { scheduleGroupId: id, deletedAt: null, enabled: true, id: { notIn: sourceIds } },
          data: { scheduleGroupId: null },
        });

        await tx.source.updateMany({
          where: { id: { in: sourceIds }, deletedAt: null, enabled: true },
          data: { scheduleGroupId: id },
        });
      }

      return group;
    });

    return ok(
      {
        groupId: group.id,
        name: group.name,
        enabled: group.enabled,
        timezone: group.timezone,
        runAtHhmm: group.runAtHhmm,
        maxParallelSources: group.maxParallelSources ?? null,
        lastTriggeredOn: group.lastTriggeredOn?.toISOString().slice(0, 10) ?? null,
        createdAt: group.createdAt.toISOString(),
        updatedAt: group.updatedAt.toISOString(),
      },
      { requestId: auth.requestId },
    );
  } catch (err) {
    if (typeof err === 'object' && err && 'code' in err && (err as { code: string }).code === 'P2002') {
      return fail(
        { code: ErrorCode.CONFIG_DUPLICATE_NAME, category: 'config', message: 'Name already exists', retryable: false },
        409,
        { requestId: auth.requestId },
      );
    }

    if (typeof err === 'object' && err && 'code' in err && (err as { code: string }).code === 'P2025') {
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

    return fail(
      { code: ErrorCode.DB_WRITE_FAILED, category: 'db', message: 'Failed to update schedule group', retryable: false },
      500,
      { requestId: auth.requestId },
    );
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin(request);
  if (!auth.ok) return auth.response;

  const { id } = await context.params;

  const exists = await prisma.scheduleGroup.findUnique({ where: { id }, select: { id: true } });
  if (!exists) {
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

  const sourceCount = await prisma.source.count({ where: { scheduleGroupId: id, deletedAt: null } });
  if (sourceCount > 0) {
    return fail(
      {
        code: ErrorCode.CONFIG_RESOURCE_CONFLICT,
        category: 'config',
        message: 'Schedule group still has active sources',
        retryable: false,
      },
      409,
      { requestId: auth.requestId },
    );
  }

  await prisma.scheduleGroup.delete({ where: { id } });
  const requestId = getOrCreateRequestId(auth.requestId);
  return new Response(null, { status: 204, headers: { 'X-Request-ID': requestId } });
}
