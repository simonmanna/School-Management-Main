import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

/**
 * Wave 17 — audit R05 / D05: a published fee change reaches an already-billed
 * pupil only through an approved correction, done by two different people in
 * the ordinary screens.
 *
 *   administrator: publishes a new version of the structure the invoice was billed from
 *   bursar:        Fee Invoices → "Revise to current fees" (files the request)
 *   bursar:        cannot approve it (API refuses)
 *   head teacher:  Fees & Billing → Refund → "Approve & apply"
 * Then, through the API: the old invoice is voided and kept, one new invoice at
 * the new amount exists, and the pupil's balance moved by exactly the fee change.
 *
 *   E2E_ORG, E2E_EMAIL, E2E_PASSWORD           administrator
 *   E2E_BURSAR_EMAIL, E2E_BURSAR_PASSWORD      bursar (Bursar preset)
 *   E2E_HEAD_EMAIL, E2E_HEAD_PASSWORD          head teacher (Head Teacher preset)
 *   E2E_API_URL (default http://localhost:3013/api/v1)
 */
const ORG = process.env.E2E_ORG ?? '';
const ADMIN = { email: process.env.E2E_EMAIL ?? '', password: process.env.E2E_PASSWORD ?? '' };
const BURSAR = { email: process.env.E2E_BURSAR_EMAIL ?? '', password: process.env.E2E_BURSAR_PASSWORD ?? '' };
const HEAD = { email: process.env.E2E_HEAD_EMAIL ?? '', password: process.env.E2E_HEAD_PASSWORD ?? '' };
const API = process.env.E2E_API_URL ?? 'http://localhost:3013/api/v1';
const INCREASE = 10_000;

test.skip(!ORG || !ADMIN.email || !BURSAR.email || !HEAD.email, 'Set admin, bursar and head teacher credentials');

