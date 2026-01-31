import { AssetType } from '@prisma/client';
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

export type LedgerFieldsV1Value = string | null;

export type LedgerFieldsV1 = Record<LedgerFieldKey, LedgerFieldsV1Value>;

export function listLedgerFieldMetasV1(): LedgerFieldMeta[] {
  return LEDGER_FIELDS_V1.slice();
}

export function isLedgerFieldKeyV1(input: string): input is LedgerFieldKey {
  return (input as LedgerFieldKey) in LEDGER_FIELD_META_BY_KEY;
}

export function getLedgerFieldMetaV1(key: string): LedgerFieldMeta | null {
  return isLedgerFieldKeyV1(key) ? LEDGER_FIELD_META_BY_KEY[key] : null;
}

export function isLedgerFieldAllowedForAssetType(meta: LedgerFieldMeta, assetType: AssetType): boolean {
  if (assetType === AssetType.host) return true;
  if (assetType === AssetType.vm) return meta.scope === 'vm_host';
  return false;
}

export function buildEmptyLedgerFieldsV1(): LedgerFieldsV1 {
  return {
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

export function formatLedgerFieldValueV1(meta: LedgerFieldMeta, dbValue: unknown): string | null {
  if (dbValue === null || dbValue === undefined) return null;

  if (meta.kind === 'date') {
    if (!(dbValue instanceof Date)) return null;
    return dbValue.toISOString().slice(0, 10);
  }

  return typeof dbValue === 'string' ? dbValue : null;
}

export function buildLedgerFieldsV1FromRow(
  row: Partial<Record<LedgerFieldKey, unknown>> | null | undefined,
): LedgerFieldsV1 {
  const out = buildEmptyLedgerFieldsV1();

  for (const meta of LEDGER_FIELDS_V1) {
    const v = row ? row[meta.key] : undefined;
    out[meta.key] = formatLedgerFieldValueV1(meta, v);
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
