import 'server-only';

import { parseAssetListQuery, buildAssetListWhere } from '@/lib/assets/asset-list-query';
import { pickLatestBackupSummary } from '@/lib/assets/backup-latest';
import { formatIpAddressesForDisplay } from '@/lib/assets/ip-addresses';
import { formatOsForDisplay } from '@/lib/assets/os-display';
import { prisma } from '@/lib/db/prisma';
import { serverEnv } from '@/lib/env/server';
import { decompressRaw } from '@/lib/ingest/raw';
import { buildPagination, parsePagination } from '@/lib/http/pagination';
import { formatAssetListIpText, parsePrivateIpPrefixes } from '@/lib/ip/asset-list-ip-display';
import { buildLedgerFieldsV1FromRow, LEDGER_FIELDS_V1_DB_SELECT } from '@/lib/ledger/ledger-fields-v1';

import type { LedgerFieldsV1 } from '@/lib/ledger/ledger-fields-v1';

const ASSETS_TABLE_COLUMNS_PREFERENCE_KEY = 'assets.table.columns.v2' as const;
const LEDGER_FIELD_OPTIONS_TAKE_LIMIT = 500;

export type AssetListItem = {
  assetUuid: string;
  assetType: string;
  status: string;
  brand: string | null;
  model: string | null;
  machineName: string | null;
  machineNameOverride: string | null;
  machineNameCollected: string | null;
  machineNameMismatch: boolean;
  hostName: string | null;
  vmName: string | null;
  os: string | null;
  osCollected: string | null;
  osOverrideText: string | null;
  vmPowerState: string | null;
  toolsRunning: boolean | null;
  ip: string | null;
  ipCollected: string | null;
  ipOverrideText: string | null;
  monitorCovered: boolean | null;
  monitorState: string | null;
  monitorStatus: string | null;
  monitorUpdatedAt: string | null;
  backupCovered: boolean | null;
  backupState: string | null;
  backupLastSuccessAt: string | null;
  backupLastResult: string | null;
  backupUpdatedAt: string | null;
  recordedAt: string;
  ledgerFields: LedgerFieldsV1;
  cpuCount: number | null;
  memoryBytes: number | null;
  totalDiskBytes: number | null;
};

export type AssetListPagination = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

export type SourceOption = {
  sourceId: string;
  name: string;
};

export type LedgerFieldFilterOptions = {
  regions: string[];
  companies: string[];
  departments: string[];
  systemCategories: string[];
  systemLevels: string[];
  bizOwners: string[];
  osNames: string[];
  brands: string[];
  models: string[];
};

export type AssetHistoryEventItem = {
  eventId: string;
  assetUuid: string;
  sourceAssetUuid: string | null;
  eventType: string;
  occurredAt: string;
  title: string;
  summary: unknown;
  refs: Record<string, unknown>;
};

export type AssetHistoryResponse = {
  items: AssetHistoryEventItem[];
  nextCursor: string | null;
};

export type AssetDetail = {
  assetUuid: string;
  assetType: string;
  status: string;
  mergedIntoAssetUuid: string | null;
  displayName: string | null;
  machineNameOverride?: string | null;
  ipOverrideText?: string | null;
  osOverrideText?: string | null;
  lastSeenAt: string | null;
  operationalState: {
    backupCovered: boolean | null;
    backupState: string | null;
    backupLastSuccessAt: string | null;
    backupLastResult: string | null;
    backupUpdatedAt: string | null;
    monitorCovered: boolean | null;
    monitorState: string | null;
    monitorStatus: string | null;
    monitorUpdatedAt: string | null;
  };
  latestBackupAt: string | null;
  latestBackupProcessedSize: number | null;
  ledgerFields: LedgerFieldsV1;
  latestSnapshot: { runId: string; createdAt: string; canonical: unknown } | null;
};

export type SourceRecordItem = {
  recordId: string;
  collectedAt: string;
  runId: string;
  sourceId: string;
  sourceName: string | null;
  externalKind: string;
  externalId: string;
  normalized: unknown;
};

