import { describe, expect, it } from 'vitest';

import { parseAssetDetailTab } from '@/lib/assets/page-data';

describe('asset detail page data', () => {
  it('defaults to overview when tab is missing', () => {
    expect(parseAssetDetailTab(null)).toBe('overview');
  });

  it('accepts debug tab', () => {
    expect(parseAssetDetailTab('debug')).toBe('debug');
  });

  it('falls back to overview for unsupported tab values', () => {
    expect(parseAssetDetailTab('unsupported')).toBe('overview');
  });
});
