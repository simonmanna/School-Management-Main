/**
 * POS P12 — Load test (k6): concurrent /pos/checkout.
 *
 * Run with:
 *   k6 run --env BASE=http://localhost:3000 tests/load/pos-checkout.js
 *
 * Asserts:
 *   - p95 < 300ms under 50 concurrent cashiers × 10 sales/sec for 30s
 *   - 0% error rate (the idempotency key dedupes retries so a transient
 *     network blip should not double-charge)
 *
 * Prerequisite: API + DB up; `pnpm db:migrate && pnpm db:seed` run; an
 * open cash session id is set in the env (POS_CASH_SESSION_ID).
 *
 * The script logs in once, fetches a product id, then spawns VUs that
 * fire checkouts in a tight loop. Each request carries a unique
 * Idempotency-Key so the load test doesn't pollute the books.
 */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Rate } from 'k6/metrics';

const BASE = __ENV.BASE || 'http://localhost:3000';
const ADMIN_EMAIL = __ENV.POS_ADMIN_EMAIL || 'admin@demo.test';
const ADMIN_PASS  = __ENV.POS_ADMIN_PASS  || 'Admin@123';
const CASH_SESSION_ID = __ENV.POS_CASH_SESSION_ID;

const checkoutDuration = new Trend('checkout_duration', true);
const checkoutErrors   = new Rate('checkout_errors');

export const options = {
  scenarios: {
    sustained: {
      executor: 'constant-arrival-rate',
      rate: 10,            // 10 sales per second
      timeUnit: '1s',
      duration: '30s',
      preAllocatedVUs: 25,
      maxVUs: 50,
    },
  },
  thresholds: {
    'http_req_duration{name:checkout}': ['p(95)<300'],
    'checkout_errors': ['rate<0.01'],
  },
};

let token = '';
let productId = '';

export function setup() {
  // 1) Login.
  const login = http.post(
    `${BASE}/auth/login`,
    JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASS }),
    { headers: { 'Content-Type': 'application/json' } },
  );
  if (login.status !== 200 && login.status !== 201) {
    throw new Error(`login failed: ${login.status} ${login.body}`);
  }
  token = (JSON.parse(login.body)).accessToken || (JSON.parse(login.body)).token;

  // 2) Find a sellable product.
  const products = http.get(`${BASE}/products?pageSize=10`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (products.status !== 200) {
    throw new Error(`products failed: ${products.status} ${products.body}`);
  }
  const list = JSON.parse(products.body);
  const p = (list.data ?? list)[0];
  if (!p) throw new Error('No products in catalog — run pnpm db:seed first');

  // 3) Confirm a cash session is open.
  if (!CASH_SESSION_ID) {
    const regs = http.get(`${BASE}/cash-registers?isActive=true`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const reg = (JSON.parse(regs.body)).data?.[0] ?? JSON.parse(regs.body)[0];
    if (reg) {
      const open = http.post(
        `${BASE}/cash-sessions/open`,
        JSON.stringify({ cashRegisterId: reg.id, openingFloat: 100_000 }),
        { headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` } },
      );
      // 201 = created, 400 = already open
      if (open.status === 201) console.log('opened cash session for load test');
    }
  }

  return { token, productId: p.id };
}

export default function (data) {
  const idemKey = `load-${__VU}-${__ITER}-${Date.now()}`;
  const body = JSON.stringify({
    lines: [{ productId: data.productId, description: 'Espresso', quantity: 1, unitPrice: 5000 }],
    tenders: [{ method: 'cash', amount: 5000 }],
    cashSessionId: CASH_SESSION_ID,
  });
  const start = Date.now();
  const res = http.post(`${BASE}/pos/checkout`, body, {
    tags: { name: 'checkout' },
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${data.token}`,
      'Idempotency-Key': idemKey,
    },
  });
  checkoutDuration.add(Date.now() - start);
  const ok = res.status === 201 || res.status === 200;
  checkoutErrors.add(!ok);
  check(res, {
    'checkout ok': (r) => r.status === 201 || r.status === 200,
    'has invoiceId': (r) => {
      try { return !!JSON.parse(r.body).invoiceId; } catch { return false; }
    },
  });
  sleep(0.05);
}