export type RelationItem = {
  relationId: string;
  relationType: string;
  toAssetUuid: string;
  toAssetType: string | null;
  toDisplayName: string | null;
  sourceId: string;
  lastSeenAt: string;
};

export type AssetsPageServerData = {
  sourceOptions: SourceOption[];
  ledgerFieldFilterOptions: LedgerFieldFilterOptions;
  visibleColumns: string[] | null;
  list: { items: AssetListItem[]; pagination: AssetListPagination } | null;
};

export type AssetDetailPageServerData = {
  asset: AssetDetail | null;
  relations: RelationItem[];
  history: AssetHistoryResponse | null;
};

const EMPTY_LEDGER_FIELD_FILTER_OPTIONS: LedgerFieldFilterOptions = {
  regions: [],
  companies: [],
  departments: [],
  systemCategories: [],
  systemLevels: [],
  bizOwners: [],
  osNames: [],
  brands: [],
  models: [],
};

function getCanonicalFieldValue(fields: unknown, path: string[]): unknown {
  let cursor: unknown = fields;
  for (const key of path) {
    if (!cursor || typeof cursor !== 'object') return null;
    cursor = (cursor as Record<string, unknown>)[key];
  }

  if (!cursor || typeof cursor !== 'object') return null;
  const leafValue = (cursor as Record<string, unknown>).value;
  return leafValue === undefined ? null : leafValue;
}

function pickPrimaryIp(fields: unknown, privatePrefixes: string[]): string | null {
  const ips = getCanonicalFieldValue(fields, ['network', 'ip_addresses']);
  if (privatePrefixes.length === 0) return formatIpAddressesForDisplay(ips);
  return formatAssetListIpText(ips, privatePrefixes);
}

function sumDiskBytes(fields: unknown): number | null {
  const disks = getCanonicalFieldValue(fields, ['hardware', 'disks']);
  if (!Array.isArray(disks)) return null;

  let sum = 0;
  let seen = false;
  for (const disk of disks) {
    if (!disk || typeof disk !== 'object') continue;
    const sizeBytes = (disk as Record<string, unknown>).size_bytes;
    if (typeof sizeBytes !== 'number' || !Number.isFinite(sizeBytes)) continue;
    sum += sizeBytes;
    seen = true;
  }

  return seen ? sum : null;
}

function pickRunsOnHostName(canonical: unknown): string | null {
  if (!canonical || typeof canonical !== 'object') return null;

  const relations = (canonical as Record<string, unknown>).relations;
  if (!relations || typeof relations !== 'object') return null;

  const outgoing = (relations as Record<string, unknown>).outgoing;
  if (!Array.isArray(outgoing)) return null;

  const runsOn = outgoing.find(
    (rel) => rel && typeof rel === 'object' && (rel as Record<string, unknown>).type === 'runs_on',
  );
  if (!runsOn || typeof runsOn !== 'object') return null;

  const to = (runsOn as Record<string, unknown>).to;
  if (!to || typeof to !== 'object') return null;

  const displayName = (to as Record<string, unknown>).display_name;
  return typeof displayName === 'string' && displayName.trim().length > 0 ? displayName.trim() : null;
}

function pickVmName(fields: unknown): string | null {
  const caption = getCanonicalFieldValue(fields, ['identity', 'caption']);
  if (typeof caption === 'string' && caption.trim().length > 0) return caption.trim();
  return null;
}

function pickMachineNameCollected(fields: unknown): string | null {
  const hostname = getCanonicalFieldValue(fields, ['identity', 'hostname']);
  if (typeof hostname === 'string' && hostname.trim().length > 0) return hostname.trim();
  return null;
}

