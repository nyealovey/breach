import { z } from 'zod/v4';

import { requireAdmin } from '@/lib/auth/require-admin';
import { decryptJson } from '@/lib/crypto/aes-gcm';
import { prisma } from '@/lib/db/prisma';
import { ErrorCode } from '@/lib/errors/error-codes';
import { fail, ok } from '@/lib/http/response';
import { compressRaw } from '@/lib/ingest/raw';
import {
  buildLedgerFieldsV1FromRow,
  getLedgerFieldDbColumnV1,
  getLedgerFieldMetaV1,
  LEDGER_FIELDS_V1_DB_SELECT,
  normalizeLedgerFieldValueV1,
  summarizeLedgerValue,
} from '@/lib/ledger/ledger-fields-v1';
import { createSwisClient } from '@/lib/solarwinds/swis-client';
import { Prisma } from '@prisma/client';

import type { LedgerFieldKey } from '@/lib/ledger/ledger-fields-v1';

function cleanString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toBooleanValue(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value === 1) return true;
    if (value === 0) return false;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true' || normalized === '1') return true;
    if (normalized === 'false' || normalized === '0') return false;
  }
  return undefined;
}

function coerceTimeoutMs(value: unknown, defaultMs: number): number {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return Math.trunc(value);
  return defaultMs;
}

function parseSwisDateToIso(value: unknown): string | null {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString();
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    const d = new Date(value);
    return Number.isFinite(d.getTime()) ? d.toISOString() : null;
  }
  if (typeof value !== 'string') return null;

  const trimmed = value.trim();
  if (!trimmed) return null;

  // SWIS commonly uses /Date(1700000000000)/ format.
  const m = /^\/Date\((\d+)([+-]\d{4})?\)\/$/.exec(trimmed);
  if (m) {
    const ms = Number(m[1]);
    if (!Number.isFinite(ms)) return null;
    const d = new Date(ms);
    return Number.isFinite(d.getTime()) ? d.toISOString() : null;
  }

  const d = new Date(trimmed);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

function mapMonitorStatus(raw: {
  status?: unknown;
  unmanaged?: unknown;
}): 'up' | 'down' | 'warning' | 'unmanaged' | 'unknown' {
  if (raw.unmanaged === true) return 'unmanaged';
  const status = raw.status;
  if (typeof status === 'number') {
    if (status === 1) return 'up';
    if (status === 2) return 'down';
    if (status === 3) return 'warning';
  }
  if (typeof status === 'string') {
    const s = status.trim().toLowerCase();
    if (s === 'up') return 'up';
    if (s === 'down') return 'down';
    if (s === 'warning') return 'warning';
    if (s === 'unmanaged') return 'unmanaged';
  }
  return 'unknown';
}

type NodeCandidate = {
  nodeId: string;
  caption: string | null;
  sysName: string | null;
  dns: string | null;
  ipAddress: string | null;
  machineType: string | null;
  status: number | string | null;
  statusDescription: string | null;
  unmanaged: boolean | null;
  lastSyncIso: string | null;
};

const SOLARWINDS_LEDGER_SOURCE_MAPPING: ReadonlyArray<{ sourceKey: string; ledgerKey: LedgerFieldKey }> = [
  { sourceKey: 'CITY', ledgerKey: 'region' },
  { sourceKey: 'CLASSIFICATION', ledgerKey: 'systemLevel' },
  { sourceKey: 'DEPARTMENT', ledgerKey: 'company' },
  { sourceKey: 'RES_APP', ledgerKey: 'systemCategory' },
  { sourceKey: 'POC_DEP', ledgerKey: 'department' },
  { sourceKey: 'POC_NAME', ledgerKey: 'bizOwner' },
] as const;

function normalizeSolarWindsCustomPropertyKey(key: string): string {
  return key.toUpperCase().replace(/\s+/g, '');
}

