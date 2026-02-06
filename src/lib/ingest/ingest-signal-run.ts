import { ErrorCode } from '@/lib/errors/error-codes';
import { compressRaw } from '@/lib/ingest/raw';
import { Prisma } from '@prisma/client';

import type { AppError } from '@/lib/errors/error';
import type { AssetType, PrismaClient, SignalMatchType, SourceType } from '@prisma/client';

type CollectorAsset = {
  external_kind: string;
  external_id: string;
  normalized: Record<string, unknown>;
  raw_payload: unknown;
};

type MatchResult =
  | {
      type: 'matched';
      assetUuid: string;
      confidence: number;
      reason: string;
      evidence: Record<string, unknown>;
    }
  | {
      type: 'ambiguous';
      candidates: Array<{ assetUuid: string; reasons: string[] }>;
      evidence: Record<string, unknown>;
    }
  | {
      type: 'unmatched';
      evidence: Record<string, unknown>;
    };

function cleanString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toAssetType(value: string): AssetType {
  if (value === 'vm' || value === 'host' || value === 'cluster') return value;
  return 'host';
}

function normalizeNameKey(input: string): string {
  return input.trim().toLowerCase();
}

function deriveNameKeys(input: string | null): string[] {
  if (!input) return [];
  const full = normalizeNameKey(input);
  if (!full) return [];
  const out = new Set<string>([full]);

  // FQDN -> short name (before first dot)
  const dot = full.indexOf('.');
  if (dot > 0) out.add(full.slice(0, dot));

  return Array.from(out);
}

function extractNormalizedIdentity(normalized: Record<string, unknown>): {
  hostname: string | null;
  caption: string | null;
} {
  const identity = normalized.identity;
  if (!identity || typeof identity !== 'object' || Array.isArray(identity)) return { hostname: null, caption: null };
  const hostname = cleanString((identity as Record<string, unknown>).hostname);
  const caption = cleanString((identity as Record<string, unknown>).caption);
  return { hostname, caption };
}

