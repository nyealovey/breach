import { getAssetFieldMeta } from '@/lib/assets/asset-field-registry';

import type { AssetFieldFormatHint, AssetFieldGroupA, AssetFieldGroupB } from '@/lib/assets/asset-field-registry';
import type { FlattenedCanonicalField } from '@/lib/assets/canonical-field';

export type AssetFieldRow = FlattenedCanonicalField & {
  labelZh: string;
  groupA: AssetFieldGroupA;
  groupB: AssetFieldGroupB;
  formatHint: AssetFieldFormatHint;
};

export type AssetFieldGroup = {
  groupA: AssetFieldGroupA;
  labelZh: string;
  groups: Array<{
    groupB: AssetFieldGroupB;
    labelZh: string;
    rows: AssetFieldRow[];
  }>;
};

const GROUP_A_ORDER: AssetFieldGroupA[] = ['common', 'vm', 'host', 'cluster', 'attributes', 'unknown'];
const GROUP_A_LABEL_ZH: Record<AssetFieldGroupA, string> = {
  common: '通用字段',
  vm: 'VM 专用字段',
  host: 'Host 专用字段',
  cluster: 'Cluster 专用字段',
  attributes: '扩展字段',
  ledger: '台账字段',
  unknown: '其他字段',
};

const GROUP_B_ORDER: AssetFieldGroupB[] = [
  'identity',
  'runtime',
  'os',
  'network',
  'hardware',
  'storage',
  'attributes',
  'other',
];
const GROUP_B_LABEL_ZH: Record<AssetFieldGroupB, string> = {
  identity: '身份',
  runtime: '运行状态',
  os: '操作系统',
  network: '网络',
  hardware: '硬件',
  storage: '存储',
  attributes: '扩展',
  other: '其他',
};

function orderIndex<T extends string>(value: T, order: readonly T[]): number {
  const idx = order.indexOf(value);
  return idx >= 0 ? idx : Number.MAX_SAFE_INTEGER;
}

export function groupAssetFieldsForDisplay(fields: FlattenedCanonicalField[]): AssetFieldGroup[] {
  const rows: AssetFieldRow[] = fields.map((f) => {
    const meta = getAssetFieldMeta(f.path);
    return { ...f, ...meta };
  });

  const byGroupA = new Map<AssetFieldGroupA, AssetFieldRow[]>();
  for (const row of rows) {
    const bucket = byGroupA.get(row.groupA);
    if (bucket) bucket.push(row);
    else byGroupA.set(row.groupA, [row]);
  }

  const result: AssetFieldGroup[] = [];
  const groupAs = Array.from(byGroupA.keys()).sort(
    (a, b) => orderIndex(a, GROUP_A_ORDER) - orderIndex(b, GROUP_A_ORDER),
  );
  for (const groupA of groupAs) {
    const groupRows = byGroupA.get(groupA);
    if (!groupRows || groupRows.length === 0) continue;

    const byGroupB = new Map<AssetFieldGroupB, AssetFieldRow[]>();
    for (const row of groupRows) {
      const bucket = byGroupB.get(row.groupB);
      if (bucket) bucket.push(row);
      else byGroupB.set(row.groupB, [row]);
    }

    const groups = Array.from(byGroupB.entries())
      .sort(([a], [b]) => orderIndex(a, GROUP_B_ORDER) - orderIndex(b, GROUP_B_ORDER))
      .map(([groupB, rows]) => ({
        groupB,
        labelZh: GROUP_B_LABEL_ZH[groupB] ?? groupB,
        rows: rows.slice().sort((a, b) => a.path.localeCompare(b.path)),
      }));

    result.push({
      groupA,
      labelZh: GROUP_A_LABEL_ZH[groupA] ?? groupA,
      groups,
    });
  }

  return result;
}
