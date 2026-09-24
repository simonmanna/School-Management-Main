import { defineConfig } from '@playwright/test';

/**
 * Web smoke (E2E audit Wave 6). Runs against an already-running stack:
 *   API on :3003 (built dist) and the web dev server on :5175, pointed at a
 *   dev database with a school tenant. Credentials come from the environment
 *   so no login is committed:
 *     E2E_ORG, E2E_EMAIL, E2E_PASSWORD   (e.g. SUNRISE / admin@… / …)
 *   Run: pnpm --filter @erp/web exec playwright test
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5175',
    // The installed Chrome — no browser download needed on a dev machine.
    channel: process.env.E2E_CHANNEL ?? 'chrome',
    headless: true,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
});
