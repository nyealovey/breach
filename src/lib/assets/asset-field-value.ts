import { powerStateLabelZh } from '@/lib/assets/power-state';

import type { AssetFieldFormatHint } from '@/lib/assets/asset-field-registry';

export type AssetFieldValueFormatOptions = {
  formatHint?: AssetFieldFormatHint;
};

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '-';

  const gib = bytes / 1024 ** 3;
  if (gib >= 1024) return `${(gib / 1024).toFixed(1)} TiB`;
  if (gib >= 10) return `${Math.round(gib)} GiB`;
  if (gib >= 1) return `${gib.toFixed(1)} GiB`;

  const mib = bytes / 1024 ** 2;
  if (mib >= 10) return `${Math.round(mib)} MiB`;
  if (mib >= 1) return `${mib.toFixed(1)} MiB`;

  return `${bytes} B`;
}

function formatPrimitive(value: string | number | boolean): string {
  if (typeof value === 'boolean') return value ? '是' : '否';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '-';
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : '-';
}

export function formatAssetFieldValue(value: unknown, options: AssetFieldValueFormatOptions = {}): string {
  if (value === null || value === undefined) return '-';

  if (typeof value === 'boolean') return value ? '是' : '否';

  if (typeof value === 'number') {
    if (options.formatHint === 'bytes') return formatBytes(value);
    return Number.isFinite(value) ? String(value) : '-';
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (options.formatHint === 'enum') {
      return powerStateLabelZh(trimmed);
    }
    return trimmed.length > 0 ? trimmed : '-';
  }

  if (Array.isArray(value)) {
    if (value.length === 0) return '-';
    if (value.every((v) => typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean')) {
      return (value as Array<string | number | boolean>).map(formatPrimitive).join(', ');
    }
    return `数组（${value.length}）`;
  }

  // Unknown object (avoid dumping JSON in default view).
  return '对象';
}
