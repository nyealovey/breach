import { generateDuplicateCandidatesForRunAssets } from '@/lib/duplicate-candidates/generate-candidates';
import { upsertDuplicateCandidate } from '@/lib/duplicate-candidates/upsert-duplicate-candidate';

import type { DuplicateCandidateJob, PrismaClient, RunMode } from '@prisma/client';

const WINDOW_DAYS = 7;

export function inferDupCandidateAssetTypesFromRunMode(mode: RunMode): Array<'host' | 'vm'> {
  if (mode === 'collect_hosts') return ['host'];
  if (mode === 'collect_vms') return ['vm'];
  if (mode === 'collect') return ['host', 'vm'];
  return [];
}

function subtractDays(date: Date, days: number): Date {
  return new Date(date.getTime() - days * 24 * 60 * 60 * 1000);
}

export async function enqueueDuplicateCandidateJob(args: {
  prisma: PrismaClient;
  runId: string;
}): Promise<{ enqueued: boolean }> {
  try {
    await args.prisma.duplicateCandidateJob.create({ data: { runId: args.runId } });
    return { enqueued: true };
  } catch (err) {
    // Idempotency: unique(runId) means "already enqueued" should be a no-op.
    if (typeof err === 'object' && err && 'code' in err && (err as any).code === 'P2002') {
      return { enqueued: false };
    }
    throw err;
  }
}

export async function claimQueuedDuplicateCandidateJobs(args: {
  prisma: PrismaClient;
  batchSize: number;
}): Promise<DuplicateCandidateJob[]> {
  return args.prisma.$queryRaw<DuplicateCandidateJob[]>`
    WITH next AS (
      SELECT id
      FROM "DuplicateCandidateJob"
      WHERE status = 'Queued'
      ORDER BY "createdAt" ASC
      LIMIT ${args.batchSize}
      FOR UPDATE SKIP LOCKED
    )
    UPDATE "DuplicateCandidateJob" j
    SET status = 'Running', "startedAt" = NOW(), "updatedAt" = NOW(), attempts = attempts + 1
    FROM next
    WHERE j.id = next.id
    RETURNING j.*;
  `;
}

async function loadCandidatePool(args: {
  prisma: PrismaClient;
  assetType: 'host' | 'vm';
  cutoff: Date;
}): Promise<Array<{ assetUuid: string; normalized: unknown }>> {
  const rows = await args.prisma.$queryRaw<Array<{ assetUuid: string; normalized: unknown }>>`
    SELECT DISTINCT ON (sr."assetUuid")
      sr."assetUuid" AS "assetUuid",
      sr."normalized" AS "normalized"
    FROM "SourceRecord" sr
    JOIN "Asset" a ON a."uuid" = sr."assetUuid"
    WHERE a."assetType" = ${args.assetType}::"AssetType"
      AND a."status" <> 'merged'::"AssetStatus"
      AND (
        a."status" = 'in_service'::"AssetStatus"
        OR (a."status" = 'offline'::"AssetStatus" AND a."lastSeenAt" >= ${args.cutoff})
      )
    ORDER BY sr."assetUuid", sr."collectedAt" DESC
  `;

  return rows.map((r) => ({ assetUuid: r.assetUuid, normalized: r.normalized }));
}

export async function processDuplicateCandidateJob(args: {
  prisma: PrismaClient;
  job: DuplicateCandidateJob;
  now: Date;
}): Promise<{ candidates: number }> {
  const run = await args.prisma.run.findUnique({
    where: { id: args.job.runId },
    select: { id: true, mode: true, status: true },
  });
  if (!run) throw new Error(`run not found for job ${args.job.id}`);

  const scopes = inferDupCandidateAssetTypesFromRunMode(run.mode);
  if (scopes.length === 0) return { candidates: 0 };

  const cutoff = subtractDays(args.now, WINDOW_DAYS);
  let candidates = 0;

  for (const assetType of scopes) {
    const runAssets = await args.prisma.sourceRecord.findMany({
      where: { runId: run.id, externalKind: assetType },
      select: { assetUuid: true, normalized: true },
    });
    if (runAssets.length === 0) continue;

    const pool = await loadCandidatePool({ prisma: args.prisma, assetType, cutoff });
    const drafts = generateDuplicateCandidatesForRunAssets({
      assetType,
      runAssets: runAssets.map((r) => ({ assetUuid: r.assetUuid, normalized: r.normalized })),
      pool,
    });

    for (const d of drafts) {
      await upsertDuplicateCandidate({
        prisma: args.prisma,
        observedAt: args.now,
        assetUuidA: d.assetUuidA,
        assetUuidB: d.assetUuidB,
        score: d.score,
        reasons: d.reasons,
      });
    }

    candidates += drafts.length;
  }

  return { candidates };
}