async function signIn(page: Page, who: { email: string; password: string }) {
  await page.goto('/login');
  await page.getByPlaceholder('e.g. GVPS').fill(ORG);
  await page.getByPlaceholder('your@email.com').fill(who.email);
  await page.getByPlaceholder('••••••••').fill(who.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

async function bearer(request: APIRequestContext, who: { email: string; password: string }) {
  const res = await request.post(`${API}/auth/login`, { data: { organizationCode: ORG, email: who.email, password: who.password } });
  expect(res.ok()).toBe(true);
  return { Authorization: `Bearer ${(await res.json()).accessToken}` };
}

test('bursar requests, head teacher approves, books follow the new fee (D05)', async ({ browser, request }) => {
  const admin = await bearer(request, ADMIN);
  const get = async (path: string, params?: Record<string, string | number>) =>
    (await request.get(`${API}${path}`, { headers: admin, params })).json();

  // ── Find an unpaid, unwaived invoice of the current term, billed from its structure's current version.
  const terms = await get('/school/terms', { pageSize: 100 });
  const current = (terms.data ?? terms).find((t: any) => t.isCurrent);
  const structures = (await get('/school/fee-structures', { pageSize: 200 })).data;
  const byVersion = new Map<string, any>(structures.filter((s: any) => s.currentVersionId).map((s: any) => [s.currentVersionId, s]));
  let invoices = (await get('/school/finance/invoices', { status: 'issued', termId: current.id, pageSize: 200 })).data;
  if (invoices.length === 0) {
    // Nothing billed this term yet: bill one class, as the bursar's term run would.
    const classes = await get('/school/classes', { pageSize: 200 });
    const klass = (classes.data ?? classes).find((c: any) => c.name === (process.env.E2E_CLASS ?? 'P.1 A'));
    const run = await request.post(`${API}/school/billing/generate`, { headers: admin, data: { termId: current.id, classId: klass.id } });
    expect(run.ok()).toBe(true);
    invoices = (await get('/school/finance/invoices', { status: 'issued', termId: current.id, pageSize: 200 })).data;
  }
  let target: any = null;
  let structure: any = null;
  for (const inv of invoices) {
    if (Number(inv.amountWaived) > 0 || Number(inv.amountPaid) > 0) continue;
    const detail = await get(`/school/finance/invoices/${inv.id}`);
    const s = byVersion.get(detail.invoice.feeStructureVersionId);
    if (s && detail.document?.status === 'posted') { target = { ...inv, studentProfileId: detail.invoice.studentProfileId }; structure = s; break; }
  }
  test.skip(!target, 'No current-term invoice on its structure’s current version — bill one first');

  const before = await get(`/school/finance/students/${target.studentProfileId}/balance`);

  // ── The school publishes a fee change (administrator).
  const full = await get(`/school/fee-structures/${structure.id}`);
  const components = (full.components ?? []).map((c: any, i: number) => (i === 0 ? { ...c, amount: Number(c.amount) + INCREASE } : c));
  const published = await request.post(`${API}/school/fee-structures/${structure.id}/publish`, { headers: admin, data: { components } });
  expect(published.ok()).toBe(true);

  // ── Bursar files the revision from Fee Invoices.
  const bursarPage = await browser.newPage();
  await signIn(bursarPage, BURSAR);
  await bursarPage.goto('/school/fees/invoices');
  const row = bursarPage.locator('tr', { hasText: target.invoiceNumber });
  await expect(row).toBeVisible();
  bursarPage.once('dialog', (d) => d.accept(`E2E fee revision ${Date.now()}`));
  await row.getByRole('button', { name: /revise to current fees/i }).click();
  await expect(bursarPage.getByText(/sent for approval/i)).toBeVisible();

  // The bursar cannot release their own request.
  const bursar = await bearer(request, BURSAR);
  const pending = (await (await request.get(`${API}/school/finance/corrections`, { headers: admin, params: { status: 'pending' } })).json())
    .find((r: any) => r.snapshot?.correction?.schoolFeeInvoiceId === target.id);
  expect(pending).toBeTruthy();
  const selfApprove = await request.post(`${API}/school/finance/corrections/${pending.id}/approve`, { headers: bursar, data: {} });
  expect(selfApprove.status()).toBe(403);

  // ── Head teacher approves in the Refund tab of Fees & Billing.
  const headPage = await browser.newPage();
  await signIn(headPage, HEAD);
  await headPage.goto('/school/fees?tab=refund');
  const card = headPage.locator('div.rounded-md.border', { hasText: 'Revise invoice to current fees' }).filter({ hasText: pending.snapshot.correction.reason });
  await card.getByRole('button', { name: /approve & apply/i }).click();
  await expect(headPage.getByText(/approved and applied/i)).toBeVisible();

  // ── The books.
  const old = await get(`/school/finance/invoices/${target.id}`);
  expect(old.invoice.status).toBe('voided');
  expect(old.document.status).toBe('cancelled');
  const live = (await get('/school/finance/invoices', { studentProfileId: target.studentProfileId, termId: current.id, pageSize: 50 })).data
    .filter((i: any) => !['voided', 'cancelled'].includes(i.status));
  // The pupil's own discounts and scholarships apply to the new fee as to the
  // old one, so the change is at most the published increase.
  const replacement = live.find((i: any) => Number(i.totalAmount) > Number(target.totalAmount));
  expect(replacement).toBeTruthy();
  const delta = Number(replacement.totalAmount) - Number(target.totalAmount);
  expect(delta).toBeGreaterThan(0);
  expect(delta).toBeLessThanOrEqual(INCREASE);
  const after = await get(`/school/finance/students/${target.studentProfileId}/balance`);
  expect(Number(after.billed) - Number(before.billed)).toBe(delta);
  expect(Number(after.balance) - Number(before.balance)).toBe(delta);

  // Approving again is refused; nothing is billed twice.
  const again = await request.post(`${API}/school/finance/corrections/${pending.id}/approve`, { headers: await bearer(request, HEAD), data: {} });
  expect(again.status()).toBeGreaterThanOrEqual(400);
});
