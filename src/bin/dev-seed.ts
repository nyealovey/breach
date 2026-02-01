import { bootstrapAdmin } from '@/lib/auth/bootstrap-admin';
import { encryptJson } from '@/lib/crypto/aes-gcm';
import { prisma } from '@/lib/db/prisma';
import { buildCanonicalV1 } from '@/lib/ingest/canonical';
import { compressRaw } from '@/lib/ingest/raw';
import { SourceType } from '@prisma/client';

import type { Asset, AssetType, Prisma, Run, RunStatus, ScheduleGroup, Source } from '@prisma/client';

type SeedSource = {
  name: string;
  sourceType: SourceType;
  endpoint: string;
  scheduleGroupId: string | null;
  credentialId: string;
  enabled: boolean;
  config: Record<string, unknown>;
};

type SeedAsset = {
  uuid: string;
  assetType: AssetType;
  status: 'in_service' | 'offline';
  displayName: string;
  machineNameOverride?: string | null;
  createdAt: Date;
  lastSeenAt: Date;
  ledger?: {
    region?: string;
    company?: string;
    department?: string;
    systemCategory?: string;
    systemLevel?: string;
    bizOwner?: string;
    maintenanceDueDate?: Date;
    purchaseDate?: Date;
    bmcIp?: string;
    cabinetNo?: string;
    rackPosition?: string;
    managementCode?: string;
    fixedAssetNo?: string;
  };
};

function log(message: string, extra?: Record<string, unknown>) {
  const payload = extra ? ` ${JSON.stringify(extra)}` : '';
  console.log(`[dev-seed] ${message}${payload}`);
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

async function ensureSource(args: { id: string; source: SeedSource }): Promise<Source> {
  const byId = await prisma.source.findUnique({ where: { id: args.id } });
  if (byId) return byId;

  // Best-effort: avoid duplicating if name already exists (name is not unique).
  const byName = await prisma.source.findFirst({ where: { name: args.source.name, deletedAt: null } });
  if (byName) return byName;

  return prisma.source.create({
    data: {
      id: args.id,
      name: args.source.name,
      sourceType: args.source.sourceType,
      enabled: args.source.enabled,
      scheduleGroupId: args.source.scheduleGroupId,
      credentialId: args.source.credentialId,
      config: args.source.config as unknown as Prisma.InputJsonValue,
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
      ...(args.errors !== undefined ? { errors: args.errors as unknown as Prisma.InputJsonValue } : {}),
      ...(args.warnings !== undefined ? { warnings: args.warnings as unknown as Prisma.InputJsonValue } : {}),
      ...(args.stats !== undefined ? { stats: args.stats as unknown as Prisma.InputJsonValue } : {}),
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
      createdAt: args.createdAt,
      lastSeenAt: args.lastSeenAt,
    },
  });
}

async function ensureLedgerFields(assetUuid: string, ledger: NonNullable<SeedAsset['ledger']>, recordedAt: Date) {
  const existing = await prisma.assetLedgerFields.findUnique({ where: { assetUuid } });
  if (existing) return existing;

  return prisma.assetLedgerFields.create({
    data: {
      assetUuid,
      region: ledger.region ?? null,
      company: ledger.company ?? null,
      department: ledger.department ?? null,
      systemCategory: ledger.systemCategory ?? null,
      systemLevel: ledger.systemLevel ?? null,
      bizOwner: ledger.bizOwner ?? null,
      maintenanceDueDate: ledger.maintenanceDueDate ?? null,
      purchaseDate: ledger.purchaseDate ?? null,
      bmcIp: ledger.bmcIp ?? null,
      cabinetNo: ledger.cabinetNo ?? null,
      rackPosition: ledger.rackPosition ?? null,
      managementCode: ledger.managementCode ?? null,
      fixedAssetNo: ledger.fixedAssetNo ?? null,
      createdAt: recordedAt,
    },
  });
}

async function ensureAssetSourceLink(args: {
  asset: Asset;
  source: Source;
  externalId: string;
  firstSeenAt: Date;
  lastSeenAt: Date;
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
        presenceStatus: 'present',
        lastSeenRunId: args.lastSeenRunId,
      },
    });
  } catch {
    // If concurrent seed (or manual create) raced, treat as success.
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

async function ensureRelation(args: {
  relationType: 'runs_on' | 'member_of';
  from: Asset;
  to: Asset;
  source: Source;
  firstSeenAt: Date;
  lastSeenAt: Date;
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
        relationType: args.relationType,
        fromAssetUuid: args.from.uuid,
        toAssetUuid: args.to.uuid,
        sourceId: args.source.id,
        firstSeenAt: args.firstSeenAt,
        lastSeenAt: args.lastSeenAt,
        status: 'active',
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
  const existing = await prisma.sourceRecord.findFirst({
    where: { id: args.id },
    orderBy: { collectedAt: 'desc' },
    select: { id: true },
  });
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
      normalized: args.normalized as unknown as Prisma.InputJsonValue,
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
  });
  if (existing) return existing;

  try {
    return await prisma.assetRunSnapshot.create({
      data: {
        assetUuid: args.asset.uuid,
        runId: args.run.id,
        canonical: args.canonical as Prisma.InputJsonValue,
        createdAt: args.createdAt,
      },
    });
  } catch {
    const again = await prisma.assetRunSnapshot.findFirst({
      where: { assetUuid: args.asset.uuid, runId: args.run.id },
    });
    if (again) return again;
    throw new Error('Failed to ensure asset run snapshot');
  }
}

