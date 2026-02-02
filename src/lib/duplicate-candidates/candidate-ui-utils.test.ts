import { describe, expect, it } from 'vitest';

import { compareCandidateFieldValues, extractCandidateReasons } from '@/lib/duplicate-candidates/candidate-ui-utils';

describe('duplicate candidate ui utils', () => {
  describe('extractCandidateReasons', () => {
    it('accepts legacy array shape', () => {
      const reasons = extractCandidateReasons([{ code: 'vm.mac_overlap', weight: 90 }]);
      expect(reasons.map((r) => r.code)).toEqual(['vm.mac_overlap']);
    });

    it('accepts dup-rules-v1 envelope shape', () => {
      const reasons = extractCandidateReasons({
        version: 'dup-rules-v1',
        matched_rules: [{ code: 'vm.mac_overlap', weight: 90 }],
      });
      expect(reasons.map((r) => r.code)).toEqual(['vm.mac_overlap']);
    });

    it('filters out invalid items', () => {
      const reasons = extractCandidateReasons({
        version: 'dup-rules-v1',
        matched_rules: [{ code: 'vm.mac_overlap', weight: 90 }, { weight: 10 }, null],
      });
      expect(reasons.map((r) => r.code)).toEqual(['vm.mac_overlap']);
    });
  });

  describe('compareCandidateFieldValues', () => {
    it('treats missing values as missing (not match)', () => {
      expect(compareCandidateFieldValues(undefined, undefined)).toBe('missing');
      expect(compareCandidateFieldValues('', ' ')).toBe('missing');
      expect(compareCandidateFieldValues([], [])).toBe('missing');
    });

    it('normalizes strings + arrays for matching', () => {
      expect(compareCandidateFieldValues('  Foo ', 'Foo')).toBe('match');
      expect(compareCandidateFieldValues(['B', 'a'], ['a', 'b'])).toBe('match');
    });

    it('returns mismatch otherwise', () => {
      expect(compareCandidateFieldValues('a', 'b')).toBe('mismatch');
      expect(compareCandidateFieldValues('a', ' ')).toBe('mismatch');
    });
  });
});
