import { describe, expect, it } from 'vitest';

import { buildKerberosPrincipalCandidates, buildKinitArgs } from './kerberos';

describe('buildKerberosPrincipalCandidates', () => {
  it('keeps UPN principal and adds uppercase realm variant when needed', () => {
    const principals = buildKerberosPrincipalCandidates({
      rawUsername: 'alice@dev.example.com',
      domain: 'dev',
      realmFromHost: 'EXAMPLE.COM',
    });

    expect(principals[0]).toBe('alice@dev.example.com');
    expect(principals).toContain('alice@DEV.EXAMPLE.COM');
  });

  it('derives realm from host and netbios domain', () => {
    const principals = buildKerberosPrincipalCandidates({
      rawUsername: 'user.name',
      domain: 'dev',
      realmFromHost: 'EXAMPLE.COM',
    });

    expect(principals).toEqual(['user.name@DEV.EXAMPLE.COM', 'user.name@EXAMPLE.COM']);
  });

  it('returns empty when realm cannot be derived and username is not UPN', () => {
    const principals = buildKerberosPrincipalCandidates({
      rawUsername: 'bob',
      realmFromHost: null,
      domain: undefined,
    });

    expect(principals).toEqual([]);
  });
});

describe('buildKinitArgs', () => {
  it('uses password-file and enterprise when requested', () => {
    expect(
      buildKinitArgs({
        principal: 'alice@dev.example.com',
        passwordFilePath: '/tmp/pw',
        enterprise: true,
      }),
    ).toEqual(['--enterprise', '--password-file=/tmp/pw', 'alice@dev.example.com']);
  });

  it('returns empty when principal or passwordFilePath missing', () => {
    expect(buildKinitArgs({ principal: '', passwordFilePath: '/tmp/pw' })).toEqual([]);
    expect(buildKinitArgs({ principal: 'u@r', passwordFilePath: '' })).toEqual([]);
  });
});