function extractLedgerSourceFromCustomProperties(raw: Record<string, unknown>): Record<LedgerFieldKey, string | null> {
  const values: Record<LedgerFieldKey, string | null> = {
    region: null,
    company: null,
    department: null,
    systemCategory: null,
    systemLevel: null,
    bizOwner: null,
    maintenanceDueDate: null,
    purchaseDate: null,
    bmcIp: null,
    cabinetNo: null,
    rackPosition: null,
    managementCode: null,
    fixedAssetNo: null,
  };

  const normalizedMap = new Map<string, unknown>();
  for (const [key, value] of Object.entries(raw)) {
    normalizedMap.set(normalizeSolarWindsCustomPropertyKey(key), value);
  }

  for (const mapping of SOLARWINDS_LEDGER_SOURCE_MAPPING) {
    const rawValue = normalizedMap.get(normalizeSolarWindsCustomPropertyKey(mapping.sourceKey));
    values[mapping.ledgerKey] = cleanString(rawValue);
  }

  return values;
}

function toLedgerSourceValueMap(
  fields: ReturnType<typeof buildLedgerFieldsV1FromRow>,
): Record<LedgerFieldKey, string | null> {
  return {
    region: fields.region.source,
    company: fields.company.source,
    department: fields.department.source,
    systemCategory: fields.systemCategory.source,
    systemLevel: fields.systemLevel.source,
    bizOwner: fields.bizOwner.source,
    maintenanceDueDate: fields.maintenanceDueDate.source,
    purchaseDate: fields.purchaseDate.source,
    bmcIp: fields.bmcIp.source,
    cabinetNo: fields.cabinetNo.source,
    rackPosition: fields.rackPosition.source,
    managementCode: fields.managementCode.source,
    fixedAssetNo: fields.fixedAssetNo.source,
  };
}

function toNodeCandidate(row: Record<string, unknown>): NodeCandidate | null {
  const nodeIdRaw = row.NodeID ?? row.nodeId ?? row.node_id;
  const nodeId =
    typeof nodeIdRaw === 'number' && Number.isFinite(nodeIdRaw)
      ? String(Math.trunc(nodeIdRaw))
      : cleanString(nodeIdRaw);
  if (!nodeId) return null;

  const caption = cleanString(row.Caption ?? row.caption);
  const sysName = cleanString(row.SysName ?? row.sysName ?? row.systemName);
  const dns = cleanString(row.DNS ?? row.dns);
  const ipAddress = cleanString(row.IPAddress ?? row.ipAddress ?? row.ip);
  const machineType = cleanString(row.MachineType ?? row.machineType);
  const status = (row.Status ?? row.status) as unknown;
  const statusDescription = cleanString(row.StatusDescription ?? row.statusDescription);
  const unmanagedRaw = row.UnManaged ?? row.unmanaged ?? row.unManaged;
  const unmanaged = typeof unmanagedRaw === 'boolean' ? unmanagedRaw : unmanagedRaw === null ? null : undefined;
  const lastSyncIso = parseSwisDateToIso(row.LastSync ?? row.lastSync ?? row.LastSeen ?? row.lastSeen);

  return {
    nodeId,
    caption,
    sysName,
    dns,
    ipAddress,
    machineType,
    status: status === null || status === undefined ? null : (status as any),
    statusDescription,
    unmanaged: unmanaged === undefined ? null : unmanaged,
    lastSyncIso,
  };
}

function deriveNameKeys(input: string | null): string[] {
  if (!input) return [];
  const full = input.trim().toLowerCase();
  if (!full) return [];
  const out = new Set<string>([full]);
  const dot = full.indexOf('.');
  if (dot > 0) out.add(full.slice(0, dot));
  return Array.from(out);
}

function parseIpKeys(ipText: string | null): string[] {
  if (!ipText) return [];
  const parts = ipText
    .split(',')
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const p of parts) {
    const key = p.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out.slice(0, 10);
}

function scoreCandidate(candidate: NodeCandidate, args: { ipKeys: string[]; nameKeys: string[] }) {
  const ip = candidate.ipAddress?.trim().toLowerCase() ?? '';
  const dns = candidate.dns?.trim().toLowerCase() ?? '';
  const sys = candidate.sysName?.trim().toLowerCase() ?? '';
  const cap = candidate.caption?.trim().toLowerCase() ?? '';

  let score = 0;
  const reasons: string[] = [];

  if (ip && args.ipKeys.includes(ip)) {
    score += 2;
    reasons.push('ip');
  }

  const nameHit = args.nameKeys.some((k) => k && (k === dns || k === sys || k === cap));
  if (nameHit) {
    score += 1;
    reasons.push('name');
  }

  return { score, reasons };
}

