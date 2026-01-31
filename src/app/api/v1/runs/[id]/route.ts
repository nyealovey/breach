import { requireAdmin } from '@/lib/auth/require-admin';
import { prisma } from '@/lib/db/prisma';
import { ErrorCode } from '@/lib/errors/error-codes';
import { fail, ok } from '@/lib/http/response';

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin(request);
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const run = await prisma.run.findUnique({
    where: { id },
    include: { source: { select: { name: true } } },
  });
  if (!run) {
    return fail(
      { code: ErrorCode.CONFIG_RUN_NOT_FOUND, category: 'config', message: 'Run not found', retryable: false },
      404,
      { requestId: auth.requestId },
    );
  }

  const durationMs = run.startedAt
    ? run.finishedAt
      ? run.finishedAt.getTime() - run.startedAt.getTime()
      : Date.now() - run.startedAt.getTime()
    : null;

  return ok(
    {
      runId: run.id,
      sourceId: run.sourceId,
      sourceName: run.source?.name ?? null,
      mode: run.mode,
      triggerType: run.triggerType,
      status: run.status,
      startedAt: run.startedAt?.toISOString() ?? null,
      finishedAt: run.finishedAt?.toISOString() ?? null,
      durationMs: durationMs ?? 0,
      detectResult: run.detectResult ?? null,
      stats: run.stats ?? null,
      warnings: run.warnings ?? [],
      errors: run.errors ?? [],
      errorSummary: run.errorSummary ?? null,
    },
    { requestId: auth.requestId },
  );
}
