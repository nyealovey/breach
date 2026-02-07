import { describe, expect, it } from 'vitest';

import {
  extractUpnSuffix,
  isAdAuthPurpose,
  isAdCollectPurpose,
  isLikelyUpn,
  normalizeUpn,
  normalizeUpnSuffixes,
  readAdBaseDn,
  readAdPurpose,
  readAdServerUrl,
  readAdUpnSuffixes,
} from '@/lib/directory/ad-source-config';

describe('ad source config utils', () => {
  it('normalizes upn and suffix arrays', () => {
    expect(normalizeUpn(' User@Example.COM ')).toBe('user@example.com');
    expect(normalizeUpnSuffixes(['@EXAMPLE.com', 'example.com', 'sub.example.com', ''])).toEqual([
      'example.com',
      'sub.example.com',
    ]);
  });

  it('parses ad config fields', () => {
    const config = {
      purpose: 'auth_collect',
      server_url: 'ldaps://dc01.example.com:636',
      base_dn: 'DC=example,DC=com',
      upn_suffixes: ['example.com'],
    };

    expect(readAdPurpose(config)).toBe('auth_collect');
    expect(readAdServerUrl(config)).toBe('ldaps://dc01.example.com:636');
    expect(readAdBaseDn(config)).toBe('DC=example,DC=com');
    expect(readAdUpnSuffixes(config)).toEqual(['example.com']);
  });

  it('handles purpose capability checks', () => {
    expect(isAdAuthPurpose('auth_collect')).toBe(true);
    expect(isAdAuthPurpose('auth_only')).toBe(true);
    expect(isAdAuthPurpose('collect_only')).toBe(false);

    expect(isAdCollectPurpose('auth_collect')).toBe(true);
    expect(isAdCollectPurpose('collect_only')).toBe(true);
    expect(isAdCollectPurpose('auth_only')).toBe(false);
  });

  it('extracts suffix and validates upn shape', () => {
    expect(extractUpnSuffix('user@example.com')).toBe('example.com');
    expect(extractUpnSuffix('invalid-user')).toBeNull();
    expect(isLikelyUpn('user@example.com')).toBe(true);
    expect(isLikelyUpn('admin')).toBe(false);
  });
});
