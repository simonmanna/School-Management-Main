#!/usr/bin/env node
/**
 * D5-3: POS smoke script — open a session, post 5 sales, close the session,
 * print the Z-report. Manual sanity check pre-deploy; ~10s runtime.
 *
 * Usage:
 *   API_BASE=http://localhost:3000/api \
 *   ORG_CODE=DEMO \
 *   ADMIN_EMAIL=admin@demo.test \
 *   ADMIN_PASSWORD='Admin@123' \
 *   pnpm tsx scripts/smoke-pos.ts
 *
 * Requires:
 *   - API running and reachable
 *   - The default seed has been applied (admin user, AR/AP/Cash accounts,
 *     'MAIN' warehouse, 'PRD-001' product)
 */
import 'dotenv/config';

const BASE = process.env.API_BASE ?? 'http://localhost:3000/api';
const ORG = process.env.ORG_CODE ?? 'DEMO';
const EMAIL = process.env.ADMIN_EMAIL ?? 'admin@demo.test';
const PASSWORD = process.env.ADMIN_PASSWORD ?? 'Admin@123';

interface TokenPair { accessToken: string; refreshToken: string }
async function call(method: string, path: string, body?: unknown, token?: string): Promise<any> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* noop */ }
  if (!res.ok) {
    throw new Error(`${method} ${path} → ${res.status}: ${text.slice(0, 300)}`);
  }
  return json;
}

async function login(): Promise<TokenPair> {
  const out = await call('POST', '/auth/login', { organizationCode: ORG, email: EMAIL, password: PASSWORD });
  return out;
}

async function main(): Promise<void> {
  console.log(`POS smoke — base=${BASE} org=${ORG}`);
  const tokens = await login();
  const auth = tokens.accessToken;
  const today = new Date().toISOString().slice(0, 10);

  // 1) Find or create a cash register on the MAIN warehouse.
  const cashAccounts = await call('GET', '/accounts?search=cash', undefined, auth);
  const cashAccount = (cashAccounts.data ?? [])[0];
  if (!cashAccount) throw new Error('No cash account found');
  console.log(`Cash account: ${cashAccount.code} ${cashAccount.name}`);

  const regList = await call('GET', '/cash-registers', undefined, auth);
  let register = (regList.data ?? [])[0];
  if (!register) {
    register = await call('POST', '/cash-registers', {
      code: 'POS-1',
      name: 'POS Front',
      defaultAccountId: cashAccount.id,
    }, auth);
  }
  console.log(`Cash register: ${register.code} (id=${register.id})`);

  // 2) Open a session.
  const open = await call('POST', '/cash-sessions/open', {
    cashRegisterId: register.id,
    openingFloat: 100,
    notes: 'smoke-test',
  }, auth);
  const sessionId = open.id;
  console.log(`Session opened: ${sessionId}`);

  // 3) Find a product + a customer.
  const products = await call('GET', '/products?search=Widget', undefined, auth);
  const product = (products.data ?? [])[0];
  if (!product) throw new Error('No product found');
  const partners = await call('GET', '/partners?search=Acme', undefined, auth);
  const partner = (partners.data ?? [])[0];
  if (!partner) throw new Error('No customer found');
  console.log(`Customer: ${partner.code}  Product: ${product.code}`);

  // 4) Post 5 sales.
  let totalSales = 0;
  for (let i = 0; i < 5; i++) {
    const invoice = await call('POST', '/invoices', {
      partnerId: partner.id,
      issueDate: today,
      currencyId: null,
      lines: [{
        productId: product.id,
        description: product.name,
        quantity: 1,
        unitPrice: 10,
        discountPercent: 0,
      }],
    }, auth);
    await call('POST', `/invoices/${invoice.id}/post`, {}, auth);
    const payment = await call('POST', '/payments', {
      partnerId: partner.id,
      paymentDate: today,
      paymentMethod: 'cash',
      amount: 10,
      cashSessionId: sessionId,
      allocations: [{ documentId: invoice.id, amount: 10 }],
    }, auth);
    totalSales += 10;
    console.log(`  Sale ${i + 1}: invoice ${invoice.documentNumber} payment ${payment.paymentNumber}`);
  }

  // 5) Close the session.
  const expected = await call('GET', `/cash-sessions/${sessionId}/expected`, undefined, auth);
  const closed = await call('POST', '/cash-sessions/close', {
    closingCounted: expected.expectedCash,
    notes: 'smoke-test',
  }, auth);
  console.log(`Session closed. expected=${closed.closingExpected} counted=${closed.closingCounted} variance=${closed.closingDifference}`);

  console.log(`\nZ-Report`);
  console.log(`  Opening float:     100.00`);
  console.log(`  Sales (5 × $10):   ${totalSales}.00`);
  console.log(`  Expected close:    ${closed.closingExpected}`);
  console.log(`  Counted close:     ${closed.closingCounted}`);
  console.log(`  Variance:          ${closed.closingDifference}`);
  console.log('\n✓ Smoke OK');
}

main().catch((err) => {
  console.error('Smoke failed:', err.message);
  process.exit(1);
});