import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createHandler } from './handler';
import { runPowerShellJsonFile } from './powershell';

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v || v.trim().length === 0) throw new Error(`${name} is required`);
  return v.trim();
}

const token = requireEnv('HYPERV_AGENT_TOKEN');
const bind = (process.env.HYPERV_AGENT_BIND ?? '127.0.0.1').trim();
const port = Number(process.env.HYPERV_AGENT_PORT ?? '8787');
const psTimeoutMs = Number(process.env.HYPERV_AGENT_PS_TIMEOUT_MS ?? '600000');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const scriptsDir = path.join(__dirname, 'scripts');

function scriptPath(name: string): string {
  return path.join(scriptsDir, name);
}

const deps = {
  run: async (mode: 'healthcheck' | 'detect' | 'collect', input: any) => {
    if (mode === 'healthcheck') {
      return runPowerShellJsonFile({ scriptPath: scriptPath('healthcheck.ps1'), timeoutMs: psTimeoutMs });
    }
    if (mode === 'detect') {
      return runPowerShellJsonFile({
        scriptPath: scriptPath('detect.ps1'),
        scriptArgs: ['-ConfiguredScope', String(input.scope ?? 'auto')],
        timeoutMs: psTimeoutMs,
      });
    }
    return runPowerShellJsonFile({
      scriptPath: scriptPath('collect.ps1'),
      scriptArgs: ['-Scope', String(input.scope ?? 'auto'), '-MaxParallelNodes', String(input.max_parallel_nodes ?? 5)],
      timeoutMs: psTimeoutMs,
    });
  },
};

const bun = (globalThis as any).Bun;
if (!bun?.serve) {
  console.error('[hyperv-agent] Bun.serve not available (run with `bun run src/server.ts`)');
  process.exit(1);
}

bun.serve({
  hostname: bind,
  port,
  fetch: createHandler({ token, deps }),
});

console.log(`[hyperv-agent] listening on http://${bind}:${port}`);
