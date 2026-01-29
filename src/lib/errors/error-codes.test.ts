import { describe, expect, it } from 'vitest';

import { ErrorCode } from '@/lib/errors/error-codes';

describe('ErrorCode', () => {
  it('includes CONFIG_CREDENTIAL_NOT_FOUND', () => {
    expect(ErrorCode.CONFIG_CREDENTIAL_NOT_FOUND).toBe('CONFIG_CREDENTIAL_NOT_FOUND');
  });
});