function pickOs(fields: unknown, assetType: string): string | null {
  const name = getCanonicalFieldValue(fields, ['os', 'name']);
  const version = getCanonicalFieldValue(fields, ['os', 'version']);
  const fingerprint = getCanonicalFieldValue(fields, ['os', 'fingerprint']);
  return formatOsForDisplay({ assetType, name, version, fingerprint });
}

function pickPowerState(fields: unknown): string | null {
  const powerState = getCanonicalFieldValue(fields, ['runtime', 'power_state']);
  if (typeof powerState === 'string' && powerState.trim().length > 0) return powerState.trim();
  return null;
}

function pickToolsRunning(fields: unknown): boolean | null {
  const toolsRunning = getCanonicalFieldValue(fields, ['runtime', 'tools_running']);
  if (typeof toolsRunning === 'boolean') return toolsRunning;
  return null;
}

function pickTrimmedString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

async function listAssets(
  searchParams: URLSearchParams,
): Promise<{ items: AssetListItem[]; pagination: AssetListPagination }> {
  const { page, pageSize, skip, take } = parsePagination(searchParams);
  const query = parseAssetListQuery(searchParams);
  const where = buildAssetListWhere(query);
  const privateIpPrefixes = parsePrivateIpPrefixes(serverEnv.ASSET_LEDGER_ASSET_LIST_IP_PRIVATE_PREFIXES);

  const totalPromise = prisma.asset.count({ where });
  const itemsPromise = prisma.asset.findMany({
    where,
    orderBy: [{ displayName: 'asc' }, { createdAt: 'desc' }],
    skip,
    take,
    include: {
      operationalState: {
        select: {
          backupCovered: true,
          backupState: true,
          backupLastSuccessAt: true,
          backupLastResult: true,
          backupUpdatedAt: true,
          monitorCovered: true,
          monitorState: true,
          monitorStatus: true,
          monitorUpdatedAt: true,
        },
      },
      ledgerFields: {
        select: {
          ...LEDGER_FIELDS_V1_DB_SELECT,
          createdAt: true,
        },
      },
      runSnapshots: {
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: { canonical: true },
      },
    },
  });

  const [total, items] = await prisma.$transaction([totalPromise, itemsPromise]);

  const data: AssetListItem[] = items.map((asset) => {
    const canonical = asset.runSnapshots?.[0]?.canonical ?? null;
    const fields = canonical && typeof canonical === 'object' ? (canonical as Record<string, unknown>).fields : null;

    const cpuCount = getCanonicalFieldValue(fields, ['hardware', 'cpu_count']);
    const cpuThreads = getCanonicalFieldValue(fields, ['attributes', 'cpu_threads']);
    const osName = getCanonicalFieldValue(fields, ['os', 'name']);
    const memoryBytes = getCanonicalFieldValue(fields, ['hardware', 'memory_bytes']);
    const datastoreTotalBytes = getCanonicalFieldValue(fields, ['attributes', 'datastore_total_bytes']);
    const diskTotalBytes = getCanonicalFieldValue(fields, ['attributes', 'disk_total_bytes']);

    const machineNameOverride = asset.machineNameOverride?.trim() ? asset.machineNameOverride.trim() : null;
    const machineNameCollected = pickMachineNameCollected(fields);
    const machineName = machineNameOverride ?? machineNameCollected;
    const machineNameMismatch =
      machineNameOverride !== null && machineNameCollected !== null && machineNameOverride !== machineNameCollected;

    const ipOverrideText = asset.ipOverrideText?.trim() ? asset.ipOverrideText.trim() : null;
    const ipCollected = pickPrimaryIp(fields, privateIpPrefixes);
    const ip = ipOverrideText ?? ipCollected;

    const osOverrideText = asset.osOverrideText?.trim() ? asset.osOverrideText.trim() : null;
    const osCollected = pickOs(fields, asset.assetType);
    const os = osOverrideText ?? osCollected;

    const vmName = asset.assetType === 'vm' ? (pickVmName(fields) ?? asset.displayName ?? asset.uuid) : null;
    const hostName = asset.assetType === 'vm' ? pickRunsOnHostName(canonical) : null;
    const recordedAt = (asset.ledgerFields?.createdAt ?? asset.createdAt).toISOString();

    return {
      assetUuid: asset.uuid,
      assetType: asset.assetType,
      status: asset.status,
      brand:
        asset.assetType === 'host' ? pickTrimmedString(getCanonicalFieldValue(fields, ['identity', 'vendor'])) : null,
      model:
        asset.assetType === 'host' ? pickTrimmedString(getCanonicalFieldValue(fields, ['identity', 'model'])) : null,
      machineName,
      machineNameOverride,
      machineNameCollected,
      machineNameMismatch,
      vmName,
      hostName,
      os,
      osCollected,
      osOverrideText,
      vmPowerState: pickPowerState(fields),
      toolsRunning: asset.assetType === 'vm' ? pickToolsRunning(fields) : null,
      ip,
      ipCollected,
      ipOverrideText,
      recordedAt,
      monitorCovered: asset.operationalState?.monitorCovered ?? null,
      monitorState: asset.operationalState?.monitorState ?? null,
      monitorStatus: asset.operationalState?.monitorStatus ?? null,
      monitorUpdatedAt: asset.operationalState?.monitorUpdatedAt?.toISOString() ?? null,
      backupCovered: asset.operationalState?.backupCovered ?? null,
      backupState: asset.operationalState?.backupState ?? null,
      backupLastSuccessAt: asset.operationalState?.backupLastSuccessAt?.toISOString() ?? null,
      backupLastResult: asset.operationalState?.backupLastResult ?? null,
      backupUpdatedAt: asset.operationalState?.backupUpdatedAt?.toISOString() ?? null,
      ledgerFields: buildLedgerFieldsV1FromRow(asset.ledgerFields),
      cpuCount:
        asset.assetType === 'host' && typeof osName === 'string' && osName.trim() === 'ESXi'
          ? typeof cpuThreads === 'number'
            ? cpuThreads
            : null
          : typeof cpuCount === 'number'
            ? cpuCount
            : null,
      memoryBytes: typeof memoryBytes === 'number' ? memoryBytes : null,
      totalDiskBytes:
        asset.assetType === 'host'
          ? typeof datastoreTotalBytes === 'number'
            ? datastoreTotalBytes
            : typeof diskTotalBytes === 'number'
              ? diskTotalBytes
              : null
          : sumDiskBytes(fields),
    };
  });

  return {
    items: data,
    pagination: buildPagination(total, page, pageSize),
  };
}