function vmNormalized(args: {
  hostname: string;
  caption: string;
  osName: string;
  osVersion: string;
  ipAddresses: string[];
  cpuCount: number;
  memoryBytes: number;
  powerState: 'poweredOn' | 'poweredOff' | 'suspended';
  toolsRunning: boolean;
  diskBytes: number;
}) {
  return {
    identity: { hostname: args.hostname, caption: args.caption },
    os: { name: args.osName, version: args.osVersion },
    network: { ip_addresses: args.ipAddresses },
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
  osName: string;
  osVersion: string;
  cpuThreads: number;
  cpuCount: number;
  memoryBytes: number;
  datastoreBytes: number;
}) {
  return {
    identity: { hostname: args.hostname },
    os: { name: args.osName, version: args.osVersion },
    hardware: { cpu_count: args.cpuCount, memory_bytes: args.memoryBytes },
    attributes: {
      cpu_threads: args.cpuThreads,
      datastore_total_bytes: args.datastoreBytes,
      disk_total_bytes: args.datastoreBytes,
    },
    storage: {
      datastores: [
        { name: 'datastore-01', capacity_bytes: Math.floor(args.datastoreBytes * 0.6) },
        { name: 'datastore-02', capacity_bytes: Math.floor(args.datastoreBytes * 0.4) },
      ],
    },
  } satisfies Record<string, unknown>;
}

function clusterNormalized(args: { caption: string }) {
  return { identity: { caption: args.caption } } satisfies Record<string, unknown>;
}

