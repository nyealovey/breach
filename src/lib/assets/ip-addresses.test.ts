import { describe, expect, it } from 'vitest';

import { filterIpAddressesForDisplay, formatIpAddressesForDisplay } from '@/lib/assets/ip-addresses';

describe('ip address display helpers', () => {
  it('filters link-local 169.254.* addresses', () => {
    expect(formatIpAddressesForDisplay(['192.0.2.10', '169.254.1.2'])).toBe('192.0.2.10');
  });

  it('trims, de-dupes, and joins', () => {
    expect(filterIpAddressesForDisplay([' 198.51.100.10 ', '198.51.100.10', '169.254.9.9'])).toEqual(['198.51.100.10']);
    expect(formatIpAddressesForDisplay([' 203.0.113.10 ', '203.0.113.11'])).toBe('203.0.113.10, 203.0.113.11');
  });

  it('returns null when no displayable ip exists', () => {
    expect(formatIpAddressesForDisplay(['169.254.1.2'])).toBeNull();
    expect(formatIpAddressesForDisplay(null)).toBeNull();
  });
});
