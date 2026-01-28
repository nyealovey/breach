import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

function requireKeyBytes(keyB64Url?: string) {
  // Avoid importing serverEnv here: tests and other isolated utilities should be able to
  // use this helper by passing an explicit key without requiring full env validation.
  const raw = keyB64Url ?? process.env.PASSWORD_ENCRYPTION_KEY;
  if (!raw) throw new Error('PASSWORD_ENCRYPTION_KEY is required');

  const key = Buffer.from(raw, 'base64url');
  if (key.length !== 32) throw new Error('PASSWORD_ENCRYPTION_KEY must be base64url encoded 32 bytes');
  return key;
}

export function encryptAes256Gcm(plaintextUtf8: string, keyB64Url?: string) {
  const key = requireKeyBytes(keyB64Url);
  const nonce = randomBytes(12);

  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  const ciphertext = Buffer.concat([cipher.update(plaintextUtf8, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return `v1:${nonce.toString('base64url')}:${ciphertext.toString('base64url')}:${tag.toString('base64url')}`;
}

export function decryptAes256Gcm(ciphertext: string, keyB64Url?: string) {
  const key = requireKeyBytes(keyB64Url);

  const [v, nonceB64, cipherB64, tagB64] = ciphertext.split(':');
  if (v !== 'v1' || !nonceB64 || !cipherB64 || !tagB64) throw new Error('Invalid ciphertext format');

  const nonce = Buffer.from(nonceB64, 'base64url');
  const cipherBytes = Buffer.from(cipherB64, 'base64url');
  const tag = Buffer.from(tagB64, 'base64url');

  const decipher = createDecipheriv('aes-256-gcm', key, nonce);
  decipher.setAuthTag(tag);

  const plaintext = Buffer.concat([decipher.update(cipherBytes), decipher.final()]);
  return plaintext.toString('utf8');
}

export function encryptJson(value: unknown, keyB64Url?: string) {
  return encryptAes256Gcm(JSON.stringify(value), keyB64Url);
}

export function decryptJson<T>(ciphertext: string, keyB64Url?: string): T {
  return JSON.parse(decryptAes256Gcm(ciphertext, keyB64Url)) as T;
}
