import { describe, expect, it } from 'vitest';

import {
  candidateStatusLabel,
  confidenceBadgeVariant,
  confidenceLabel,
} from '@/lib/duplicate-candidates/duplicate-candidates-ui';

describe('duplicate candidates ui', () => {
  it('confidenceLabel maps score to High/Medium', () => {
    expect(confidenceLabel(90)).toBe('High');
    expect(confidenceLabel(89)).toBe('Medium');
  });

  it('candidateStatusLabel maps status to Chinese label', () => {
    expect(candidateStatusLabel('open')).toBe('待处理');
    expect(candidateStatusLabel('ignored')).toBe('已忽略');
    expect(candidateStatusLabel('merged')).toBe('已合并');
  });

  it('confidenceBadgeVariant maps confidence to badge variant', () => {
    expect(confidenceBadgeVariant('High')).toBe('default');
    expect(confidenceBadgeVariant('Medium')).toBe('secondary');
  });
});
