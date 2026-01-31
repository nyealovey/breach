import { vi } from 'vitest';

process.env.SKIP_ENV_VALIDATION = 'true';

// Provide a stable default encryption key for tests that exercise credential encryption.
process.env.PASSWORD_ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString('base64url');

// Vitest v4 removed `vi.mocked` at runtime; keep compatibility with existing tests.
if (typeof (vi as unknown as { mocked?: unknown }).mocked !== 'function') {
  (vi as unknown as { mocked: (item: unknown) => unknown }).mocked = (item) => item;
}
