import { describe, expect, it, vi } from 'vitest';

async function loadDebugFlag(value: string | undefined): Promise<boolean> {
  vi.resetModules();

  // createEnv() runs at import-time; ensure required env vars exist first.
  process.env.DATABASE_URL ??= 'postgresql://postgres:postgres@localhost:5432/breach?schema=public';

  if (value === undefined) delete process.env.ASSET_LEDGER_DEBUG;
  else process.env.ASSET_LEDGER_DEBUG = value;

  // Test env intentionally disables validation globally; override here to verify parsing behavior.
  const prevSkip = process.env.SKIP_ENV_VALIDATION;
  process.env.SKIP_ENV_VALIDATION = '';
  try {
    const { serverEnv } = await import('@/lib/env/server');
    return serverEnv.ASSET_LEDGER_DEBUG;
  } finally {
    if (prevSkip === undefined) delete process.env.SKIP_ENV_VALIDATION;
    else process.env.SKIP_ENV_VALIDATION = prevSkip;
  }
}

describe('serverEnv', () => {
  it('parses ASSET_LEDGER_DEBUG (true/false/1/0; case-insensitive) and defaults to false', async () => {
    await expect(loadDebugFlag(undefined)).resolves.toBe(false);
    await expect(loadDebugFlag('true')).resolves.toBe(true);
    await expect(loadDebugFlag('false')).resolves.toBe(false);
    await expect(loadDebugFlag('1')).resolves.toBe(true);
    await expect(loadDebugFlag('0')).resolves.toBe(false);
    await expect(loadDebugFlag('TRUE')).resolves.toBe(true);
    await expect(loadDebugFlag('False')).resolves.toBe(false);
  });

  it('rejects invalid ASSET_LEDGER_DEBUG values', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(loadDebugFlag('yes')).rejects.toThrow();
    spy.mockRestore();
  });
});
