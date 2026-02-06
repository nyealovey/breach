import { ErrorCode } from '@/lib/errors/error-codes';

import type { AppError } from '@/lib/errors/error';

export type LedgerFieldKey =
  | 'region'
  | 'company'
  | 'department'
  | 'systemCategory'
  | 'systemLevel'
  | 'bizOwner'
  | 'maintenanceDueDate'
  | 'purchaseDate'
  | 'bmcIp'
  | 'cabinetNo'
  | 'rackPosition'
  | 'managementCode'
  | 'fixedAssetNo';

type LedgerFieldKind = 'string' | 'date' | 'ipv4';
type LedgerFieldScope = 'vm_host' | 'host_only';

export type LedgerFieldMeta = {
  key: LedgerFieldKey;
  labelZh: string;
  kind: LedgerFieldKind;
  scope: LedgerFieldScope;
};

const LEDGER_FIELDS_V1: LedgerFieldMeta[] = [
  // ===== common (vm + host) =====
  { key: 'region', labelZh: '地区', kind: 'string', scope: 'vm_host' },
  { key: 'company', labelZh: '公司', kind: 'string', scope: 'vm_host' },
  { key: 'department', labelZh: '部门', kind: 'string', scope: 'vm_host' },
  { key: 'systemCategory', labelZh: '系统分类', kind: 'string', scope: 'vm_host' },
  { key: 'systemLevel', labelZh: '系统分级', kind: 'string', scope: 'vm_host' },
  { key: 'bizOwner', labelZh: '业务对接人员', kind: 'string', scope: 'vm_host' },

  // ===== host-only =====
  { key: 'maintenanceDueDate', labelZh: '维保时间', kind: 'date', scope: 'host_only' },
  { key: 'purchaseDate', labelZh: '购买时间', kind: 'date', scope: 'host_only' },
  { key: 'bmcIp', labelZh: '管理IP（BMC/ILO）', kind: 'ipv4', scope: 'host_only' },
  { key: 'cabinetNo', labelZh: '机柜编号', kind: 'string', scope: 'host_only' },
  { key: 'rackPosition', labelZh: '机架位置', kind: 'string', scope: 'host_only' },
  { key: 'managementCode', labelZh: '管理码', kind: 'string', scope: 'host_only' },
  { key: 'fixedAssetNo', labelZh: '固定资产编号', kind: 'string', scope: 'host_only' },
];

const LEDGER_FIELD_META_BY_KEY: Record<LedgerFieldKey, LedgerFieldMeta> = Object.fromEntries(
  LEDGER_FIELDS_V1.map((m) => [m.key, m]),
) as Record<LedgerFieldKey, LedgerFieldMeta>;

export type LedgerFieldLayer = 'source' | 'override';

export type LedgerFieldSourceColumn = `${LedgerFieldKey}Source`;
export type LedgerFieldOverrideColumn = `${LedgerFieldKey}Override`;

export const LEDGER_FIELDS_V1_DB_SELECT = {
  regionSource: true,
  regionOverride: true,
  companySource: true,
  companyOverride: true,
  departmentSource: true,
  departmentOverride: true,
  systemCategorySource: true,
  systemCategoryOverride: true,
  systemLevelSource: true,
  systemLevelOverride: true,
  bizOwnerSource: true,
  bizOwnerOverride: true,
  maintenanceDueDateSource: true,
  maintenanceDueDateOverride: true,
  purchaseDateSource: true,
  purchaseDateOverride: true,
  bmcIpSource: true,
  bmcIpOverride: true,
  cabinetNoSource: true,
  cabinetNoOverride: true,
  rackPositionSource: true,
  rackPositionOverride: true,
  managementCodeSource: true,
  managementCodeOverride: true,
  fixedAssetNoSource: true,
  fixedAssetNoOverride: true,
} as const;

const LEDGER_FIELD_DB_COLUMNS_BY_KEY: Record<
  LedgerFieldKey,
  { source: LedgerFieldSourceColumn; override: LedgerFieldOverrideColumn }
