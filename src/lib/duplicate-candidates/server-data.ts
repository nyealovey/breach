import 'server-only';

import { findRunsOnHost } from '@/lib/assets/asset-relation-chain';
import { prisma } from '@/lib/db/prisma';
import { buildPagination } from '@/lib/http/pagination';
import {
  buildDuplicateCandidatesUrlSearchParams,
  parseDuplicateCandidatesUrlState,
} from '@/lib/duplicate-candidates/duplicate-candidates-url';

import type { RelationRef } from '@/lib/assets/asset-relation-chain';

import type {
  DuplicateCandidateDetail,
  DuplicateCandidateListItem,
  DuplicateCandidatePageInitialData,
  DuplicateCandidatesPageInitialData,
  DuplicateCandidateSourceLink,
} from './page-data';

function confidenceLabel(score: number): 'High' | 'Medium' {
  return score >= 90 ? 'High' : 'Medium';
}

function emptyCandidatePageData(candidateId: string): DuplicateCandidatePageInitialData {
  return {
    candidateId,
    candidate: null,
    loadError: null,
    canonicalFields: { assetA: null, assetB: null, error: null },
    vmHosts: { assetA: null, assetB: null },
  };
}

function emptyCandidateListPageData(): DuplicateCandidatesPageInitialData {
  const urlState = parseDuplicateCandidatesUrlState(new URLSearchParams());
  return {
    urlState,
    queryString: buildDuplicateCandidatesUrlSearchParams(urlState).toString(),
    list: null,
    loadError: null,
  };
}

function toUrlSearchParams(input: Record<string, string | string[] | undefined>): URLSearchParams {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(input)) {
    if (typeof value === 'string') {
      params.set(key, value);
      continue;
    }

    if (Array.isArray(value) && typeof value[0] === 'string') {
      params.set(key, value[0]);
    }
  }

  return params;
}

function readCanonicalFields(canonical: unknown): unknown | null {
  if (!canonical || typeof canonical !== 'object' || Array.isArray(canonical)) return null;
  const fields = (canonical as Record<string, unknown>).fields;
  return fields ?? null;
}

async function readActiveRelations(assetUuid: string): Promise<RelationRef[]> {
  const relations = await prisma.relation.findMany({
    where: { fromAssetUuid: assetUuid, status: 'active' },
    orderBy: { lastSeenAt: 'desc' },
    take: 200,
    include: { toAsset: { select: { uuid: true, assetType: true, displayName: true } } },
  });

  return relations.map((relation) => ({
    relationType: relation.relationType,
    toAssetUuid: relation.toAssetUuid,
    toAssetType: relation.toAsset?.assetType ?? null,
    toDisplayName: relation.toAsset?.displayName ?? null,
  }));
}

function toCandidateDetail(
  candidate: {
    id: string;
    status: 'open' | 'ignored' | 'merged';
    score: number;
    reasons: unknown;
    createdAt: Date;
    updatedAt: Date;
    lastObservedAt: Date;
    ignoredByUserId: string | null;
    ignoredAt: Date | null;
    ignoreReason: string | null;
    assetA: { uuid: string; assetType: string; status: string; displayName: string | null; lastSeenAt: Date | null };
    assetB: { uuid: string; assetType: string; status: string; displayName: string | null; lastSeenAt: Date | null };
  },
  linksByAssetUuid: Map<string, DuplicateCandidateSourceLink[]>,
): DuplicateCandidateDetail | null {
  if (candidate.assetA.assetType !== 'vm' && candidate.assetA.assetType !== 'host') return null;
  if (candidate.assetB.assetType !== 'vm' && candidate.assetB.assetType !== 'host') return null;

  return {
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
            ignoredByUserId: candidate.ignoredByUserId,
            ignoredAt: candidate.ignoredAt?.toISOString() ?? null,
            ignoreReason: candidate.ignoreReason,
          }
        : null,
    assetA: {
      assetUuid: candidate.assetA.uuid,
      assetType: candidate.assetA.assetType,
      status: candidate.assetA.status,
      displayName: candidate.assetA.displayName,
      lastSeenAt: candidate.assetA.lastSeenAt?.toISOString() ?? null,
      sourceLinks: linksByAssetUuid.get(candidate.assetA.uuid) ?? [],
    },
    assetB: {
      assetUuid: candidate.assetB.uuid,
      assetType: candidate.assetB.assetType,
      status: candidate.assetB.status,
      displayName: candidate.assetB.displayName,
      lastSeenAt: candidate.assetB.lastSeenAt?.toISOString() ?? null,
      sourceLinks: linksByAssetUuid.get(candidate.assetB.uuid) ?? [],
    },
  };
}

