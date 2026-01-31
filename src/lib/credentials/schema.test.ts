import { describe, expect, it } from 'vitest';

import { CredentialCreateSchema } from '@/lib/credentials/schema';

describe('CredentialCreateSchema', () => {
  it('rejects missing payload field for vcenter', () => {
    const result = CredentialCreateSchema.safeParse({ name: 'c1', type: 'vcenter', payload: { username: 'u' } });
    expect(result.success).toBe(false);
  });

  it('accepts pve api_token credentials', () => {
    const result = CredentialCreateSchema.safeParse({
      name: 'pve-1',
      type: 'pve',
      payload: { auth_type: 'api_token', api_token_id: 'user@pam!tokenid', api_token_secret: 'secret' },
    });
    expect(result.success).toBe(true);
  });

  it('accepts pve user_password credentials (auth_type explicit)', () => {
    const result = CredentialCreateSchema.safeParse({
      name: 'pve-2',
      type: 'pve',
      payload: { auth_type: 'user_password', username: 'root@pam', password: 'pass' },
    });
    expect(result.success).toBe(true);
  });

  it('accepts pve user_password credentials (back-compat without auth_type)', () => {
    const result = CredentialCreateSchema.safeParse({
      name: 'pve-3',
      type: 'pve',
      payload: { username: 'root@pam', password: 'pass' },
    });
    expect(result.success).toBe(true);
  });

  it('accepts hyperv username/password credentials', () => {
    const result = CredentialCreateSchema.safeParse({
      name: 'hv-1',
      type: 'hyperv',
      payload: { username: 'Administrator', password: 'pass' },
    });
    expect(result.success).toBe(true);
  });

  it('accepts hyperv domain username/password credentials', () => {
    const result = CredentialCreateSchema.safeParse({
      name: 'hv-2',
      type: 'hyperv',
      payload: { domain: 'CORP', username: 'Administrator', password: 'pass' },
    });
    expect(result.success).toBe(true);
  });
});
