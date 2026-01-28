import { describe, expect, it } from 'vitest';

import { getLocalParts, localDateToUtcDateOnly } from '@/lib/timezone';

describe('timezone helpers', () => {
  it('formats localDate + hhmm in target tz', () => {
    const now = new Date('2026-01-01T00:00:00.000Z');
    const parts = getLocalParts(now, 'Asia/Shanghai');
    expect(parts.localDate).toBe('2026-01-01');
    expect(parts.hhmm).toBe('08:00');
  });

  it('stores date-only as utc midnight', () => {
    const d = localDateToUtcDateOnly('2026-01-01');
    expect(d.toISOString()).toBe('2026-01-01T00:00:00.000Z');
  });
});
