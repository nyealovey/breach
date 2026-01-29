import { requireAdmin } from '@/lib/auth/require-admin';
import { prisma } from '@/lib/db/prisma';
import { ErrorCode } from '@/lib/errors/error-codes';
import { fail, ok } from '@/lib/http/response';

type TxResult = {
  queued: number;
  skipped_active: number;
  skipped_missing_credential: number;
  message: string;
};

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin(request);
  if (!auth.ok) return auth.response;

  const { id } = await context.params;

  const group = await prisma.scheduleGroup.findUnique({ where: { id }, select: { id: true } });
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

  const result = await prisma.$transaction(async (tx): Promise<TxResult> => {
    // Concurrency control: lock eligible sources in the group to avoid duplicate enqueue.
    const sources = await tx.$queryRaw<Array<{ id: string; credentialId: string | null }>>`
      SELECT id, "credentialId"
      FROM "Source"
      WHERE "scheduleGroupId" = ${group.id}
        AND "deletedAt" IS NULL
        AND enabled = true
      FOR UPDATE SKIP LOCKED
    `;

    const skipped_missing_credential = sources.filter((s) => s.credentialId === null).length;
    const eligibleSourceIds = sources.filter((s) => s.credentialId !== null).map((s) => s.id);

    if (eligibleSourceIds.length === 0) {
      return { queued: 0, skipped_active: 0, skipped_missing_credential, message: 'no eligible sources' };
    }

    const active = await tx.run.findMany({
      where: { sourceId: { in: eligibleSourceIds }, status: { in: ['Queued', 'Running'] } },
      select: { sourceId: true },
      distinct: ['sourceId'],
    });
    const activeSet = new Set(active.map((r) => r.sourceId));

    const toQueue = eligibleSourceIds.filter((sourceId) => !activeSet.has(sourceId));

    if (toQueue.length > 0) {
      await tx.run.createMany({
        data: toQueue.map((sourceId) => ({
          sourceId,
          scheduleGroupId: group.id,
          triggerType: 'manual',
          mode: 'collect',
          status: 'Queued',
        })),
      });
    }

    const queued = toQueue.length;
    const skipped_active = activeSet.size;
    const message = queued === 0 ? 'no eligible sources' : 'queued';

    return { queued, skipped_active, skipped_missing_credential, message };
  });

  return ok(result, { requestId: auth.requestId });
}
