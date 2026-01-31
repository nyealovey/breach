import { z } from 'zod/v4';

import { requireAdmin } from '@/lib/auth/require-admin';
import { prisma } from '@/lib/db/prisma';
import { ErrorCode } from '@/lib/errors/error-codes';
import { fail, ok } from '@/lib/http/response';

import type { Prisma } from '@prisma/client';

const BodySchema = z.object({
  mergedAssetUuids: z.array(z.string()).min(1),
  conflictStrategy: z.literal('primary_wins').optional(),
});

function normalizeUuidList(values: string[]): string[] {
  const out: string[] = [];
  for (const v of values) {
    if (typeof v !== 'string') continue;
    const trimmed = v.trim();
    if (!trimmed) continue;
    out.push(trimmed);
  }
  return Array.from(new Set(out));
}

export async function POST(request: Request, context: { params: Promise<{ uuid: string }> }) {
  const auth = await requireAdmin(request);
  if (!auth.ok) return auth.response;

  const { uuid: primaryAssetUuid } = await context.params;

  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await request.json());
  } catch {
    return fail(
      { code: ErrorCode.CONFIG_INVALID_REQUEST, category: 'config', message: 'Validation failed', retryable: false },
      400,
      { requestId: auth.requestId },
    );
  }

  const mergedAssetUuids = normalizeUuidList(body.mergedAssetUuids);
  if (mergedAssetUuids.length < 1 || mergedAssetUuids.includes(primaryAssetUuid)) {
    return fail(
      {
        code: ErrorCode.CONFIG_INVALID_REQUEST,
        category: 'config',
        message: 'Invalid merge request',
        retryable: false,
      },
      400,
      { requestId: auth.requestId },
    );
  }

  const conflictStrategy = body.conflictStrategy ?? 'primary_wins';

  const primary = await prisma.asset.findUnique({
    where: { uuid: primaryAssetUuid },
    select: { uuid: true, assetType: true, status: true, mergedIntoAssetUuid: true },
  });

  if (!primary) {
    return fail(
      { code: ErrorCode.CONFIG_ASSET_NOT_FOUND, category: 'config', message: 'Asset not found', retryable: false },
      404,
      { requestId: auth.requestId },
    );
  }

  if (primary.mergedIntoAssetUuid) {
    return fail(
      {
        code: ErrorCode.CONFIG_ASSET_MERGE_CYCLE_DETECTED,
        category: 'config',
        message: 'Merge cycle detected',
        retryable: false,
      },
      400,
      { requestId: auth.requestId },
    );
  }

  const mergedAssets = await prisma.asset.findMany({
    where: { uuid: { in: mergedAssetUuids } },
    select: { uuid: true, assetType: true, status: true, mergedIntoAssetUuid: true },
  });

  if (mergedAssets.length !== mergedAssetUuids.length) {
    return fail(
      { code: ErrorCode.CONFIG_ASSET_NOT_FOUND, category: 'config', message: 'Asset not found', retryable: false },
      404,
      { requestId: auth.requestId },
    );
  }

  if (mergedAssets.some((a) => a.mergedIntoAssetUuid)) {
    return fail(
      {
        code: ErrorCode.CONFIG_ASSET_MERGE_CYCLE_DETECTED,
        category: 'config',
        message: 'Merge cycle detected',
        retryable: false,
      },
      400,
      { requestId: auth.requestId },
    );
  }

  if (mergedAssets.some((a) => a.assetType !== primary.assetType)) {
    return fail(
      {
        code: ErrorCode.CONFIG_ASSET_MERGE_ASSET_TYPE_MISMATCH,
        category: 'config',
        message: 'Asset type mismatch',
        retryable: false,
      },
      400,
      { requestId: auth.requestId },
    );
  }

  if (primary.assetType === 'vm') {
    const primaryOk = primary.status === 'in_service';
    const allMergedOffline = mergedAssets.every((a) => a.status === 'offline');
    if (!primaryOk || !allMergedOffline) {
      return fail(
        {
          code: ErrorCode.CONFIG_ASSET_MERGE_VM_REQUIRES_OFFLINE,
          category: 'config',
          message: 'VM merge requires primary in_service and secondary offline',
          retryable: false,
        },
        400,
        { requestId: auth.requestId },
      );
    }
  }

  if (primary.status === 'merged' || mergedAssets.some((a) => a.status === 'merged')) {
    return fail(
      { code: ErrorCode.CONFIG_INVALID_REQUEST, category: 'config', message: 'Asset already merged', retryable: false },
      400,
      { requestId: auth.requestId },
    );
  }

  const mergedSet = new Set<string>(mergedAssetUuids);
  const involved = [primaryAssetUuid, ...mergedAssetUuids];

  const result = await prisma.$transaction(async (tx) => {
    const now = new Date();

    const assetsUpdated = await tx.asset.updateMany({
      where: { uuid: { in: mergedAssetUuids } },
      data: { status: 'merged', mergedIntoAssetUuid: primaryAssetUuid },
    });

    const sourceLinksMoved = await tx.assetSourceLink.updateMany({
      where: { assetUuid: { in: mergedAssetUuids } },
      data: { assetUuid: primaryAssetUuid },
    });

    const sourceRecordsMoved = await tx.sourceRecord.updateMany({
      where: { assetUuid: { in: mergedAssetUuids } },
      data: { assetUuid: primaryAssetUuid },
    });

    const relations = await tx.relation.findMany({
      where: { OR: [{ fromAssetUuid: { in: mergedAssetUuids } }, { toAssetUuid: { in: mergedAssetUuids } }] },
      select: {
        id: true,
        relationType: true,
        fromAssetUuid: true,
        toAssetUuid: true,
        sourceId: true,
      },
    });

    let relationsRewrittenCount = 0;
    let dedupedRelationsCount = 0;
    for (const rel of relations) {
      const nextFrom = mergedSet.has(rel.fromAssetUuid) ? primaryAssetUuid : rel.fromAssetUuid;
      const nextTo = mergedSet.has(rel.toAssetUuid) ? primaryAssetUuid : rel.toAssetUuid;

      if (nextFrom === nextTo) {
        await tx.relation.delete({ where: { id: rel.id } });
        dedupedRelationsCount += 1;
        continue;
      }

      if (nextFrom === rel.fromAssetUuid && nextTo === rel.toAssetUuid) continue;

      try {
        await tx.relation.update({
          where: { id: rel.id },
          data: { fromAssetUuid: nextFrom, toAssetUuid: nextTo },
        });
        relationsRewrittenCount += 1;
      } catch {
        // Unique conflict or other issues -> keep the existing row and drop this duplicate.
        await tx.relation.delete({ where: { id: rel.id } });
        dedupedRelationsCount += 1;
      }
    }

    const candidatesUpdated = await tx.duplicateCandidate.updateMany({
      where: { OR: [{ assetUuidA: { in: involved } }, { assetUuidB: { in: involved } }] },
      data: { status: 'merged' },
    });

    const mergeAuditIds: string[] = [];
    for (const mergedAssetUuid of mergedAssetUuids) {
      const audit = await tx.mergeAudit.create({
        data: {
          primaryAssetUuid,
          mergedAssetUuid,
          performedByUserId: auth.session.user.id,
          performedAt: now,
          conflictStrategy,
          summary: {
            requestId: auth.requestId,
            primaryAssetUuid,
            mergedAssetUuids,
            conflictStrategy,
            migrated: {
              assetsUpdatedCount: assetsUpdated.count,
              sourceLinksMovedCount: sourceLinksMoved.count,
              sourceRecordsMovedCount: sourceRecordsMoved.count,
              relationsRewrittenCount,
              dedupedRelationsCount,
              duplicateCandidatesUpdatedCount: candidatesUpdated.count,
            },
          },
        },
        select: { id: true },
      });
      mergeAuditIds.push(audit.id);
    }

    await tx.auditEvent.create({
      data: {
        eventType: 'asset.merged',
        actorUserId: auth.session.user.id,
        payload: {
          requestId: auth.requestId,
          primaryAssetUuid,
          mergedAssetUuids,
          conflictStrategy,
          migrated: {
            assetsUpdatedCount: assetsUpdated.count,
            sourceLinksMovedCount: sourceLinksMoved.count,
            sourceRecordsMovedCount: sourceRecordsMoved.count,
            relationsRewrittenCount,
            dedupedRelationsCount,
            duplicateCandidatesUpdatedCount: candidatesUpdated.count,
          },
          mergeAuditIds,
        },
      },
    });

    await tx.assetHistoryEvent.create({
      data: {
        assetUuid: primaryAssetUuid,
        eventType: 'asset.merged',
        occurredAt: now,
        title: '资产合并',
        summary: {
          actor: { userId: auth.session.user.id, username: auth.session.user.username },
          requestId: auth.requestId,
          primaryAssetUuid,
          mergedAssetUuids,
          conflictStrategy,
          mergeAuditIds,
        } as Prisma.InputJsonValue,
        refs: { mergeAuditIds } as Prisma.InputJsonValue,
      },
    });

    return {
      primaryAssetUuid,
      mergedAssetUuids,
      conflictStrategy,
      mergeAuditIds,
      migrated: {
        assetsUpdatedCount: assetsUpdated.count,
        sourceLinksMovedCount: sourceLinksMoved.count,
        sourceRecordsMovedCount: sourceRecordsMoved.count,
        relationsRewrittenCount,
        dedupedRelationsCount,
        duplicateCandidatesUpdatedCount: candidatesUpdated.count,
      },
    };
  });

  return ok(result, { requestId: auth.requestId });
}
