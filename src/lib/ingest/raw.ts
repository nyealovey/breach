import { createHash } from 'node:crypto';

import { compress, decompress, init } from '@bokuweb/zstd-wasm';

export type CompressedRaw = {
  bytes: Uint8Array;
  sizeBytes: number;
  hash: string;
  compression: 'zstd';
  mimeType: 'application/json';
  inlineExcerpt: string;
};

let initPromise: Promise<void> | null = null;
async function ensureZstd() {
  if (!initPromise) initPromise = init();
  await initPromise;
}

export async function compressRaw(payload: unknown): Promise<CompressedRaw> {
  await ensureZstd();

  const json = JSON.stringify(payload);
  const rawBytes = Buffer.from(json, 'utf8');
  const hash = createHash('sha256').update(rawBytes).digest('hex');

  // zstd level range depends on build; 10 is a reasonable default for JSON payloads.
  const compressed = compress(rawBytes, 10);

  return {
    bytes: compressed,
    sizeBytes: rawBytes.length,
    hash,
    compression: 'zstd',
    mimeType: 'application/json',
    inlineExcerpt: json.slice(0, 2000),
  };
}

export async function decompressRaw(bytes: Uint8Array): Promise<unknown> {
  await ensureZstd();
  const rawBytes = decompress(bytes);
  return JSON.parse(Buffer.from(rawBytes).toString('utf8')) as unknown;
}
