import { ErrorCode } from '@/lib/errors/error-codes';
import { validateCanonicalV1 } from '@/lib/schema/validate';
import { buildCanonicalV1 } from '@/lib/ingest/canonical';
import { compressRaw } from '@/lib/ingest/raw';

import type { AppError } from '@/lib/errors/error';
import type { AssetType, Prisma, PrismaClient, RelationType } from '@prisma/client';

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
    const hostname = (identity as Record<string, unknown>).hostname;
    if (typeof hostname === 'string' && hostname.trim().length > 0) return hostname;
    const caption = (identity as Record<string, unknown>).caption;
    if (typeof caption === 'string' && caption.trim().length > 0) return caption;
  }
  return null;
}

export async function ingestCollectRun(args: {
  prisma: PrismaClient;
  runId: string;
  sourceId: string;
  collectedAt: Date;
  assets: CollectorAsset[];
  relations: CollectorRelation[];
}): Promise<{ ingestedAssets: number; ingestedRelations: number; warnings: unknown[] }> {
  const collectedAtIso = args.collectedAt.toISOString();

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
      const linksByExternal = new Map<
        string,
        { linkId: string; assetUuid: string; assetDisplayName: string | null; assetType: AssetType }
      >();

      const sourceRecordIdsByAssetUuid = new Map<string, string>();

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

      const outgoingByAssetUuid = new Map<
        string,
        Array<{ type: RelationType; toUuid: string; toName: string | null; toType: AssetType }>
      >();

      let ingestedRelations = 0;
      for (const entry of compressedRelations) {
        const { relation } = entry;

        const fromLink = linksByExternal.get(key(relation.from.external_kind, relation.from.external_id));
        const toLink = linksByExternal.get(key(relation.to.external_kind, relation.to.external_id));
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