function cleanDistinctStrings(values: Array<string | null | undefined>): string[] {
  const cleaned = values
    .map((value) => (typeof value === 'string' ? value.trim() : ''))
    .filter((value) => value.length > 0);
  return Array.from(new Set(cleaned)).sort((a, b) => a.localeCompare(b, 'zh-CN'));
}

async function readLedgerFieldFilterOptions(): Promise<LedgerFieldFilterOptions> {
  type RegionRow = { region: string | null };
  type CompanyRow = { company: string | null };
  type DepartmentRow = { department: string | null };
  type SystemCategoryRow = { systemCategory: string | null };
  type SystemLevelRow = { systemLevel: string | null };
  type BizOwnerRow = { bizOwner: string | null };
  type OsNameRow = { osName: string | null };
  type BrandRow = { brand: string | null };
  type ModelRow = { model: string | null };

  const [
    regionsRows,
    companiesRows,
    departmentsRows,
    systemCategoryRows,
    systemLevelRows,
    bizOwnerRows,
    osNameRows,
    brandRows,
    modelRows,
  ] = await Promise.all([
    prisma.$queryRaw<RegionRow[]>`
      SELECT DISTINCT value AS "region"
      FROM (
        SELECT NULLIF(btrim(COALESCE(alf."regionOverride", alf."regionSource")), '') AS value
        FROM "AssetLedgerFields" alf
        JOIN "Asset" a ON a.uuid = alf."assetUuid"
        WHERE a.status <> 'merged'
      ) t
      WHERE value IS NOT NULL
      ORDER BY value
      LIMIT ${LEDGER_FIELD_OPTIONS_TAKE_LIMIT}
    `,
    prisma.$queryRaw<CompanyRow[]>`
      SELECT DISTINCT value AS "company"
      FROM (
        SELECT NULLIF(btrim(COALESCE(alf."companyOverride", alf."companySource")), '') AS value
        FROM "AssetLedgerFields" alf
        JOIN "Asset" a ON a.uuid = alf."assetUuid"
        WHERE a.status <> 'merged'
      ) t
      WHERE value IS NOT NULL
      ORDER BY value
      LIMIT ${LEDGER_FIELD_OPTIONS_TAKE_LIMIT}
    `,
    prisma.$queryRaw<DepartmentRow[]>`
      SELECT DISTINCT value AS "department"
      FROM (
        SELECT NULLIF(btrim(COALESCE(alf."departmentOverride", alf."departmentSource")), '') AS value
        FROM "AssetLedgerFields" alf
        JOIN "Asset" a ON a.uuid = alf."assetUuid"
        WHERE a.status <> 'merged'
      ) t
      WHERE value IS NOT NULL
      ORDER BY value
      LIMIT ${LEDGER_FIELD_OPTIONS_TAKE_LIMIT}
    `,
    prisma.$queryRaw<SystemCategoryRow[]>`
      SELECT DISTINCT value AS "systemCategory"
      FROM (
        SELECT NULLIF(btrim(COALESCE(alf."systemCategoryOverride", alf."systemCategorySource")), '') AS value
        FROM "AssetLedgerFields" alf
        JOIN "Asset" a ON a.uuid = alf."assetUuid"
        WHERE a.status <> 'merged'
      ) t
      WHERE value IS NOT NULL
      ORDER BY value
      LIMIT ${LEDGER_FIELD_OPTIONS_TAKE_LIMIT}
    `,
    prisma.$queryRaw<SystemLevelRow[]>`
      SELECT DISTINCT value AS "systemLevel"
      FROM (
        SELECT NULLIF(btrim(COALESCE(alf."systemLevelOverride", alf."systemLevelSource")), '') AS value
        FROM "AssetLedgerFields" alf
        JOIN "Asset" a ON a.uuid = alf."assetUuid"
        WHERE a.status <> 'merged'
      ) t
      WHERE value IS NOT NULL
      ORDER BY value
      LIMIT ${LEDGER_FIELD_OPTIONS_TAKE_LIMIT}
    `,
    prisma.$queryRaw<BizOwnerRow[]>`
      SELECT DISTINCT value AS "bizOwner"
      FROM (
        SELECT NULLIF(btrim(COALESCE(alf."bizOwnerOverride", alf."bizOwnerSource")), '') AS value
        FROM "AssetLedgerFields" alf
        JOIN "Asset" a ON a.uuid = alf."assetUuid"
        WHERE a.status <> 'merged'
      ) t
      WHERE value IS NOT NULL
      ORDER BY value
      LIMIT ${LEDGER_FIELD_OPTIONS_TAKE_LIMIT}
    `,
    prisma.$queryRaw<OsNameRow[]>`
      SELECT DISTINCT os_name AS "osName"
      FROM (
        SELECT DISTINCT ON (ars."assetUuid")
          ars.canonical #>> '{fields,os,name,value}' AS os_name
        FROM "AssetRunSnapshot" ars
        JOIN "Asset" a ON a.uuid = ars."assetUuid"
        WHERE a.status <> 'merged'
        ORDER BY ars."assetUuid", ars."createdAt" DESC
      ) t
      WHERE os_name IS NOT NULL AND btrim(os_name) <> ''
      ORDER BY os_name
      LIMIT ${LEDGER_FIELD_OPTIONS_TAKE_LIMIT}
    `,
    prisma.$queryRaw<BrandRow[]>`
      SELECT DISTINCT brand AS "brand"
      FROM (
        SELECT DISTINCT ON (ars."assetUuid")
          ars.canonical #>> '{fields,identity,vendor,value}' AS brand
        FROM "AssetRunSnapshot" ars
        JOIN "Asset" a ON a.uuid = ars."assetUuid"
        WHERE a.status <> 'merged' AND a."assetType" = 'host'
        ORDER BY ars."assetUuid", ars."createdAt" DESC
      ) t
      WHERE brand IS NOT NULL AND btrim(brand) <> ''
      ORDER BY brand
      LIMIT ${LEDGER_FIELD_OPTIONS_TAKE_LIMIT}
    `,
    prisma.$queryRaw<ModelRow[]>`
      SELECT DISTINCT model AS "model"
      FROM (
        SELECT DISTINCT ON (ars."assetUuid")
          ars.canonical #>> '{fields,identity,model,value}' AS model
        FROM "AssetRunSnapshot" ars
        JOIN "Asset" a ON a.uuid = ars."assetUuid"
        WHERE a.status <> 'merged' AND a."assetType" = 'host'
        ORDER BY ars."assetUuid", ars."createdAt" DESC
      ) t
      WHERE model IS NOT NULL AND btrim(model) <> ''
      ORDER BY model
      LIMIT ${LEDGER_FIELD_OPTIONS_TAKE_LIMIT}
    `,
  ]);

  return {
    regions: cleanDistinctStrings(regionsRows.map((row) => row.region)),
    companies: cleanDistinctStrings(companiesRows.map((row) => row.company)),
    departments: cleanDistinctStrings(departmentsRows.map((row) => row.department)),
    systemCategories: cleanDistinctStrings(systemCategoryRows.map((row) => row.systemCategory)),
    systemLevels: cleanDistinctStrings(systemLevelRows.map((row) => row.systemLevel)),
    bizOwners: cleanDistinctStrings(bizOwnerRows.map((row) => row.bizOwner)),
    osNames: cleanDistinctStrings(osNameRows.map((row) => row.osName)),
    brands: cleanDistinctStrings(brandRows.map((row) => row.brand)),
    models: cleanDistinctStrings(modelRows.map((row) => row.model)),
  };
}

