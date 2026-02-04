import { describe, expect, it } from 'vitest';

import { compactId } from '@/lib/ui/compact-id';

describe('compactId', () => {
  it('returns original when id is short enough', () => {
    expect(compactId('abc')).toBe('abc');
  });

  it('compacts long ids with defaults', () => {
    expect(compactId('cml4fz2tx0008ke8t5bm2eeuo')).toBe('cml4fz2t\u2026bm2eeuo');
  });

  it('supports edge cases (tail=0)', () => {
    expect(compactId('abcdefghijklmnopqrstuvwxyz', { head: 4, tail: 0 })).toBe('abcd\u2026');
  });
});