function swisErrorToAppError(err: unknown) {
  const status = typeof err === 'object' && err && 'status' in err ? (err as { status?: number }).status : undefined;
  const bodyText =
    typeof err === 'object' && err && 'bodyText' in err ? (err as { bodyText?: string }).bodyText : undefined;

  if (status === 401) {
    return {
      code: ErrorCode.SOLARWINDS_AUTH_FAILED,
      category: 'auth',
      message: 'SolarWinds authentication failed',
      retryable: false,
      redacted_context: bodyText ? { body_excerpt: bodyText.slice(0, 500) } : undefined,
    } as const;
  }
  if (status === 403) {
    return {
      code: ErrorCode.SOLARWINDS_PERMISSION_DENIED,
      category: 'permission',
      message: 'SolarWinds permission denied',
      retryable: false,
      redacted_context: bodyText ? { body_excerpt: bodyText.slice(0, 500) } : undefined,
    } as const;
  }
  if (status === 429) {
    return {
      code: ErrorCode.SOLARWINDS_RATE_LIMIT,
      category: 'rate_limit',
      message: 'SolarWinds rate limited',
      retryable: true,
      redacted_context: bodyText ? { body_excerpt: bodyText.slice(0, 500) } : undefined,
    } as const;
  }

  return {
    code: ErrorCode.SOLARWINDS_NETWORK_ERROR,
    category: 'network',
    message: 'SolarWinds request failed',
    retryable: true,
    redacted_context: {
      cause: err instanceof Error ? err.message : String(err),
      ...(status ? { status } : {}),
      ...(bodyText ? { body_excerpt: bodyText.slice(0, 500) } : {}),
    },
  } as const;
}

const BodySchema = z.object({ nodeId: z.string().min(1).optional() }).strict();

