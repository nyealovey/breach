import { describe, expect, it } from 'vitest';

import { backupStateDisplay } from '@/lib/assets/backup-state';

describe('backupStateDisplay', () => {
  it('returns null when no backup info exists', () => {
    expect(backupStateDisplay({ backupCovered: null, backupState: null })).toBeNull();
  });

  it('maps covered=false to not_covered', () => {
    const display = backupStateDisplay({ backupCovered: false, backupState: null });
    expect(display).toMatchObject({ state: 'not_covered', labelZh: '未覆盖' });
  });

  it('maps success state', () => {
    const display = backupStateDisplay({ backupCovered: true, backupState: 'success' });
    expect(display).toMatchObject({ state: 'success', labelZh: '成功' });
  });

  it('normalizes unknown backupState to unknown', () => {
    const display = backupStateDisplay({ backupCovered: true, backupState: 'weird_state' });
    expect(display).toMatchObject({ state: 'unknown', labelZh: '未知' });
  });
});
