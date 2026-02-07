import { describe, expect, it, vi } from 'vitest';

import { validateAndNormalizeAdSourceConfig } from '@/lib/sources/ad-source';

describe('validateAndNormalizeAdSourceConfig', () => {
  it('requires purpose/server/base_dn for activedirectory', async () => {
    const prisma = {
      source: { findMany: vi.fn().mockResolvedValue([]) },
    } as any;

    const result = await validateAndNormalizeAdSourceConfig({
      prisma,
      sourceType: 'activedirectory',
      credentialId: 'cred_1',
      config: { endpoint: 'ldaps://dc01.example.com:636' },
    });

    expect(result.ok).toBe(false);
  });

  it('normalizes auth source suffixes and endpoint aliases', async () => {
    const prisma = {
      source: { findMany: vi.fn().mockResolvedValue([]) },
    } as any;

    const result = await validateAndNormalizeAdSourceConfig({
      prisma,
      sourceType: 'activedirectory',
      credentialId: 'cred_1',
      config: {
        purpose: 'auth_collect',
        endpoint: 'ldaps://dc01.example.com:636',
        base_dn: 'DC=example,DC=com',
        upn_suffixes: ['EXAMPLE.com', '@sub.example.com'],
      },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.normalizedConfig.server_url).toBe('ldaps://dc01.example.com:636');
      expect(result.normalizedConfig.upn_suffixes).toEqual(['example.com', 'sub.example.com']);
    }
  });

  it('rejects conflicting suffixes across auth sources', async () => {
    const prisma = {
      source: {
        findMany: vi
          .fn()
          .mockResolvedValue([{ id: 'src_1', config: { purpose: 'auth_only', upn_suffixes: ['example.com'] } }]),
      },
    } as any;

    const result = await validateAndNormalizeAdSourceConfig({
      prisma,
      sourceType: 'activedirectory',
      credentialId: 'cred_1',
      config: {
        purpose: 'auth_collect',
        endpoint: 'ldaps://dc02.example.com:636',
        base_dn: 'DC=example,DC=com',
        upn_suffixes: ['example.com'],
      },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain('upn_suffixes conflict');
    }
  });
});
