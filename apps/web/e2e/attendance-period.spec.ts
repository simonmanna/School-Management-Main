import { expect, test, type Page } from '@playwright/test';

/**
 * Wave 17 — audit R01 / D01: the daily register and each lesson register are
 * different documents.
 *
 * The same pupil is Present on the daily register, Absent in period 1 and Late
 * in period 2. Each register is read with its own period (the request carries
 * `periodId`), shows only its own marks after a reload, and a correction in
 * period 1 changes nothing else.
 *
 * Needs at least two periods (School → Periods) and a class with pupils:
 *   E2E_ORG, E2E_EMAIL, E2E_PASSWORD, E2E_CLASS (default "P.1 A")
 *   E2E_PERIOD_1, E2E_PERIOD_2 (default: the first two periods listed)
 */
const ORG = process.env.E2E_ORG ?? '';
const EMAIL = process.env.E2E_EMAIL ?? '';
const PASSWORD = process.env.E2E_PASSWORD ?? '';
const CLASS = process.env.E2E_CLASS ?? 'P.1 A';

test.skip(!ORG || !EMAIL || !PASSWORD, 'Set E2E_ORG, E2E_EMAIL and E2E_PASSWORD');

async function signIn(page: Page) {
  await page.goto('/login');
  await page.getByPlaceholder('e.g. GVPS').fill(ORG);
  await page.getByPlaceholder('your@email.com').fill(EMAIL);
  await page.getByPlaceholder('••••••••').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

test('daily, period 1 and period 2 registers stay separate (D01)', async ({ page }) => {
  await signIn(page);
  await page.goto('/school/attendance');
  const selects = page.locator('main select, select');
  const classSelect = selects.nth(0);
  const periodSelect = selects.nth(1);
  await classSelect.selectOption({ label: CLASS });
  // Today in the school's zone (R09): every pupil on the class list is placed today.
  const date = await page.locator('input[type="date"]').first().inputValue();
  expect(date).toMatch(/^\d{4}-\d{2}-\d{2}$/);

  const periodOptions = periodSelect.locator('option');
  await expect.poll(() => periodOptions.count()).toBeGreaterThan(2);
  const p1Label = process.env.E2E_PERIOD_1 ?? ((await periodOptions.nth(1).textContent()) ?? '').trim();
  const p2Label = process.env.E2E_PERIOD_2 ?? ((await periodOptions.nth(2).textContent()) ?? '').trim();

  const firstPupilButtons = () => page.locator('tbody tr').first().locator('button[aria-pressed]');
  const pressedLabel = async () => {
    const pressed = page.locator('tbody tr').first().locator('button[aria-pressed="true"]');
    return (await pressed.count()) ? ((await pressed.first().textContent()) ?? '').trim() : '';
  };
  const save = async () => {
    const res = page.waitForResponse((r) => r.url().includes('/attendance/mark') && r.request().method() === 'POST');
    await page.getByRole('button', { name: 'Save' }).click();
    expect((await res).ok()).toBe(true);
  };
  let periodReads = 0;
  const openRegister = (label: string, periodExpected: boolean) =>
    test.step(`open ${label}`, async () => {
      // A register already in the cache may be served without a new request,
      // so check the request only when one is made, and always check the result.
      const req = page
        .waitForRequest((r) => r.url().includes('/attendance/register') && r.url().includes(date), { timeout: 10_000 })
        .catch(() => null);
      await periodSelect.selectOption({ label });
      const made = await req;
      if (made) expect(made.url().includes('periodId=')).toBe(periodExpected);
      if (made && periodExpected) periodReads += 1;
      if (made) await made.response();
      // Let React apply the new register before reading it.
      await page.waitForTimeout(300);
      await expect(firstPupilButtons().first()).toBeEnabled();
    });

  // Daily: everyone present.
  await expect(firstPupilButtons().first()).toBeEnabled();
  await page.getByRole('button', { name: 'All present' }).click();
  await save();
  const present = await pressedLabel();
  expect(present).not.toBe('');

  // Period 1 does NOT inherit the daily marks. Mark the first pupil absent.
  await openRegister(p1Label, true);
  expect(await pressedLabel()).not.toBe(present);
  await firstPupilButtons().filter({ hasText: /absent/i }).first().click();
  await save();

  // Period 2: late. Neither the daily nor the period-1 mark shows through.
  await openRegister(p2Label, true);
  expect(await pressedLabel()).not.toBe(present);
  expect(await pressedLabel()).not.toMatch(/absent/i);
  await firstPupilButtons().filter({ hasText: /late/i }).first().click();
  await save();

  // Reload: each register shows only its own mark.
  await page.reload();
  await classSelect.selectOption({ label: CLASS });
  await expect(page.locator('input[type="date"]').first()).toHaveValue(date);
  await expect(firstPupilButtons().first()).toBeEnabled();
  expect(await pressedLabel()).toBe(present);
  await openRegister(p1Label, true);
  expect(await pressedLabel()).toMatch(/absent/i);
  await openRegister(p2Label, true);
  expect(await pressedLabel()).toMatch(/late/i);
  await openRegister('Daily register', false);
  expect(await pressedLabel()).toBe(present);
  // R01 itself: lesson registers were read with their period, not as the daily one.
  expect(periodReads).toBeGreaterThanOrEqual(2);
});