> = {
  region: { source: 'regionSource', override: 'regionOverride' },
  company: { source: 'companySource', override: 'companyOverride' },
  department: { source: 'departmentSource', override: 'departmentOverride' },
  systemCategory: { source: 'systemCategorySource', override: 'systemCategoryOverride' },
  systemLevel: { source: 'systemLevelSource', override: 'systemLevelOverride' },
  bizOwner: { source: 'bizOwnerSource', override: 'bizOwnerOverride' },
  maintenanceDueDate: { source: 'maintenanceDueDateSource', override: 'maintenanceDueDateOverride' },
  purchaseDate: { source: 'purchaseDateSource', override: 'purchaseDateOverride' },
  bmcIp: { source: 'bmcIpSource', override: 'bmcIpOverride' },
  cabinetNo: { source: 'cabinetNoSource', override: 'cabinetNoOverride' },
  rackPosition: { source: 'rackPositionSource', override: 'rackPositionOverride' },
  managementCode: { source: 'managementCodeSource', override: 'managementCodeOverride' },
  fixedAssetNo: { source: 'fixedAssetNoSource', override: 'fixedAssetNoOverride' },
};

export type LedgerFieldValueV1 = {
  source: string | null;
  override: string | null;
  effective: string | null;
};

export type LedgerFieldsV1 = Record<LedgerFieldKey, LedgerFieldValueV1>;

export type LedgerFieldsAssetType = 'vm' | 'host' | 'cluster';

export function listLedgerFieldMetasV1(): LedgerFieldMeta[] {
  return LEDGER_FIELDS_V1.slice();
}

export function isLedgerFieldKeyV1(input: string): input is LedgerFieldKey {
  return (input as LedgerFieldKey) in LEDGER_FIELD_META_BY_KEY;
}

export function getLedgerFieldMetaV1(key: string): LedgerFieldMeta | null {
  return isLedgerFieldKeyV1(key) ? LEDGER_FIELD_META_BY_KEY[key] : null;
}

export function getLedgerFieldDbColumnV1(key: LedgerFieldKey, layer: 'source'): LedgerFieldSourceColumn;
export function getLedgerFieldDbColumnV1(key: LedgerFieldKey, layer: 'override'): LedgerFieldOverrideColumn;
export function getLedgerFieldDbColumnV1(
  key: LedgerFieldKey,
  layer: LedgerFieldLayer,
): LedgerFieldSourceColumn | LedgerFieldOverrideColumn {
  return LEDGER_FIELD_DB_COLUMNS_BY_KEY[key][layer];
}

export function getLedgerFieldDbColumnsV1(key: LedgerFieldKey): {
  source: LedgerFieldSourceColumn;
  override: LedgerFieldOverrideColumn;
} {
  return LEDGER_FIELD_DB_COLUMNS_BY_KEY[key];
}

export function isLedgerFieldAllowedForAssetType(meta: LedgerFieldMeta, assetType: LedgerFieldsAssetType): boolean {
  if (assetType === 'host') return true;
  if (assetType === 'vm') return meta.scope === 'vm_host';
  return false;
}

export function buildEmptyLedgerFieldsV1(): LedgerFieldsV1 {
  return {
    region: { source: null, override: null, effective: null },
    company: { source: null, override: null, effective: null },
    department: { source: null, override: null, effective: null },
    systemCategory: { source: null, override: null, effective: null },
    systemLevel: { source: null, override: null, effective: null },
    bizOwner: { source: null, override: null, effective: null },
    maintenanceDueDate: { source: null, override: null, effective: null },
    purchaseDate: { source: null, override: null, effective: null },
    bmcIp: { source: null, override: null, effective: null },
    cabinetNo: { source: null, override: null, effective: null },
    rackPosition: { source: null, override: null, effective: null },
    managementCode: { source: null, override: null, effective: null },
    fixedAssetNo: { source: null, override: null, effective: null },
  };
}

export function computeLedgerFieldEffectiveValueV1(input: {
  source: string | null;
  override: string | null;
}): string | null {
  return input.override ?? input.source;
}

