import { describe, expect, it } from 'vitest';

import { groupAssetFieldsForDisplay } from '@/lib/assets/asset-field-display';

describe('asset field display grouping', () => {
  it('groups flattened canonical fields by groupA/groupB and enriches meta', () => {
    const grouped = groupAssetFieldsForDisplay([
      { path: 'runtime.power_state', value: 'poweredOn', sourcesCount: 1, conflict: false },
      { path: 'identity.hostname', value: 'vm-01', sourcesCount: 2, conflict: true },
      { path: 'attributes.custom_key', value: 'x', sourcesCount: 1, conflict: false },
      { path: 'weird.path', value: 123, sourcesCount: 0, conflict: false },
    ]);

    expect(grouped.map((g) => g.groupA)).toEqual(['common', 'attributes', 'unknown']);

    const common = grouped[0]!;
    expect(common.labelZh).toBe('通用字段');
    expect(common.groups[0]?.groupB).toBe('identity');
    expect(common.groups[0]?.rows[0]).toMatchObject({
      path: 'identity.hostname',
      labelZh: '机器名',
      sourcesCount: 2,
      conflict: true,
    });
  });
});
