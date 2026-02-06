import { describe, expect, it } from 'vitest';

import { prioritizeStructuredFieldRows } from '@/lib/assets/structured-field-priority';

type Row = {
  path: string;
  value: unknown;
  sourcesCount: number;
  conflict: boolean;
  labelZh: string;
  groupA: any;
  groupB: any;
  formatHint: any;
  groupTitle: string;
};

function row(path: string, value: unknown): Row {
  return {
    path,
    value,
    sourcesCount: 1,
    conflict: false,
    labelZh: '-',
    groupA: 'common',
    groupB: 'other',
    formatHint: 'json',
    groupTitle: 'x',
  };
}

describe('prioritizeStructuredFieldRows', () => {
  it('prioritizes key vm fields in the same order as 盘点摘要, and injects placeholders', () => {
    const inputRows: Row[] = [
      row('network.ip_addresses', ['10.0.0.1']),
      row('identity.hostname', 'vm-guest'),
      row('attributes.foo', 'bar'),
    ];

    const out = prioritizeStructuredFieldRows({
      assetType: 'vm',
      displayName: 'vm-01',
      assetUuid: '550e8400-e29b-41d4-a716-446655440000',
      rows: inputRows as any,
    }) as Row[];

    const first = out[0];
    expect(first?.path).toBe('asset.display_name');
    expect(first?.value).toBe('vm-01');

    // Key order prefix: 名字 -> 机器名 -> 虚拟机名 -> 系统(3) -> IP
    expect(out.slice(0, 7).map((r) => r.path)).toEqual([
      'asset.display_name',
      'identity.hostname',
      'identity.caption',
      'os.name',
      'os.version',
      'os.fingerprint',
      'network.ip_addresses',
    ]);

    const caption = out.find((r) => r.path === 'identity.caption');
    expect(caption?.value).toBeNull();

    expect(out.at(-1)?.path).toBe('attributes.foo');
  });
});
