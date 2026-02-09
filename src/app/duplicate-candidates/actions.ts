'use server';

import { z } from 'zod/v4';

import { requireServerAdminSession } from '@/lib/auth/require-server-session';
import { actionError, actionOk, getActionErrorMessage } from '@/lib/actions/action-result';
import { prisma } from '@/lib/db/prisma';
import { buildPagination } from '@/lib/http/pagination';

import type { ActionResult } from '@/lib/actions/action-result';

export type DuplicateCandidateStatusParam = 'open' | 'ignored' | 'merged';
export type DuplicateCandidateAssetTypeParam = 'vm' | 'host';
export type DuplicateCandidateConfidenceParam = 'High' | 'Medium';

export type DuplicateCandidateListItem = {
  candidateId: string;
  status: DuplicateCandidateStatusParam;
  score: number;
  confidence: DuplicateCandidateConfidenceParam;
  lastObservedAt: string;
  assetA: {
    assetUuid: string;
    assetType: DuplicateCandidateAssetTypeParam;
    status: string;
    displayName: string | null;
    lastSeenAt: string | null;
  };
  assetB: {
    assetUuid: string;
    assetType: DuplicateCandidateAssetTypeParam;
    status: string;
    displayName: string | null;
    lastSeenAt: string | null;
  };
};

export type Pagination = { page: number; pageSize: number; total: number; totalPages: number };

export type DuplicateCandidatesListResponse = { data: DuplicateCandidateListItem[]; pagination: Pagination };

function parseStatus(input: unknown): DuplicateCandidateStatusParam {
  return input === 'ignored' || input === 'merged' ? input : 'open';
}

function parseAssetType(input: unknown): DuplicateCandidateAssetTypeParam | undefined {
  return input === 'vm' || input === 'host' ? input : undefined;
}

function parseConfidence(input: unknown): DuplicateCandidateConfidenceParam | undefined {
  return input === 'High' || input === 'Medium' ? input : undefined;
}

function confidenceLabel(score: number): DuplicateCandidateConfidenceParam {
  return score >= 90 ? 'High' : 'Medium';
}

function clampPagination(input: { page?: number; pageSize?: number }) {
  const rawPage = input.page ?? 1;
  const rawPageSize = input.pageSize ?? 20;

  const page = Number.isFinite(rawPage) && rawPage > 0 ? Math.floor(rawPage) : 1;
  let pageSize = Number.isFinite(rawPageSize) && rawPageSize > 0 ? Math.floor(rawPageSize) : 20;
  if (pageSize > 100) pageSize = 100;

  const skip = (page - 1) * pageSize;
  const take = pageSize;
  return { page, pageSize, skip, take };
}

export async function listDuplicateCandidatesAction(input: {
  status?: unknown;
  assetType?: unknown;
  confidence?: unknown;
  page?: number;
  pageSize?: number;
}): Promise<ActionResult<DuplicateCandidatesListResponse>> {
  await requireServerAdminSession();

  const status = parseStatus(input.status);
  const assetType = parseAssetType(input.assetType);
  const confidence = parseConfidence(input.confidence);
  const { page, pageSize, skip, take } = clampPagination({ page: input.page, pageSize: input.pageSize });

  const where: Record<string, unknown> = { status };
  if (assetType) where.assetA = { assetType };
  if (confidence === 'High') where.score = { gte: 90 };
  else if (confidence === 'Medium') where.score = { gte: 70, lt: 90 };

  try {
    const totalPromise = prisma.duplicateCandidate.count({ where: where as any });
    const itemsPromise = prisma.duplicateCandidate.findMany({
      where: where as any,
      orderBy: [{ lastObservedAt: 'desc' }, { score: 'desc' }],
      skip,
      take,
      include: {
        assetA: { select: { uuid: true, displayName: true, assetType: true, status: true, lastSeenAt: true } },
        assetB: { select: { uuid: true, displayName: true, assetType: true, status: true, lastSeenAt: true } },
      },
    });

    const [total, items] = await prisma.$transaction([totalPromise, itemsPromise]);

    const data = (items as any[]).map((c) => ({
      candidateId: c.id,
      status: c.status,
      score: c.score,
      confidence: confidenceLabel(c.score),
      lastObservedAt: c.lastObservedAt.toISOString(),
      assetA: {
        assetUuid: c.assetA.uuid,
        assetType: c.assetA.assetType,
        status: c.assetA.status,
        displayName: c.assetA.displayName ?? null,
        lastSeenAt: c.assetA.lastSeenAt ? c.assetA.lastSeenAt.toISOString() : null,
      },
      assetB: {
        assetUuid: c.assetB.uuid,
        assetType: c.assetB.assetType,
        status: c.assetB.status,
        displayName: c.assetB.displayName ?? null,
        lastSeenAt: c.assetB.lastSeenAt ? c.assetB.lastSeenAt.toISOString() : null,
      },
    })) as DuplicateCandidateListItem[];

    return actionOk({ data, pagination: buildPagination(total as number, page, pageSize) });
  } catch (err) {
    return actionError(getActionErrorMessage(err, 'Failed to load duplicate candidates'));
  }
}

