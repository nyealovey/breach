import { expect, it } from 'vitest';

import { MergeConflictStrategy } from '@prisma/client';

it('exports MergeConflictStrategy enum (merge schema)', () => {
  expect(MergeConflictStrategy.primary_wins).toBe('primary_wins');
});
