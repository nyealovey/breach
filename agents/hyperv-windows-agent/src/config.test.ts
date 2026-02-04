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
    expect(loaded.config.token).toBe('t');
    expect(loaded.config.bind).toBe('127.0.0.1');
    expect(loaded.config.port).toBe(8787);
    expect(loaded.config.ps_timeout_ms).toBe(600_000);
    expect(loaded.config.log.dir).toBe('logs');
    expect(loaded.config.log.level).toBe('info');
    expect(loaded.config.log.retain_days).toBe(14);
    expect(loaded.scriptsDir).toBe(path.join(dir, 'scripts'));
  });

  it('supports --config override (relative to baseDir)', () => {
    const dir = makeTempDir('hyperv-agent-config-');
    writeFileSync(path.join(dir, 'custom.json'), JSON.stringify({ token: 'x', port: 9999 }), 'utf8');

    const loaded = loadConfig({
      argv: ['hyperv-windows-agent.exe', '--config', 'custom.json'],
      importMetaUrl: pathToFileURL(path.join(dir, 'server.ts')).toString(),
    });

    expect(loaded.configPath).toBe(path.join(dir, 'custom.json'));
    expect(loaded.config.token).toBe('x');
    expect(loaded.config.port).toBe(9999);
  });

  it('throws when token is missing', () => {
    const dir = makeTempDir('hyperv-agent-config-');
    writeFileSync(path.join(dir, 'hyperv-agent.config.json'), JSON.stringify({}), 'utf8');

    expect(() =>
      loadConfig({ argv: ['bun', 'server.ts'], importMetaUrl: pathToFileURL(path.join(dir, 'server.ts')).toString() }),
    ).toThrow(/token is required/i);
  });
});
