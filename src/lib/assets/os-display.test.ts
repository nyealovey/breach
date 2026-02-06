import { describe, expect, it } from 'vitest';

import { formatOsForDisplay } from '@/lib/assets/os-display';

describe('formatOsForDisplay', () => {
  it('formats vm os name+version', () => {
    expect(formatOsForDisplay({ assetType: 'vm', name: 'Ubuntu', version: '20.04', fingerprint: 'ignored' })).toBe(
      'Ubuntu 20.04',
    );
  });

  it('falls back to name/version/fingerprint for vms', () => {
    expect(formatOsForDisplay({ assetType: 'vm', name: 'Ubuntu', version: null, fingerprint: 'fp' })).toBe('Ubuntu');
    expect(formatOsForDisplay({ assetType: 'vm', name: null, version: '20.04', fingerprint: 'fp' })).toBe('20.04');
    expect(formatOsForDisplay({ assetType: 'vm', name: null, version: null, fingerprint: 'RHEL_8_64' })).toBe(
      'RHEL_8_64',
    );
    expect(formatOsForDisplay({ assetType: 'vm', name: '  ', version: ' ', fingerprint: '  ' })).toBeNull();
  });

  it('does not fall back to fingerprint for hosts when version is missing', () => {
    expect(formatOsForDisplay({ assetType: 'host', name: 'ESXi', version: '7.0.3', fingerprint: '20036589' })).toBe(
      'ESXi 7.0.3',
    );
    expect(formatOsForDisplay({ assetType: 'host', name: 'ESXi', version: null, fingerprint: '20036589' })).toBeNull();
    expect(formatOsForDisplay({ assetType: 'host', name: null, version: '7.0.3', fingerprint: '20036589' })).toBeNull();
    expect(formatOsForDisplay({ assetType: 'host', name: null, version: null, fingerprint: '20036589' })).toBeNull();
  });
});
