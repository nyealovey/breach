import { z } from 'zod/v4';

import { requireAdmin } from '@/lib/auth/require-admin';
import { prisma } from '@/lib/db/prisma';
import { ErrorCode } from '@/lib/errors/error-codes';
import { buildPagination, parseBoolean, parsePagination } from '@/lib/http/pagination';
import { created, fail, okPaginated } from '@/lib/http/response';

const ScheduleGroupSchema = z.object({
  name: z.string().min(1),
  timezone: z.string().min(1),
  runAtHhmm: z.string().min(1),
  enabled: z.boolean().optional(),
  maxParallelSources: z.number().int().positive().optional().nullable(),
  sourceIds: z.array(z.string().min(1)).min(1),
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

export async function GET(request: Request) {
  const auth = await requireAdmin(request);
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const { page, pageSize, skip, take } = parsePagination(url.searchParams);
  const enabled = parseBoolean(url.searchParams.get('enabled'));

  const where = enabled === undefined ? {} : { enabled };

  const [total, groups] = await prisma.$transaction([
    prisma.scheduleGroup.count({ where }),
    prisma.scheduleGroup.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take,
    }),
  ]);

  const ids = groups.map((group) => group.id);
  const counts =
    ids.length > 0
      ? await prisma.source.groupBy({
          by: ['scheduleGroupId'],
          where: { scheduleGroupId: { in: ids }, deletedAt: null },
          _count: { _all: true },
        })
      : [];
  const countMap = new Map(counts.map((item) => [item.scheduleGroupId ?? '', item._count._all]));

  const data = groups.map((group) => ({
    groupId: group.id,
    name: group.name,
    enabled: group.enabled,
    timezone: group.timezone,
    runAtHhmm: group.runAtHhmm,
    sourceCount: countMap.get(group.id) ?? 0,
    lastTriggeredOn: group.lastTriggeredOn?.toISOString().slice(0, 10) ?? null,
    createdAt: group.createdAt.toISOString(),
    updatedAt: group.updatedAt.toISOString(),
  }));

  return okPaginated(data, buildPagination(total, page, pageSize), { requestId: auth.requestId });
}

export async function POST(request: Request) {
  const auth = await requireAdmin(request);
  if (!auth.ok) return auth.response;

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

  try {
    const sourceIds = Array.from(new Set(body.sourceIds));
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

    const group = await prisma.$transaction(async (tx) => {
      const group = await tx.scheduleGroup.create({
        data: {
          name: body.name,
          timezone: body.timezone,
          runAtHhmm: body.runAtHhmm,
          enabled: body.enabled ?? true,
          maxParallelSources: body.maxParallelSources ?? null,
        },
      });

      await tx.source.updateMany({
        where: { id: { in: sourceIds }, deletedAt: null, enabled: true },
        data: { scheduleGroupId: group.id },
      });

      return group;
    });

    return created(
      {
        groupId: group.id,
        name: group.name,
        enabled: group.enabled,
        timezone: group.timezone,
        runAtHhmm: group.runAtHhmm,
        maxParallelSources: group.maxParallelSources ?? null,
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
    return fail(
      { code: ErrorCode.DB_WRITE_FAILED, category: 'db', message: 'Failed to create schedule group', retryable: false },
      500,
      { requestId: auth.requestId },
    );
  }
}
