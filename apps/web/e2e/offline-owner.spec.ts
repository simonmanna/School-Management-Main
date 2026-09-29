import { expect, test, type Page, type Request } from '@playwright/test';

/**
 * Wave 17 — audit R02 / D02: offline work belongs to the school and person
 * who entered it.
 *
 * A saves a register while the server refuses connections, so it is kept on
 * the device. A signs out; B signs in on the same browser. B sees that another
 * account has saved work here, never its content, and nothing is sent under
 * B's session. A signs back in and the register is sent once, as A.
 *
 *   E2E_ORG, E2E_EMAIL, E2E_PASSWORD                    account A (staff with attendance)
 *   E2E_SECOND_EMAIL, E2E_SECOND_PASSWORD               account B, same school, can open attendance
 *   E2E_CLASS (default "P.1 A")
 */
const ORG = process.env.E2E_ORG ?? '';
const A = { email: process.env.E2E_EMAIL ?? '', password: process.env.E2E_PASSWORD ?? '' };
const B = { email: process.env.E2E_SECOND_EMAIL ?? '', password: process.env.E2E_SECOND_PASSWORD ?? '' };
const CLASS = process.env.E2E_CLASS ?? 'P.1 A';

test.skip(!ORG || !A.email || !B.email, 'Set E2E_ORG, E2E_EMAIL/PASSWORD and E2E_SECOND_EMAIL/PASSWORD');

async function signIn(page: Page, who: { email: string; password: string }) {
  await page.goto('/login');
  await page.getByPlaceholder('e.g. GVPS').fill(ORG);
  await page.getByPlaceholder('your@email.com').fill(who.email);
  await page.getByPlaceholder('••••••••').fill(who.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

async function signOut(page: Page) {
  await page.locator('header [aria-haspopup="menu"]').last().click();
  await page.getByRole('menuitem', { name: /sign out/i }).click();
  await expect(page).toHaveURL(/\/login/);
}

test('saved-offline work is sent only by its author (D02)', async ({ page }) => {
  const marks: Request[] = [];
  page.on('request', (r) => {
    if (r.method() === 'POST' && r.url().includes('/attendance/mark')) marks.push(r);
  });

  // ── A takes a register with the server unreachable for the save.
  await signIn(page, A);
  await page.goto('/school/attendance');
  await page.locator('select').first().selectOption({ label: CLASS });
  const firstRow = page.locator('tbody tr').first();
  await expect(firstRow.locator('button[aria-pressed]').first()).toBeEnabled();
  await page.route('**/attendance/mark', (route) => route.abort('connectionrefused'));
  await firstRow.locator('button[aria-pressed]').filter({ hasText: /late/i }).first().click();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText(/saved on this device/i).first()).toBeVisible();
  await page.unroute('**/attendance/mark');
  const attemptsWhileOffline = marks.length;

  // ── A signs out: nothing is erased, nothing is sent.
  await signOut(page);

  // ── B on the same browser: sees a count, not A's work; sends nothing.
  await signIn(page, B);
  await page.goto('/school/attendance');
  await expect(page.getByText(/saved on this device by another account/i)).toBeVisible();
  await expect(page.getByText(/Register ·/)).toHaveCount(0);
  await page.waitForTimeout(3_000);
  expect(marks.length).toBe(attemptsWhileOffline);
  await signOut(page);

  // ── A returns: the register is sent once, under A's session.
  await signIn(page, A);
  const sent = page.waitForResponse((r) => r.request().method() === 'POST' && r.url().includes('/attendance/mark'));
  await page.goto('/school/attendance');
  const res = await sent;
  expect(res.ok()).toBe(true);
  await expect(page.getByText(/saved on this device/i)).toHaveCount(0);
  await page.waitForTimeout(2_000);
  expect(marks.length).toBe(attemptsWhileOffline + 1);
});
