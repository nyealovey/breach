import { defineConfig } from '@playwright/test';

const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:3000';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  timeout: 120_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL,
    trace: 'on-first-retry',
  },
  webServer:
    process.env.E2E_WEB_SERVER === '1'
      ? {
          command: 'bun run dev',
          url: baseURL,
          reuseExistingServer: true,
        }
      : undefined,
});