export type SourceLink = {
  sourceId: string;
  sourceName: string;
  externalKind: string;
  externalId: string;
  presenceStatus: 'present' | 'missing';
  lastSeenAt: string;
  lastSeenRunId: string | null;
};

export type CandidateAsset = {
  assetUuid: string;
  assetType: DuplicateCandidateAssetTypeParam;
  status: string;
  displayName: string | null;
  lastSeenAt: string | null;
  sourceLinks: SourceLink[];
};

export type CandidateDetail = {
  candidateId: string;
  status: DuplicateCandidateStatusParam;
  score: number;
  confidence: DuplicateCandidateConfidenceParam;
  reasons: unknown;
  createdAt: string;
  updatedAt: string;
  lastObservedAt: string;
  ignore: null | {
    ignoredByUserId: string | null;
    ignoredAt: string | null;
    ignoreReason: string | null;
  };
  assetA: CandidateAsset;
  assetB: CandidateAsset;
};

export async function getDuplicateCandidateAction(candidateId: string): Promise<ActionResult<CandidateDetail>> {
  await requireServerAdminSession();

  const id = candidateId.trim();
  if (!id) return actionError('Invalid candidateId');

  try {
    const candidate = await prisma.duplicateCandidate.findUnique({
      where: { id },
      include: {
        assetA: { select: { uuid: true, displayName: true, assetType: true, status: true, lastSeenAt: true } },
        assetB: { select: { uuid: true, displayName: true, assetType: true, status: true, lastSeenAt: true } },
      },
    });

    if (!candidate) return actionError('Duplicate candidate not found');

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

    const linksByAssetUuid = new Map<string, SourceLink[]>();
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

    if (candidate.assetA.assetType !== 'vm' && candidate.assetA.assetType !== 'host') {
      return actionError('Unsupported asset type for duplicate candidate');
    }
    if (candidate.assetB.assetType !== 'vm' && candidate.assetB.assetType !== 'host') {
      return actionError('Unsupported asset type for duplicate candidate');
    }

    return actionOk({
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
    });
  } catch (err) {
    return actionError(getActionErrorMessage(err, 'Failed to load duplicate candidate'));
  }
}

const IgnoreBodySchema = z.object({ reason: z.string().optional() });

export async function ignoreDuplicateCandidateAction(
  candidateId: string,
  input: unknown,
): Promise<
  ActionResult<{
    candidateId: string;
    status: DuplicateCandidateStatusParam;
    ignoredAt: string | null;
    ignoreReason: string | null;
  }>
> {
  const session = await requireServerAdminSession();

  const id = candidateId.trim();
  if (!id) return actionError('Invalid candidateId');

  let body: z.infer<typeof IgnoreBodySchema>;
  try {
    body = IgnoreBodySchema.parse(input ?? {});
  } catch {
    return actionError('Validation failed');
  }

  try {
    const candidate = await prisma.duplicateCandidate.findUnique({
      where: { id },
      select: { id: true, status: true, assetUuidA: true, assetUuidB: true, ignoredAt: true, ignoreReason: true },
    });
    if (!candidate) return actionError('Duplicate candidate not found');

    const ignoreReason = body.reason?.trim() ? body.reason.trim() : null;

    if (candidate.status !== 'open') {
      return actionOk({
        candidateId: candidate.id,
        status: candidate.status,
        ignoredAt: candidate.ignoredAt ? candidate.ignoredAt.toISOString() : null,
        ignoreReason: candidate.ignoreReason ?? null,
      });
    }

    const now = new Date();
    const updated = await prisma.duplicateCandidate.updateMany({
      where: { id: candidate.id, status: 'open' },
      data: { status: 'ignored', ignoredByUserId: session.user.id, ignoredAt: now, ignoreReason },
    });

    if (updated.count === 1) {
      await prisma.auditEvent.create({
        data: {
          eventType: 'duplicate_candidate.ignored',
          actorUserId: session.user.id,
          payload: {
            candidateId: candidate.id,
            assetUuidA: candidate.assetUuidA,
            assetUuidB: candidate.assetUuidB,
            ignoreReason,
          },
        },
      });
    }

    return actionOk({ candidateId: candidate.id, status: 'ignored', ignoredAt: now.toISOString(), ignoreReason });
  } catch (err) {
    return actionError(getActionErrorMessage(err, 'Ignore failed'));
  }
}
