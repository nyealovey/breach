import path from 'node:path';

import { loadConfig } from './config';
import { createHandler } from './handler';
import { createLogger } from './logger';
import { runPowerShellJsonFile } from './powershell';

let loaded: ReturnType<typeof loadConfig>;
try {
  loaded = loadConfig({ argv: process.argv, importMetaUrl: import.meta.url });
} catch (err) {
  console.error(`[hyperv-agent] config error: ${err instanceof Error ? err.message : String(err)}`);
  console.error('[hyperv-agent] expected config file: hyperv-agent.config.json (or pass --config <path>)');
  process.exit(1);
}

const psTimeoutMs = loaded.config.ps_timeout_ms;
const { logger, logDir } = createLogger({ baseDir: loaded.baseDir, config: loaded.config.log });

function scriptPath(name: string): string {
  return path.join(loaded.scriptsDir, name);
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
  hostname: loaded.config.bind,
  port: loaded.config.port,
  fetch: createHandler({ token: loaded.config.token, deps, logger }),
});

console.log(`[hyperv-agent] config: ${loaded.configPath}`);
console.log(`[hyperv-agent] scripts: ${loaded.scriptsDir}`);
console.log(`[hyperv-agent] logs: ${logDir}`);
console.log(`[hyperv-agent] listening on http://${loaded.config.bind}:${loaded.config.port}`);
