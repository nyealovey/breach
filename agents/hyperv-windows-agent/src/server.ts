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
const { logger, logDir } = createLogger({ baseDir: loaded.configDir, config: loaded.config.log });

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

const startup = {
  config_path: loaded.configPath,
  scripts_dir: loaded.scriptsDir,
  bind: loaded.config.bind,
  port: loaded.config.port,
  logs_dir: logDir || '(disabled)',
};

// Print critical runtime info BEFORE listening, so even a listen failure can be debugged.
console.log(`[hyperv-agent] config: ${startup.config_path}`);
console.log(`[hyperv-agent] scripts: ${startup.scripts_dir}`);
console.log(`[hyperv-agent] logs: ${startup.logs_dir}`);
console.log(`[hyperv-agent] bind: ${startup.bind}`);
console.log(`[hyperv-agent] port: ${startup.port}`);

// Emit a startup line so operators can tail the log file even before the first request arrives.
logger.info({ event: 'agent.start', ...startup });

try {
  bun.serve({
    hostname: loaded.config.bind,
    port: loaded.config.port,
    fetch: createHandler({ token: loaded.config.token, deps, logger }),
  });
} catch (err) {
  const cause = err instanceof Error ? err.message : String(err);
  console.error(`[hyperv-agent] listen failed: ${cause}`);
  logger.error({ event: 'agent.listen_failed', ...startup, cause });
  process.exit(1);
}

console.log(`[hyperv-agent] listening on http://${loaded.config.bind}:${loaded.config.port}`);
