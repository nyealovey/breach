import { describe, expect, it } from 'vitest';

import { ErrorCode } from '@/lib/errors/error-codes';

import type { Prisma } from '@prisma/client';
import type { AppError } from '@/lib/errors/error';

describe('AppError Prisma JSON compatibility', () => {
  it('can be stored as Prisma JSON without losing core fields', () => {
    const err: AppError = {
      code: ErrorCode.DB_WRITE_FAILED,
      category: 'db',
      message: 'Failed to write',
      retryable: false,
      redacted_context: { table: 'Run' },
    };

    // Compile-time safety: AppError must be assignable to Prisma.InputJsonValue.
    const json: Prisma.InputJsonValue = err;

    expect(() => JSON.stringify(json)).not.toThrow();
    expect(JSON.parse(JSON.stringify(json))).toMatchObject({
      code: ErrorCode.DB_WRITE_FAILED,
      category: 'db',
    });
  });
});