export function extractLedgerFieldEffectiveValueV1(value: LedgerFieldValueV1): string | null {
  return computeLedgerFieldEffectiveValueV1({ source: value.source, override: value.override });
}

function parseIsoDateOnly(input: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input);
  if (!m) return null;

  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;

  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCFullYear() !== year) return null;
  if (d.getUTCMonth() + 1 !== month) return null;
  if (d.getUTCDate() !== day) return null;

  return d;
}

function isIpv4(input: string): boolean {
  const parts = input.split('.');
  if (parts.length !== 4) return false;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return false;
    const n = Number(part);
    if (!Number.isFinite(n) || n < 0 || n > 255) return false;
  }
  return true;
}

export function normalizeLedgerFieldValueV1(
  meta: LedgerFieldMeta,
  value: string | null,
): {
  dbValue: string | Date | null;
  displayValue: string | null;
} {
  if (value === null) return { dbValue: null, displayValue: null };

  const trimmed = value.trim();
  if (trimmed.length === 0) return { dbValue: null, displayValue: null };

  if (meta.kind === 'string') {
    if (trimmed.length > 256) {
      throw {
        code: ErrorCode.CONFIG_LEDGER_FIELD_VALUE_INVALID,
        category: 'config',
        message: `ledger field "${meta.key}" exceeds max length`,
        retryable: false,
        redacted_context: { key: meta.key, maxLen: 256 },
      } satisfies AppError;
    }
    return { dbValue: trimmed, displayValue: trimmed };
  }

  if (meta.kind === 'ipv4') {
    if (!isIpv4(trimmed)) {
      throw {
        code: ErrorCode.CONFIG_LEDGER_FIELD_VALUE_INVALID,
        category: 'config',
        message: `ledger field "${meta.key}" must be a valid ipv4`,
        retryable: false,
        redacted_context: { key: meta.key },
      } satisfies AppError;
    }
    return { dbValue: trimmed, displayValue: trimmed };
  }

  if (meta.kind === 'date') {
    const parsed = parseIsoDateOnly(trimmed);
    if (!parsed) {
      throw {
        code: ErrorCode.CONFIG_LEDGER_FIELD_VALUE_INVALID,
        category: 'config',
        message: `ledger field "${meta.key}" must be YYYY-MM-DD`,
        retryable: false,
        redacted_context: { key: meta.key },
      } satisfies AppError;
    }
    return { dbValue: parsed, displayValue: trimmed };
  }

  throw {
    code: ErrorCode.INTERNAL_ERROR,
    category: 'unknown',
    message: 'unsupported ledger field kind',
    retryable: false,
    redacted_context: { key: meta.key, kind: meta.kind },
  } satisfies AppError;
}

function formatLedgerFieldStoredValueV1(meta: LedgerFieldMeta, dbValue: unknown): string | null {
  if (dbValue === null || dbValue === undefined) return null;

  if (meta.kind === 'date') {
    if (!(dbValue instanceof Date)) return null;
    return dbValue.toISOString().slice(0, 10);
  }

  return typeof dbValue === 'string' ? dbValue : null;
}

export function buildLedgerFieldsV1FromRow(
  row: Partial<Record<LedgerFieldSourceColumn | LedgerFieldOverrideColumn, unknown>> | null | undefined,
): LedgerFieldsV1 {
  const out = buildEmptyLedgerFieldsV1();

  for (const meta of LEDGER_FIELDS_V1) {
    const columns = getLedgerFieldDbColumnsV1(meta.key);
    const source = formatLedgerFieldStoredValueV1(meta, row ? row[columns.source] : undefined);
    const override = formatLedgerFieldStoredValueV1(meta, row ? row[columns.override] : undefined);
    out[meta.key] = {
      source,
      override,
      effective: computeLedgerFieldEffectiveValueV1({ source, override }),
    };
  }

  return out;
}

export function summarizeLedgerValue(value: string | null): string | null {
  if (value === null) return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length <= 120) return trimmed;
  return `${trimmed.slice(0, 117)}...`;
}
