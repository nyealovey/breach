import { mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { HypervAgentLogLevel } from './config';

export type HypervAgentLogger = {
  debug: (event: Record<string, unknown>) => void;
  info: (event: Record<string, unknown>) => void;
  error: (event: Record<string, unknown>) => void;
};

type LoggerConfig = {
  dir: string;
  level: HypervAgentLogLevel;
  retain_days: number;
};

function levelRank(level: HypervAgentLogLevel): number {
  if (level === 'debug') return 10;
  if (level === 'info') return 20;
  return 30;
}

export function formatLocalDate(d: Date): string {
  const yyyy = String(d.getFullYear()).padStart(4, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function safeJsonLine(value: unknown): string {
  try {
    return `${JSON.stringify(value)}\n`;
  } catch {
    return `${JSON.stringify({ ts: new Date().toISOString(), level: 'error', message: 'log serialization failed' })}\n`;
  }
}

function cleanupOldLogs(logDir: string, retainDays: number, nowMs: number) {
  if (!Number.isFinite(retainDays) || retainDays <= 0) return;

  const cutoffMs = nowMs - retainDays * 24 * 60 * 60 * 1000;
  try {
    for (const entry of readdirSync(logDir, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      if (!entry.name.startsWith('hyperv-agent-') || !entry.name.endsWith('.jsonl')) continue;

      const full = path.join(logDir, entry.name);
      try {
        const st = statSync(full);
        if (st.mtimeMs < cutoffMs) rmSync(full, { force: true });
      } catch {
        // ignore per-file failures
      }
    }
  } catch {
    // ignore cleanup failures
  }
}

function defaultFallbackLogDir(): string {
  if (process.platform === 'win32') {
    // Prefer ProgramData for services. It's stable across working directories and usually writable.
    const programData =
      process.env.PROGRAMDATA && process.env.PROGRAMDATA.trim() ? process.env.PROGRAMDATA : 'C:\\ProgramData';
    return path.join(programData, 'breach', 'hyperv-agent', 'logs');
  }
  return path.join(tmpdir(), 'breach', 'hyperv-agent', 'logs');
}

function ensureDir(dir: string): boolean {
  try {
    mkdirSync(dir, { recursive: true });
    return true;
  } catch {
    return false;
  }
}

export function createLogger(args: { baseDir: string; config: LoggerConfig; now?: () => Date }): {
  logger: HypervAgentLogger;
  logDir: string;
} {
  const now = args.now ?? (() => new Date());
  const desiredLogDir = path.isAbsolute(args.config.dir) ? args.config.dir : path.join(args.baseDir, args.config.dir);
  let logDir = desiredLogDir;

  if (!ensureDir(logDir)) {
    const fallback = defaultFallbackLogDir();
    if (ensureDir(fallback)) {
      // Avoid crashing the agent due to log directory ACLs (common when installed under Program Files).
      console.error(`[hyperv-agent] log dir not writable: ${desiredLogDir}`);
      console.error(`[hyperv-agent] falling back to: ${fallback}`);
      logDir = fallback;
    } else {
      console.error(`[hyperv-agent] log dir not writable and fallback failed: ${desiredLogDir}`);
      console.error('[hyperv-agent] file logging disabled');
      logDir = '';
    }
  }

  cleanupOldLogs(logDir, args.config.retain_days, now().getTime());

  const minRank = levelRank(args.config.level);

  function write(level: HypervAgentLogLevel, event: Record<string, unknown>) {
    if (levelRank(level) < minRank) return;
    if (!logDir) return;

    const ts = new Date().toISOString();
    const payload = { ts, level, service: 'hyperv-windows-agent', ...event };
    const day = formatLocalDate(now());
    const file = path.join(logDir, `hyperv-agent-${day}.jsonl`);

    try {
      // Use append-only writes. Small JSONL lines are acceptable for this agent.
      writeFileSync(file, safeJsonLine(payload), { encoding: 'utf8', flag: 'a' });
    } catch {
      // Never crash the agent because of logging.
    }
  }

  const logger: HypervAgentLogger = {
    debug: (e) => write('debug', e),
    info: (e) => write('info', e),
    error: (e) => write('error', e),
  };

  return { logger, logDir };
}
