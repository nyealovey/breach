import { expect, it } from 'vitest';

import { DuplicateCandidateStatus } from '@prisma/client';

it('exports DuplicateCandidateStatus enum (dup-candidates schema)', () => {
  expect(DuplicateCandidateStatus.open).toBe('open');
  expect(DuplicateCandidateStatus.ignored).toBe('ignored');
  expect(DuplicateCandidateStatus.merged).toBe('merged');
});
