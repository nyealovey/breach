import { describe, expect, it } from 'vitest';

import { CredentialCreateSchema } from '@/lib/credentials/schema';

describe('CredentialCreateSchema', () => {
  it('rejects missing payload field for vcenter', () => {
    const result = CredentialCreateSchema.safeParse({ name: 'c1', type: 'vcenter', payload: { username: 'u' } });
    expect(result.success).toBe(false);
  });
});

