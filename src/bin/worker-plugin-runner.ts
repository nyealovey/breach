import { extname } from 'node:path';

export function buildPluginCommand(pluginPath: string): { cmd: string; args: string[] } {
  const ext = extname(pluginPath).toLowerCase();

  // Support PowerShell plugins without relying on executable bit/shebang.
  if (ext === '.ps1') {
    return { cmd: 'pwsh', args: ['-NoProfile', '-NonInteractive', '-File', pluginPath] };
  }

  return { cmd: pluginPath, args: [] };
}