async function readSourcesSummary(): Promise<SourceOption[]> {
  const sources = await prisma.source.findMany({
    where: { enabled: true, deletedAt: null },
    orderBy: { name: 'asc' },
    select: { id: true, name: true },
  });

  return sources.map((source) => ({ sourceId: source.id, name: source.name }));
}

async function readAssetsTableVisibleColumns(userId: string): Promise<string[] | null> {
  const pref = await prisma.userPreference.findUnique({
    where: { userId_key: { userId, key: ASSETS_TABLE_COLUMNS_PREFERENCE_KEY } },
    select: { value: true },
  });

  const value = pref?.value;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;

  const visibleColumns = (value as Record<string, unknown>).visibleColumns;
  if (!Array.isArray(visibleColumns)) return null;

  const next = visibleColumns
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

  return next.length > 0 ? Array.from(new Set(next)) : null;
}

async function readAssetDetail(assetUuid: string): Promise<AssetDetail | null> {
  const asset = await prisma.asset.findUnique({
    where: { uuid: assetUuid },
    select: {
      uuid: true,
      assetType: true,
      status: true,
      mergedIntoAssetUuid: true,
      displayName: true,
      machineNameOverride: true,
      ipOverrideText: true,
      osOverrideText: true,
      lastSeenAt: true,
      operationalState: {
        select: {
          backupCovered: true,
          backupState: true,
          backupLastSuccessAt: true,
          backupLastResult: true,
          backupUpdatedAt: true,
          monitorCovered: true,
          monitorState: true,
          monitorStatus: true,
          monitorUpdatedAt: true,
        },
      },
      ledgerFields: {
        select: LEDGER_FIELDS_V1_DB_SELECT,
      },
    },
  });

  if (!asset) return null;

  const [snapshot, latestVeeamSignal] = await Promise.all([
    prisma.assetRunSnapshot.findFirst({
      where: { assetUuid },
      orderBy: { createdAt: 'desc' },
      select: { runId: true, canonical: true, createdAt: true },
    }),
    prisma.signalRecord.findFirst({
      where: { assetUuid, source: { sourceType: 'veeam' } },
      orderBy: { collectedAt: 'desc' },
      select: { raw: true },
    }),
  ]);

  let latestBackupAt: string | null = null;
  let latestBackupProcessedSize: number | null = null;

  if (latestVeeamSignal?.raw) {
    try {
      const raw = await decompressRaw(latestVeeamSignal.raw);
      const summary = pickLatestBackupSummary(raw);
      latestBackupAt = summary.latestBackupAt;
      latestBackupProcessedSize = summary.latestBackupProcessedSize;
    } catch {
      latestBackupAt = null;
      latestBackupProcessedSize = null;
    }
  }

  if (!latestBackupAt) {
    latestBackupAt = asset.operationalState?.backupLastSuccessAt?.toISOString() ?? null;
  }

  return {
    assetUuid: asset.uuid,
    assetType: asset.assetType,
    status: asset.status,
    mergedIntoAssetUuid: asset.mergedIntoAssetUuid ?? null,
    displayName: asset.displayName,
    machineNameOverride: asset.machineNameOverride,
    ipOverrideText: asset.ipOverrideText ?? null,
    osOverrideText: asset.osOverrideText ?? null,
    lastSeenAt: asset.lastSeenAt?.toISOString() ?? null,
    ledgerFields: buildLedgerFieldsV1FromRow(asset.ledgerFields),
    operationalState: {
      backupCovered: asset.operationalState?.backupCovered ?? null,
      backupState: asset.operationalState?.backupState ?? null,
      backupLastSuccessAt: asset.operationalState?.backupLastSuccessAt?.toISOString() ?? null,
      backupLastResult: asset.operationalState?.backupLastResult ?? null,
      backupUpdatedAt: asset.operationalState?.backupUpdatedAt?.toISOString() ?? null,
      monitorCovered: asset.operationalState?.monitorCovered ?? null,
      monitorState: asset.operationalState?.monitorState ?? null,
      monitorStatus: asset.operationalState?.monitorStatus ?? null,
      monitorUpdatedAt: asset.operationalState?.monitorUpdatedAt?.toISOString() ?? null,
    },
    latestBackupAt,
    latestBackupProcessedSize,
    latestSnapshot: snapshot
      ? {
          runId: snapshot.runId,
          createdAt: snapshot.createdAt.toISOString(),
          canonical: snapshot.canonical,
        }
      : null,
  };
}