export async function POST(request: Request, context: { params: Promise<{ uuid: string }> }) {
  const auth = await requireAdmin(request);
  if (!auth.ok) return auth.response;

  const { uuid } = await context.params;

  let body: z.infer<typeof BodySchema> = {};
  try {
    const parsed = await request.json();
    body = BodySchema.parse(parsed);
  } catch {
    // treat empty/non-json body as empty
    body = {};
  }

  const asset = await prisma.asset.findUnique({
    where: { uuid },
    select: {
      uuid: true,
      status: true,
      assetType: true,
      machineNameOverride: true,
      ipOverrideText: true,
      collectedHostname: true,
      collectedVmCaption: true,
      collectedIpText: true,
    },
  });
  if (!asset) {
    return fail(
      { code: ErrorCode.CONFIG_ASSET_NOT_FOUND, category: 'config', message: 'Asset not found', retryable: false },
      404,
      { requestId: auth.requestId },
    );
  }
  if (asset.status === 'merged') {
    return fail(
      { code: ErrorCode.CONFIG_INVALID_REQUEST, category: 'config', message: 'Asset is merged', retryable: false },
      400,
      { requestId: auth.requestId },
    );
  }

  const sources = await prisma.source.findMany({
    where: { deletedAt: null, enabled: true, sourceType: 'solarwinds', role: 'signal' },
    orderBy: { createdAt: 'desc' },
    include: { credential: true },
  });
  if (sources.length === 0) return ok({ status: 'no_source' as const }, { requestId: auth.requestId });
  if (sources.length > 1) {
    return fail(
      {
        code: ErrorCode.CONFIG_INVALID_REQUEST,
        category: 'config',
        message: 'Multiple solarwinds sources found; keep only one enabled',
        retryable: false,
        redacted_context: { sourceIds: sources.map((s) => s.id).slice(0, 10) },
      },
      400,
      { requestId: auth.requestId },
    );
  }

  const source = sources[0]!;
  const configObj =
    source.config && typeof source.config === 'object' && !Array.isArray(source.config)
      ? (source.config as Record<string, unknown>)
      : {};
  const endpoint = cleanString(configObj.endpoint);
  if (!endpoint) {
    return fail(
      { code: ErrorCode.SOLARWINDS_CONFIG_INVALID, category: 'config', message: 'missing endpoint', retryable: false },
      400,
      { requestId: auth.requestId },
    );
  }

  const payloadCiphertext = source.credential?.payloadCiphertext ?? null;
  if (!payloadCiphertext) {
    return fail(
      {
        code: ErrorCode.CONFIG_INVALID_REQUEST,
        category: 'config',
        message: 'SolarWinds credential is required',
        retryable: false,
      },
      400,
      { requestId: auth.requestId },
    );
  }

  let credential: unknown;
  try {
    credential = decryptJson(payloadCiphertext);
  } catch (err) {
    return fail(
      {
        code: ErrorCode.INTERNAL_ERROR,
        category: 'unknown',
        message: 'failed to decrypt credential',
        retryable: false,
        redacted_context: { cause: err instanceof Error ? err.message : String(err) },
      },
      500,
      { requestId: auth.requestId },
    );
  }

  const username = cleanString((credential as any)?.username);
  const password = cleanString((credential as any)?.password);
  if (!username || !password) {
    return fail(
      {
        code: ErrorCode.SOLARWINDS_CONFIG_INVALID,
        category: 'config',
        message: 'missing solarwinds username/password',
        retryable: false,
      },
      400,
      { requestId: auth.requestId },
    );
  }

  const tlsVerify = toBooleanValue(configObj.tls_verify) ?? true;
  const timeoutMs = coerceTimeoutMs(configObj.timeout_ms, 60_000);
  const includeUnmanaged = toBooleanValue(configObj.include_unmanaged) ?? true;

  const client = createSwisClient({ endpoint, tlsVerify, timeoutMs, username, password });

  const selectClause =
    'NodeID, Caption, SysName, DNS, IPAddress, MachineType, Status, StatusDescription, UnManaged, LastSync';

  const queryByNodeId = async (nodeId: string): Promise<NodeCandidate | null> => {
    const swql = `SELECT TOP 1\n      ${selectClause}\n    FROM Orion.Nodes\n    WHERE NodeID = @nodeId`;
    const page = await client.query(swql, { nodeId: Number.isFinite(Number(nodeId)) ? Number(nodeId) : nodeId });
    const raw = page.results.length > 0 ? page.results[0]! : null;
    return raw ? toNodeCandidate(raw) : null;
  };

  const queryNodeCustomProperties = async (nodeId: string): Promise<Record<string, unknown> | null> => {
    const swql = 'SELECT TOP 1 * FROM Orion.NodesCustomProperties WHERE NodeID = @nodeId';
    const page = await client.query(swql, { nodeId: Number.isFinite(Number(nodeId)) ? Number(nodeId) : nodeId });
    const raw = page.results.length > 0 ? page.results[0]! : null;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    return raw;
  };

  let chosen: NodeCandidate | null = null;

  try {
    if (body.nodeId) {
      chosen = await queryByNodeId(body.nodeId);
      if (!chosen) return ok({ status: 'no_match' as const }, { requestId: auth.requestId });
    } else {
      // Prefer existing manual binding when present.
      const bound = await prisma.assetSignalLink.findFirst({
        where: { sourceId: source.id, assetUuid: asset.uuid, matchType: 'manual' },
        orderBy: { lastSeenAt: 'desc' },
        select: { externalId: true },
      });
      if (bound?.externalId) {
        chosen = await queryByNodeId(bound.externalId);
      }

      if (!chosen) {
        const nameCandidate =
          cleanString(asset.machineNameOverride) ??
          cleanString(asset.collectedHostname) ??
          (asset.assetType === 'vm' ? cleanString(asset.collectedVmCaption) : null);
        const nameKeys = Array.from(
          new Set([
            ...deriveNameKeys(cleanString(asset.machineNameOverride)),
            ...deriveNameKeys(cleanString(asset.collectedHostname)),
            ...(asset.assetType === 'vm' ? deriveNameKeys(cleanString(asset.collectedVmCaption)) : []),
          ]),
        );
        const ipText = cleanString(asset.ipOverrideText) ?? cleanString(asset.collectedIpText);
        const ipKeys = parseIpKeys(ipText);

        if (nameKeys.length === 0 && ipKeys.length === 0) {
          return ok(
            { status: 'no_match' as const, hints: { reason: 'no_identifiers' as const } },
            { requestId: auth.requestId },
          );
        }

        const parameters: Record<string, unknown> = {};
        const conditions: string[] = [];

        ipKeys.forEach((ip, idx) => {
          const key = `ip${idx}`;
          parameters[key] = ip;
          conditions.push(`IPAddress = @${key}`);
        });

        nameKeys.forEach((name, idx) => {
          const key = `name${idx}`;
          parameters[key] = name;
          conditions.push(`(DNS = @${key} OR SysName = @${key} OR Caption = @${key})`);
        });

        const where = conditions.length > 0 ? conditions.join(' OR ') : '1 = 0';
        const unmanagedFilter = includeUnmanaged ? '' : ' AND UnManaged = false';
        const swql = `SELECT TOP 20\n      ${selectClause}\n    FROM Orion.Nodes\n    WHERE (${where})${unmanagedFilter}\n    ORDER BY NodeID`;

        const page = await client.query(swql, parameters);
        const candidates = page.results.map(toNodeCandidate).filter((c): c is NodeCandidate => !!c);

        if (candidates.length === 0) {
          return ok(
            {
              status: 'no_match' as const,
              hints: { reason: 'not_found' as const, machineName: nameCandidate, ipText },
            },
            { requestId: auth.requestId },
          );
        }

        // Score and auto-pick only when top score is strictly better.
        const scored = candidates
          .map((c) => ({ c, ...scoreCandidate(c, { ipKeys, nameKeys }) }))
          .sort((a, b) => (b.score - a.score !== 0 ? b.score - a.score : a.c.nodeId.localeCompare(b.c.nodeId)));

        const best = scored[0]!;
        const second = scored[1] ?? null;
        if (!second || best.score > second.score) {
          chosen = best.c;
        } else {
          return ok(
            {
              status: 'ambiguous' as const,
              candidates: scored.map((s) => ({ ...s.c, matchScore: s.score, matchReasons: s.reasons })),
            },
            { requestId: auth.requestId },
          );
        }
      }
    }
  } catch (err) {
    const appErr = swisErrorToAppError(err);
    return fail(appErr, 502, { requestId: auth.requestId });
  }

  if (!chosen) return ok({ status: 'no_match' as const }, { requestId: auth.requestId });

  // Ensure we respect include_unmanaged=false even when explicitly selecting a node.
  if (includeUnmanaged === false && chosen.unmanaged === true) {
    return ok(
      { status: 'no_match' as const, hints: { reason: 'unmanaged_filtered' as const, nodeId: chosen.nodeId } },
      { requestId: auth.requestId },
    );
  }

  let ledgerFieldSources: Record<LedgerFieldKey, string | null> | null = null;
  const ledgerSourceSyncWarnings: Array<{ type: string; message: string; detail?: string }> = [];
  try {
    const cpRow = await queryNodeCustomProperties(chosen.nodeId);
    ledgerFieldSources = extractLedgerSourceFromCustomProperties(cpRow ?? {});
  } catch (err) {
    ledgerSourceSyncWarnings.push({
      type: 'ledger.source_sync_skipped',
      message: 'Failed to query SolarWinds custom properties',
      detail: err instanceof Error ? err.message : String(err),
    });
  }

  const now = new Date();

  // Build normalized-v1 (signal payload).
  const hostname = chosen.sysName ?? chosen.dns ?? null;
  const caption = chosen.caption ?? chosen.sysName ?? chosen.dns ?? null;
  const ip = chosen.ipAddress ?? null;
  const monitorStatus = mapMonitorStatus({ status: chosen.status, unmanaged: chosen.unmanaged });

  const normalized: Record<string, unknown> = {
    version: 'normalized-v1',
    kind: 'host',
    ...(hostname || caption
      ? {
          identity: {
            ...(hostname ? { hostname } : {}),
            ...(caption ? { caption } : {}),
          },
        }
      : {}),
    ...(ip ? { network: { ip_addresses: [ip] } } : {}),
    ...(chosen.machineType ? { os: { fingerprint: chosen.machineType } } : {}),
    attributes: {
      monitor_covered: true,
      monitor_status: monitorStatus,
      monitor_node_id: chosen.nodeId,
      ...(chosen.lastSyncIso ? { monitor_last_seen_at: chosen.lastSyncIso } : {}),
      ...(chosen.statusDescription ? { monitor_status_raw: chosen.statusDescription } : {}),
    },
  };

  const compressed = await compressRaw({
    ...chosen,
    source_id: source.id,
    asset_uuid: asset.uuid,
  });

  const externalKind = 'host' as const;
  const externalId = chosen.nodeId;

  // Prevent overwriting an existing manual binding for another asset.
  const existingLink = await prisma.assetSignalLink.findUnique({
    where: { sourceId_externalKind_externalId: { sourceId: source.id, externalKind, externalId } },
    select: { id: true, assetUuid: true, matchType: true },
  });

  if (existingLink?.matchType === 'manual' && existingLink.assetUuid && existingLink.assetUuid !== asset.uuid) {
    return fail(
      {
        code: ErrorCode.CONFIG_RESOURCE_CONFLICT,
        category: 'config',
        message: 'SolarWinds node already bound to another asset',
        retryable: false,
        redacted_context: { nodeId: externalId, assetUuid: existingLink.assetUuid },
      },
      409,
      { requestId: auth.requestId },
    );
  }

  const result = await prisma.$transaction(async (tx) => {
    const run = await tx.run.create({
      data: {
        sourceId: source.id,
        scheduleGroupId: source.scheduleGroupId,
        triggerType: 'manual',
        mode: 'collect',
        status: 'Succeeded',
        startedAt: now,
        finishedAt: now,
        stats: { assets: 1, relations: 0, inventory_complete: true, targeted: true },
        errors: [],
        warnings: [],
        errorSummary: null,
      },
      select: { id: true },
    });

    const link = await tx.assetSignalLink.upsert({
      where: { sourceId_externalKind_externalId: { sourceId: source.id, externalKind, externalId } },
      update: {
        asset: { connect: { uuid: asset.uuid } },
        lastSeenAt: now,
        lastSeenRun: { connect: { id: run.id } },
        matchType: 'manual',
        matchConfidence: 100,
        matchReason: 'targeted_collect',
        matchEvidence: { trigger: 'asset.solarwinds.collect' },
        ambiguous: false,
        ambiguousCandidates: Prisma.DbNull,
      },
      create: {
        source: { connect: { id: source.id } },
        asset: { connect: { uuid: asset.uuid } },
        externalKind,
        externalId,
        firstSeenAt: now,
        lastSeenAt: now,
        lastSeenRun: { connect: { id: run.id } },
        matchType: 'manual',
        matchConfidence: 100,
        matchReason: 'targeted_collect',
        matchEvidence: { trigger: 'asset.solarwinds.collect' },
        ambiguous: false,
        ambiguousCandidates: Prisma.DbNull,
      },
      select: { id: true },
    });

    await tx.signalRecord.create({
      data: {
        collectedAt: now,
        runId: run.id,
        sourceId: source.id,
        linkId: link.id,
        assetUuid: asset.uuid,
        externalKind,
        externalId,
        normalized: normalized as Prisma.InputJsonValue,
        raw: Buffer.from(compressed.bytes),
        rawCompression: compressed.compression,
        rawSizeBytes: compressed.sizeBytes,
        rawHash: compressed.hash,
        rawMimeType: compressed.mimeType,
        rawInlineExcerpt: compressed.inlineExcerpt,
      },
    });

    await tx.assetOperationalState.upsert({
      where: { assetUuid: asset.uuid },
      update: {
        monitorCovered: true,
        monitorState: monitorStatus,
        monitorStatus: chosen.statusDescription,
        monitorUpdatedAt: now,
      },
      create: {
        asset: { connect: { uuid: asset.uuid } },
        monitorCovered: true,
        monitorState: monitorStatus,
        monitorStatus: chosen.statusDescription,
        monitorUpdatedAt: now,
      },
    });

    let syncedLedgerFieldSources: Record<LedgerFieldKey, string | null> | null = null;
    const sourceSyncStatus: 'synced' | 'skipped' = ledgerFieldSources ? 'synced' : 'skipped';
    const sourceSyncReason: string | null = ledgerFieldSources ? null : 'custom_properties_query_failed';
    const sourceSyncUpdatedKeys: LedgerFieldKey[] = [];
    const sourceSyncChanges: Array<{
      key: LedgerFieldKey;
      layer: 'source';
      beforeSource: string | null;
      afterSource: string | null;
      beforeEffective: string | null;
      afterEffective: string | null;
    }> = [];

    if (ledgerFieldSources) {
      const existingLedger = await tx.assetLedgerFields.findUnique({
        where: { assetUuid: asset.uuid },
        select: LEDGER_FIELDS_V1_DB_SELECT,
      });
      const beforeFields = buildLedgerFieldsV1FromRow(existingLedger);
      const sourceUpdateData: Prisma.AssetLedgerFieldsUncheckedUpdateInput = {};
      const sourceCreateData: Prisma.AssetLedgerFieldsUncheckedCreateInput = { assetUuid: asset.uuid };

      for (const [key, rawValue] of Object.entries(ledgerFieldSources) as Array<[LedgerFieldKey, string | null]>) {
        const meta = getLedgerFieldMetaV1(key);
        if (!meta) continue;

        try {
          const normalizedSource = normalizeLedgerFieldValueV1(meta, rawValue);
          const sourceColumn = getLedgerFieldDbColumnV1(meta.key, 'source');
          sourceUpdateData[sourceColumn] = normalizedSource.dbValue as any;
          sourceCreateData[sourceColumn] = normalizedSource.dbValue as any;

          const before = beforeFields[meta.key];
          const afterSource = normalizedSource.displayValue;
          const afterEffective = before.override ?? afterSource;
          if (before.source !== afterSource) {
            sourceSyncUpdatedKeys.push(meta.key);
            sourceSyncChanges.push({
              key: meta.key,
              layer: 'source',
              beforeSource: summarizeLedgerValue(before.source),
              afterSource: summarizeLedgerValue(afterSource),
              beforeEffective: summarizeLedgerValue(before.effective),
              afterEffective: summarizeLedgerValue(afterEffective),
            });
          }
        } catch (err) {
          ledgerSourceSyncWarnings.push({
            type: 'ledger.source_sync_value_invalid',
            message: `Invalid SolarWinds value for ${meta.key}`,
            detail: err instanceof Error ? err.message : String(err),
          });
        }
      }

      const savedLedger = await tx.assetLedgerFields.upsert({
        where: { assetUuid: asset.uuid },
        create: sourceCreateData,
        update: sourceUpdateData,
        select: LEDGER_FIELDS_V1_DB_SELECT,
      });
      syncedLedgerFieldSources = toLedgerSourceValueMap(buildLedgerFieldsV1FromRow(savedLedger));
    }

    const sourceSyncAudit = await tx.auditEvent.create({
      data: {
        eventType: 'asset.ledger_fields_source_synced',
        actorUserId: auth.session.user.id,
        payload: {
          requestId: auth.requestId,
          assetUuid: asset.uuid,
          sourceId: source.id,
          runId: run.id,
          nodeId: chosen.nodeId,
          status: sourceSyncStatus,
          reason: sourceSyncReason,
          updatedKeys: sourceSyncUpdatedKeys,
          changes: sourceSyncChanges,
          warnings: ledgerSourceSyncWarnings,
        },
      },
      select: { id: true },
    });

    await tx.assetHistoryEvent.create({
      data: {
        assetUuid: asset.uuid,
        eventType: 'ledger_fields.changed',
        occurredAt: now,
        title: '台账字段来源同步',
        summary: {
          actor: { userId: auth.session.user.id, username: auth.session.user.username },
          requestId: auth.requestId,
          mode: 'source_sync',
          status: sourceSyncStatus,
          reason: sourceSyncReason,
          sourceId: source.id,
          runId: run.id,
          nodeId: chosen.nodeId,
          updatedKeys: sourceSyncUpdatedKeys,
          changes: sourceSyncChanges,
          warnings: ledgerSourceSyncWarnings,
        } as Prisma.InputJsonValue,
        refs: { auditEventId: sourceSyncAudit.id, runId: run.id, sourceId: source.id } as Prisma.InputJsonValue,
      },
    });

    return {
      runId: run.id,
      linkId: link.id,
      ledgerFieldSources: syncedLedgerFieldSources,
      sourceSyncWarnings: ledgerSourceSyncWarnings,
    };
  });

  return ok(
    {
      status: 'ok' as const,
      runId: result.runId,
      linkId: result.linkId,
      collectedAt: now.toISOString(),
      node: chosen,
      fields: {
        machineName: hostname ?? caption ?? null,
        ipText: ip,
        osText: chosen.machineType ?? null,
      },
      ledgerFieldSources: result.ledgerFieldSources,
      warnings: result.sourceSyncWarnings,
    },
    { requestId: auth.requestId },
  );
}
