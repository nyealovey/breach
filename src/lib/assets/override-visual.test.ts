import { describe, expect, it } from 'vitest';

import { getOverrideVisualMeta, resolveOverrideAndCurrentValue } from '@/lib/assets/override-visual';

describe('override visual helpers', () => {
  it('returns default visual state when override is missing', () => {
    expect(getOverrideVisualMeta({ overrideText: null, collectedText: 'value' })).toMatchObject({
      title: '未覆盖',
      borderClassName: 'border-slate-300 dark:border-slate-600',
    });
  });

  it('returns mismatch visual state when override differs from collected', () => {
    expect(getOverrideVisualMeta({ overrideText: 'override', collectedText: 'collected' })).toMatchObject({
      title: '覆盖≠采集',
      borderClassName: 'border-destructive',
    });
  });

  it('returns green visual state when override equals collected', () => {
    expect(getOverrideVisualMeta({ overrideText: 'same', collectedText: 'same' })).toMatchObject({
      title: '覆盖=采集',
      borderClassName: 'border-emerald-600 dark:border-emerald-500',
    });
  });

  it('returns blue visual state when collected value is empty but override exists', () => {
    expect(getOverrideVisualMeta({ overrideText: 'override', collectedText: null })).toMatchObject({
      title: '覆盖空值',
      borderClassName: 'border-blue-600 dark:border-blue-500',
    });
  });

  it('normalizes override and collected values before comparing', () => {
    expect(resolveOverrideAndCurrentValue({ overrideText: '  new  ', collectedText: '  old  ' })).toEqual({
      overrideText: 'new',
      collectedText: 'old',
      currentText: 'new',
      mismatch: true,
    });
  });
});
