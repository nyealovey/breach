const REDACTED = '***';

function shouldRedactKey(key: string): boolean {
  const k = key.toLowerCase();

  // Short keys should match exactly to reduce false positives.
  if (k === 'ak' || k === 'sk') return true;

  return (
    k.includes('password') ||
    k.includes('secret') ||
    k.includes('token') ||
    k.includes('access_key') ||
    k.includes('accesskey')
  );
}

export function redactJsonSecrets(input: unknown): unknown {
  if (Array.isArray(input)) return input.map((v) => redactJsonSecrets(v));
  if (!input || typeof input !== 'object') return input;

  const obj = input as Record<string, unknown>;
  const out: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(obj)) {
    out[key] = shouldRedactKey(key) ? REDACTED : redactJsonSecrets(value);
  }

  return out;
}
