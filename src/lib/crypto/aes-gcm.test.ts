import { describe, expect, it } from 'vitest';

import { decryptAes256Gcm, encryptAes256Gcm } from '@/lib/crypto/aes-gcm';

describe('aes-256-gcm', () => {
  it('encrypts and decrypts (roundtrip)', () => {
    const key = Buffer.alloc(32, 7).toString('base64url');
    const ciphertext = encryptAes256Gcm('hello', key);
    expect(decryptAes256Gcm(ciphertext, key)).toBe('hello');
  });

  it('fails to decrypt with wrong key', () => {
    const key = Buffer.alloc(32, 7).toString('base64url');
    const wrongKey = Buffer.alloc(32, 8).toString('base64url');
    const ciphertext = encryptAes256Gcm('hello', key);
    expect(() => decryptAes256Gcm(ciphertext, wrongKey)).toThrow();
  });
});