async function readAssetRelations(assetUuid: string): Promise<RelationItem[]> {
  const relations = await prisma.relation.findMany({
    where: { fromAssetUuid: assetUuid, status: 'active' },
    orderBy: { lastSeenAt: 'desc' },
    take: 200,
    include: {
      toAsset: {
        select: {
          uuid: true,
          assetType: true,
          displayName: true,
        },
      },
    },
  });

  return relations.map((relation) => ({
    relationId: relation.id,
    relationType: relation.relationType,
    toAssetUuid: relation.toAssetUuid,
    toAssetType: relation.toAsset?.assetType ?? null,
    toDisplayName: relation.toAsset?.displayName ?? null,
    sourceId: relation.sourceId,
    lastSeenAt: relation.lastSeenAt.toISOString(),
  }));
}

function encodeHistoryCursor(input: { occurredAt: Date; id: string }): string {
  const payload = JSON.stringify({ occurredAt: input.occurredAt.toISOString(), id: input.id });
  return Buffer.from(payload, 'utf8').toString('base64url');
}

async function listMergedAssetUuids(primaryAssetUuid: string): Promise<string[]> {
  const visited = new Set<string>([primaryAssetUuid]);
  let frontier: string[] = [primaryAssetUuid];
  const merged: string[] = [];

  const maxDepth = 10;
  const maxTotal = 200;

  for (let depth = 0; depth < maxDepth; depth += 1) {
    if (frontier.length === 0) break;
    if (merged.length >= maxTotal) break;

    const rows = await prisma.asset.findMany({
      where: { mergedIntoAssetUuid: { in: frontier } },
      select: { uuid: true },
      take: maxTotal - merged.length,
    });

    const next: string[] = [];
    for (const row of rows) {
      if (visited.has(row.uuid)) continue;
      visited.add(row.uuid);
      merged.push(row.uuid);
      next.push(row.uuid);
    }

    frontier = next;
  }

  return merged;
}

