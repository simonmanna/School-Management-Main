import { expect, test } from '@playwright/test';

/**
 * The one journey a school cannot run without (E2E audit Wave 6):
 * sign in → register and place a pupil → take a fee payment → read the
 * pupil's statement. Every step here was broken at some point in the audit.
 */
const ORG = process.env.E2E_ORG ?? '';
const EMAIL = process.env.E2E_EMAIL ?? '';
const PASSWORD = process.env.E2E_PASSWORD ?? '';
// The term to place into. Defaults to the one the school flagged current; a dev
// tenant whose "current" flag has gone stale (placement refused after the
// term's end date) can name a live term instead.
const TERM = process.env.E2E_TERM ?? '';

test.skip(!ORG || !EMAIL || !PASSWORD, 'Set E2E_ORG, E2E_EMAIL and E2E_PASSWORD to run the smoke test');

test('login → place pupil → collect fee → statement', async ({ page }) => {
  const pupil = `Smoke Pupil ${Date.now()}`;

  // 1. Sign in.
  await page.goto('/login');
  await page.getByPlaceholder('e.g. GVPS').fill(ORG);
  await page.getByPlaceholder('your@email.com').fill(EMAIL);
  await page.getByPlaceholder('••••••••').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).not.toHaveURL(/\/login/);

  // 2. Register and place in one step (Students → Quick register & place).
  await page.goto('/school/students');
  await page.getByRole('button', { name: 'Quick register & place' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByPlaceholder('E.g. Isabelle Atweoki').fill(pupil);
  const selects = dialog.locator('select');
  // Term, then class, then (if the class is divided) its first section.
  if (TERM) await selects.nth(1).selectOption({ label: TERM });
  else await selects.nth(1).selectOption({ index: 1 });
  await selects.nth(2).selectOption({ index: 1 });
  const section = selects.nth(3);
  if (await section.isEnabled()) {
    const options = await section.locator('option').count();
    if (options > 1) await section.selectOption({ index: 1 });
  }
  await dialog.getByPlaceholder('E.g. 23').fill(String(Date.now() % 100000));
  await dialog.getByRole('button', { name: 'Register & place' }).click();
  await expect(page.getByText('Student registered and placed')).toBeVisible();

  // 3. Take a cash payment for the new pupil (Record Fee Payments).
  await page.goto('/school/fees/collect');
  await page.getByPlaceholder('Search name or admission no…').fill(pupil);
  const studentSelect = page.locator('select').filter({ hasText: 'Select student…' });
  await expect(studentSelect.locator('option', { hasText: pupil })).toHaveCount(1);
  await studentSelect.selectOption({ label: (await studentSelect.locator('option', { hasText: pupil }).textContent())!.trim() });
  await page.getByRole('spinbutton').first().fill('10000');
  await page.getByRole('button', { name: /^Next/ }).click();
  await page.getByRole('button', { name: /^(Next|Review|Continue)/ }).click();
  await page.getByRole('button', { name: /record/i }).last().click();
  // The collect toast — not the page subtitle, which also mentions a receipt.
  await expect(page.getByText(/^Collected .*10,000/).first()).toBeVisible();

  // 4. The pupil's statement shows the receipt.
  await page.goto('/school/fees/statement');
  await page.getByPlaceholder('Search name or admission no…').fill(pupil);
  const stSelect = page.locator('select').first();
  await stSelect.selectOption({ index: 1 });
  if (TERM) await page.locator('select').nth(1).selectOption({ label: TERM });
  await expect(page.getByText(/10,000/).first()).toBeVisible();
});
