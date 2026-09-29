import { expect, test, type APIRequestContext } from '@playwright/test';

/**
 * Wave 17 — audit §9 / D07: each office role can do its own job and is refused
 * the others', at the API (typing a URL or calling the API directly must not
 * get round the screens). A refusal is a 403 that changes nothing.
 *
 * Logins (SUNRISE seed, scripts/seed-sunrise-academics.ts):
 *   administrator E2E_EMAIL/E2E_PASSWORD · registrar/bursar/head E2E_STAFF_PASSWORD
 *   teacher E2E_TEACHER_EMAIL/E2E_TEACHER_PASSWORD
 *   E2E_API_URL (default http://localhost:3013/api/v1)
 */
const ORG = process.env.E2E_ORG ?? '';
const API = process.env.E2E_API_URL ?? 'http://localhost:3013/api/v1';
const STAFF_PASSWORD = process.env.E2E_STAFF_PASSWORD ?? '';
const ACCOUNTS = {
  admin: { email: process.env.E2E_EMAIL ?? '', password: process.env.E2E_PASSWORD ?? '' },
  registrar: { email: 'registrar@sunrise.test', password: STAFF_PASSWORD },
  bursar: { email: 'bursar@sunrise.test', password: STAFF_PASSWORD },
  head: { email: 'head@sunrise.test', password: STAFF_PASSWORD },
  teacher: { email: process.env.E2E_TEACHER_EMAIL ?? '', password: process.env.E2E_TEACHER_PASSWORD ?? '' },
} as const;
type Who = keyof typeof ACCOUNTS;

test.skip(!ORG || !STAFF_PASSWORD || !ACCOUNTS.admin.email || !ACCOUNTS.teacher.email, 'Set admin, teacher and E2E_STAFF_PASSWORD');

const tokens: Partial<Record<Who, string>> = {};
async function auth(request: APIRequestContext, who: Who) {
  if (!tokens[who]) {
    const res = await request.post(`${API}/auth/login`, { data: { organizationCode: ORG, ...ACCOUNTS[who] } });
    expect(res.ok(), `${who} can sign in`).toBe(true);
    tokens[who] = (await res.json()).accessToken;
  }
  return { Authorization: `Bearer ${tokens[who]}` };
}

test('each role is allowed its own work and refused the rest (D07 matrix)', async ({ request }) => {
  const admin = await auth(request, 'admin');
  const get = async (path: string, params?: Record<string, string | number>) =>
    (await request.get(`${API}${path}`, { headers: admin, params })).json();
  const terms = await get('/school/terms', { pageSize: 100 });
  const term = (terms.data ?? terms).find((t: any) => t.isCurrent);
  const classes = (await get('/school/classes', { pageSize: 200 })).data;
  const own = classes.find((c: any) => c.name === 'P.1 A');
  const other = classes.find((c: any) => c.name === 'P.7 A');
  const today = new Date().toISOString().slice(0, 10);
  const pupilCount = async () => (await get('/school/students', { pageSize: 1 })).meta?.total;
  const invoiceCount = async () => (await get('/school/finance/invoices', { pageSize: 1 })).total;

  type Case = { who: Who; what: string; method: 'get' | 'post'; path: string; data?: unknown; params?: Record<string, string>; expect: 'allow' | 'deny' };
  const register = { name: `Matrix Pupil ${Date.now()}`, classId: own.id, termId: term.id, rollNumber: `MX-${Date.now()}` };
  const cases: Case[] = [
    // Registrar: pupils yes, money no.
    { who: 'registrar', what: 'list pupils', method: 'get', path: '/school/students', params: { pageSize: '1' }, expect: 'allow' },
    { who: 'registrar', what: 'read fee invoices', method: 'get', path: '/school/finance/invoices', expect: 'deny' },
    { who: 'registrar', what: 'run term billing', method: 'post', path: '/school/billing/generate', data: { termId: term.id, classId: own.id }, expect: 'deny' },
    { who: 'registrar', what: 'close the financial term', method: 'post', path: `/school/finance/terms/${term.id}/close`, expect: 'deny' },
    // Bursar: money yes, pupils and period close no.
    { who: 'bursar', what: 'read fee invoices', method: 'get', path: '/school/finance/invoices', params: { pageSize: '1' }, expect: 'allow' },
    { who: 'bursar', what: 'register a pupil', method: 'post', path: '/school/students/register', data: register, expect: 'deny' },
    { who: 'bursar', what: 'close the financial term', method: 'post', path: `/school/finance/terms/${term.id}/close`, expect: 'deny' },
    { who: 'bursar', what: 'define a school pupil field', method: 'post', path: '/school/custom-fields', data: { entityType: 'student', name: 'x', label: 'X' }, expect: 'deny' },
    // Head teacher: oversight and approval, not cashiering or admissions.
    { who: 'head', what: 'see fee corrections', method: 'get', path: '/school/finance/corrections', expect: 'allow' },
    { who: 'head', what: 'take a payment', method: 'post', path: '/school/payments/collect', data: { studentProfileId: 'x', amount: 1000, paymentMethod: 'cash' }, expect: 'deny' },
    { who: 'head', what: 'register a pupil', method: 'post', path: '/school/students/register', data: register, expect: 'deny' },
    // Teacher: own class register only; no money, no admissions.
    { who: 'teacher', what: 'read own class register', method: 'get', path: '/school/attendance/register', params: { classId: own.id, date: today }, expect: 'allow' },
    { who: 'teacher', what: 'read another class register', method: 'get', path: '/school/attendance/register', params: { classId: other.id, date: today }, expect: 'deny' },
    { who: 'teacher', what: 'mark another class register', method: 'post', path: '/school/attendance/mark', data: { classId: other.id, date: today, entries: [] }, expect: 'deny' },
    { who: 'teacher', what: 'read fee invoices', method: 'get', path: '/school/finance/invoices', expect: 'deny' },
    { who: 'teacher', what: 'register a pupil', method: 'post', path: '/school/students/register', data: register, expect: 'deny' },
    { who: 'teacher', what: 'run term billing', method: 'post', path: '/school/billing/generate', data: { termId: term.id }, expect: 'deny' },
  ];

  const pupilsBefore = await pupilCount();
  const invoicesBefore = await invoiceCount();
  const failures: string[] = [];
  for (const c of cases) {
    const headers = await auth(request, c.who);
    const res = c.method === 'get'
      ? await request.get(`${API}${c.path}`, { headers, params: c.params })
      : await request.post(`${API}${c.path}`, { headers, data: c.data ?? {} });
    const ok = c.expect === 'allow' ? res.ok() : res.status() === 403;
    if (!ok) failures.push(`${c.who} — ${c.what}: expected ${c.expect}, got ${res.status()}`);
  }
  expect(failures, failures.join('\n')).toEqual([]);

  // Refusals changed nothing.
  expect(await pupilCount()).toBe(pupilsBefore);
  expect(await invoiceCount()).toBe(invoicesBefore);
});
