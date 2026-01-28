import { describe, expect, it } from 'vitest';

import { toPublicError } from '@/lib/errors/error';

describe('toPublicError', () => {
  it('returns INTERNAL_ERROR for unknown input', () => {
    expect(toPublicError('x').code).toBe('INTERNAL_ERROR');
  });
});
