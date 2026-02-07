import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export function resolveBunBin(): string {
  const env = (process.env.BUN_BIN ?? process.env.BUN ?? '').trim();
  if (env) return env;

  const candidate = join(homedir(), '.bun', 'bin', process.platform === 'win32' ? 'bun.exe' : 'bun');
  if (existsSync(candidate)) return candidate;

  return 'bun';
}
