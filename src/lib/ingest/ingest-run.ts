import { ErrorCode } from '@/lib/errors/error-codes';
import { validateCanonicalV1 } from '@/lib/schema/validate';
import { buildCanonicalV1 } from '@/lib/ingest/canonical';
import { compressRaw } from '@/lib/ingest/raw';
import { computeCollectChangedSummary } from '@/lib/history/collect-changed';

import type { AppError } from '@/lib/errors/error';
import type { AssetType, Prisma, PrismaClient, RelationType, RunMode } from '@prisma/client';

type CollectorAsset = {
  external_kind: AssetType;
  external_id: string;
  normalized: Record<string, unknown>;
  raw_payload: unknown;
};

type CollectorRelation = {
  type: RelationType;
  from: { external_kind: AssetType; external_id: string };
  to: { external_kind: AssetType; external_id: string };
  raw_payload: unknown;
};

function key(kind: string, id: string) {
  return `${kind}:${id}`;
}

function deriveAssetDisplayName(normalized: Record<string, unknown>): string | null {
  const identity = normalized.identity;
  if (identity && typeof identity === 'object') {
    // Prefer platform/resource name when available (e.g. VM name from vCenter), fall back to guest hostname.
    const caption = (identity as Record<string, unknown>).caption;
    if (typeof caption === 'string' && caption.trim().length > 0) return caption;
    const hostname = (identity as Record<string, unknown>).hostname;
    if (typeof hostname === 'string' && hostname.trim().length > 0) return hostname;
  }
  return null;
}

