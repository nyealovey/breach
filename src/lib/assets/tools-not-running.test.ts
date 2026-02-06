import { describe, expect, it } from 'vitest';

import { shouldShowToolsNotRunning } from '@/lib/assets/tools-not-running';

describe('shouldShowToolsNotRunning', () => {
  it('returns true only for poweredOn vms with toolsRunning=false', () => {
    expect(shouldShowToolsNotRunning({ assetType: 'vm', powerState: 'poweredOn', toolsRunning: false })).toBe(true);

    expect(shouldShowToolsNotRunning({ assetType: 'vm', powerState: 'poweredOff', toolsRunning: false })).toBe(false);
    expect(shouldShowToolsNotRunning({ assetType: 'vm', powerState: 'poweredOn', toolsRunning: null })).toBe(false);
    expect(shouldShowToolsNotRunning({ assetType: 'host', powerState: 'poweredOn', toolsRunning: false })).toBe(false);
  });
});
