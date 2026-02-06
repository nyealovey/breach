import { createHash } from 'node:crypto';

export const ASSET_LEDGER_EXPORT_V1_VERSION = 'asset-ledger-export-v1' as const;
export const ASSET_LEDGER_EXPORT_V1_FORMAT = 'csv' as const;

export const ASSET_LEDGER_EXPORT_V1_COLUMNS = [
  // ===== base columns (SRS hard requirements) =====
  'asset_uuid',
  'asset_type',
  'status',
  'display_name',
  'last_seen_at',
  'source_id',
  'source_type',

  // ===== ledger-fields-v1 =====
  'region',
  'company',
  'department',
  'systemCategory',
  'systemLevel',
  'bizOwner',

  // host-only (vm left empty)
  'maintenanceDueDate',
  'purchaseDate',
  'bmcIp',
  'cabinetNo',
  'rackPosition',
  'managementCode',
  'fixedAssetNo',
] as const;

export type AssetLedgerExportV1Column = (typeof ASSET_LEDGER_EXPORT_V1_COLUMNS)[number];

export type AssetLedgerExportV1Row = Record<AssetLedgerExportV1Column, string>;

function formatIsoUtcSeconds(date: Date): string {
  // PRD: ISO 8601 UTC with trailing "Z" (example omits milliseconds).
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function formatDateOnly(date: Date): string {
  // Prisma Date-only columns are represented as Date; export as YYYY-MM-DD.
  return date.toISOString().slice(0, 10);
}

export function escapeCsvField(value: string): string {
  // RFC 4180 style:
  // - If field contains comma, quote or newline: wrap in quotes
  // - Escape quote as doubled quote
  if (value.includes('"')) value = value.replaceAll('"', '""');
  if (value.includes(',') || value.includes('\n') || value.includes('"')) return `"${value}"`;
  return value;
}

export function toCsvLine(fields: string[]): string {
  return fields.map(escapeCsvField).join(',');
}

export function buildAssetLedgerExportV1Row(input: {
  asset: {
    uuid: string;
    assetType: 'vm' | 'host';
    status: 'in_service' | 'offline';
    displayName: string | null;
    lastSeenAt: Date | null;
  };
  sourceLinks: Array<{ sourceId: string; sourceType: string }>;
  ledgerFields: {
    regionSource: string | null;
    regionOverride: string | null;
    companySource: string | null;
    companyOverride: string | null;
    departmentSource: string | null;
    departmentOverride: string | null;
    systemCategorySource: string | null;
    systemCategoryOverride: string | null;
    systemLevelSource: string | null;
    systemLevelOverride: string | null;
    bizOwnerSource: string | null;
    bizOwnerOverride: string | null;
    maintenanceDueDateSource: Date | null;
    maintenanceDueDateOverride: Date | null;
    purchaseDateSource: Date | null;
    purchaseDateOverride: Date | null;
    bmcIpSource: string | null;
    bmcIpOverride: string | null;
    cabinetNoSource: string | null;
    cabinetNoOverride: string | null;
    rackPositionSource: string | null;
    rackPositionOverride: string | null;
    managementCodeSource: string | null;
    managementCodeOverride: string | null;
    fixedAssetNoSource: string | null;
    fixedAssetNoOverride: string | null;
  } | null;
}): AssetLedgerExportV1Row {
  const sortedSources = [...input.sourceLinks]
    .filter((s) => s.sourceId.trim().length > 0)
    .sort((a, b) => a.sourceId.localeCompare(b.sourceId));

  const sourceIds = sortedSources.map((s) => s.sourceId).join(';');
  const sourceTypes = sortedSources.map((s) => s.sourceType).join(';');

  const lf = input.ledgerFields;
  const isHost = input.asset.assetType === 'host';
  const pickString = (overrideValue: string | null | undefined, sourceValue: string | null | undefined) =>
    overrideValue ?? sourceValue ?? '';
  const pickDate = (overrideValue: Date | null | undefined, sourceValue: Date | null | undefined) => {
    const v = overrideValue ?? sourceValue;
    return v ? formatDateOnly(v) : '';
  };

  return {
    asset_uuid: input.asset.uuid,
    asset_type: input.asset.assetType,
    status: input.asset.status,
    display_name: input.asset.displayName ?? '',
    last_seen_at: input.asset.lastSeenAt ? formatIsoUtcSeconds(input.asset.lastSeenAt) : '',
    source_id: sourceIds,
    source_type: sourceTypes,

    region: pickString(lf?.regionOverride, lf?.regionSource),
    company: pickString(lf?.companyOverride, lf?.companySource),
    department: pickString(lf?.departmentOverride, lf?.departmentSource),
    systemCategory: pickString(lf?.systemCategoryOverride, lf?.systemCategorySource),
    systemLevel: pickString(lf?.systemLevelOverride, lf?.systemLevelSource),
    bizOwner: pickString(lf?.bizOwnerOverride, lf?.bizOwnerSource),

    maintenanceDueDate: isHost ? pickDate(lf?.maintenanceDueDateOverride, lf?.maintenanceDueDateSource) : '',
    purchaseDate: isHost ? pickDate(lf?.purchaseDateOverride, lf?.purchaseDateSource) : '',
    bmcIp: isHost ? pickString(lf?.bmcIpOverride, lf?.bmcIpSource) : '',
    cabinetNo: isHost ? pickString(lf?.cabinetNoOverride, lf?.cabinetNoSource) : '',
    rackPosition: isHost ? pickString(lf?.rackPositionOverride, lf?.rackPositionSource) : '',
    managementCode: isHost ? pickString(lf?.managementCodeOverride, lf?.managementCodeSource) : '',
    fixedAssetNo: isHost ? pickString(lf?.fixedAssetNoOverride, lf?.fixedAssetNoSource) : '',
  };
}

export function buildAssetLedgerExportV1Csv(rows: AssetLedgerExportV1Row[]): string {
  const lines: string[] = [];
  lines.push(toCsvLine([...ASSET_LEDGER_EXPORT_V1_COLUMNS]));
  for (const row of rows) {
    const line = toCsvLine(ASSET_LEDGER_EXPORT_V1_COLUMNS.map((col) => row[col]));
    lines.push(line);
  }
  return `${lines.join('\n')}\n`;
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}
