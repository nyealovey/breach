import { describe, expect, it } from 'vitest';

import { formatAssetListIpText, parsePrivateIpPrefixes } from '@/lib/ip/asset-list-ip-display';

describe('parsePrivateIpPrefixes', () => {
  it('returns empty array for empty input', () => {
    expect(parsePrivateIpPrefixes(undefined)).toEqual([]);
    expect(parsePrivateIpPrefixes('')).toEqual([]);
    expect(parsePrivateIpPrefixes('   ')).toEqual([]);
  });

  it('splits by comma, trims, drops empties, and de-dupes while preserving order', () => {
    expect(parsePrivateIpPrefixes(' 169., 172., ,169. , ')).toEqual(['169.', '172.']);
  });
});

describe('formatAssetListIpText', () => {
  it('returns null for non-array inputs', () => {
    expect(formatAssetListIpText(null, [])).toBeNull();
    expect(formatAssetListIpText(undefined, [])).toBeNull();
    expect(formatAssetListIpText('203.0.113.10', [])).toBeNull();
    expect(formatAssetListIpText({ value: ['203.0.113.10'] }, [])).toBeNull();
  });

  it('keeps existing behavior when no private prefixes are configured', () => {
    expect(formatAssetListIpText(['203.0.113.10', ' 203.0.113.10 ', '198.51.100.1'], [])).toBe(
      '203.0.113.10, 198.51.100.1',
    );
  });

  it('prefers non-private IPs when both private and non-private are present', () => {
    expect(formatAssetListIpText(['192.0.2.10', '203.0.113.10'], ['192.0.2.'])).toBe('203.0.113.10');
  });

  it('falls back to private IPs when all IPs are private', () => {
    expect(formatAssetListIpText(['192.0.2.10'], ['192.0.2.'])).toBe('192.0.2.10');
  });
});
