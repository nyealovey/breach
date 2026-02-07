import { bootstrapAdmin } from '@/lib/auth/bootstrap-admin';
import { encryptJson } from '@/lib/crypto/aes-gcm';
import { prisma } from '@/lib/db/prisma';
import { buildCanonicalV1 } from '@/lib/ingest/canonical';
import { compressRaw } from '@/lib/ingest/raw';
import { Prisma, SourceRole, SourceType } from '@prisma/client';

import type {
  Agent,
  Asset,
  AssetType,
  Relation,
  RelationStatus,
  Run,
  RunStatus,
  ScheduleGroup,
  SignalMatchType,
  Source,
} from '@prisma/client';

const ALLOW_NON_LOCAL_FLAG = 'ALLOW_NON_LOCAL_DB_SEED';
const LOCAL_DB_HOSTS = new Set(['localhost', '127.0.0.1', '::1', 'host.docker.internal']);

function readDatabaseUrl(): string {
  const value = process.env.DATABASE_URL?.trim();
  if (!value) throw new Error('DATABASE_URL is required.');
  return value;
}

function extractHostname(databaseUrl: string): string | null {
  try {
    return new URL(databaseUrl).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function ensureSafeLocalDatabase(operation: string) {
  if (process.env[ALLOW_NON_LOCAL_FLAG] === 'true') return;

  const databaseUrl = readDatabaseUrl();
  const hostname = extractHostname(databaseUrl);
  if (hostname && LOCAL_DB_HOSTS.has(hostname)) return;

  throw new Error(
    `${operation} blocked: DATABASE_URL must target localhost/127.0.0.1/::1 (or host.docker.internal). ` +
      `Current host: ${hostname ?? 'invalid-url'}. ` +
      `If this is intentional, set ${ALLOW_NON_LOCAL_FLAG}=true.`,
  );
}

type SeedSource = {
  name: string;
  sourceType: SourceType;
  role: SourceRole;
  endpoint: string;
  scheduleGroupId: string | null;
  credentialId: string;
  agentId?: string | null;
  enabled: boolean;
  config: Record<string, unknown>;
};

type SeedAssetLedger = {
  regionSource?: string | null;
  regionOverride?: string | null;
  companySource?: string | null;
  companyOverride?: string | null;
  departmentSource?: string | null;
  departmentOverride?: string | null;
  systemCategorySource?: string | null;
  systemCategoryOverride?: string | null;
  systemLevelSource?: string | null;
  systemLevelOverride?: string | null;
  bizOwnerSource?: string | null;
  bizOwnerOverride?: string | null;
  maintenanceDueDateSource?: Date | null;
  maintenanceDueDateOverride?: Date | null;
  purchaseDateSource?: Date | null;
  purchaseDateOverride?: Date | null;
  bmcIpSource?: string | null;
  bmcIpOverride?: string | null;
  cabinetNoSource?: string | null;
  cabinetNoOverride?: string | null;
  rackPositionSource?: string | null;
  rackPositionOverride?: string | null;
  managementCodeSource?: string | null;
  managementCodeOverride?: string | null;
  fixedAssetNoSource?: string | null;
  fixedAssetNoOverride?: string | null;
};

type SeedAsset = {
  uuid: string;
  assetType: AssetType;
  status: 'in_service' | 'offline' | 'merged';
  displayName: string;
  machineNameOverride?: string | null;
  ipOverrideText?: string | null;
  osOverrideText?: string | null;
  collectedHostname?: string | null;
  collectedVmCaption?: string | null;
  collectedIpText?: string | null;
  machineNameVmNameMismatch?: boolean;
  mergedIntoAssetUuid?: string | null;
  createdAt: Date;
  lastSeenAt: Date;
  ledger?: SeedAssetLedger;
};

type SeedRelation = {
  id: string;
  relationType: 'runs_on' | 'member_of';
  fromUuid: string;
  toUuid: string;
  sourceId: string;
  firstSeenAt: Date;
  lastSeenAt: Date;
  status: RelationStatus;
};

type SeedSignalLink = {
  externalKind: AssetType;
  externalId: string;
  assetUuid: string | null;
  firstSeenAt: Date;
  lastSeenAt: Date;
  matchType?: SignalMatchType | null;
  matchConfidence?: number | null;
  matchReason?: string | null;
  matchEvidence?: Record<string, unknown> | null;
  ambiguous: boolean;
  ambiguousCandidates?: unknown;
};

function log(message: string, extra?: Record<string, unknown>) {
  const payload = extra ? ` ${JSON.stringify(extra)}` : '';
  console.log(`[dev-seed] ${message}${payload}`);
}

function asJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function toUuid(num: number): string {
  return `00000000-0000-0000-0000-${String(num).padStart(12, '0')}`;
}

function mustGetAsset(map: Record<string, Asset | undefined>, uuid: string): Asset {
  const asset = map[uuid];
  if (!asset) throw new Error(`seed invariant failed: missing Asset(uuid=${uuid})`);
  return asset;
}

async function ensureScheduleGroup(): Promise<ScheduleGroup> {
  const name = '[DEV] Seed Schedule Group';

  const existing = await prisma.scheduleGroup.findUnique({ where: { name } });
  if (existing) return existing;

  return prisma.scheduleGroup.create({
    data: {
      id: 'dev_seed_schedule_group',
      name,
      enabled: false,
      timezone: 'Asia/Shanghai',
      runAtHhmm: '09:30',
      maxParallelSources: 3,
    },
  });
}

async function ensureCredential(args: { id: string; name: string; type: SourceType; payload: unknown }) {
  const existing = await prisma.credential.findUnique({ where: { name: args.name } });
  if (existing) return existing;

  return prisma.credential.create({
    data: {
      id: args.id,
      name: args.name,
      type: args.type,
      payloadCiphertext: encryptJson(args.payload),
    },
  });
}

async function ensureAgent(args: {
  id: string;
  name: string;
  agentType: Agent['agentType'];
  endpoint: string;
  enabled: boolean;
  tlsVerify: boolean;
  timeoutMs: number;
}) {
  const existing = await prisma.agent.findUnique({ where: { name: args.name } });
  if (existing) return existing;

  return prisma.agent.create({
    data: {
      id: args.id,
      name: args.name,
      agentType: args.agentType,
      endpoint: args.endpoint,
      enabled: args.enabled,
      tlsVerify: args.tlsVerify,
      timeoutMs: args.timeoutMs,
    },
  });
}

async function ensureSource(args: { id: string; source: SeedSource }): Promise<Source> {
  const byId = await prisma.source.findUnique({ where: { id: args.id } });
  if (byId) return byId;

  const byName = await prisma.source.findFirst({ where: { name: args.source.name, deletedAt: null } });
  if (byName) return byName;

  return prisma.source.create({
    data: {
      id: args.id,
      name: args.source.name,
      sourceType: args.source.sourceType,
      role: args.source.role,
      enabled: args.source.enabled,
      scheduleGroupId: args.source.scheduleGroupId,
      credentialId: args.source.credentialId,
      agentId: args.source.agentId ?? null,
      config: asJson(args.source.config),
    },
  });
}

async function ensureRun(args: {
  id: string;
  source: Source;
  scheduleGroupId: string | null;
  status: RunStatus;
  createdAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
  mode: Run['mode'];
  triggerType: Run['triggerType'];
  errorSummary?: string | null;
  errors?: unknown;
  warnings?: unknown;
  stats?: unknown;
  detectResult?: unknown;
}): Promise<Run> {
  const existing = await prisma.run.findUnique({ where: { id: args.id } });
  if (existing) return existing;

  return prisma.run.create({
    data: {
      id: args.id,
      sourceId: args.source.id,
      scheduleGroupId: args.scheduleGroupId,
      triggerType: args.triggerType,
      mode: args.mode,
      status: args.status,
      createdAt: args.createdAt,
      startedAt: args.startedAt,
      finishedAt: args.finishedAt,
      errorSummary: args.errorSummary ?? null,
      ...(args.errors !== undefined ? { errors: asJson(args.errors) } : {}),
      ...(args.warnings !== undefined ? { warnings: asJson(args.warnings) } : {}),
      ...(args.stats !== undefined ? { stats: asJson(args.stats) } : {}),
      ...(args.detectResult !== undefined ? { detectResult: asJson(args.detectResult) } : {}),
    },
  });
}

async function ensureAsset(args: SeedAsset): Promise<Asset> {
  const existing = await prisma.asset.findUnique({ where: { uuid: args.uuid } });
  if (existing) return existing;

  return prisma.asset.create({
    data: {
      uuid: args.uuid,
      assetType: args.assetType,
      status: args.status,
      displayName: args.displayName,
      machineNameOverride: args.machineNameOverride ?? null,
      ipOverrideText: args.ipOverrideText ?? null,
      osOverrideText: args.osOverrideText ?? null,
      collectedHostname: args.collectedHostname ?? null,
      collectedVmCaption: args.collectedVmCaption ?? null,
      collectedIpText: args.collectedIpText ?? null,
      machineNameVmNameMismatch: args.machineNameVmNameMismatch ?? false,
      mergedIntoAssetUuid: args.mergedIntoAssetUuid ?? null,
      createdAt: args.createdAt,
      lastSeenAt: args.lastSeenAt,
    },
  });
}

async function ensureLedgerFields(assetUuid: string, ledger: SeedAssetLedger, recordedAt: Date) {
  const existing = await prisma.assetLedgerFields.findUnique({ where: { assetUuid } });
  if (existing) return existing;

  return prisma.assetLedgerFields.create({
    data: {
      assetUuid,
      regionSource: ledger.regionSource ?? null,
      regionOverride: ledger.regionOverride ?? null,
      companySource: ledger.companySource ?? null,
      companyOverride: ledger.companyOverride ?? null,
      departmentSource: ledger.departmentSource ?? null,
      departmentOverride: ledger.departmentOverride ?? null,
      systemCategorySource: ledger.systemCategorySource ?? null,
      systemCategoryOverride: ledger.systemCategoryOverride ?? null,
      systemLevelSource: ledger.systemLevelSource ?? null,
      systemLevelOverride: ledger.systemLevelOverride ?? null,
      bizOwnerSource: ledger.bizOwnerSource ?? null,
      bizOwnerOverride: ledger.bizOwnerOverride ?? null,
      maintenanceDueDateSource: ledger.maintenanceDueDateSource ?? null,
      maintenanceDueDateOverride: ledger.maintenanceDueDateOverride ?? null,
      purchaseDateSource: ledger.purchaseDateSource ?? null,
      purchaseDateOverride: ledger.purchaseDateOverride ?? null,
      bmcIpSource: ledger.bmcIpSource ?? null,
      bmcIpOverride: ledger.bmcIpOverride ?? null,
      cabinetNoSource: ledger.cabinetNoSource ?? null,
      cabinetNoOverride: ledger.cabinetNoOverride ?? null,
      rackPositionSource: ledger.rackPositionSource ?? null,
      rackPositionOverride: ledger.rackPositionOverride ?? null,
      managementCodeSource: ledger.managementCodeSource ?? null,
      managementCodeOverride: ledger.managementCodeOverride ?? null,
      fixedAssetNoSource: ledger.fixedAssetNoSource ?? null,
      fixedAssetNoOverride: ledger.fixedAssetNoOverride ?? null,
      createdAt: recordedAt,
    },
  });
}

async function ensureAssetOperationalState(args: {
  assetUuid: string;
  monitorCovered: boolean;
  monitorState: string;
  monitorStatus: string | null;
  monitorUpdatedAt: Date;
}) {
  const existing = await prisma.assetOperationalState.findUnique({ where: { assetUuid: args.assetUuid } });
  if (existing) return existing;

  return prisma.assetOperationalState.create({
    data: {
      assetUuid: args.assetUuid,
      monitorCovered: args.monitorCovered,
      monitorState: args.monitorState,
      monitorStatus: args.monitorStatus,
      monitorUpdatedAt: args.monitorUpdatedAt,
    },
  });
}

async function ensureAssetSourceLink(args: {
  asset: Asset;
  source: Source;
  externalId: string;
  firstSeenAt: Date;
  lastSeenAt: Date;
  presenceStatus: 'present' | 'missing';
  lastSeenRunId: string | null;
}) {
  const existing = await prisma.assetSourceLink.findFirst({
    where: {
      sourceId: args.source.id,
      externalKind: args.asset.assetType,
      externalId: args.externalId,
    },
  });
  if (existing) return existing;

  try {
    return await prisma.assetSourceLink.create({
      data: {
        assetUuid: args.asset.uuid,
        sourceId: args.source.id,
        externalKind: args.asset.assetType,
        externalId: args.externalId,
        firstSeenAt: args.firstSeenAt,
        lastSeenAt: args.lastSeenAt,
        presenceStatus: args.presenceStatus,
        lastSeenRunId: args.lastSeenRunId,
      },
    });
  } catch {
    const again = await prisma.assetSourceLink.findFirst({
      where: {
        sourceId: args.source.id,
        externalKind: args.asset.assetType,
        externalId: args.externalId,
      },
    });
    if (again) return again;
    throw new Error('Failed to ensure asset source link');
  }
}

async function ensureAssetSignalLink(args: { source: Source; link: SeedSignalLink; lastSeenRunId: string | null }) {
  const existing = await prisma.assetSignalLink.findFirst({
    where: {
      sourceId: args.source.id,
      externalKind: args.link.externalKind,
      externalId: args.link.externalId,
    },
  });
  if (existing) return existing;

  try {
    return await prisma.assetSignalLink.create({
      data: {
        sourceId: args.source.id,
        assetUuid: args.link.assetUuid,
        externalKind: args.link.externalKind,
        externalId: args.link.externalId,
        firstSeenAt: args.link.firstSeenAt,
        lastSeenAt: args.link.lastSeenAt,
        lastSeenRunId: args.lastSeenRunId,
        matchType: args.link.matchType ?? null,
        matchConfidence: args.link.matchConfidence ?? null,
        matchReason: args.link.matchReason ?? null,
        matchEvidence: args.link.matchEvidence ? asJson(args.link.matchEvidence) : undefined,
        ambiguous: args.link.ambiguous,
        ambiguousCandidates:
          args.link.ambiguousCandidates === undefined
            ? undefined
            : args.link.ambiguousCandidates === null
              ? Prisma.DbNull
              : asJson(args.link.ambiguousCandidates),
      },
    });
  } catch {
    const again = await prisma.assetSignalLink.findFirst({
      where: {
        sourceId: args.source.id,
        externalKind: args.link.externalKind,
        externalId: args.link.externalId,
      },
    });
    if (again) return again;
    throw new Error('Failed to ensure asset signal link');
  }
}

async function ensureRelation(args: {
  id: string;
  relationType: 'runs_on' | 'member_of';
  from: Asset;
  to: Asset;
  source: Source;
  firstSeenAt: Date;
  lastSeenAt: Date;
  status: RelationStatus;
}) {
  const existing = await prisma.relation.findFirst({
    where: {
      relationType: args.relationType,
      fromAssetUuid: args.from.uuid,
      toAssetUuid: args.to.uuid,
      sourceId: args.source.id,
    },
  });
  if (existing) return existing;

  try {
    return await prisma.relation.create({
      data: {
        id: args.id,
        relationType: args.relationType,
        fromAssetUuid: args.from.uuid,
        toAssetUuid: args.to.uuid,
        sourceId: args.source.id,
        firstSeenAt: args.firstSeenAt,
        lastSeenAt: args.lastSeenAt,
        status: args.status,
      },
    });
  } catch {
    const again = await prisma.relation.findFirst({
      where: {
        relationType: args.relationType,
        fromAssetUuid: args.from.uuid,
        toAssetUuid: args.to.uuid,
        sourceId: args.source.id,
      },
    });
    if (again) return again;
    throw new Error('Failed to ensure relation');
  }
}

async function ensureSourceRecord(args: {
  id: string;
  collectedAt: Date;
  run: Run;
  source: Source;
  linkId: string;
  asset: Asset;
  externalId: string;
  normalized: Record<string, unknown>;
}) {
  const existing = await prisma.sourceRecord.findFirst({ where: { id: args.id }, select: { id: true } });
  if (existing) return existing;

  const raw = await compressRaw(args.normalized);

  return prisma.sourceRecord.create({
    data: {
      id: args.id,
      collectedAt: args.collectedAt,
      runId: args.run.id,
      sourceId: args.source.id,
      linkId: args.linkId,
      assetUuid: args.asset.uuid,
      externalKind: args.asset.assetType,
      externalId: args.externalId,
      normalized: asJson(args.normalized),
      raw: Buffer.from(raw.bytes),
      rawCompression: raw.compression,
      rawSizeBytes: raw.sizeBytes,
      rawHash: raw.hash,
      rawMimeType: raw.mimeType,
      rawInlineExcerpt: raw.inlineExcerpt,
    },
  });
}

async function ensureSignalRecord(args: {
  id: string;
  collectedAt: Date;
  run: Run;
  source: Source;
  linkId: string;
  assetUuid: string | null;
  externalKind: AssetType;
  externalId: string;
  normalized: Record<string, unknown>;
}) {
  const existing = await prisma.signalRecord.findFirst({ where: { id: args.id }, select: { id: true } });
  if (existing) return existing;

  const raw = await compressRaw(args.normalized);

  return prisma.signalRecord.create({
    data: {
      id: args.id,
      collectedAt: args.collectedAt,
      runId: args.run.id,
      sourceId: args.source.id,
      linkId: args.linkId,
      assetUuid: args.assetUuid,
      externalKind: args.externalKind,
      externalId: args.externalId,
      normalized: asJson(args.normalized),
      raw: Buffer.from(raw.bytes),
      rawCompression: raw.compression,
      rawSizeBytes: raw.sizeBytes,
      rawHash: raw.hash,
      rawMimeType: raw.mimeType,
      rawInlineExcerpt: raw.inlineExcerpt,
    },
  });
}

async function ensureRelationRecord(args: {
  id: string;
  collectedAt: Date;
  run: Run;
  source: Source;
  relation: Relation;
  rawPayload: Record<string, unknown>;
}) {
  const existing = await prisma.relationRecord.findFirst({ where: { id: args.id }, select: { id: true } });
  if (existing) return existing;

  const raw = await compressRaw(args.rawPayload);

  return prisma.relationRecord.create({
    data: {
      id: args.id,
      collectedAt: args.collectedAt,
      runId: args.run.id,
      sourceId: args.source.id,
      relationId: args.relation.id,
      relationType: args.relation.relationType,
      fromAssetUuid: args.relation.fromAssetUuid,
      toAssetUuid: args.relation.toAssetUuid,
      raw: Buffer.from(raw.bytes),
      rawCompression: raw.compression,
      rawSizeBytes: raw.sizeBytes,
      rawHash: raw.hash,
      rawMimeType: raw.mimeType,
      rawInlineExcerpt: raw.inlineExcerpt,
    },
  });
}

async function ensureSnapshot(args: { asset: Asset; run: Run; createdAt: Date; canonical: unknown }) {
  const existing = await prisma.assetRunSnapshot.findFirst({
    where: { assetUuid: args.asset.uuid, runId: args.run.id },
    select: { id: true },
  });
  if (existing) return existing;

  return prisma.assetRunSnapshot.create({
    data: {
      assetUuid: args.asset.uuid,
      runId: args.run.id,
      canonical: asJson(args.canonical),
      createdAt: args.createdAt,
    },
  });
}

async function ensureDuplicateCandidate(args: {
  id: string;
  assetUuidA: string;
  assetUuidB: string;
  score: number;
  reasons: unknown;
  status: 'open' | 'ignored' | 'merged';
  lastObservedAt: Date;
  ignoredByUserId?: string | null;
  ignoredAt?: Date | null;
  ignoreReason?: string | null;
}) {
  const existing = await prisma.duplicateCandidate.findUnique({
    where: {
      assetUuidA_assetUuidB: {
        assetUuidA: args.assetUuidA,
        assetUuidB: args.assetUuidB,
      },
    },
  });
  if (existing) return existing;

  return prisma.duplicateCandidate.create({
    data: {
      id: args.id,
      assetUuidA: args.assetUuidA,
      assetUuidB: args.assetUuidB,
      score: args.score,
      reasons: asJson(args.reasons),
      status: args.status,
      lastObservedAt: args.lastObservedAt,
      ignoredByUserId: args.ignoredByUserId ?? null,
      ignoredAt: args.ignoredAt ?? null,
      ignoreReason: args.ignoreReason ?? null,
    },
  });
}

async function ensureDuplicateCandidateJob(args: {
  id: string;
  runId: string;
  status: 'Queued' | 'Running' | 'Succeeded' | 'Failed';
  attempts: number;
  startedAt: Date | null;
  finishedAt: Date | null;
  errorSummary?: string | null;
}) {
  const existing = await prisma.duplicateCandidateJob.findUnique({ where: { runId: args.runId } });
  if (existing) return existing;

  return prisma.duplicateCandidateJob.create({
    data: {
      id: args.id,
      runId: args.runId,
      status: args.status,
      attempts: args.attempts,
      startedAt: args.startedAt,
      finishedAt: args.finishedAt,
      errorSummary: args.errorSummary ?? null,
    },
  });
}

async function ensureMergeAudit(args: {
  id: string;
  primaryAssetUuid: string;
  mergedAssetUuid: string;
  performedByUserId: string | null;
  performedAt: Date;
  conflictStrategy: 'primary_wins' | 'latest_wins' | 'manual_pick';
  summary: unknown;
  snapshotRef?: string | null;
}) {
  const existing = await prisma.mergeAudit.findUnique({ where: { id: args.id } });
  if (existing) return existing;

  return prisma.mergeAudit.create({
    data: {
      id: args.id,
      primaryAssetUuid: args.primaryAssetUuid,
      mergedAssetUuid: args.mergedAssetUuid,
      performedByUserId: args.performedByUserId,
      performedAt: args.performedAt,
      conflictStrategy: args.conflictStrategy,
      summary: asJson(args.summary),
      snapshotRef: args.snapshotRef ?? null,
    },
  });
}

async function ensureHistoryEvent(args: {
  id: string;
  assetUuid: string;
  eventType: string;
  occurredAt: Date;
  title: string;
  summary: unknown;
  refs?: unknown;
}) {
  const existing = await prisma.assetHistoryEvent.findUnique({ where: { id: args.id } });
  if (existing) return existing;

  return prisma.assetHistoryEvent.create({
    data: {
      id: args.id,
      assetUuid: args.assetUuid,
      eventType: args.eventType,
      occurredAt: args.occurredAt,
      title: args.title,
      summary: asJson(args.summary),
      refs: args.refs === undefined ? undefined : asJson(args.refs),
    },
  });
}

async function ensureAssetLedgerExport(args: {
  id: string;
  requestedByUserId: string | null;
  status: 'Queued' | 'Running' | 'Succeeded' | 'Failed' | 'Expired';
  requestId: string;
  params: unknown;
  rowCount?: number | null;
  fileName?: string | null;
  fileBytes?: Uint8Array | null;
  fileSha256?: string | null;
  error?: unknown;
  createdAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
  expiresAt: Date | null;
}) {
  const existing = await prisma.assetLedgerExport.findUnique({ where: { id: args.id } });
  if (existing) return existing;

  return prisma.assetLedgerExport.create({
    data: {
      id: args.id,
      requestedByUserId: args.requestedByUserId,
      status: args.status,
      requestId: args.requestId,
      params: asJson(args.params),
      rowCount: args.rowCount ?? null,
      fileName: args.fileName ?? null,
      fileSizeBytes: args.fileBytes ? args.fileBytes.byteLength : null,
      fileBytes: args.fileBytes ? Uint8Array.from(args.fileBytes) : null,
      fileSha256: args.fileSha256 ?? null,
      error: args.error === undefined ? undefined : asJson(args.error),
      createdAt: args.createdAt,
      startedAt: args.startedAt,
      finishedAt: args.finishedAt,
      expiresAt: args.expiresAt,
    },
  });
}

function vmNormalized(args: {
  hostname: string;
  caption: string;
  osName: string;
  osVersion: string;
  ipAddresses: string[];
  macAddress: string;
  cpuCount: number;
  memoryBytes: number;
  powerState: 'poweredOn' | 'poweredOff' | 'suspended';
  toolsRunning: boolean;
  diskBytes: number;
}) {
  return {
    identity: { hostname: args.hostname, caption: args.caption },
    os: { name: args.osName, version: args.osVersion },
    network: { ip_addresses: args.ipAddresses, mac_addresses: [args.macAddress] },
    hardware: {
      cpu_count: args.cpuCount,
      memory_bytes: args.memoryBytes,
      disks: [{ name: 'Hard disk 1', size_bytes: args.diskBytes, type: 'thin' }],
    },
    runtime: { power_state: args.powerState, tools_running: args.toolsRunning },
  } satisfies Record<string, unknown>;
}

function hostNormalized(args: {
  hostname: string;
  vendor: string;
  model: string;
  osName: string;
  osVersion: string;
  osFingerprint: string;
  managementIp: string;
  bmcIp: string;
  cpuThreads: number;
  cpuCount: number;
  memoryBytes: number;
  datastoreBytes: number;
}) {
  return {
    identity: { hostname: args.hostname, vendor: args.vendor, model: args.model },
    os: { name: args.osName, version: args.osVersion, fingerprint: args.osFingerprint },
    network: { management_ip: args.managementIp, bmc_ip: args.bmcIp, ip_addresses: [args.managementIp] },
    hardware: { cpu_count: args.cpuCount, memory_bytes: args.memoryBytes },
    attributes: {
      cpu_threads: args.cpuThreads,
      datastore_total_bytes: args.datastoreBytes,
      disk_total_bytes: args.datastoreBytes,
    },
    storage: {
      datastores: [
        { name: 'datastore-a', capacity_bytes: Math.floor(args.datastoreBytes * 0.65) },
        { name: 'datastore-b', capacity_bytes: Math.floor(args.datastoreBytes * 0.35) },
      ],
    },
  } satisfies Record<string, unknown>;
}

function clusterNormalized(args: { caption: string }) {
  return { identity: { caption: args.caption } } satisfies Record<string, unknown>;
}

function signalNormalized(args: {
  hostname: string;
  monitorStatus: string;
  monitorStatusRaw: string;
  vendor: string;
  model: string;
}) {
  return {
    identity: { hostname: args.hostname, vendor: args.vendor, model: args.model },
    attributes: {
      monitor_status: args.monitorStatus,
      monitor_status_raw: args.monitorStatusRaw,
      monitor_source: 'solarwinds',
    },
  } satisfies Record<string, unknown>;
}

async function main() {
  ensureSafeLocalDatabase('db:seed:dev');
  log('starting');

  const adminUser = await bootstrapAdmin();

  const scheduleGroup = await ensureScheduleGroup();

  const hypervAgent = await ensureAgent({
    id: 'dev_seed_agent_hyperv',
    name: '[DEV] Hyper-V Agent',
    agentType: 'hyperv',
    endpoint: 'https://agent-hyperv.example.com',
    enabled: true,
    tlsVerify: false,
    timeoutMs: 60_000,
  });

  const vcenterCred = await ensureCredential({
    id: 'dev_seed_cred_vcenter',
    name: '[DEV] vCenter Credential',
    type: SourceType.vcenter,
    payload: { username: 'user@example.com', password: 'dev-password' },
  });
  const hypervCred = await ensureCredential({
    id: 'dev_seed_cred_hyperv',
    name: '[DEV] Hyper-V Credential',
    type: SourceType.hyperv,
    payload: { domain: 'example', username: 'user@example.com', password: 'dev-password' },
  });
  const solarwindsCred = await ensureCredential({
    id: 'dev_seed_cred_solarwinds',
    name: '[DEV] SolarWinds Credential',
    type: SourceType.solarwinds,
    payload: { username: 'user@example.com', token: 'seed-token' },
  });

  const vcenterSource = await ensureSource({
    id: 'dev_seed_source_vcenter',
    source: {
      name: '[DEV] vCenter (mock)',
      sourceType: SourceType.vcenter,
      role: SourceRole.inventory,
      endpoint: 'https://vcenter.example.com',
      scheduleGroupId: scheduleGroup.id,
      credentialId: vcenterCred.id,
      enabled: true,
      config: {
        endpoint: 'https://vcenter.example.com',
        preferred_vcenter_version: '7.0-8.x',
        tls_verify: false,
        timeout_ms: 2000,
      },
    },
  });

  const hypervSource = await ensureSource({
    id: 'dev_seed_source_hyperv',
    source: {
      name: '[DEV] Hyper-V (mock)',
      sourceType: SourceType.hyperv,
      role: SourceRole.inventory,
      endpoint: 'https://hyperv-gateway.example.com',
      scheduleGroupId: scheduleGroup.id,
      credentialId: hypervCred.id,
      agentId: hypervAgent.id,
      enabled: true,
      config: {
        endpoint: 'https://hyperv-gateway.example.com',
        connection_method: 'agent',
        agent_url: 'https://agent-hyperv.example.com',
        agent_tls_verify: false,
        timeout_ms: 4000,
      },
    },
  });

  const solarwindsSource = await ensureSource({
    id: 'dev_seed_source_solarwinds',
    source: {
      name: '[DEV] SolarWinds (mock)',
      sourceType: SourceType.solarwinds,
      role: SourceRole.signal,
      endpoint: 'https://solarwinds.example.com',
      scheduleGroupId: null,
      credentialId: solarwindsCred.id,
      enabled: true,
      config: {
        endpoint: 'https://solarwinds.example.com',
        tls_verify: false,
        timeout_ms: 2000,
      },
    },
  });

  const now = Date.now();
  const t = {
    d10: new Date(now - 10 * 24 * 60 * 60 * 1000),
    d7: new Date(now - 7 * 24 * 60 * 60 * 1000),
    d5: new Date(now - 5 * 24 * 60 * 60 * 1000),
    d3: new Date(now - 3 * 24 * 60 * 60 * 1000),
    d2: new Date(now - 2 * 24 * 60 * 60 * 1000),
    d1: new Date(now - 1 * 24 * 60 * 60 * 1000),
    h12: new Date(now - 12 * 60 * 60 * 1000),
    h6: new Date(now - 6 * 60 * 60 * 1000),
    h2: new Date(now - 2 * 60 * 60 * 1000),
  };

  const vcenterRunOld = await ensureRun({
    id: 'dev_seed_run_vcenter_0',
    source: vcenterSource,
    scheduleGroupId: scheduleGroup.id,
    triggerType: 'manual',
    mode: 'collect',
    status: 'Succeeded',
    createdAt: t.d5,
    startedAt: t.d5,
    finishedAt: new Date(t.d5.getTime() + 35_000),
    stats: { assets: 16, relations: 14, inventoryComplete: true },
  });

  const vcenterRun = await ensureRun({
    id: 'dev_seed_run_vcenter_1',
    source: vcenterSource,
    scheduleGroupId: scheduleGroup.id,
    triggerType: 'manual',
    mode: 'collect',
    status: 'Succeeded',
    createdAt: t.d1,
    startedAt: t.d1,
    finishedAt: new Date(t.d1.getTime() + 32_000),
    stats: { assets: 20, relations: 17, inventoryComplete: true },
  });

  const hypervRun = await ensureRun({
    id: 'dev_seed_run_hyperv_1',
    source: hypervSource,
    scheduleGroupId: scheduleGroup.id,
    triggerType: 'manual',
    mode: 'collect',
    status: 'Failed',
    createdAt: t.h6,
    startedAt: t.h6,
    finishedAt: new Date(t.h6.getTime() + 14_000),
    errorSummary: 'DEV seed: mock WinRM endpoint unreachable',
    errors: [{ code: 'PLUGIN_EXEC_FAILED', message: 'mock failure', retryable: false }],
    warnings: [{ code: 'DEV_WARNING', message: 'seeded failure sample' }],
    stats: { assets: 0, relations: 0, inventoryComplete: false },
  });

  const dedupRun = await ensureRun({
    id: 'dev_seed_run_detect_1',
    source: vcenterSource,
    scheduleGroupId: scheduleGroup.id,
    triggerType: 'manual',
    mode: 'detect',
    status: 'Succeeded',
    createdAt: t.h12,
    startedAt: t.h12,
    finishedAt: new Date(t.h12.getTime() + 8_000),
    detectResult: { plugin: 'dup-rules-v1', version: '1.0.0', matched: 3 },
    stats: { candidates: 3 },
  });

  const solarwindsRun = await ensureRun({
    id: 'dev_seed_run_solarwinds_1',
    source: solarwindsSource,
    scheduleGroupId: null,
    triggerType: 'manual',
    mode: 'collect',
    status: 'Succeeded',
    createdAt: t.h2,
    startedAt: t.h2,
    finishedAt: new Date(t.h2.getTime() + 10_000),
    stats: { links: 4, matched: 2, ambiguous: 1, unmatched: 1 },
  });

  const clusterA: SeedAsset = {
    uuid: toUuid(100),
    assetType: 'cluster',
    status: 'in_service',
    displayName: 'cluster-alpha',
    createdAt: t.d10,
    lastSeenAt: t.d1,
    ledger: {
      regionSource: 'cn-shanghai',
      companySource: 'example.com',
      departmentSource: 'platform',
      systemCategorySource: 'infrastructure',
      systemLevelSource: 'L2',
      bizOwnerSource: 'ops-team',
    },
  };

  const clusterB: SeedAsset = {
    uuid: toUuid(101),
    assetType: 'cluster',
    status: 'in_service',
    displayName: 'cluster-beta',
    createdAt: t.d10,
    lastSeenAt: t.d1,
    ledger: {
      regionSource: 'us-west-2',
      companySource: 'example.net',
      departmentSource: 'ops',
      systemCategorySource: 'infrastructure',
      systemLevelSource: 'L2',
      bizOwnerSource: 'infra-team',
    },
  };

  const hostA: SeedAsset = {
    uuid: toUuid(201),
    assetType: 'host',
    status: 'in_service',
    displayName: 'esxi-alpha-01',
    ipOverrideText: '203.0.113.10',
    collectedHostname: 'esxi-alpha-01.example.com',
    collectedIpText: '192.0.2.10',
    createdAt: t.d7,
    lastSeenAt: t.d1,
    ledger: {
      regionSource: 'cn-shanghai',
      regionOverride: 'cn-shanghai-1',
      companySource: 'example.com',
      companyOverride: 'example.org',
      departmentSource: 'platform',
      departmentOverride: 'platform-core',
      systemCategorySource: 'infrastructure',
      systemCategoryOverride: 'core-infra',
      systemLevelSource: 'L1',
      systemLevelOverride: 'L0',
      bizOwnerSource: 'ops-team',
      bizOwnerOverride: 'owner-a',
      maintenanceDueDateSource: new Date('2026-06-30T00:00:00.000Z'),
      maintenanceDueDateOverride: new Date('2026-08-31T00:00:00.000Z'),
      purchaseDateSource: new Date('2024-03-10T00:00:00.000Z'),
      purchaseDateOverride: new Date('2024-03-10T00:00:00.000Z'),
      bmcIpSource: '198.51.100.21',
      bmcIpOverride: '198.51.100.31',
      cabinetNoSource: 'cab-a',
      cabinetNoOverride: 'cab-a1',
      rackPositionSource: 'U12',
      rackPositionOverride: 'U10',
      managementCodeSource: 'MGMT-HOST-A',
      managementCodeOverride: 'MGMT-HOST-A-OVR',
      fixedAssetNoSource: 'FA-1001',
      fixedAssetNoOverride: 'FA-1001-OVR',
    },
  };

  const hostB: SeedAsset = {
    uuid: toUuid(202),
    assetType: 'host',
    status: 'offline',
    displayName: 'esxi-alpha-02',
    osOverrideText: 'ESXi 7.0 U3 (override)',
    collectedHostname: 'esxi-alpha-02.example.com',
    collectedIpText: '192.0.2.20',
    createdAt: t.d7,
    lastSeenAt: t.d3,
    ledger: {
      regionSource: 'cn-shanghai',
      companySource: 'example.com',
      departmentSource: 'security',
      systemCategorySource: 'infrastructure',
      systemLevelSource: 'L2',
      bizOwnerSource: 'owner-b',
      maintenanceDueDateSource: new Date('2026-04-30T00:00:00.000Z'),
      purchaseDateSource: new Date('2023-11-01T00:00:00.000Z'),
      bmcIpSource: '198.51.100.22',
      cabinetNoSource: 'cab-a',
      rackPositionSource: 'U18',
      managementCodeSource: 'MGMT-HOST-B',
      fixedAssetNoSource: 'FA-1002',
    },
  };

  const hostC: SeedAsset = {
    uuid: toUuid(203),
    assetType: 'host',
    status: 'in_service',
    displayName: 'esxi-beta-01',
    collectedHostname: 'esxi-beta-01.example.net',
    collectedIpText: '198.51.100.60',
    createdAt: t.d7,
    lastSeenAt: t.d1,
    ledger: {
      regionSource: 'us-west-2',
      companySource: 'example.net',
      departmentSource: 'ops',
      systemCategorySource: 'infrastructure',
      systemLevelSource: 'L1',
      bizOwnerSource: 'owner-c',
      maintenanceDueDateSource: new Date('2026-05-31T00:00:00.000Z'),
      purchaseDateSource: new Date('2024-01-15T00:00:00.000Z'),
      bmcIpSource: '198.51.100.23',
      cabinetNoSource: 'cab-c',
      rackPositionSource: 'U08',
      managementCodeSource: 'MGMT-HOST-C',
      fixedAssetNoSource: 'FA-1003',
    },
  };

  const hostMerged: SeedAsset = {
    uuid: toUuid(299),
    assetType: 'host',
    status: 'merged',
    displayName: 'esxi-alpha-legacy',
    mergedIntoAssetUuid: hostA.uuid,
    collectedHostname: 'esxi-alpha-legacy.example.com',
    collectedIpText: '192.0.2.99',
    createdAt: t.d10,
    lastSeenAt: t.d5,
  };

  const vmAssets: SeedAsset[] = Array.from({ length: 12 }).map((_, index) => {
    const idx = index + 1;
    const uuid = toUuid(1000 + idx);
    const region = idx % 3 === 0 ? 'us-west-2' : idx % 2 === 0 ? 'cn-shanghai' : 'cn-beijing';
    const company = idx % 2 === 0 ? 'example.com' : 'example.net';
    const department = idx % 3 === 0 ? 'security' : idx % 3 === 1 ? 'platform' : 'devops';
    const ip = idx <= 4 ? `192.0.2.${100 + idx}` : idx <= 8 ? `198.51.100.${100 + idx}` : `203.0.113.${100 + idx}`;
    const lastSeenAt = idx === 12 ? t.d3 : t.d1;

    return {
      uuid,
      assetType: 'vm',
      status: idx === 12 ? 'offline' : 'in_service',
      displayName: `vm-app-${String(idx).padStart(2, '0')}`,
      machineNameOverride: idx === 1 ? 'vm-app-01-override.example.com' : null,
      ipOverrideText: idx === 2 ? '203.0.113.202' : null,
      osOverrideText: idx === 3 ? 'Ubuntu 22.04 LTS (override)' : null,
      collectedHostname: `guest-app-${String(idx).padStart(2, '0')}.example.com`,
      collectedVmCaption: `vm-app-${String(idx).padStart(2, '0')}`,
      collectedIpText: ip,
      machineNameVmNameMismatch: idx === 1,
      createdAt: new Date(t.d7.getTime() + idx * 30 * 60 * 1000),
      lastSeenAt,
      ledger: {
        regionSource: region,
        regionOverride: idx === 5 ? 'cn-shanghai-2' : null,
        companySource: company,
        departmentSource: department,
        systemCategorySource: idx % 2 === 0 ? 'business' : 'data-platform',
        systemLevelSource: idx % 3 === 0 ? 'L3' : 'L2',
        bizOwnerSource: idx % 3 === 0 ? 'owner-c' : idx % 2 === 0 ? 'owner-a' : 'owner-b',
      },
    };
  });

  const vmMerged: SeedAsset = {
    uuid: toUuid(1999),
    assetType: 'vm',
    status: 'merged',
    displayName: 'vm-app-legacy-01',
    mergedIntoAssetUuid: vmAssets[0]!.uuid,
    collectedHostname: 'guest-app-legacy-01.example.com',
    collectedVmCaption: 'vm-app-legacy-01',
    collectedIpText: '203.0.113.199',
    machineNameVmNameMismatch: true,
    createdAt: t.d10,
    lastSeenAt: t.d5,
  };

  const assetsSeed = [clusterA, clusterB, hostA, hostB, hostC, hostMerged, ...vmAssets, vmMerged];

  const assetsByUuid: Record<string, Asset | undefined> = {};
  for (const seed of assetsSeed) {
    const created = await ensureAsset(seed);
    assetsByUuid[seed.uuid] = created;
    if (seed.ledger) {
      const recordedAt = new Date(seed.createdAt.getTime() + 5 * 60 * 1000);
      await ensureLedgerFields(seed.uuid, seed.ledger, recordedAt);
    }
  }

  const relationSeeds: SeedRelation[] = [
    {
      id: 'dev_seed_rel_member_host_a_cluster_a',
      relationType: 'member_of',
      fromUuid: hostA.uuid,
      toUuid: clusterA.uuid,
      sourceId: vcenterSource.id,
      firstSeenAt: t.d7,
      lastSeenAt: t.d1,
      status: 'active',
    },
    {
      id: 'dev_seed_rel_member_host_b_cluster_a',
      relationType: 'member_of',
      fromUuid: hostB.uuid,
      toUuid: clusterA.uuid,
      sourceId: vcenterSource.id,
      firstSeenAt: t.d7,
      lastSeenAt: t.d3,
      status: 'inactive',
    },
    {
      id: 'dev_seed_rel_member_host_c_cluster_b',
      relationType: 'member_of',
      fromUuid: hostC.uuid,
      toUuid: clusterB.uuid,
      sourceId: vcenterSource.id,
      firstSeenAt: t.d7,
      lastSeenAt: t.d1,
      status: 'active',
    },
  ];

  for (const [index, vm] of vmAssets.entries()) {
    const hostUuid = index < 6 ? hostA.uuid : index < 10 ? hostB.uuid : hostC.uuid;
    relationSeeds.push({
      id: `dev_seed_rel_runs_on_${vm.uuid}`,
      relationType: 'runs_on',
      fromUuid: vm.uuid,
      toUuid: hostUuid,
      sourceId: vcenterSource.id,
      firstSeenAt: vm.createdAt,
      lastSeenAt: vm.lastSeenAt,
      status: vm.status === 'offline' ? 'inactive' : 'active',
    });
  }

  const relationsById = new Map<string, Relation>();
  let relationRecordsCreated = 0;
  for (const seed of relationSeeds) {
    const relation = await ensureRelation({
      id: seed.id,
      relationType: seed.relationType,
      from: mustGetAsset(assetsByUuid, seed.fromUuid),
      to: mustGetAsset(assetsByUuid, seed.toUuid),
      source: vcenterSource,
      firstSeenAt: seed.firstSeenAt,
      lastSeenAt: seed.lastSeenAt,
      status: seed.status,
    });
    relationsById.set(seed.id, relation);

    await ensureRelationRecord({
      id: `dev_seed_rel_record_${seed.id}`,
      collectedAt: seed.lastSeenAt,
      run: vcenterRun,
      source: vcenterSource,
      relation,
      rawPayload: {
        relation_type: seed.relationType,
        from_asset_uuid: seed.fromUuid,
        to_asset_uuid: seed.toUuid,
        status: seed.status,
      },
    });
    relationRecordsCreated += 1;
  }

  const activeOutgoingByAsset = new Map<string, Array<{ type: 'runs_on' | 'member_of'; toUuid: string }>>();
  for (const seed of relationSeeds) {
    if (seed.status !== 'active') continue;
    const arr = activeOutgoingByAsset.get(seed.fromUuid) ?? [];
    arr.push({ type: seed.relationType, toUuid: seed.toUuid });
    activeOutgoingByAsset.set(seed.fromUuid, arr);
  }

  const inventoryAssets = [clusterA, clusterB, hostA, hostB, hostC, ...vmAssets];
  const sourceLinks = new Map<string, { id: string; externalId: string }>();

  let sourceRecordsCreated = 0;
  let snapshotsCreated = 0;

  for (const seed of inventoryAssets) {
    const asset = mustGetAsset(assetsByUuid, seed.uuid);
    const isHost = asset.assetType === 'host';
    const isCluster = asset.assetType === 'cluster';

    const normalized = isCluster
      ? clusterNormalized({ caption: seed.displayName })
      : isHost
        ? hostNormalized({
            hostname: seed.displayName,
            vendor: seed.uuid === hostC.uuid ? 'Supermicro' : 'Dell',
            model: seed.uuid === hostC.uuid ? 'SYS-220' : 'R740',
            osName: 'ESXi',
            osVersion: seed.uuid === hostB.uuid ? '7.0.3' : '8.0.2',
            osFingerprint: seed.uuid === hostB.uuid ? '19193900' : '22380479',
            managementIp:
              seed.uuid === hostA.uuid ? '192.0.2.10' : seed.uuid === hostB.uuid ? '192.0.2.20' : '198.51.100.60',
            bmcIp:
              seed.uuid === hostA.uuid ? '198.51.100.21' : seed.uuid === hostB.uuid ? '198.51.100.22' : '198.51.100.23',
            cpuThreads: seed.uuid === hostB.uuid ? 48 : 64,
            cpuCount: seed.uuid === hostB.uuid ? 24 : 32,
            memoryBytes: seed.uuid === hostB.uuid ? 192 * 1024 ** 3 : 256 * 1024 ** 3,
            datastoreBytes: seed.uuid === hostB.uuid ? 9 * 1024 ** 4 : 14 * 1024 ** 4,
          })
        : vmNormalized({
            hostname: seed.collectedHostname ?? seed.displayName,
            caption: seed.displayName,
            osName:
              seed.uuid === vmAssets[2]!.uuid ? 'Ubuntu' : seed.uuid === vmAssets[8]!.uuid ? 'Windows' : 'Rocky Linux',
            osVersion: seed.uuid === vmAssets[2]!.uuid ? '22.04' : seed.uuid === vmAssets[8]!.uuid ? '2022' : '9.4',
            ipAddresses:
              seed.uuid === vmAssets[6]!.uuid
                ? []
                : seed.collectedIpText
                  ? seed.collectedIpText.split(',').map((item) => item.trim())
                  : [],
            macAddress: `00:50:56:aa:${String(seed.displayName.length).padStart(2, '0')}:${seed.uuid.slice(-2)}`,
            cpuCount: 2 + (Number(seed.uuid.slice(-2)) % 6),
            memoryBytes: (4 + (Number(seed.uuid.slice(-2)) % 4)) * 1024 ** 3,
            powerState: seed.status === 'offline' ? 'poweredOff' : 'poweredOn',
            toolsRunning: Number(seed.uuid.slice(-2)) % 5 !== 0,
            diskBytes: (40 + (Number(seed.uuid.slice(-2)) % 20)) * 1024 ** 3,
          });

    const link = await ensureAssetSourceLink({
      asset,
      source: vcenterSource,
      externalId: `vcenter:${seed.displayName}`,
      firstSeenAt: seed.createdAt,
      lastSeenAt: seed.lastSeenAt,
      presenceStatus: seed.status === 'offline' ? 'missing' : 'present',
      lastSeenRunId: vcenterRun.id,
    });
    sourceLinks.set(seed.uuid, { id: link.id, externalId: link.externalId });

    await ensureSourceRecord({
      id: `dev_seed_source_record_${asset.uuid}`,
      collectedAt: seed.lastSeenAt,
      run: vcenterRun,
      source: vcenterSource,
      linkId: link.id,
      asset,
      externalId: link.externalId,
      normalized,
    });
    sourceRecordsCreated += 1;

    const outgoing = (activeOutgoingByAsset.get(seed.uuid) ?? []).map((r) => {
      const toAsset = mustGetAsset(assetsByUuid, r.toUuid);
      return {
        type: r.type,
        to: {
          asset_uuid: toAsset.uuid,
          asset_type: toAsset.assetType,
          display_name: toAsset.displayName ?? toAsset.uuid,
        },
      };
    });

    const canonical = buildCanonicalV1({
      assetUuid: asset.uuid,
      assetType: asset.assetType,
      status: asset.status,
      sourceId: vcenterSource.id,
      runId: vcenterRun.id,
      collectedAt: seed.lastSeenAt.toISOString(),
      normalized,
      outgoingRelations: outgoing,
    });

    await ensureSnapshot({ asset, run: vcenterRun, createdAt: seed.lastSeenAt, canonical });
    snapshotsCreated += 1;
  }

  const mergedAssets = [hostMerged, vmMerged];
  for (const seed of mergedAssets) {
    const asset = mustGetAsset(assetsByUuid, seed.uuid);
    await ensureAssetSourceLink({
      asset,
      source: vcenterSource,
      externalId: `vcenter:${seed.displayName}`,
      firstSeenAt: seed.createdAt,
      lastSeenAt: seed.lastSeenAt,
      presenceStatus: 'missing',
      lastSeenRunId: vcenterRunOld.id,
    });
  }

  const hostCAsset = mustGetAsset(assetsByUuid, hostC.uuid);
  await ensureAssetSourceLink({
    asset: hostCAsset,
    source: hypervSource,
    externalId: `hyperv:${hostC.displayName}`,
    firstSeenAt: t.d5,
    lastSeenAt: t.d2,
    presenceStatus: 'present',
    lastSeenRunId: null,
  });

  await ensureAssetSourceLink({
    asset: mustGetAsset(assetsByUuid, vmAssets[10]!.uuid),
    source: hypervSource,
    externalId: `hyperv:${vmAssets[10]!.displayName}`,
    firstSeenAt: t.d5,
    lastSeenAt: t.d2,
    presenceStatus: 'present',
    lastSeenRunId: null,
  });

  const signalLinksSeed: SeedSignalLink[] = [
    {
      externalKind: 'host',
      externalId: 'solarwinds:node:101',
      assetUuid: hostA.uuid,
      firstSeenAt: t.d3,
      lastSeenAt: t.h2,
      matchType: 'auto',
      matchConfidence: 98,
      matchReason: 'hostname+management_ip',
      matchEvidence: { hostname: 'esxi-alpha-01.example.com', management_ip: '192.0.2.10' },
      ambiguous: false,
      ambiguousCandidates: null,
    },
    {
      externalKind: 'host',
      externalId: 'solarwinds:node:102',
      assetUuid: hostB.uuid,
      firstSeenAt: t.d2,
      lastSeenAt: t.h2,
      matchType: 'manual',
      matchConfidence: 100,
      matchReason: 'manual',
      matchEvidence: { assigned_by: 'admin' },
      ambiguous: false,
      ambiguousCandidates: null,
    },
    {
      externalKind: 'host',
      externalId: 'solarwinds:node:103',
      assetUuid: null,
      firstSeenAt: t.d2,
      lastSeenAt: t.h2,
      ambiguous: true,
      ambiguousCandidates: [
        {
          asset_uuid: hostB.uuid,
          asset_type: 'host',
          display_name: hostB.displayName,
          confidence: 84,
          reason: 'hostname_similar',
        },
        {
          asset_uuid: hostC.uuid,
          asset_type: 'host',
          display_name: hostC.displayName,
          confidence: 80,
          reason: 'ip_overlap',
        },
      ],
    },
    {
      externalKind: 'host',
      externalId: 'solarwinds:node:104',
      assetUuid: null,
      firstSeenAt: t.d1,
      lastSeenAt: t.h2,
      ambiguous: false,
      ambiguousCandidates: null,
    },
  ];

  let signalRecordsCreated = 0;
  for (const [index, seed] of signalLinksSeed.entries()) {
    const link = await ensureAssetSignalLink({
      source: solarwindsSource,
      link: seed,
      lastSeenRunId: solarwindsRun.id,
    });

    const normalized = signalNormalized({
      hostname:
        seed.externalId === 'solarwinds:node:101'
          ? 'esxi-alpha-01.example.com'
          : seed.externalId === 'solarwinds:node:102'
            ? 'esxi-alpha-02.example.com'
            : seed.externalId === 'solarwinds:node:103'
              ? 'esxi-beta-01.example.net'
              : 'unknown-host.example.org',
      monitorStatus:
        seed.externalId === 'solarwinds:node:101'
          ? 'up'
          : seed.externalId === 'solarwinds:node:102'
            ? 'down'
            : seed.externalId === 'solarwinds:node:103'
              ? 'warning'
              : 'unknown',
      monitorStatusRaw:
        seed.externalId === 'solarwinds:node:101'
          ? 'Up'
          : seed.externalId === 'solarwinds:node:102'
            ? 'Down'
            : seed.externalId === 'solarwinds:node:103'
              ? 'Warning'
              : 'Unknown',
      vendor: 'Dell',
      model: 'R740',
    });

    await ensureSignalRecord({
      id: `dev_seed_signal_record_${String(index + 1).padStart(2, '0')}`,
      collectedAt: seed.lastSeenAt,
      run: solarwindsRun,
      source: solarwindsSource,
      linkId: link.id,
      assetUuid: seed.assetUuid,
      externalKind: seed.externalKind,
      externalId: seed.externalId,
      normalized,
    });
    signalRecordsCreated += 1;
  }

  await ensureAssetOperationalState({
    assetUuid: hostA.uuid,
    monitorCovered: true,
    monitorState: 'up',
    monitorStatus: 'Up',
    monitorUpdatedAt: t.h2,
  });
  await ensureAssetOperationalState({
    assetUuid: hostB.uuid,
    monitorCovered: true,
    monitorState: 'down',
    monitorStatus: 'Down',
    monitorUpdatedAt: t.h2,
  });

  await ensureDuplicateCandidate({
    id: 'dev_seed_dup_open_1',
    assetUuidA: vmAssets[2]!.uuid,
    assetUuidB: vmAssets[8]!.uuid,
    score: 94,
    reasons: [
      { rule: 'hostname_similarity', score: 60, evidence: ['guest-app-03.example.com', 'guest-app-09.example.com'] },
      { rule: 'mac_vendor_match', score: 34, evidence: ['00:50:56'] },
    ],
    status: 'open',
    lastObservedAt: t.h12,
  });

  await ensureDuplicateCandidate({
    id: 'dev_seed_dup_ignored_1',
    assetUuidA: vmAssets[3]!.uuid,
    assetUuidB: vmAssets[9]!.uuid,
    score: 81,
    reasons: [{ rule: 'ip_overlap', score: 81, evidence: ['198.51.100.104'] }],
    status: 'ignored',
    lastObservedAt: t.d1,
    ignoredByUserId: adminUser.id,
    ignoredAt: t.h6,
    ignoreReason: 'different business domains',
  });

  await ensureDuplicateCandidate({
    id: 'dev_seed_dup_merged_1',
    assetUuidA: hostA.uuid,
    assetUuidB: hostMerged.uuid,
    score: 97,
    reasons: [
      { rule: 'serial_number_exact', score: 80, evidence: ['SN-HOST-A-0001'] },
      { rule: 'management_ip_exact', score: 17, evidence: ['192.0.2.10'] },
    ],
    status: 'merged',
    lastObservedAt: t.h12,
  });

  await ensureDuplicateCandidateJob({
    id: 'dev_seed_dup_job_1',
    runId: dedupRun.id,
    status: 'Succeeded',
    attempts: 1,
    startedAt: t.h12,
    finishedAt: new Date(t.h12.getTime() + 6_000),
  });

  await ensureMergeAudit({
    id: 'dev_seed_merge_audit_1',
    primaryAssetUuid: hostA.uuid,
    mergedAssetUuid: hostMerged.uuid,
    performedByUserId: adminUser.id,
    performedAt: t.h12,
    conflictStrategy: 'primary_wins',
    summary: {
      conflictCount: 2,
      resolvedBy: 'primary_wins',
      keptFields: ['display_name', 'asset_source_links'],
      droppedFields: ['legacy_hostname'],
    },
    snapshotRef: 'merge-audit/dev_seed_merge_audit_1',
  });

  await ensureHistoryEvent({
    id: 'dev_seed_history_collect_host_a',
    assetUuid: hostA.uuid,
    eventType: 'collect.changed',
    occurredAt: t.d1,
    title: '采集发现变更',
    summary: {
      sourceId: vcenterSource.id,
      runId: vcenterRun.id,
      fields: ['network.management_ip', 'hardware.memory_bytes'],
    },
    refs: { sourceRecordId: `dev_seed_source_record_${hostA.uuid}` },
  });

  await ensureHistoryEvent({
    id: 'dev_seed_history_ledger_host_a',
    assetUuid: hostA.uuid,
    eventType: 'ledger_fields.changed',
    occurredAt: t.h12,
    title: '台账字段更新',
    summary: {
      changedBy: 'admin',
      fields: ['regionOverride', 'companyOverride', 'managementCodeOverride'],
    },
    refs: { requestId: 'req_dev_seed_ledger_1' },
  });

  await ensureHistoryEvent({
    id: 'dev_seed_history_status_host_b',
    assetUuid: hostB.uuid,
    eventType: 'asset.status_changed',
    occurredAt: t.d3,
    title: '资产状态变更',
    summary: {
      from: 'in_service',
      to: 'offline',
      reason: 'source_missing',
    },
    refs: { sourceId: vcenterSource.id, runId: vcenterRun.id },
  });

  await ensureHistoryEvent({
    id: 'dev_seed_history_merged_host_legacy',
    assetUuid: hostMerged.uuid,
    eventType: 'asset.merged',
    occurredAt: t.h12,
    title: '资产合并完成',
    summary: {
      primaryAssetUuid: hostA.uuid,
      strategy: 'primary_wins',
      mergeAuditId: 'dev_seed_merge_audit_1',
    },
    refs: { mergeAuditId: 'dev_seed_merge_audit_1' },
  });

  const exportFile = Buffer.from(
    'asset_uuid,asset_type,display_name\n00000000-0000-0000-0000-000000000201,host,esxi-alpha-01\n',
  );

  await ensureAssetLedgerExport({
    id: 'dev_seed_export_success_1',
    requestedByUserId: adminUser.id,
    status: 'Succeeded',
    requestId: 'req_export_dev_seed_success',
    params: {
      filters: { asset_type: ['host', 'vm'], status: ['in_service'] },
      columns: ['asset_uuid', 'asset_type', 'display_name', 'machine_name', 'ip'],
    },
    rowCount: 18,
    fileName: 'asset-ledger-seed-success.csv',
    fileBytes: exportFile,
    fileSha256: 'dev-seed-sha256-success',
    createdAt: t.h12,
    startedAt: t.h12,
    finishedAt: new Date(t.h12.getTime() + 4_000),
    expiresAt: new Date(t.d1.getTime() + 7 * 24 * 60 * 60 * 1000),
  });

  await ensureAssetLedgerExport({
    id: 'dev_seed_export_failed_1',
    requestedByUserId: adminUser.id,
    status: 'Failed',
    requestId: 'req_export_dev_seed_failed',
    params: {
      filters: { asset_type: ['host'] },
      columns: ['asset_uuid', 'asset_type', 'display_name'],
    },
    error: {
      code: 'EXPORT_GENERATE_FAILED',
      message: 'mock export error for UI fallback',
      retryable: true,
    },
    createdAt: t.h6,
    startedAt: t.h6,
    finishedAt: new Date(t.h6.getTime() + 2_000),
    expiresAt: null,
  });

  log('done', {
    adminUserId: adminUser.id,
    sources: [vcenterSource.id, hypervSource.id, solarwindsSource.id],
    runs: [vcenterRun.id, hypervRun.id, dedupRun.id, solarwindsRun.id],
    assets: assetsSeed.length,
    sourceLinks: sourceLinks.size + mergedAssets.length + 2,
    sourceRecordsCreated,
    signalRecordsCreated,
    relationRecordsCreated,
    snapshotsCreated,
  });
}

main()
  .catch((err) => {
    log('failed', { error: err instanceof Error ? err.message : String(err) });
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