export async function readDuplicateCandidatesListInitialData(
  searchParamsInput: Record<string, string | string[] | undefined>,
): Promise<DuplicateCandidatesPageInitialData> {
  const base = emptyCandidateListPageData();
  const searchParams = toUrlSearchParams(searchParamsInput);
  const urlState = parseDuplicateCandidatesUrlState(searchParams);
  const queryString = buildDuplicateCandidatesUrlSearchParams(urlState).toString();

  const where: Record<string, unknown> = { status: urlState.status };
  if (urlState.assetType) {
    where.assetA = { assetType: urlState.assetType };
  }
  if (urlState.confidence === 'High') {
    where.score = { gte: 90 };
  } else if (urlState.confidence === 'Medium') {
    where.score = { gte: 70, lt: 90 };
  }

  const skip = (urlState.page - 1) * urlState.pageSize;
  const take = urlState.pageSize;

  try {
    const [total, items] = await prisma.$transaction([
      prisma.duplicateCandidate.count({ where: where as any }),
      prisma.duplicateCandidate.findMany({
        where: where as any,
        orderBy: [{ lastObservedAt: 'desc' }, { score: 'desc' }],
        skip,
        take,
        include: {
          assetA: { select: { uuid: true, displayName: true, assetType: true, status: true, lastSeenAt: true } },
          assetB: { select: { uuid: true, displayName: true, assetType: true, status: true, lastSeenAt: true } },
        },
      }),
    ]);

    const listItems = items.map((candidate) => ({
      candidateId: candidate.id,
      status: candidate.status,
      score: candidate.score,
      confidence: confidenceLabel(candidate.score),
      lastObservedAt: candidate.lastObservedAt.toISOString(),
      assetA: {
        assetUuid: candidate.assetA.uuid,
        assetType: candidate.assetA.assetType,
        status: candidate.assetA.status,
        displayName: candidate.assetA.displayName ?? null,
        lastSeenAt: candidate.assetA.lastSeenAt ? candidate.assetA.lastSeenAt.toISOString() : null,
      },
      assetB: {
        assetUuid: candidate.assetB.uuid,
        assetType: candidate.assetB.assetType,
        status: candidate.assetB.status,
        displayName: candidate.assetB.displayName ?? null,
        lastSeenAt: candidate.assetB.lastSeenAt ? candidate.assetB.lastSeenAt.toISOString() : null,
      },
    })) as DuplicateCandidateListItem[];

    return {
      urlState,
      queryString,
      list: {
        items: listItems,
        pagination: buildPagination(total as number, urlState.page, urlState.pageSize),
      },
      loadError: null,
    };
  } catch {
    return {
      ...base,
      urlState,
      queryString,
      loadError: '加载失败，请稍后重试。',
    };
  }
}

export async function readDuplicateCandidatePageInitialData(
  candidateIdInput: string,
): Promise<DuplicateCandidatePageInitialData> {
  const candidateId = candidateIdInput.trim();
  const base = emptyCandidatePageData(candidateId);

  if (!candidateId) {
    return { ...base, loadError: '候选不存在或无权限访问。' };
  }

  try {
    const candidate = await prisma.duplicateCandidate.findUnique({
      where: { id: candidateId },
      include: {
        assetA: { select: { uuid: true, displayName: true, assetType: true, status: true, lastSeenAt: true } },
        assetB: { select: { uuid: true, displayName: true, assetType: true, status: true, lastSeenAt: true } },
      },
    });

    if (!candidate) return { ...base, loadError: '候选不存在或无权限访问。' };

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

    const linksByAssetUuid = new Map<string, DuplicateCandidateSourceLink[]>();
    for (const link of links) {
      const next = linksByAssetUuid.get(link.assetUuid) ?? [];
      next.push({
        sourceId: link.sourceId,
        sourceName: link.source.name,
        externalKind: link.externalKind,
        externalId: link.externalId,
        presenceStatus: link.presenceStatus,
        lastSeenAt: link.lastSeenAt.toISOString(),
        lastSeenRunId: link.lastSeenRunId ?? null,
      });
      linksByAssetUuid.set(link.assetUuid, next);
    }

    const detail = toCandidateDetail(candidate, linksByAssetUuid);
    if (!detail) {
      return { ...base, loadError: '候选资产类型不受支持。' };
    }

    const data: DuplicateCandidatePageInitialData = {
      ...base,
      candidate: detail,
      loadError: null,
    };

    try {
      const [assetA, assetB] = await Promise.all([
        prisma.assetRunSnapshot.findFirst({
          where: { assetUuid: detail.assetA.assetUuid },
          orderBy: { createdAt: 'desc' },
          select: { canonical: true },
        }),
        prisma.assetRunSnapshot.findFirst({
          where: { assetUuid: detail.assetB.assetUuid },
          orderBy: { createdAt: 'desc' },
          select: { canonical: true },
        }),
      ]);

      data.canonicalFields = {
        assetA: readCanonicalFields(assetA?.canonical),
        assetB: readCanonicalFields(assetB?.canonical),
        error: null,
      };
    } catch {
      data.canonicalFields = {
        assetA: null,
        assetB: null,
        error: '加载 canonical 快照失败（不影响使用）。',
      };
    }

    if (detail.assetA.assetType === 'vm' && detail.assetB.assetType === 'vm') {
      try {
        const [relationsA, relationsB] = await Promise.all([
          readActiveRelations(detail.assetA.assetUuid),
          readActiveRelations(detail.assetB.assetUuid),
        ]);

        data.vmHosts = {
          assetA: findRunsOnHost(relationsA),
          assetB: findRunsOnHost(relationsB),
        };
      } catch {
        data.vmHosts = { assetA: null, assetB: null };
      }
    }

    return data;
  } catch {
    return { ...base, loadError: '加载失败，请稍后重试。' };
  }
}