async function readAssetHistory(assetUuid: string, limit: number): Promise<AssetHistoryResponse> {
  const mergedUuids = await listMergedAssetUuids(assetUuid);
  const scopeUuids = [assetUuid, ...mergedUuids];

  const rows = await prisma.assetHistoryEvent.findMany({
    where: { assetUuid: { in: scopeUuids } },
    orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
    select: {
      id: true,
      assetUuid: true,
      eventType: true,
      occurredAt: true,
      title: true,
      summary: true,
      refs: true,
    },
  });

  const items: AssetHistoryEventItem[] = rows.slice(0, limit).map((event) => ({
    eventId: event.id,
    assetUuid,
    sourceAssetUuid: event.assetUuid !== assetUuid ? event.assetUuid : null,
    eventType: event.eventType,
    occurredAt: event.occurredAt.toISOString(),
    title: event.title,
    summary: event.summary,
    refs: (event.refs ?? {}) as Record<string, unknown>,
  }));

  const nextRow = rows[limit];

  return {
    items,
    nextCursor: nextRow ? encodeHistoryCursor(nextRow) : null,
  };
}

export async function readAssetsPageServerData(input: {
  userId: string;
  listQueryString: string;
}): Promise<AssetsPageServerData> {
  const [sourceOptionsResult, ledgerFieldOptionsResult, visibleColumnsResult, listResult] = await Promise.allSettled([
    readSourcesSummary(),
    readLedgerFieldFilterOptions(),
    readAssetsTableVisibleColumns(input.userId),
    listAssets(new URLSearchParams(input.listQueryString)),
  ]);

  return {
    sourceOptions: sourceOptionsResult.status === 'fulfilled' ? sourceOptionsResult.value : [],
    ledgerFieldFilterOptions:
      ledgerFieldOptionsResult.status === 'fulfilled'
        ? ledgerFieldOptionsResult.value
        : EMPTY_LEDGER_FIELD_FILTER_OPTIONS,
    visibleColumns: visibleColumnsResult.status === 'fulfilled' ? visibleColumnsResult.value : null,
    list: listResult.status === 'fulfilled' ? listResult.value : null,
  };
}

export async function readAssetDetailPageServerData(input: {
  uuid: string;
  historyLimit?: number;
}): Promise<AssetDetailPageServerData> {
  let assetResult: AssetDetail | null = null;
  try {
    assetResult = await readAssetDetail(input.uuid);
  } catch {
    assetResult = null;
  }

  if (!assetResult) {
    return {
      asset: null,
      relations: [],
      history: null,
    };
  }

  const historyLimit = Number.isFinite(input.historyLimit) && input.historyLimit ? Math.max(1, input.historyLimit) : 20;

  const [relationsResult, historyResult] = await Promise.allSettled([
    readAssetRelations(input.uuid),
    readAssetHistory(input.uuid, historyLimit),
  ]);

  return {
    asset: assetResult,
    relations: relationsResult.status === 'fulfilled' ? relationsResult.value : [],
    history: historyResult.status === 'fulfilled' ? historyResult.value : null,
  };
}
