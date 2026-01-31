import { describe, expect, it } from 'vitest';

import { getAssetFieldMeta } from '@/lib/assets/asset-field-registry';

describe('asset field registry', () => {
  it('returns localized meta for known structured fields', () => {
    expect(getAssetFieldMeta('identity.hostname')).toMatchObject({
      labelZh: '机器名',
      groupA: 'common',
      groupB: 'identity',
      formatHint: 'string',
    });

    expect(getAssetFieldMeta('hardware.memory_bytes')).toMatchObject({
      labelZh: '内存',
      groupB: 'hardware',
      formatHint: 'bytes',
    });
  });

  it('treats attributes.* as extension fields by default', () => {
    expect(getAssetFieldMeta('attributes.custom_key')).toEqual({
      labelZh: '扩展字段：custom_key',
      groupA: 'attributes',
      groupB: 'attributes',
      formatHint: 'json',
    });
  });

  it('keeps unknown fields visible with fallback meta', () => {
    expect(getAssetFieldMeta('weird.path')).toEqual({
      labelZh: '-',
      groupA: 'unknown',
      groupB: 'other',
      formatHint: 'json',
    });
  });
});