export async function ingestCollectRun(args: {
  prisma: PrismaClient;
  runId: string;
  sourceId: string;
  runMode: RunMode;
  collectedAt: Date;
  assets: CollectorAsset[];
  relations: CollectorRelation[];
}): Promise<{ ingestedAssets: number; ingestedRelations: number; warnings: unknown[] }> {
  const collectedAtIso = args.collectedAt.toISOString();
  const scopeKinds: AssetType[] =
    args.runMode === 'collect_hosts'
      ? ['host', 'cluster']
      : args.runMode === 'collect_vms'
        ? ['vm']
        : ['vm', 'host', 'cluster'];

  let compressedAssets: Array<{ asset: CollectorAsset; raw: Awaited<ReturnType<typeof compressRaw>> }>;
  let compressedRelations: Array<{ relation: CollectorRelation; raw: Awaited<ReturnType<typeof compressRaw>> }>;
  try {
    compressedAssets = await Promise.all(
      args.assets.map(async (asset) => ({
        asset,
        raw: await compressRaw(asset.raw_payload),
      })),
    );

    compressedRelations = await Promise.all(
      args.relations.map(async (relation) => ({
        relation,
        raw: await compressRaw(relation.raw_payload),
      })),
    );
  } catch (err) {
    throw {
      code: ErrorCode.RAW_PERSIST_FAILED,
      category: 'raw',
      message: 'failed to compress raw payload',
      retryable: false,
      redacted_context: { cause: err instanceof Error ? err.message : String(err) },
    } satisfies AppError;
  }

  const warnings: unknown[] = [];

  try {
    const result = await args.prisma.$transaction(async (tx) => {
      const seenExternalKeys = new Set<string>();
      const touchedAssetUuids = new Set<string>();
      const linksByExternal = new Map<
        string,
        { linkId: string; assetUuid: string; assetDisplayName: string | null; assetType: AssetType }
      >();

      const sourceRecordIdsByAssetUuid = new Map<string, string>();

      const externalLinkCache = new Map<
        string,
        { linkId: string; assetUuid: string; assetDisplayName: string | null; assetType: AssetType } | null
      >();

      const resolveLink = async (input: {
        external_kind: AssetType;
        external_id: string;
      }): Promise<{
        linkId: string;
        assetUuid: string;
        assetDisplayName: string | null;
        assetType: AssetType;
      } | null> => {
        const k = key(input.external_kind, input.external_id);

        const local = linksByExternal.get(k);
        if (local) return local;

        if (externalLinkCache.has(k)) return externalLinkCache.get(k) ?? null;

        const link = await tx.assetSourceLink.findUnique({
          where: {
            sourceId_externalKind_externalId: {
              sourceId: args.sourceId,
              externalKind: input.external_kind,
              externalId: input.external_id,
            },
          },
          include: { asset: true },
        });

        const resolved = link
          ? {
              linkId: link.id,
              assetUuid: link.assetUuid,
              assetDisplayName: link.asset.displayName,
              assetType: link.asset.assetType,
            }
          : null;

        externalLinkCache.set(k, resolved);
        return resolved;
      };

      for (const entry of compressedAssets) {
        const { asset } = entry;
        const displayName = deriveAssetDisplayName(asset.normalized);

        const link = await tx.assetSourceLink.upsert({
          where: {
            sourceId_externalKind_externalId: {
              sourceId: args.sourceId,
              externalKind: asset.external_kind,
              externalId: asset.external_id,
            },
          },
          update: {
            lastSeenAt: args.collectedAt,
            presenceStatus: 'present',
            lastSeenRun: { connect: { id: args.runId } },
            asset: {
              update: {
                lastSeenAt: args.collectedAt,
                ...(displayName ? { displayName } : {}),
              },
            },
          },
          create: {
            externalKind: asset.external_kind,
            externalId: asset.external_id,
            lastSeenAt: args.collectedAt,
            presenceStatus: 'present',
            lastSeenRun: { connect: { id: args.runId } },
            source: { connect: { id: args.sourceId } },
            asset: {
              create: {
                assetType: asset.external_kind,
                displayName,
                lastSeenAt: args.collectedAt,
              },
            },
          },
          include: { asset: true },
        });

        seenExternalKeys.add(key(asset.external_kind, asset.external_id));
        touchedAssetUuids.add(link.assetUuid);

        linksByExternal.set(key(asset.external_kind, asset.external_id), {
          linkId: link.id,
          assetUuid: link.assetUuid,
          assetDisplayName: link.asset.displayName,
          assetType: link.asset.assetType,
        });

        const record = await tx.sourceRecord.create({
          data: {
            collectedAt: args.collectedAt,
            runId: args.runId,
            sourceId: args.sourceId,
            linkId: link.id,
            assetUuid: link.assetUuid,
            externalKind: asset.external_kind,
            externalId: asset.external_id,
            normalized: asset.normalized as Prisma.InputJsonValue,
            raw: Buffer.from(entry.raw.bytes),
            rawCompression: entry.raw.compression,
            rawSizeBytes: entry.raw.sizeBytes,
            rawHash: entry.raw.hash,
            rawMimeType: entry.raw.mimeType,
            rawInlineExcerpt: entry.raw.inlineExcerpt,
          },
        });

        sourceRecordIdsByAssetUuid.set(link.assetUuid, record.id);
      }

      // Preload "previous snapshot" for collect.changed diffing (per-asset latest snapshot excluding this run).
      const snapshotAssetUuids = Array.from(sourceRecordIdsByAssetUuid.keys());
      const previousSnapshots =
        snapshotAssetUuids.length > 0
          ? await tx.assetRunSnapshot.findMany({
              where: { assetUuid: { in: snapshotAssetUuids }, runId: { not: args.runId } },
              orderBy: { createdAt: 'desc' },
              distinct: ['assetUuid'],
              select: { assetUuid: true, canonical: true },
            })
          : [];
      const previousCanonicalByAssetUuid = new Map(previousSnapshots.map((s) => [s.assetUuid, s.canonical]));

      // After a successful inventory-complete run, mark "not seen this run" links as missing (scope-limited).
      const existingLinks = await tx.assetSourceLink.findMany({
        where: { sourceId: args.sourceId, externalKind: { in: scopeKinds } },
        select: { id: true, externalKind: true, externalId: true, presenceStatus: true, assetUuid: true },
      });

      const toMissingIds: string[] = [];
      for (const l of existingLinks) {
        if (l.presenceStatus !== 'present') continue;
        if (seenExternalKeys.has(key(l.externalKind, l.externalId))) continue;
        toMissingIds.push(l.id);
        touchedAssetUuids.add(l.assetUuid);
      }

      const chunkSize = 500;
      for (let i = 0; i < toMissingIds.length; i += chunkSize) {
        const chunk = toMissingIds.slice(i, i + chunkSize);
        await tx.assetSourceLink.updateMany({
          where: { id: { in: chunk } },
          data: { presenceStatus: 'missing' },
        });
      }

      // Recompute overall asset.status based on current presence across all sourceLinks.
      // NOTE: merged status must be preserved (never overwritten by presence).
      const touched = Array.from(touchedAssetUuids);
      if (touched.length > 0) {
        const previousStatuses = await tx.asset.findMany({
          where: { uuid: { in: touched } },
          select: { uuid: true, status: true },
        });
        const prevStatusByUuid = new Map(previousStatuses.map((r) => [r.uuid, r.status]));

        const linkRows = await tx.assetSourceLink.findMany({
          where: { assetUuid: { in: touched } },
          select: { assetUuid: true, presenceStatus: true },
        });

        const anyPresent = new Map<string, boolean>();
        for (const row of linkRows) {
          if (!anyPresent.has(row.assetUuid)) anyPresent.set(row.assetUuid, false);
          if (row.presenceStatus === 'present') anyPresent.set(row.assetUuid, true);
        }

        const toInService: string[] = [];
        const toOffline: string[] = [];
        const statusEvents: Prisma.AssetHistoryEventCreateManyInput[] = [];
        for (const assetUuid of touched) {
          const before = prevStatusByUuid.get(assetUuid);
          if (!before) continue;
          if (before === 'merged') continue; // status changes must not override merged semantics

          const after = anyPresent.get(assetUuid) ? 'in_service' : 'offline';

          if (after === 'in_service') toInService.push(assetUuid);
          else toOffline.push(assetUuid);

          if (before !== after) {
            statusEvents.push({
              assetUuid,
              eventType: 'asset.status_changed',
              occurredAt: args.collectedAt,
              title: '资产状态变化',
              summary: { before, after } as Prisma.InputJsonValue,
              refs: { runId: args.runId, sourceId: args.sourceId } as Prisma.InputJsonValue,
            });
          }
        }

        for (let i = 0; i < toInService.length; i += chunkSize) {
          const chunk = toInService.slice(i, i + chunkSize);
          await tx.asset.updateMany({
            where: { uuid: { in: chunk }, status: { not: 'merged' } },
            data: { status: 'in_service' },
          });
        }
        for (let i = 0; i < toOffline.length; i += chunkSize) {
          const chunk = toOffline.slice(i, i + chunkSize);
          await tx.asset.updateMany({
            where: { uuid: { in: chunk }, status: { not: 'merged' } },
            data: { status: 'offline' },
          });
        }

        if (statusEvents.length > 0) {
          await tx.assetHistoryEvent.createMany({ data: statusEvents });
        }
      }

      const outgoingByAssetUuid = new Map<
        string,
        Array<{ type: RelationType; toUuid: string; toName: string | null; toType: AssetType }>
      >();

      let ingestedRelations = 0;
      for (const entry of compressedRelations) {
        const { relation } = entry;

        const fromLink = await resolveLink(relation.from);
        const toLink = await resolveLink(relation.to);
        if (!fromLink || !toLink) {
          warnings.push({
            type: 'relation.skipped_missing_endpoint',
            relation_type: relation.type,
            from: relation.from,
            to: relation.to,
          });
          continue;
        }

        const rel = await tx.relation.upsert({
          where: {
            relationType_fromAssetUuid_toAssetUuid_sourceId: {
              relationType: relation.type,
              fromAssetUuid: fromLink.assetUuid,
              toAssetUuid: toLink.assetUuid,
              sourceId: args.sourceId,
            },
          },
          update: { lastSeenAt: args.collectedAt, status: 'active' },
          create: {
            relationType: relation.type,
            fromAssetUuid: fromLink.assetUuid,
            toAssetUuid: toLink.assetUuid,
            sourceId: args.sourceId,
            firstSeenAt: args.collectedAt,
            lastSeenAt: args.collectedAt,
            status: 'active',
          },
        });

        await tx.relationRecord.create({
          data: {
            collectedAt: args.collectedAt,
            runId: args.runId,
            sourceId: args.sourceId,
            relationId: rel.id,
            relationType: relation.type,
            fromAssetUuid: fromLink.assetUuid,
            toAssetUuid: toLink.assetUuid,
            raw: Buffer.from(entry.raw.bytes),
            rawCompression: entry.raw.compression,
            rawSizeBytes: entry.raw.sizeBytes,
            rawHash: entry.raw.hash,
            rawMimeType: entry.raw.mimeType,
            rawInlineExcerpt: entry.raw.inlineExcerpt,
          },
        });

        const outgoing = outgoingByAssetUuid.get(fromLink.assetUuid) ?? [];
        outgoing.push({
          type: relation.type,
          toUuid: toLink.assetUuid,
          toName: toLink.assetDisplayName,
          toType: toLink.assetType,
        });
        outgoingByAssetUuid.set(fromLink.assetUuid, outgoing);

        ingestedRelations += 1;
      }

      // canonical-v1 snapshot per asset in this run (v1.0: single source, simple provenance).
      const collectChangedEvents: Prisma.AssetHistoryEventCreateManyInput[] = [];
      for (const entry of compressedAssets) {
        const { asset } = entry;
        const link = linksByExternal.get(key(asset.external_kind, asset.external_id));
        if (!link) continue;

        const recordId = sourceRecordIdsByAssetUuid.get(link.assetUuid);
        const outgoing = outgoingByAssetUuid.get(link.assetUuid) ?? [];

        const canonical = buildCanonicalV1({
          assetUuid: link.assetUuid,
          assetType: link.assetType,
          sourceId: args.sourceId,
          runId: args.runId,
          recordId,
          collectedAt: collectedAtIso,
          normalized: asset.normalized,
          outgoingRelations: outgoing.map((rel) => ({
            type: rel.type,
            to: { asset_uuid: rel.toUuid, asset_type: rel.toType, display_name: rel.toName ?? rel.toUuid },
            source_id: args.sourceId,
            last_seen_at: collectedAtIso,
          })),
        });

        const canonicalValidation = validateCanonicalV1(canonical);
        if (!canonicalValidation.ok) {
          throw {
            code: ErrorCode.SCHEMA_VALIDATION_FAILED,
            category: 'schema',
            message: 'canonical-v1 schema validation failed',
            retryable: false,
            redacted_context: { issues: canonicalValidation.issues.slice(0, 20), asset_uuid: link.assetUuid },
          } satisfies AppError;
        }

        await tx.assetRunSnapshot.create({
          data: {
            assetUuid: link.assetUuid,
            runId: args.runId,
            canonical: canonical as Prisma.InputJsonValue,
          },
        });

        const prevCanonical = previousCanonicalByAssetUuid.get(link.assetUuid) ?? null;
        if (prevCanonical) {
          const summary = computeCollectChangedSummary({
            assetType: link.assetType,
            prevCanonical,
            nextCanonical: canonical,
          });
          if (summary) {
            collectChangedEvents.push({
              assetUuid: link.assetUuid,
              eventType: 'collect.changed',
              occurredAt: args.collectedAt,
              title: '采集变化',
              summary: summary as Prisma.InputJsonValue,
              refs: { runId: args.runId, sourceId: args.sourceId } as Prisma.InputJsonValue,
            });
          }
        }
      }

      if (collectChangedEvents.length > 0) {
        await tx.assetHistoryEvent.createMany({ data: collectChangedEvents });
      }

      return { ingestedAssets: compressedAssets.length, ingestedRelations };
    });

    return { ...result, warnings };
  } catch (err) {
    if (typeof err === 'object' && err && 'code' in err && 'category' in err) {
      throw err;
    }

    throw {
      code: ErrorCode.DB_WRITE_FAILED,
      category: 'db',
      message: 'failed to ingest run',
      retryable: true,
      redacted_context: { cause: err instanceof Error ? err.message : String(err) },
    } satisfies AppError;
  }
}
