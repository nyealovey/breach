import { describe, expect, it } from 'vitest';

import { buildPluginCommand } from './worker-plugin-runner';

describe('buildPluginCommand', () => {
  it('wraps .ps1 plugins with pwsh -File', () => {
    expect(buildPluginCommand('plugins/hyperv/index.ps1')).toEqual({
      cmd: 'pwsh',
      args: ['-NoProfile', '-NonInteractive', '-File', 'plugins/hyperv/index.ps1'],
    });
  });

  it('runs other plugin paths directly', () => {
    expect(buildPluginCommand('plugins/hyperv/index.ts')).toEqual({ cmd: 'plugins/hyperv/index.ts', args: [] });
  });
});
