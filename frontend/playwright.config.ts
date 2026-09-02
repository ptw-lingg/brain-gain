import { defineConfig } from '@playwright/test';

// E2E runs against an isolated backend (spawned in global-setup) that serves the built SPA AND the
// API on one HTTPS origin — so there is no dev proxy and no CORS. Serial + a fresh seeded data dir
// keeps tests deterministic. The browser is the installed MS Edge (no chromium download).
export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  globalTeardown: './e2e/global-teardown.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30_000,
  expect: { timeout: 8_000 },
  reporter: [['list']],
  use: {
    baseURL: 'https://localhost:4543',
    ignoreHTTPSErrors: true,
    channel: 'msedge',
    headless: true,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
});