async function main() {
  log('starting');

  // Ensure the default admin exists, so the seeded environment is immediately usable.
  await bootstrapAdmin();

  const scheduleGroup = await ensureScheduleGroup();

  const vcenterCred = await ensureCredential({
    id: 'dev_seed_cred_vcenter',
    name: '[DEV] vCenter Credential',
    type: SourceType.vcenter,
    payload: { username: 'dev', password: 'dev' },
  });
  const hypervCred = await ensureCredential({
    id: 'dev_seed_cred_hyperv',
    name: '[DEV] Hyper-V Credential',
    type: SourceType.hyperv,
    payload: { domain: 'LAB', username: 'dev', password: 'dev' },
  });

  const vcenterSource = await ensureSource({
    id: 'dev_seed_source_vcenter',
    source: {
      name: '[DEV] vCenter (mock)',
      sourceType: SourceType.vcenter,
      endpoint: 'https://vcenter.example.invalid',
      scheduleGroupId: scheduleGroup.id,
      credentialId: vcenterCred.id,
      enabled: true,
      config: {
        endpoint: 'https://vcenter.example.invalid',
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
      endpoint: 'winrm://hyperv.example.invalid',
      scheduleGroupId: scheduleGroup.id,
      credentialId: hypervCred.id,
      enabled: true,
      config: { endpoint: 'winrm://hyperv.example.invalid', tls_verify: false, timeout_ms: 2000 },
    },
  });

  const now = Date.now();
  const t = {
    d3: new Date(now - 3 * 24 * 60 * 60 * 1000),
    d2: new Date(now - 2 * 24 * 60 * 60 * 1000),
    d1: new Date(now - 1 * 24 * 60 * 60 * 1000),
    h6: new Date(now - 6 * 60 * 60 * 1000),
    h2: new Date(now - 2 * 60 * 60 * 1000),
  };

  const vcenterRun = await ensureRun({
    id: 'dev_seed_run_vcenter_1',
    source: vcenterSource,
    scheduleGroupId: scheduleGroup.id,
    triggerType: 'manual',
    mode: 'collect',
    status: 'Succeeded',
    createdAt: t.d1,
    startedAt: t.d1,
    finishedAt: new Date(t.d1.getTime() + 30_000),
    stats: { assets: 26, relations: 24, inventoryComplete: true },
  });

  await ensureRun({
    id: 'dev_seed_run_hyperv_1',
    source: hypervSource,
    scheduleGroupId: scheduleGroup.id,
    triggerType: 'manual',
    mode: 'collect',
    status: 'Failed',
    createdAt: t.h6,
    startedAt: t.h6,
    finishedAt: new Date(t.h6.getTime() + 12_000),
    errorSummary: 'DEV seed: mock failure (no real WinRM endpoint)',
    errors: [{ code: 'PLUGIN_EXEC_FAILED', message: 'mock failure', retryable: false }],
    warnings: [{ code: 'DEV_WARNING', message: 'this is seeded data' }],
    stats: { assets: 0, relations: 0, inventoryComplete: false },
  });

  const cluster: SeedAsset = {
    uuid: '00000000-0000-0000-0000-000000000100',
    assetType: 'cluster',
    status: 'in_service',
    displayName: 'cluster-01',
    createdAt: t.d3,
    lastSeenAt: t.d1,
    ledger: {
      region: 'cn-shanghai',
      company: 'ACME',
      department: 'IT',
      systemCategory: '基础设施',
      systemLevel: 'L2',
      bizOwner: 'Alice',
    },
  };

  const host1: SeedAsset = {
    uuid: '00000000-0000-0000-0000-000000000201',
    assetType: 'host',
    status: 'in_service',
    displayName: 'esxi-01',
    createdAt: t.d3,
    lastSeenAt: t.d1,
    ledger: {
      region: 'cn-shanghai',
      company: 'ACME',
      department: 'IT',
      systemCategory: '基础设施',
      systemLevel: 'L1',
      bizOwner: 'Bob',
      maintenanceDueDate: new Date('2026-03-31T00:00:00.000Z'),
      purchaseDate: new Date('2024-08-15T00:00:00.000Z'),
      bmcIp: '10.10.10.10',
      cabinetNo: 'A-01',
      rackPosition: 'U12',
      managementCode: 'MGMT-ESXI-01',
      fixedAssetNo: 'FA-0001',
    },
  };

  const host2: SeedAsset = {
    uuid: '00000000-0000-0000-0000-000000000202',
    assetType: 'host',
    status: 'offline',
    displayName: 'esxi-02',
    createdAt: t.d2,
    lastSeenAt: t.d2,
    ledger: {
      region: 'cn-beijing',
      company: 'Beta',
      department: 'DevOps',
      systemCategory: '基础设施',
      systemLevel: 'L2',
      bizOwner: 'Carol',
      maintenanceDueDate: new Date('2026-02-28T00:00:00.000Z'),
      purchaseDate: new Date('2023-11-03T00:00:00.000Z'),
      bmcIp: '10.10.10.11',
      cabinetNo: 'B-02',
      rackPosition: 'U20',
      managementCode: 'MGMT-ESXI-02',
      fixedAssetNo: 'FA-0002',
    },
  };

  const vmAssets: SeedAsset[] = Array.from({ length: 24 }).map((_, i) => {
    const idx = String(i + 1).padStart(2, '0');
    const uuid = `00000000-0000-0000-0000-0000000010${idx}`;
    const company = i % 2 === 0 ? 'ACME' : 'Beta';
    const region = i % 3 === 0 ? 'cn-shanghai' : i % 3 === 1 ? 'cn-beijing' : 'us-west-2';
    const department = i % 3 === 0 ? 'IT' : i % 3 === 1 ? 'Security' : 'DevOps';
    const systemCategory = i % 2 === 0 ? '业务系统' : '数据平台';
    const systemLevel = i % 3 === 0 ? 'L1' : i % 3 === 1 ? 'L2' : 'L3';
    const bizOwner = i % 3 === 0 ? 'Alice' : i % 3 === 1 ? 'Bob' : 'Carol';

    return {
      uuid,
      assetType: 'vm',
      status: 'in_service',
      displayName: `vm-${idx}`,
      machineNameOverride: i % 9 === 0 ? `vm-override-${idx}` : null,
      createdAt: new Date(t.d3.getTime() + i * 60_000),
      lastSeenAt: t.d1,
      ledger: { region, company, department, systemCategory, systemLevel, bizOwner },
    };
  });

  const assetsSeed = [cluster, host1, host2, ...vmAssets];

  const assetsByUuid: Record<string, Asset | undefined> = {};
  for (const a of assetsSeed) {
    const created = await ensureAsset(a);
    assetsByUuid[a.uuid] = created;
    if (a.ledger) {
      // Spread "录入时间" so list isn't all the same: it makes UI debugging easier.
      const recordedAt = new Date(a.createdAt.getTime() + 5 * 60_000);
      await ensureLedgerFields(created.uuid, a.ledger, recordedAt);
    }
  }

  const clusterAsset = mustGetAsset(assetsByUuid, cluster.uuid);
  const host1Asset = mustGetAsset(assetsByUuid, host1.uuid);
  const host2Asset = mustGetAsset(assetsByUuid, host2.uuid);

  // Relations: host member_of cluster + vm runs_on host.
  await ensureRelation({
    relationType: 'member_of',
    from: host1Asset,
    to: clusterAsset,
    source: vcenterSource,
    firstSeenAt: t.d3,
    lastSeenAt: t.d1,
  });
  await ensureRelation({
    relationType: 'member_of',
    from: host2Asset,
    to: clusterAsset,
    source: vcenterSource,
    firstSeenAt: t.d2,
    lastSeenAt: t.d2,
  });

  // Records + snapshots: use vCenter run as the main data source.
  let recordsCreated = 0;
  let snapshotsCreated = 0;
  let linksEnsured = 0;
  let relationsEnsured = 2;

  const vmUuids = vmAssets.map((v) => v.uuid);
  for (const vmUuid of vmUuids) {
    const asset = mustGetAsset(assetsByUuid, vmUuid);
    const idx = vmUuid.slice(-2);
    const hostname = `vm-guest-${idx}`;
    const caption = `vm-${idx}`;
    const isWindows = Number(idx) % 5 === 1;
    const isIpMissing = Number(idx) % 7 === 1;

    const normalized = vmNormalized({
      hostname,
      caption,
      osName: isWindows ? 'Windows' : 'Ubuntu',
      osVersion: isWindows ? '2022' : '20.04',
      ipAddresses: isIpMissing ? [] : [`10.10.${Number(idx)}.${100 + Number(idx)}`],
      cpuCount: 2 + (Number(idx) % 6),
      memoryBytes: (2 + (Number(idx) % 4)) * 1024 ** 3,
      powerState: Number(idx) % 4 === 0 ? 'poweredOff' : 'poweredOn',
      toolsRunning: Number(idx) % 6 !== 0,
      diskBytes: (40 + Number(idx)) * 1024 ** 3,
    });

    const runsOnHost = Number(idx) % 2 === 0 ? host1Asset : host2Asset;
    const outgoingRelations = [
      {
        type: 'runs_on' as const,
        to: {
          asset_uuid: runsOnHost.uuid,
          asset_type: 'host' as const,
          display_name: runsOnHost.displayName ?? runsOnHost.uuid,
        },
      },
    ];

    const canonical = buildCanonicalV1({
      assetUuid: asset.uuid,
      assetType: 'vm',
      status: asset.status,
      sourceId: vcenterSource.id,
      runId: vcenterRun.id,
      collectedAt: t.d1.toISOString(),
      normalized,
      outgoingRelations,
    });

    const link = await ensureAssetSourceLink({
      asset,
      source: vcenterSource,
      externalId: `vcenter:${caption}`,
      firstSeenAt: asset.createdAt,
      lastSeenAt: asset.lastSeenAt ?? t.d1,
      lastSeenRunId: vcenterRun.id,
    });
    linksEnsured += 1;

    await ensureSourceRecord({
      id: `dev_seed_record_${asset.uuid}`,
      collectedAt: t.d1,
      run: vcenterRun,
      source: vcenterSource,
      linkId: link.id,
      asset,
      externalId: link.externalId,
      normalized,
    });
    recordsCreated += 1;

    await ensureSnapshot({ asset, run: vcenterRun, createdAt: t.d1, canonical });
    snapshotsCreated += 1;

    await ensureRelation({
      relationType: 'runs_on',
      from: asset,
      to: runsOnHost,
      source: vcenterSource,
      firstSeenAt: asset.createdAt,
      lastSeenAt: t.d1,
    });
    relationsEnsured += 1;
  }

  // Hosts + cluster snapshots/records, so detail pages show data.
  const host1Norm = hostNormalized({
    hostname: host1.displayName,
    osName: 'ESXi',
    osVersion: '7.0.3',
    cpuThreads: 64,
    cpuCount: 32,
    memoryBytes: 256 * 1024 ** 3,
    datastoreBytes: 12 * 1024 ** 4,
  });
  const host2Norm = hostNormalized({
    hostname: host2.displayName,
    osName: 'ESXi',
    osVersion: '7.0.3',
    cpuThreads: 48,
    cpuCount: 24,
    memoryBytes: 192 * 1024 ** 3,
    datastoreBytes: 8 * 1024 ** 4,
  });
  const clusterNorm = clusterNormalized({ caption: cluster.displayName });

  const clusterCanonical = buildCanonicalV1({
    assetUuid: clusterAsset.uuid,
    assetType: 'cluster',
    status: clusterAsset.status,
    sourceId: vcenterSource.id,
    runId: vcenterRun.id,
    collectedAt: t.d1.toISOString(),
    normalized: clusterNorm,
    outgoingRelations: [],
  });

  const clusterLink = await ensureAssetSourceLink({
    asset: clusterAsset,
    source: vcenterSource,
    externalId: `vcenter:${cluster.displayName}`,
    firstSeenAt: clusterAsset.createdAt,
    lastSeenAt: t.d1,
    lastSeenRunId: vcenterRun.id,
  });
  linksEnsured += 1;
  await ensureSourceRecord({
    id: `dev_seed_record_${clusterAsset.uuid}`,
    collectedAt: t.d1,
    run: vcenterRun,
    source: vcenterSource,
    linkId: clusterLink.id,
    asset: clusterAsset,
    externalId: clusterLink.externalId,
    normalized: clusterNorm,
  });
  recordsCreated += 1;
  await ensureSnapshot({ asset: clusterAsset, run: vcenterRun, createdAt: t.d1, canonical: clusterCanonical });
  snapshotsCreated += 1;

  for (const [seed, normalized] of [
    [host1, host1Norm],
    [host2, host2Norm],
  ] as const) {
    const asset = mustGetAsset(assetsByUuid, seed.uuid);
    const hostCanonical = buildCanonicalV1({
      assetUuid: asset.uuid,
      assetType: 'host',
      status: asset.status,
      sourceId: vcenterSource.id,
      runId: vcenterRun.id,
      collectedAt: t.d1.toISOString(),
      normalized,
      outgoingRelations: [
        {
          type: 'member_of',
          to: { asset_uuid: clusterAsset.uuid, asset_type: 'cluster', display_name: cluster.displayName },
        },
      ],
    });

    const link = await ensureAssetSourceLink({
      asset,
      source: vcenterSource,
      externalId: `vcenter:${seed.displayName}`,
      firstSeenAt: asset.createdAt,
      lastSeenAt: asset.lastSeenAt ?? t.d1,
      lastSeenRunId: vcenterRun.id,
    });
    linksEnsured += 1;

    await ensureSourceRecord({
      id: `dev_seed_record_${asset.uuid}`,
      collectedAt: t.d1,
      run: vcenterRun,
      source: vcenterSource,
      linkId: link.id,
      asset,
      externalId: link.externalId,
      normalized,
    });
    recordsCreated += 1;

    await ensureSnapshot({ asset, run: vcenterRun, createdAt: t.d1, canonical: hostCanonical });
    snapshotsCreated += 1;
  }

  log('done', {
    scheduleGroupId: scheduleGroup.id,
    sources: [vcenterSource.id, hypervSource.id],
    runs: [vcenterRun.id],
    assets: assetsSeed.length,
    linksEnsured,
    recordsCreated,
    snapshotsCreated,
    relationsEnsured,
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
