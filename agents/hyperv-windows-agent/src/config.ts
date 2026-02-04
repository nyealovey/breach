import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export type HypervAgentLogLevel = 'debug' | 'info' | 'error';

export type HypervAgentConfig = {
  bind: string;
  port: number;
  token: string;
  ps_timeout_ms: number;
  log: {
    dir: string;
    level: HypervAgentLogLevel;
    retain_days: number;
  };
};

export type LoadedHypervAgentConfig = {
  baseDir: string;
  configPath: string;
  scriptsDir: string;
  config: HypervAgentConfig;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asInt(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value)) return null;
  return value;
}

function asPositiveInt(value: unknown): number | null {
  const n = asInt(value);
  if (n === null || n <= 0) return null;
  return n;
}

function asPort(value: unknown): number | null {
  const n = asPositiveInt(value);
  if (n === null || n > 65535) return null;
  return n;
}

function parseLogLevel(value: unknown): HypervAgentLogLevel | null {
  if (value === 'debug' || value === 'info' || value === 'error') return value;
  return null;
}

export function detectBaseDir(importMetaUrl: string): string {
  const execName = path.basename(process.execPath).toLowerCase();
  const isRuntime = execName === 'bun' || execName === 'bun.exe' || execName === 'node' || execName === 'node.exe';

  if (!isRuntime) return path.dirname(process.execPath);
  return path.dirname(fileURLToPath(importMetaUrl));
}

function isValidFileUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === 'file:';
  } catch {
    return false;
  }
}

export function detectImportMetaUrlFallback(): string {
  // In some compiled environments import.meta.url can be opaque. This fallback keeps the
  // baseDir logic stable by mapping execPath to a file URL.
  return pathToFileURL(process.execPath).toString();
}

export function parseConfigPathFromArgv(argv: string[]): string | null {
  const idx = argv.lastIndexOf('--config');
  if (idx === -1) return null;
  const candidate = argv[idx + 1];
  const p = asNonEmptyString(candidate);
  if (!p) throw new Error('--config requires a path');
  return p;
}

function resolveConfigPath(baseDir: string, value: string): string {
  return path.isAbsolute(value) ? value : path.join(baseDir, value);
}

export function loadConfig(args: { argv: string[]; importMetaUrl: string }): LoadedHypervAgentConfig {
  const importMetaUrl = isValidFileUrl(args.importMetaUrl) ? args.importMetaUrl : detectImportMetaUrlFallback();
  const baseDir = detectBaseDir(importMetaUrl);
  const configArg = parseConfigPathFromArgv(args.argv);
  const configPath = resolveConfigPath(baseDir, configArg ?? 'hyperv-agent.config.json');

  const rawText = readFileSync(configPath, 'utf8');
  const raw = JSON.parse(rawText) as unknown;
  if (!isRecord(raw)) throw new Error('config must be a JSON object');

  const token = asNonEmptyString(raw.token);
  if (!token) throw new Error('token is required');

  const bind = asNonEmptyString(raw.bind) ?? '127.0.0.1';
  const port = raw.port === undefined ? 8787 : asPort(raw.port);
  if (!port) throw new Error('port must be an integer between 1 and 65535');

  const ps_timeout_ms = raw.ps_timeout_ms === undefined ? 600_000 : asPositiveInt(raw.ps_timeout_ms);
  if (!ps_timeout_ms) throw new Error('ps_timeout_ms must be a positive integer');

  const logRaw = raw.log === undefined ? {} : raw.log;
  if (!isRecord(logRaw)) throw new Error('log must be an object');

  const logDir = asNonEmptyString(logRaw.dir) ?? 'logs';
  const logLevel = logRaw.level === undefined ? 'info' : parseLogLevel(logRaw.level);
  if (!logLevel) throw new Error("log.level must be one of 'debug' | 'info' | 'error'");

  const retain_days = logRaw.retain_days === undefined ? 14 : asInt(logRaw.retain_days);
  if (retain_days === null || retain_days < 0) throw new Error('log.retain_days must be an integer >= 0');

  const config: HypervAgentConfig = {
    bind,
    port,
    token,
    ps_timeout_ms,
    log: { dir: logDir, level: logLevel, retain_days },
  };

  return {
    baseDir,
    configPath,
    scriptsDir: path.join(baseDir, 'scripts'),
    config,
  };
}
