import { describe, expect, it } from 'vitest';

import {
  buildDuplicateCandidatesUrlSearchParams,
  parseDuplicateCandidatesUrlState,
} from '@/lib/duplicate-candidates/duplicate-candidates-url';

describe('duplicate candidates url', () => {
  it('parses supported params and normalizes page/pageSize', () => {
    const params = new URLSearchParams({
      status: 'ignored',
      assetType: 'vm',
      confidence: 'High',
      page: '2',
      pageSize: '50',
    });

    expect(parseDuplicateCandidatesUrlState(params)).toEqual({
      status: 'ignored',
      assetType: 'vm',
      confidence: 'High',
      page: 2,
      pageSize: 50,
    });
  });

  it('defaults status=open and falls back to default page/pageSize', () => {
    const params = new URLSearchParams({ page: '0', pageSize: '33' });

    expect(parseDuplicateCandidatesUrlState(params)).toEqual({
      status: 'open',
      assetType: undefined,
      confidence: undefined,
      page: 1,
      pageSize: 20,
    });
  });

  it('builds URLSearchParams with normalization rules (omits defaults)', () => {
    const params = buildDuplicateCandidatesUrlSearchParams({
      status: 'open',
      assetType: 'host',
      confidence: 'Medium',
      page: 1,
      pageSize: 20,
    });

    expect(params.toString()).toBe('assetType=host&confidence=Medium');
  });
});
