import { describe, expect, test } from 'vitest';

import { buildPywinrmInput } from './pywinrm-input';

describe('buildPywinrmInput', () => {
  test('defaults to strict WSMAN SPN strategy', () => {
    expect(
      buildPywinrmInput(
        {
          host: 'host01.example.com',
          port: 5985,
          useHttps: false,
          rejectUnauthorized: true,
          rawUsername: 'user@example.com',
          password: 'redacted',
          kerberosServiceName: undefined,
          kerberosSpnFallback: undefined,
          kerberosHostnameOverride: undefined,
        },
        'Write-Output ok',
      ),
    ).toMatchObject({
      host: 'host01.example.com',
      port: 5985,
      use_https: false,
      username: 'user@example.com',
      password: 'redacted',
      transport: 'kerberos',
      kerberos_service_candidates: ['WSMAN'],
      kerberos_hostname_overrides: [null],
    });
  });

  test('fallback enabled includes HTTP/HOST and short hostname', () => {
    expect(
      buildPywinrmInput(
        {
          host: 'host01.example.com',
          port: 5985,
          useHttps: false,
          rejectUnauthorized: true,
          rawUsername: 'user@example.com',
          password: 'redacted',
          kerberosServiceName: 'WSMAN',
          kerberosSpnFallback: true,
          kerberosHostnameOverride: undefined,
        },
        'Write-Output ok',
      ),
    ).toMatchObject({
      kerberos_service_candidates: ['WSMAN', 'HTTP', 'HOST'],
      kerberos_hostname_overrides: [null, 'host01'],
    });
  });
});
