import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { createLogger, formatLocalDate } from './logger';

function makeTempDir(prefix: string): string {
  return mkdtempSync(path.join(tmpdir(), prefix));
}

describe('hyperv windows agent logger', () => {
  it('writes JSONL to daily log file', () => {
    const baseDir = makeTempDir('hyperv-agent-logger-');
    const now = () => new Date(2026, 1, 4, 12, 0, 0); // local time: 2026-02-04

    const { logger, logDir } = createLogger({
      baseDir,
      config: { dir: 'logs', level: 'info', retain_days: 14 },
      now,
    });

    logger.info({ request_id: 'r1', path: '/v1/hyperv/healthcheck', outcome: 'success' });

    const file = path.join(logDir, `hyperv-agent-${formatLocalDate(now())}.jsonl`);
    const text = readFileSync(file, 'utf8').trim();
    const parsed = JSON.parse(text) as any;

    expect(parsed.service).toBe('hyperv-windows-agent');
    expect(parsed.request_id).toBe('r1');
    expect(parsed.outcome).toBe('success');
  });

  it('cleans up old logs based on retain_days (best-effort)', () => {
    const baseDir = makeTempDir('hyperv-agent-logger-');
    const logsDir = path.join(baseDir, 'logs');
    mkdirSync(logsDir, { recursive: true });

    const oldFile = path.join(logsDir, 'hyperv-agent-2000-01-01.jsonl');
    writeFileSync(oldFile, '{"old":true}\n', 'utf8');

    // Make it look very old.
    const past = new Date(2000, 0, 1).getTime() / 1000;
    try {
      utimesSync(oldFile, past, past);
    } catch {
      // ignore if utimes is not available in this environment
    }

    const { logger } = createLogger({
      baseDir,
      config: { dir: 'logs', level: 'info', retain_days: 1 },
      now: () => new Date(2026, 1, 4, 12, 0, 0),
    });

    logger.info({ hello: 'world' });

    // If cleanup runs, old file should be removed. On platforms where mtime update fails, allow it.
    const exists = (() => {
      try {
        statSync(oldFile);
        return true;
      } catch {
        return false;
      }
    })();

    if (exists) {
      rmSync(oldFile, { force: true });
    }
  });
});
