import { describe, expect, test } from 'vitest';

import { buildKerberosSpnStrategy, normalizeKerberosServiceName } from './kerberos-spn';

describe('normalizeKerberosServiceName', () => {
  test('defaults to WSMAN', () => {
    expect(normalizeKerberosServiceName(undefined)).toBe('WSMAN');
    expect(normalizeKerberosServiceName('')).toBe('WSMAN');
  });

  test('normalizes case and trims', () => {
    expect(normalizeKerberosServiceName(' wsman ')).toBe('WSMAN');
    expect(normalizeKerberosServiceName('http')).toBe('HTTP');
    expect(normalizeKerberosServiceName('HOST')).toBe('HOST');
  });

  test('rejects unknown values', () => {
    expect(normalizeKerberosServiceName('WSS')).toBe('WSMAN');
  });
});

describe('buildKerberosSpnStrategy', () => {
  test('strict default: only WSMAN + no hostname override', () => {
    expect(
      buildKerberosSpnStrategy({
        host: 'host01.example.com',
        preferredServiceName: undefined,
        enableFallback: false,
        hostnameOverride: undefined,
      }),
    ).toEqual({
      serviceCandidates: ['WSMAN'],
      hostnameOverrides: [null],
    });
  });

  test('fallback enabled: adds HTTP/HOST + short hostname for FQDN', () => {
    expect(
      buildKerberosSpnStrategy({
        host: 'host01.example.com',
        preferredServiceName: 'WSMAN',
        enableFallback: true,
        hostnameOverride: undefined,
      }),
    ).toEqual({
      serviceCandidates: ['WSMAN', 'HTTP', 'HOST'],
      hostnameOverrides: [null, 'host01'],
    });
  });

  test('fallback enabled: preferred service is first (deduped)', () => {
    expect(
      buildKerberosSpnStrategy({
        host: 'host01.example.com',
        preferredServiceName: 'HTTP',
        enableFallback: true,
        hostnameOverride: undefined,
      }),
    ).toEqual({
      serviceCandidates: ['HTTP', 'WSMAN', 'HOST'],
      hostnameOverrides: [null, 'host01'],
    });
  });

  test('explicit hostnameOverride disables auto short-host guess', () => {
    expect(
      buildKerberosSpnStrategy({
        host: 'host01.example.com',
        preferredServiceName: 'WSMAN',
        enableFallback: true,
        hostnameOverride: 'HOST01',
      }),
    ).toEqual({
      serviceCandidates: ['WSMAN', 'HTTP', 'HOST'],
      hostnameOverrides: ['HOST01'],
    });
  });
});
