import { requireAdmin } from '@/lib/auth/require-admin';
import { prisma } from '@/lib/db/prisma';
import { ErrorCode } from '@/lib/errors/error-codes';
import { buildPagination, parsePagination } from '@/lib/http/pagination';
import { fail, okPaginated } from '@/lib/http/response';
import { RunMode, RunStatus, RunTriggerType } from '@prisma/client';

const SUPPORTED_STATUS = new Set<RunStatus>(['Queued', 'Running', 'Succeeded', 'Failed', 'Cancelled']);
const SUPPORTED_MODE = new Set<RunMode>(['collect', 'collect_hosts', 'collect_vms', 'detect', 'healthcheck']);
const SUPPORTED_TRIGGER = new Set<RunTriggerType>(['manual', 'schedule']);

export async function GET(request: Request) {
  const auth = await requireAdmin(request);
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const { page, pageSize, skip, take } = parsePagination(url.searchParams);

  const sourceId = url.searchParams.get('sourceId') ?? undefined;
  const status = url.searchParams.get('status') as RunStatus | null;
  const mode = url.searchParams.get('mode') as RunMode | null;
  const triggerType = url.searchParams.get('triggerType') as RunTriggerType | null;

  if (status && !SUPPORTED_STATUS.has(status)) {
    return fail(
      { code: ErrorCode.CONFIG_INVALID_REQUEST, category: 'config', message: 'Invalid status', retryable: false },
      400,
      { requestId: auth.requestId },
    );
  }
  if (mode && !SUPPORTED_MODE.has(mode)) {
    return fail(
      { code: ErrorCode.CONFIG_INVALID_REQUEST, category: 'config', message: 'Invalid mode', retryable: false },
      400,
      { requestId: auth.requestId },
    );
  }
  if (triggerType && !SUPPORTED_TRIGGER.has(triggerType)) {
    return fail(
      { code: ErrorCode.CONFIG_INVALID_REQUEST, category: 'config', message: 'Invalid triggerType', retryable: false },
      400,
      { requestId: auth.requestId },
    );
  }

  const where = {
    ...(sourceId ? { sourceId } : {}),
    ...(status ? { status } : {}),
    ...(mode ? { mode } : {}),
    ...(triggerType ? { triggerType } : {}),
  };

  const [total, runs] = await prisma.$transaction([
    prisma.run.count({ where }),
    prisma.run.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take,
      include: { source: { select: { name: true } } },
    }),
  ]);

  const now = Date.now();
  const data = runs.map((run) => {
    const durationMs = run.startedAt
      ? run.finishedAt
        ? run.finishedAt.getTime() - run.startedAt.getTime()
        : now - run.startedAt.getTime()
      : null;
    const warningsCount = Array.isArray(run.warnings) ? run.warnings.length : 0;
    const errorsCount = Array.isArray(run.errors) ? run.errors.length : 0;
    return {
      runId: run.id,
      sourceId: run.sourceId,
      sourceName: run.source?.name ?? null,
      mode: run.mode,
      triggerType: run.triggerType,
      status: run.status,
      startedAt: run.startedAt?.toISOString() ?? null,
      finishedAt: run.finishedAt?.toISOString() ?? null,
      durationMs: durationMs ?? 0,
      stats: run.stats ?? null,
      warningsCount,
      errorsCount,
    };
  });

  return okPaginated(data, buildPagination(total, page, pageSize), { requestId: auth.requestId });
}
