import { describe, expect, it } from 'vitest';

import { ErrorCode } from '@/lib/errors/error-codes';
import { toPublicError } from '@/lib/errors/error';

import type { AppError } from '@/lib/errors/error';

describe('toPublicError', () => {
  it('returns INTERNAL_ERROR for unknown input', () => {
    expect(toPublicError('x').code).toBe('INTERNAL_ERROR');
  });

  it('passes through a known AppError (including db category)', () => {
    const err: AppError = {
      code: ErrorCode.DB_WRITE_FAILED,
      category: 'db',
      message: 'Failed to write',
      retryable: false,
      redacted_context: { table: 'Run' },
    };

    expect(toPublicError(err)).toEqual(err);
  });
});
