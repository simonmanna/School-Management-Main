import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

/**
 * Wave 17 — audit R03 / D03: a school-required pupil field is asked for and
 * enforced on the front-desk quick register, and the API refuses a direct call
 * that leaves it out.
 *
 * The spec creates one required select field for the run and DEACTIVATES it
 * afterwards, so other journeys are not affected.
 *   E2E_ORG, E2E_EMAIL, E2E_PASSWORD (a registrar or administrator)
 *   E2E_API_URL (default http://localhost:3013/api/v1), E2E_CLASS (default "P.1 A")
 */
const ORG = process.env.E2E_ORG ?? '';
const EMAIL = process.env.E2E_EMAIL ?? '';
const PASSWORD = process.env.E2E_PASSWORD ?? '';
const API = process.env.E2E_API_URL ?? 'http://localhost:3013/api/v1';
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

async function token(request: APIRequestContext): Promise<string> {
  const res = await request.post(`${API}/auth/login`, { data: { organizationCode: ORG, email: EMAIL, password: PASSWORD } });
  expect(res.ok()).toBe(true);
  return (await res.json()).accessToken;
}

test('a required school field is enforced on quick register and at the API (D03)', async ({ page, request }) => {
  const stamp = Date.now();
  const name = `bloodGroupE2E${stamp}`;
  const label = `Blood group ${stamp}`;
  const auth = { Authorization: `Bearer ${await token(request)}` };
  const created = await request.post(`${API}/school/custom-fields`, {
    headers: auth,
    data: { entityType: 'student', name, label, type: 'select', options: ['A+', 'O+'], required: true, order: 99 },
  });
  expect(created.ok()).toBe(true);
  const fieldId = (await created.json()).id as string;

  try {
    // ── API: a direct quick-register without the field is refused, nothing written.
    const terms = await (await request.get(`${API}/school/terms`, { headers: auth, params: { pageSize: 50 } })).json();
    const term = (terms.data ?? terms).find((t: any) => t.isCurrent) ?? (terms.data ?? terms)[0];
    const classes = await (await request.get(`${API}/school/classes`, { headers: auth, params: { pageSize: 200 } })).json();
    const klass = (classes.data ?? classes).find((c: any) => c.name === CLASS);
    const direct = await request.post(`${API}/school/students/register`, {
      headers: auth,
      data: { name: `Api Refused ${stamp}`, classId: klass.id, termId: term.id, rollNumber: `API-${stamp}` },
    });
    expect(direct.status()).toBe(400);
    expect(await direct.text()).toContain(`${label} is required`);

    // ── UI: the quick register shows the field and will not submit without it.
    await signIn(page);
    await page.goto('/school/students');
    await page.getByRole('button', { name: /quick register/i }).first().click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText(label)).toBeVisible();
    await dialog.getByPlaceholder('E.g. Isabelle Atweoki').fill(`Ui Pupil ${stamp}`);
    const selects = dialog.locator('select');
    await selects.nth(1).selectOption({ label: term.name }); // Term (after Gender)
    await selects.nth(2).selectOption({ label: CLASS });
    const section = selects.nth(3);
    if (await section.isEnabled()) await section.selectOption({ index: 1 });
    await dialog.getByPlaceholder('E.g. 23').fill(`UI-${stamp}`);
    await dialog.getByRole('button', { name: /register & place/i }).click();
    await expect(page.getByText(new RegExp(`Also required: ${label}`))).toBeVisible();

    // Fill it and the pupil is registered with the value stored.
    const fieldSelect = dialog.locator(`select#cf-student-${name}, select[id$="${name}"]`).first();
    await fieldSelect.selectOption('O+');
    const saved = page.waitForResponse((r) => r.url().includes('/students/register') && r.request().method() === 'POST');
    await dialog.getByRole('button', { name: /register & place/i }).click();
    const res = await saved;
    expect(res.ok()).toBe(true);
    const profileId = (await res.json()).profile.id as string;
    const pupil = await (await request.get(`${API}/school/students/${profileId}`, { headers: auth })).json();
    expect(pupil.customFields?.[name]).toBe('O+');
  } finally {
    await request.patch(`${API}/school/custom-fields/${fieldId}`, { headers: auth, data: { active: false, required: false } });
  }
});
