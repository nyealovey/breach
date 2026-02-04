import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { describe, expect, it } from 'vitest';

import { loadConfig } from './config';

function makeTempDir(prefix: string): string {
  return mkdtempSync(path.join(tmpdir(), prefix));
}

describe('hyperv windows agent config', () => {
  it('loads defaults from config file', () => {
    const dir = makeTempDir('hyperv-agent-config-');
    writeFileSync(path.join(dir, 'hyperv-agent.config.json'), JSON.stringify({ token: 't' }), 'utf8');

    const loaded = loadConfig({
      argv: ['bun', 'server.ts'],
      importMetaUrl: pathToFileURL(path.join(dir, 'server.ts')).toString(),
    });

    expect(loaded.baseDir).toBe(dir);
    expect(loaded.configPath).toBe(path.join(dir, 'hyperv-agent.config.json'));
    expect(loaded.configDir).toBe(dir);
    expect(loaded.config.token).toBe('t');
    expect(loaded.config.bind).toBe('127.0.0.1');
    expect(loaded.config.port).toBe(8787);
    expect(loaded.config.ps_timeout_ms).toBe(600_000);
    expect(loaded.config.log.dir).toBe('logs');
    expect(loaded.config.log.level).toBe('info');
    expect(loaded.config.log.retain_days).toBe(14);
    expect(loaded.scriptsDir).toBe(path.join(dir, 'scripts'));
  });

  it('supports --config override (relative to CWD; fallback to baseDir)', () => {
    const baseDir = makeTempDir('hyperv-agent-config-base-');
    const cwd = makeTempDir('hyperv-agent-config-cwd-');
    writeFileSync(path.join(baseDir, 'custom.json'), JSON.stringify({ token: 'base', port: 9999 }), 'utf8');
    writeFileSync(path.join(cwd, 'custom.json'), JSON.stringify({ token: 'cwd', port: 8888 }), 'utf8');

    const loaded = loadConfig({
      argv: ['hyperv-windows-agent.exe', '--config', 'custom.json'],
      importMetaUrl: pathToFileURL(path.join(baseDir, 'server.ts')).toString(),
      cwd,
    });

    expect(loaded.configPath).toBe(path.join(cwd, 'custom.json'));
    expect(loaded.config.token).toBe('cwd');
    expect(loaded.config.port).toBe(8888);
  });

  it('throws when token is missing', () => {
    const dir = makeTempDir('hyperv-agent-config-');
    writeFileSync(path.join(dir, 'hyperv-agent.config.json'), JSON.stringify({}), 'utf8');

    expect(() =>
      loadConfig({ argv: ['bun', 'server.ts'], importMetaUrl: pathToFileURL(path.join(dir, 'server.ts')).toString() }),
    ).toThrow(/token is required/i);
  });
});
