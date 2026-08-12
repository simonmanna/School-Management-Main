/**
 * POS P12 — E2E test suite (smoke tests for the sell loop).
 *
 * These tests run against a live API + Postgres (i.e. you need to:
 *   1. start the database:  `pnpm db:up`
 *   2. run the migrations:   `pnpm db:migrate`
 *   3. seed the demo data:   `pnpm db:seed`
 *   4. start the API:        `pnpm dev:api`  (or `pnpm --filter @erp/api start:dev`)
 *   5. run the tests:        `pnpm test:e2e`
 *
 * The tests are API-only (no browser) so they exercise the same surface
 * the cashier's terminal hits, but in a fraction of the time and without
 * flakiness from UI rendering. For a true browser-level smoke test, see
 * `e2e/web-smoke.spec.ts` (Playwright UI).
 */
import { test, expect, beforeAll, afterAll, describe } from 'vitest';

const BASE = process.env.POS_API_BASE ?? 'http://localhost:3000';
const ADMIN_EMAIL = 'admin@demo.test';
const ADMIN_PASS = 'Admin@123';

let token = '';
let orgId = '';
let productId = '';
let cashRegisterId = '';
let cashSessionId = '';
let partnerId = '';

async function api(path: string, init: RequestInit = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${init.method ?? 'GET'} ${path} → ${res.status}: ${body}`);
  }
  return res.json();
}

beforeAll(async () => {
  // Login as the demo admin.
  const login = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASS }),
  });
  expect(login.ok).toBe(true);
  const loginJson = (await login.json()) as any;
  token = loginJson.accessToken ?? loginJson.token;
  expect(token).toBeTruthy();

  // Resolve IDs.
  const me = await api('/auth/me') as any;
  orgId = me.organizationId;

  const products = await api('/products?pageSize=200') as any;
  const espresso = (products.data ?? products).find((p: any) => p.code === 'P-COFFEE-S');
  expect(espresso).toBeTruthy();
  productId = espresso.id;

  const registers = await api('/cash-registers?isActive=true') as any;
  const reg = (registers.data ?? registers)[0];
  expect(reg).toBeTruthy();
  cashRegisterId = reg.id;

  // Use a known test customer — auto-create one if missing.
  const customers = await api('/partners?pageSize=10&isCustomer=true') as any;
  partnerId = (customers.data ?? customers)[0]?.id ?? (await api('/partners', {
    method: 'POST',
    body: JSON.stringify({ code: `TEST-${Date.now()}`, name: 'Test Customer', isCustomer: true }),
  })) as any).id;
}, 30_000);

afterAll(async () => {
  if (cashSessionId) {
    try {
      await api('/cash-sessions/close', {
        method: 'POST',
        body: JSON.stringify({ closingCounted: 0, notes: 'E2E teardown' }),
      });
    } catch { /* best effort */ }
  }
});

describe('POS sell loop', () => {
  test('opens a shift, sells a coffee, closes the shift', async () => {
    // 1) Open a shift on the main register.
    const session = await api('/cash-sessions/open', {
      method: 'POST',
      body: JSON.stringify({ cashRegisterId, openingFloat: 50_000 }),
    }) as any;
    cashSessionId = session.id;
    expect(cashSessionId).toBeTruthy();

    // 2) Sell 2 espressos @ 5,000 UGX each = 10,000 UGX total.
    const checkout = await api('/pos/checkout', {
      method: 'POST',
      body: JSON.stringify({
        lines: [{ productId, description: 'Espresso', quantity: 2, unitPrice: 5000 }],
        tenders: [{ method: 'cash', amount: 10_000 }],
        cashSessionId,
      }),
    }) as any;
    expect(checkout.invoiceId).toBeTruthy();
    expect(checkout.invoiceNumber).toMatch(/^INV-\d{4}-/);
    expect(checkout.change).toBe(0);

    // 3) X-report should now show 10,000 UGX in sales + 1 transaction.
    const x = await api(`/pos/reports/x-report?cashSessionId=${cashSessionId}`) as any;
    expect(x.totals.sales).toBe(10_000);
    expect(x.totals.count).toBe(1);
  });

  test('refunds a sale (full credit note + reversing payment)', async () => {
    const docs = await api('/invoices?pageSize=5&sourceType=pos') as any;
    const invoice = (docs.data ?? docs)[0];
    expect(invoice).toBeTruthy();
    const refund = await api('/pos/refund', {
      method: 'POST',
      body: JSON.stringify({ invoiceId: invoice.id, reason: 'E2E refund test' }),
    }) as any;
    // POS refunds now run the Order→Invoice→Receipt pipeline (billing.refund),
    // which reverses the invoice GL in place rather than raising a credit-note
    // Document. It returns the refunded invoice, not a creditNoteId.
    expect(refund.status).toBe('refunded');
  });

  test('manager override: 30% discount requires manager PIN', async () => {
    // 30% discount without override should fail.
    let failed = false;
    try {
      await api('/pos/checkout', {
        method: 'POST',
        body: JSON.stringify({
          lines: [{ productId, description: 'Espresso', quantity: 1, unitPrice: 5000, discountPercent: 30 }],
          tenders: [{ method: 'cash', amount: 3_500 }],
          cashSessionId,
        }),
      });
    } catch (e: any) {
      failed = true;
      expect(String(e.message)).toMatch(/override/i);
    }
    expect(failed).toBe(true);

    // With override (we verify the admin as the manager), it should succeed.
    const verify = await api('/pos/override/verify', {
      method: 'POST',
      body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASS }),
    }) as any;
    expect(verify.managerId).toBeTruthy();

    const ok = await api('/pos/checkout', {
      method: 'POST',
      body: JSON.stringify({
        lines: [{ productId, description: 'Espresso', quantity: 1, unitPrice: 5000, discountPercent: 30 }],
        tenders: [{ method: 'cash', amount: 3_500 }],
        cashSessionId,
        overrideById: verify.managerId,
      }),
    }) as any;
    expect(ok.invoiceId).toBeTruthy();
  });

  test('held order: park + recall', async () => {
    const hold = await api('/pos/holds', {
      method: 'POST',
      body: JSON.stringify({
        name: `E2E hold ${Date.now()}`,
        partnerId,
        cashSessionId,
        lines: [{ productId, description: 'Espresso', quantity: 1, unitPrice: 5000 }],
      }),
    }) as any;
    expect(hold.id).toBeTruthy();

    const list = await api('/pos/holds?status=open') as any;
    expect((list.data ?? list).length).toBeGreaterThan(0);

    const recall = await api(`/pos/holds/${hold.id}/recall`, { method: 'POST' }) as any;
    expect(recall.lines.length).toBe(1);
    expect(recall.lines[0].productId).toBe(productId);

    // Cancel the hold so it doesn't pollute the next run.
    await api(`/pos/holds/${hold.id}`, { method: 'DELETE' });
  });

  test('tax-inclusive product: GL splits net vs tax correctly', async () => {
    // Pick the Large Café Latte (P-LATTE-L, 12,000 UGX tax-inclusive).
    const products = await api('/products?pageSize=200') as any;
    const latte = (products.data ?? products).find((p: any) => p.code === 'P-LATTE-L');
    expect(latte).toBeTruthy();
    expect(latte.taxInclusive).toBe(true);

    const checkout = await api('/pos/checkout', {
      method: 'POST',
      body: JSON.stringify({
        lines: [{ productId: latte.id, description: latte.name, quantity: 1, unitPrice: 12000 }],
        tenders: [{ method: 'cash', amount: 12_000 }],
        cashSessionId,
      }),
    }) as any;
    expect(checkout.invoiceId).toBeTruthy();

    // Pull the invoice + lines back to verify the GL split.
    const inv = await api(`/invoices/${checkout.invoiceId}?include=lines`) as any;
    const line = (inv.lines ?? []).find((l: any) => l.productId === latte.id);
    expect(line).toBeTruthy();
    expect(line.taxInclusive).toBe(true);
    // Net = 12,000 / 1.18 = ~10,170; Tax = ~1,830
    expect(Number(line.taxAmount)).toBeGreaterThan(1_000);
    expect(Number(line.taxAmount)).toBeLessThan(2_500);
    expect(Number(line.subtotal) + Number(line.taxAmount)).toBeCloseTo(12_000, 0);
  });
});
