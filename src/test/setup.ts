import { vi } from 'vitest';

process.env.SKIP_ENV_VALIDATION = 'true';

// Vitest v4 removed `vi.mocked` at runtime; keep compatibility with existing tests.
if (typeof (vi as unknown as { mocked?: unknown }).mocked !== 'function') {
  (vi as unknown as { mocked: (item: unknown) => unknown }).mocked = (item) => item;
}
