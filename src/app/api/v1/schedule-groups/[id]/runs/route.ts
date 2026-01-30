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
    const sources = await tx.$queryRaw<Array<{ id: string; credentialId: string | null; sourceType: string }>>`
      SELECT id, "credentialId", "sourceType"
      FROM "Source"
      WHERE "scheduleGroupId" = ${group.id}
        AND "deletedAt" IS NULL
        AND enabled = true
      FOR UPDATE SKIP LOCKED
    `;

    const skipped_missing_credential = sources.filter((s) => s.credentialId === null).length;
    const eligibleSources = sources.filter((s) => s.credentialId !== null);
    const eligibleSourceIds = eligibleSources.map((s) => s.id);

    if (eligibleSourceIds.length === 0) {
      return { queued: 0, skipped_active: 0, skipped_missing_credential, message: 'no eligible sources' };
    }

    const active = await tx.run.findMany({
      where: { sourceId: { in: eligibleSourceIds }, status: { in: ['Queued', 'Running'] } },
      select: { sourceId: true, mode: true },
      distinct: ['sourceId', 'mode'],
    });
    const activeSet = new Set(active.map((r) => `${r.sourceId}:${r.mode}`));

    const vcenterSources = eligibleSources.filter((s) => s.sourceType === 'vcenter');
    const otherSources = eligibleSources.filter((s) => s.sourceType !== 'vcenter');

    const hostRuns = vcenterSources
      .filter((s) => !activeSet.has(`${s.id}:collect_hosts`))
      .map((s) => ({
        sourceId: s.id,
        scheduleGroupId: group.id,
        triggerType: 'manual' as const,
        mode: 'collect_hosts' as const,
        status: 'Queued' as const,
      }));

    const vmRuns = vcenterSources
      .filter((s) => !activeSet.has(`${s.id}:collect_vms`))
      .map((s) => ({
        sourceId: s.id,
        scheduleGroupId: group.id,
        triggerType: 'manual' as const,
        mode: 'collect_vms' as const,
        status: 'Queued' as const,
      }));

    const collectRuns = otherSources
      .filter((s) => !activeSet.has(`${s.id}:collect`))
      .map((s) => ({
        sourceId: s.id,
        scheduleGroupId: group.id,
        triggerType: 'manual' as const,
        mode: 'collect' as const,
        status: 'Queued' as const,
      }));

    // Create in order so hosts runs are likely processed before vm runs.
    if (hostRuns.length > 0) await tx.run.createMany({ data: hostRuns });
    if (vmRuns.length > 0) await tx.run.createMany({ data: vmRuns });
    if (collectRuns.length > 0) await tx.run.createMany({ data: collectRuns });

    const queued = hostRuns.length + vmRuns.length + collectRuns.length;
    const wanted = vcenterSources.length * 2 + otherSources.length;
    const skipped_active = Math.max(0, wanted - queued);

    const message =
      queued === 0 ? (skipped_active > 0 ? 'all eligible sources have active runs' : 'no eligible sources') : 'queued';

    return { queued, skipped_active, skipped_missing_credential, message };
  });

  return ok(result, { requestId: auth.requestId });
}
