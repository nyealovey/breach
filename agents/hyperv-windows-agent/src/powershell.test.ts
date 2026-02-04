import { describe, expect, it } from 'vitest';

import { PowerShellExecError, runPowerShellJsonFile } from './powershell';

describe('runPowerShellJsonFile', () => {
  it('does not crash the process when PowerShell cannot be spawned', async () => {
    await expect(
      runPowerShellJsonFile({
        powershellExe: '__no_such_powershell__',
        scriptPath: 'C:\\nope\\healthcheck.ps1',
        timeoutMs: 1_000,
      }),
    ).rejects.toBeInstanceOf(PowerShellExecError);
  });
});
