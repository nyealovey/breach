import { describe, expect, it } from 'vitest';

import { compressRaw, decompressRaw } from '@/lib/ingest/raw';

describe('ingest raw', () => {
  it('compressRaw uses zstd and is reversible', async () => {
    const payload = { hello: 'world', n: 1, nested: { ok: true } };

    const result = await compressRaw(payload);
    expect(result.compression).toBe('zstd');
    expect(result.sizeBytes).toBeGreaterThan(0);
    expect(result.hash).toMatch(/^[a-f0-9]{64}$/);

    const roundtrip = await decompressRaw(result.bytes);
    expect(roundtrip).toEqual(payload);
  });
});
