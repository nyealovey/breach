import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { configDefaults, defineConfig } from 'vitest/config';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'node',
    setupFiles: ['./src/test/setup.ts'],
    // Keep Playwright E2E tests out of Vitest (they use `@playwright/test` globals).
    include: ['src/**/*.test.{ts,tsx}', 'plugins/**/*.test.ts'],
    exclude: [...configDefaults.exclude, 'e2e/**', '**/e2e/**'],
  },
});
