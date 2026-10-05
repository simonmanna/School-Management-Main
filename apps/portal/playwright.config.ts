import { defineConfig } from '@playwright/test';

/**
 * Portal end-to-end (the learner and guardian half of the LMS turn-on).
 *
 * Runs against an already-running stack: the API on :3003 with
 * `ENABLE_ADVANCED_LMS=true`, and the portal dev server on :5198 built with
 * `VITE_ENABLE_ADVANCED_LMS=true`. The flag matters on both sides — the API one
 * is authoritative, and without the portal's mirror the Courses tab is not even
 * drawn.
 *
 * Credentials come from the environment so none is committed. These must be real
 * portal accounts (`PortalIdentity` rows), minted from the admin app's
 * Portals & Promotion Gate screen:
 *
 *   E2E_PUPIL_EMAIL, E2E_PUPIL_PASSWORD        a pupil enrolled in a course
 *   E2E_GUARDIAN_EMAIL, E2E_GUARDIAN_PASSWORD  a guardian of that pupil
 *
 * Run: pnpm --filter @erp/portal exec playwright test
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  retries: 0,
  // One pupil's submissions and attempts: run in order, not in parallel.
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_PORTAL_BASE_URL ?? 'http://localhost:5198',
    channel: process.env.E2E_CHANNEL ?? 'chrome',
    headless: true,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    // The portal is phone-first; running it at desktop width would not exercise
    // the bottom navigation or the layout a family actually sees.
    viewport: { width: 390, height: 844 },
  },
});
