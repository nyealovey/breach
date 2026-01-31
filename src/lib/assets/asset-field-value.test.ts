import { describe, expect, it } from 'vitest';

import { formatAssetFieldValue } from '@/lib/assets/asset-field-value';

describe('asset field value formatter', () => {
  it('formats nullish as dash', () => {
    expect(formatAssetFieldValue(null)).toBe('-');
    expect(formatAssetFieldValue(undefined)).toBe('-');
  });

  it('formats booleans as 是/否', () => {
    expect(formatAssetFieldValue(true)).toBe('是');
    expect(formatAssetFieldValue(false)).toBe('否');
  });

  it('formats bytes as GiB/TiB', () => {
    expect(formatAssetFieldValue(1024 ** 3, { formatHint: 'bytes' })).toBe('1.0 GiB');
  });

  it('maps known enum values (power_state)', () => {
    expect(formatAssetFieldValue('poweredOn', { formatHint: 'enum' })).toBe('运行');
    expect(formatAssetFieldValue('poweredOff', { formatHint: 'enum' })).toBe('关机');
    expect(formatAssetFieldValue('suspended', { formatHint: 'enum' })).toBe('挂起');
  });

  it('joins primitive arrays', () => {
    expect(formatAssetFieldValue(['10.0.0.1', '10.0.0.2'])).toBe('10.0.0.1, 10.0.0.2');
  });
});
