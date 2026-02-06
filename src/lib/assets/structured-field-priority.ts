import { getAssetFieldMeta } from '@/lib/assets/asset-field-registry';

import type { AssetFieldRow } from '@/lib/assets/asset-field-display';
import type { AssetFieldFormatHint, AssetFieldGroupA, AssetFieldGroupB } from '@/lib/assets/asset-field-registry';

export type StructuredFieldRowForDisplay = AssetFieldRow & { groupTitle: string };

const VM_PRIORITY_PATHS: string[] = [
  'identity.hostname',
  'identity.caption',
  'os.name',
  'os.version',
  'os.fingerprint',
  'network.ip_addresses',
  'hardware.cpu_count',
  'hardware.memory_bytes',
  'hardware.disks',
  'runtime.power_state',
  'runtime.tools_running',
  'runtime.tools_status',
];

const HOST_PRIORITY_PATHS: string[] = [
  'identity.hostname',
  'os.name',
  'os.version',
  'os.fingerprint',
  'network.ip_addresses',
  'hardware.cpu_count',
  'hardware.memory_bytes',
  'runtime.power_state',
];

function buildDisplayNameRow(input: { displayName: string | null; assetUuid: string }): StructuredFieldRowForDisplay {
  const value = input.displayName?.trim() ? input.displayName.trim() : input.assetUuid;
  return {
    path: 'asset.display_name',
    value,
    sourcesCount: 0,
    conflict: false,
    labelZh: '名字',
    groupA: 'common' as AssetFieldGroupA,
    groupB: 'identity' as AssetFieldGroupB,
    formatHint: 'string' as AssetFieldFormatHint,
    groupTitle: '关键字段',
  };
}

function buildPlaceholderRow(path: string): StructuredFieldRowForDisplay {
  const meta = getAssetFieldMeta(path);
  return {
    path,
    value: null,
    sourcesCount: 0,
    conflict: false,
    ...meta,
    groupTitle: '关键字段',
  };
}

export function prioritizeStructuredFieldRows(input: {
  assetType: string;
  displayName: string | null;
  assetUuid: string;
  rows: StructuredFieldRowForDisplay[];
}): StructuredFieldRowForDisplay[] {
  const out: StructuredFieldRowForDisplay[] = [];
  const byPath = new Map(input.rows.map((r) => [r.path, r]));
  const used = new Set<string>();

  out.push(buildDisplayNameRow({ displayName: input.displayName, assetUuid: input.assetUuid }));
  used.add('asset.display_name');

  const priorityPaths =
    input.assetType === 'vm' ? VM_PRIORITY_PATHS : input.assetType === 'host' ? HOST_PRIORITY_PATHS : [];

  for (const path of priorityPaths) {
    const existing = byPath.get(path);
    out.push(existing ?? buildPlaceholderRow(path));
    used.add(path);
  }

  // Keep the remaining (non-priority) rows in their existing stable order.
  for (const row of input.rows) {
    if (used.has(row.path)) continue;
    out.push(row);
  }

  return out;
}
