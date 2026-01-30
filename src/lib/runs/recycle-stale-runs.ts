import { ErrorCode } from '@/lib/errors/error-codes';

import type { AppError } from '@/lib/errors/error';
import type { Prisma, PrismaClient } from '@prisma/client';

export type RecycleStaleRunsResult = {
  staleBefore: Date;
  recycled: number;
};

/**
 * Auto-recycle stale runs (best-effort).
 *
 * Why: a worker crash or abnormal exit can leave runs stuck in `Running`, which then blocks
 * subsequent schedules/manual triggers due to single-flight checks.
 */
export async function recycleStaleRuns(args: {
  prisma: PrismaClient;
  now: Date;
  staleAfterMs: number;
}): Promise<RecycleStaleRunsResult> {
  const staleBefore = new Date(args.now.getTime() - args.staleAfterMs);

  // Keep it small and safe: only recycle `Running` runs with a very old startedAt.
  // We intentionally do NOT touch `Queued` runs.
  const error: AppError = {
    code: ErrorCode.INTERNAL_ERROR,
    category: 'unknown',
    message: 'run recycled (stale running run)',
    retryable: true,
  };

  // NOTE: updateMany can't conditionally preserve existing errors/warnings. This is fine for
  // stale `Running` runs which typically have no terminal error yet.
  const res = await args.prisma.run.updateMany({
    where: {
      status: 'Running',
      startedAt: { lt: staleBefore },
      finishedAt: null,
    },
    data: {
      status: 'Failed',
      finishedAt: args.now,
      errorSummary: 'recycled stale run',
      errors: [error] as unknown as Prisma.InputJsonValue,
    },
  });

  return { staleBefore, recycled: res.count };
}
