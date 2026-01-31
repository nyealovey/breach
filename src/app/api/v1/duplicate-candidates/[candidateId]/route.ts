import { requireAdmin } from '@/lib/auth/require-admin';
import { prisma } from '@/lib/db/prisma';
import { ErrorCode } from '@/lib/errors/error-codes';
import { fail, ok } from '@/lib/http/response';

function confidenceLabel(score: number): 'High' | 'Medium' {
  return score >= 90 ? 'High' : 'Medium';
}

export async function GET(request: Request, context: { params: Promise<{ candidateId: string }> }) {
  const auth = await requireAdmin(request);
  if (!auth.ok) return auth.response;

  const { candidateId } = await context.params;

  const candidate = await prisma.duplicateCandidate.findUnique({
    where: { id: candidateId },
    include: {
      assetA: { select: { uuid: true, displayName: true, assetType: true, status: true, lastSeenAt: true } },
      assetB: { select: { uuid: true, displayName: true, assetType: true, status: true, lastSeenAt: true } },
    },
  });

  if (!candidate) {
    return fail(
      {
        code: ErrorCode.CONFIG_DUPLICATE_CANDIDATE_NOT_FOUND,
        category: 'config',
        message: 'Duplicate candidate not found',
        retryable: false,
      },
      404,
      { requestId: auth.requestId },
    );
  }

  const links = await prisma.assetSourceLink.findMany({
    where: { assetUuid: { in: [candidate.assetUuidA, candidate.assetUuidB] } },
    select: {
      assetUuid: true,
      sourceId: true,
      externalKind: true,
      externalId: true,
      presenceStatus: true,
      lastSeenAt: true,
      lastSeenRunId: true,
      source: { select: { id: true, name: true } },
    },
    orderBy: [{ presenceStatus: 'asc' }, { lastSeenAt: 'desc' }],
  });

  const linksByAssetUuid = new Map<string, any[]>();
  for (const link of links) {
    const arr = linksByAssetUuid.get(link.assetUuid) ?? [];
    arr.push({
      sourceId: link.sourceId,
      sourceName: link.source.name,
      externalKind: link.externalKind,
      externalId: link.externalId,
      presenceStatus: link.presenceStatus,
      lastSeenAt: link.lastSeenAt.toISOString(),
      lastSeenRunId: link.lastSeenRunId ?? null,
    });
    linksByAssetUuid.set(link.assetUuid, arr);
  }

  return ok(
    {
      candidateId: candidate.id,
      status: candidate.status,
      score: candidate.score,
      confidence: confidenceLabel(candidate.score),
      reasons: candidate.reasons,
      createdAt: candidate.createdAt.toISOString(),
      updatedAt: candidate.updatedAt.toISOString(),
      lastObservedAt: candidate.lastObservedAt.toISOString(),
      ignore:
        candidate.status === 'ignored'
          ? {
              ignoredByUserId: candidate.ignoredByUserId ?? null,
              ignoredAt: candidate.ignoredAt ? candidate.ignoredAt.toISOString() : null,
              ignoreReason: candidate.ignoreReason ?? null,
            }
          : null,
      assetA: {
        assetUuid: candidate.assetA.uuid,
        assetType: candidate.assetA.assetType,
        status: candidate.assetA.status,
        displayName: candidate.assetA.displayName ?? null,
        lastSeenAt: candidate.assetA.lastSeenAt ? candidate.assetA.lastSeenAt.toISOString() : null,
        sourceLinks: linksByAssetUuid.get(candidate.assetA.uuid) ?? [],
      },
      assetB: {
        assetUuid: candidate.assetB.uuid,
        assetType: candidate.assetB.assetType,
        status: candidate.assetB.status,
        displayName: candidate.assetB.displayName ?? null,
        lastSeenAt: candidate.assetB.lastSeenAt ? candidate.assetB.lastSeenAt.toISOString() : null,
        sourceLinks: linksByAssetUuid.get(candidate.assetB.uuid) ?? [],
      },
    },
    { requestId: auth.requestId },
  );
}