function extractNormalizedIps(normalized: Record<string, unknown>): string[] {
  const network = normalized.network;
  if (!network || typeof network !== 'object' || Array.isArray(network)) return [];
  const ips = (network as Record<string, unknown>).ip_addresses;
  if (!Array.isArray(ips)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const ip of ips) {
    const v = cleanString(ip);
    if (!v) continue;
    // IPs are case-insensitive; normalize to lower for stable matching.
    const key = v.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

type AssetIndexItem = {
  assetUuid: string;
  assetType: AssetType;
  nameKeys: string[];
  ipKeys: string[];
};

function buildAssetIndex(
  rows: Array<{
    uuid: string;
    assetType: AssetType;
    collectedHostname: string | null;
    collectedVmCaption: string | null;
    collectedIpText: string | null;
  }>,
) {
  const byNameKey = new Map<string, Set<string>>();
  const byIpKey = new Map<string, Set<string>>();
  const assetsByUuid = new Map<string, AssetIndexItem>();

  const add = (map: Map<string, Set<string>>, key: string, assetUuid: string) => {
    const set = map.get(key) ?? new Set<string>();
    set.add(assetUuid);
    map.set(key, set);
  };

  for (const row of rows) {
    const nameKeys = [...deriveNameKeys(row.collectedHostname), ...deriveNameKeys(row.collectedVmCaption)];

    const ipKeys: string[] = [];
    if (row.collectedIpText) {
      const parts = row.collectedIpText
        .split(',')
        .map((p) => p.trim())
        .filter((p) => p.length > 0);
      for (const p of parts) ipKeys.push(p.toLowerCase());
    }

    assetsByUuid.set(row.uuid, { assetUuid: row.uuid, assetType: row.assetType, nameKeys, ipKeys });

    for (const k of nameKeys) add(byNameKey, k, row.uuid);
    for (const k of ipKeys) add(byIpKey, k, row.uuid);
  }

  return { byNameKey, byIpKey, assetsByUuid };
}

function matchAsset(params: {
  normalized: Record<string, unknown>;
  assetIndex: ReturnType<typeof buildAssetIndex>;
}): MatchResult {
  const { hostname, caption } = extractNormalizedIdentity(params.normalized);
  const ips = extractNormalizedIps(params.normalized);

  const evidence: Record<string, unknown> = {
    hostname,
    caption,
    ip_addresses: ips,
  };

  const reasonsByUuid = new Map<string, Set<string>>();
  const addReason = (assetUuid: string, reason: string) => {
    const set = reasonsByUuid.get(assetUuid) ?? new Set<string>();
    set.add(reason);
    reasonsByUuid.set(assetUuid, set);
  };

  // IP matches (strong when available)
  for (const ip of ips) {
    const hit = params.assetIndex.byIpKey.get(ip);
    if (!hit) continue;
    for (const assetUuid of hit) addReason(assetUuid, 'ip');
  }

  // Name matches (supports FQDN -> short name)
  for (const key of [...deriveNameKeys(hostname), ...deriveNameKeys(caption)]) {
    const hit = params.assetIndex.byNameKey.get(key);
    if (!hit) continue;
    for (const assetUuid of hit) addReason(assetUuid, 'name');
  }

  const candidates = Array.from(reasonsByUuid.entries()).map(([assetUuid, reasons]) => ({
    assetUuid,
    reasons: Array.from(reasons),
  }));

  if (candidates.length === 0) return { type: 'unmatched', evidence };
  if (candidates.length > 1) return { type: 'ambiguous', candidates: candidates.slice(0, 50), evidence };

  const only = candidates[0]!;
  const reasons = new Set(only.reasons);
  const confidence = reasons.has('ip') && reasons.has('name') ? 95 : reasons.has('ip') ? 90 : 80;
  const reason = reasons.has('ip') && reasons.has('name') ? 'ip+name' : reasons.has('ip') ? 'ip' : 'name';

  return { type: 'matched', assetUuid: only.assetUuid, confidence, reason, evidence };
}

function extractMonitorState(normalized: Record<string, unknown>): { state: string; status: string | null } {
  const attributes = normalized.attributes;
  if (!attributes || typeof attributes !== 'object' || Array.isArray(attributes))
    return { state: 'unknown', status: null };

  const monitorStatus = cleanString((attributes as Record<string, unknown>).monitor_status);
  const monitorRaw = cleanString((attributes as Record<string, unknown>).monitor_status_raw);
  return {
    state: monitorStatus ?? 'unknown',
    status: monitorRaw,
  };
}

function chooseWorstMonitorState(states: string[]): string {
  // Higher index => "worse" (more attention needed).
  const order = ['up', 'unmanaged', 'unknown', 'warning', 'down'];
  const rank = (s: string) => {
    const idx = order.indexOf(s);
    return idx === -1 ? order.indexOf('unknown') : idx;
  };
  let worst = 'unknown';
  for (const s of states) {
    if (rank(s) > rank(worst)) worst = s;
  }
  return worst;
}

export async function ingestSignalRun(args: {
  prisma: PrismaClient;
  runId: string;
  sourceId: string;
  sourceType: SourceType;
  collectedAt: Date;
  assets: CollectorAsset[];
}): Promise<{ ingestedSignals: number; warnings: unknown[] }> {
  // Defensive: only solarwinds is supported as a signal source today.
  if (args.sourceType !== 'solarwinds') {
    throw {
      code: ErrorCode.CONFIG_INVALID_REQUEST,
      category: 'config',
      message: 'signal ingest only supported for solarwinds sources',
      retryable: false,
      redacted_context: { sourceType: args.sourceType },
    } satisfies AppError;
  }

  let compressedAssets: Array<{ asset: CollectorAsset; raw: Awaited<ReturnType<typeof compressRaw>> }>;
  try {
    compressedAssets = await Promise.all(
      args.assets.map(async (asset) => ({
        asset,
        raw: await compressRaw(asset.raw_payload),
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

  const result = await args.prisma.$transaction(async (tx) => {
    // Build a lightweight in-memory index for matching (hostname/vmName/ip).
    const assets = await tx.asset.findMany({
      where: { status: { not: 'merged' }, assetType: { in: ['vm', 'host'] } },
      select: {
        uuid: true,
        assetType: true,
        collectedHostname: true,
        collectedVmCaption: true,
        collectedIpText: true,
      },
    });

    const assetIndex = buildAssetIndex(assets);

    const coveredNow = new Set<string>();
    const monitorStatesByAssetUuid = new Map<string, { states: string[]; status: string | null }>();

    let ingestedSignals = 0;

    for (const entry of compressedAssets) {
      const { asset } = entry;

      const externalId = cleanString(asset.external_id);
      if (!externalId) {
        warnings.push({ type: 'signal.skipped_missing_external_id', external_kind: asset.external_kind });
        continue;
      }
      const externalKind = toAssetType(asset.external_kind);

      // Upsert link but do NOT overwrite match fields here (manual mappings must persist).
      const link = await tx.assetSignalLink.upsert({
        where: {
          sourceId_externalKind_externalId: {
            sourceId: args.sourceId,
            externalKind,
            externalId,
          },
        },
        update: {
          lastSeenAt: args.collectedAt,
          ambiguous: false,
          lastSeenRun: { connect: { id: args.runId } },
        },
        create: {
          source: { connect: { id: args.sourceId } },
          externalKind,
          externalId,
          firstSeenAt: args.collectedAt,
          lastSeenAt: args.collectedAt,
          ambiguous: false,
          lastSeenRun: { connect: { id: args.runId } },
        },
        select: {
          id: true,
          assetUuid: true,
          matchType: true,
        },
      });

      let assetUuid: string | null = null;
      let matchType: SignalMatchType | null = null;
      let matchConfidence: number | null = null;
      let matchReason: string | null = null;
      let matchEvidence: Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput = Prisma.DbNull;
      let ambiguous = false;
      let ambiguousCandidates: Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput = Prisma.DbNull;

      if (link.matchType === 'manual' && link.assetUuid) {
        assetUuid = link.assetUuid;
        matchType = 'manual';
        matchConfidence = 100;
        matchReason = 'manual';
      } else {
        const matched = matchAsset({ normalized: asset.normalized, assetIndex });
        matchEvidence = matched.evidence as Prisma.InputJsonValue;
        if (matched.type === 'matched') {
          assetUuid = matched.assetUuid;
          matchType = 'auto';
          matchConfidence = matched.confidence;
          matchReason = matched.reason;
        } else if (matched.type === 'ambiguous') {
          ambiguous = true;
          matchType = 'auto';
          matchConfidence = 0;
          matchReason = 'ambiguous';
          ambiguousCandidates = matched.candidates as unknown as Prisma.InputJsonValue;
          warnings.push({
            type: 'signal.ambiguous_match',
            external_kind: externalKind,
            external_id: externalId,
            candidates: matched.candidates.slice(0, 10),
          });
        } else {
          // unmatched
          warnings.push({ type: 'signal.unmatched', external_kind: externalKind, external_id: externalId });
        }
      }

      if (link.matchType !== 'manual') {
        await tx.assetSignalLink.update({
          where: { id: link.id },
          data: {
            assetUuid,
            matchType,
            matchConfidence,
            matchReason,
            matchEvidence,
            ambiguous,
            ambiguousCandidates,
          },
        });
      }

      await tx.signalRecord.create({
        data: {
          collectedAt: args.collectedAt,
          runId: args.runId,
          sourceId: args.sourceId,
          linkId: link.id,
          assetUuid,
          externalKind,
          externalId,
          normalized: asset.normalized as Prisma.InputJsonValue,
          raw: Buffer.from(entry.raw.bytes),
          rawCompression: entry.raw.compression,
          rawSizeBytes: entry.raw.sizeBytes,
          rawHash: entry.raw.hash,
          rawMimeType: entry.raw.mimeType,
          rawInlineExcerpt: entry.raw.inlineExcerpt,
        },
      });

      ingestedSignals += 1;

      if (assetUuid) {
        coveredNow.add(assetUuid);
        const monitor = extractMonitorState(asset.normalized);
        const cur = monitorStatesByAssetUuid.get(assetUuid) ?? { states: [], status: null };
        cur.states.push(monitor.state);
        // Preserve a human-readable tooltip-ish string when present.
        cur.status = cur.status ?? monitor.status;
        monitorStatesByAssetUuid.set(assetUuid, cur);
      }
    }

    // Update operational state for covered assets.
    for (const [assetUuid, state] of monitorStatesByAssetUuid.entries()) {
      const monitorState = chooseWorstMonitorState(state.states);
      await tx.assetOperationalState.upsert({
        where: { assetUuid },
        update: {
          monitorCovered: true,
          monitorState,
          monitorStatus: state.status,
          monitorUpdatedAt: args.collectedAt,
        },
        create: {
          asset: { connect: { uuid: assetUuid } },
          monitorCovered: true,
          monitorState,
          monitorStatus: state.status,
          monitorUpdatedAt: args.collectedAt,
        },
      });
    }

    // Mark previously-covered assets as not covered when no mapped node was seen in this run.
    const mapped = await tx.assetSignalLink.findMany({
      where: { sourceId: args.sourceId, assetUuid: { not: null } },
      select: { assetUuid: true, lastSeenRunId: true },
    });
    const coveredMissing = new Set<string>();
    for (const row of mapped) {
      if (!row.assetUuid) continue;
      if (row.lastSeenRunId === args.runId) continue;
      if (coveredNow.has(row.assetUuid)) continue;
      coveredMissing.add(row.assetUuid);
    }

    for (const assetUuid of coveredMissing) {
      await tx.assetOperationalState.upsert({
        where: { assetUuid },
        update: {
          monitorCovered: false,
          monitorState: 'not_covered',
          monitorStatus: null,
          monitorUpdatedAt: args.collectedAt,
        },
        create: {
          asset: { connect: { uuid: assetUuid } },
          monitorCovered: false,
          monitorState: 'not_covered',
          monitorStatus: null,
          monitorUpdatedAt: args.collectedAt,
        },
      });
    }

    return { ingestedSignals };
  });

  return { ingestedSignals: result.ingestedSignals, warnings };
}

// Expose small pure helpers for unit tests (avoid heavy prisma mocks).
export const __private__ = {
  deriveNameKeys,
  buildAssetIndex,
  matchAsset,
};
