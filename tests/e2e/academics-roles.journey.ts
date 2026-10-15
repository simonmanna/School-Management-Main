/**
 * Academics — role journeys against a live API and the Sunrise demo school
 * (2026-10-14 academics review, Phase 3).
 *
 * Run (API on 3003, Sunrise demo seeded):
 *   ACADEMICS_API_BASE=http://localhost:3003 npx tsx --test tests/e2e/academics-roles.journey.ts
 *
 * Each journey signs in as the person who does the job and checks what they
 * can and cannot do, and that what parents would be shown is right:
 *   - Teacher: own papers only, own class's comments only, no head comment,
 *     no allocation grid.
 *   - Director of Studies: allocation grid and Term Board; cannot release.
 *   - Head Teacher: writes the head teacher's comment.
 *   - Results: nursery reported in descriptors; lower primary has no division
 *     by default; upper primary has an aggregate and a division.
 * The only writes are comments on the current (unreleased) term.
 */
import { before as beforeAll, describe, test } from 'node:test';
import assert from 'node:assert/strict';

// Plain Node test runner (the repo's vitest install cannot start). Minimal expect.
const expect = (v: any) => ({
  toBe: (x: any) => assert.strictEqual(v, x),
  toBeTruthy: () => assert.ok(v),
  toBeGreaterThan: (x: number) => assert.ok(v > x, String(v) + ' > ' + x),
  toHaveLength: (n: number) => assert.strictEqual(v.length, n),
  toContain: (x: any) => assert.ok(v.includes(x), JSON.stringify(x)),
});

const BASE = (process.env.ACADEMICS_API_BASE ?? 'http://localhost:3003') + '/api/v1';
const ORG = process.env.ACADEMICS_ORG_CODE ?? 'SUNRISE';
const PASSWORD = process.env.DEMO_STAFF_PASSWORD ?? 'Staff@123';
const DOMAIN = process.env.ACADEMICS_EMAIL_DOMAIN ?? 'sunrise.test';

type Session = { token: string };

async function login(user: string): Promise<Session> {
  const res = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ organizationCode: ORG, email: `${user}@${DOMAIN}`, password: PASSWORD }),
  });
  if (!res.ok) throw new Error(`login ${user} → ${res.status}`);
  return { token: (await res.json()).accessToken };
}

async function call(s: Session, path: string, init: RequestInit = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${s.token}`, ...(init.headers ?? {}) },
  });
  const text = await res.text();
  let body: any = text;
  try { body = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, body };
}

let teacher: Session;
let dos: Session;
let head: Session;
let currentTermId = '';
let releasedTermId = '';
let p5Id = '';
let topClassId = '';
let p1Id = '';

beforeAll(async () => {
  [teacher, dos, head] = await Promise.all([login('teacher'), login('dos'), login('head')]);
  const terms = (await call(dos, '/school/terms?pageSize=100')).body.data as any[];
  currentTermId = terms.find((t) => t.isCurrent)?.id;
  // The latest term before the current one that has released results.
  const earlier = terms
    .filter((t) => t.id !== currentTermId && new Date(t.startDate) < new Date(terms.find((x) => x.id === currentTermId).startDate))
    .sort((a, b) => +new Date(b.startDate) - +new Date(a.startDate));
  for (const t of earlier) {
    const sets = (await call(dos, `/school/results/by-term/${t.id}`)).body;
    if (Array.isArray(sets) && sets.some((s: any) => s.status === 'published')) { releasedTermId = t.id; break; }
  }
  const classes = (await call(dos, '/school/classes?pageSize=100')).body.data as any[];
  p5Id = classes.find((c) => /^P\.?5$/.test(c.name))?.id;
  p1Id = classes.find((c) => /^P\.?1$/.test(c.name))?.id;
  topClassId = classes.find((c) => /top/i.test(c.name))?.id;
  expect(currentTermId && releasedTermId && p5Id && p1Id && topClassId).toBeTruthy();
});

describe('Class teacher', () => {
  test('sees exam papers only for the classes and subjects they are allocated', async () => {
    const me = (await call(teacher, '/hr/me/identity')).body;
    const overview = (await call(teacher, `/school/portals/teaching/${me.staffProfileId}`)).body;
    const pairs = new Set((overview.classes as any[]).map((c) => `${c.classId}:${c.subjectId}`));
    for (const p of overview.examPapers as any[]) expect(pairs.has(`${p.classId}:${p.subjectId}`)).toBe(true);
  });

  test('writes the class teacher’s comment for their own class, never the head teacher’s', async () => {
    const sheet = (await call(teacher, `/school/report-cards/comments?classId=${p5Id}&termId=${currentTermId}`)).body;
    expect(sheet.canWriteClass).toBe(true);
    expect(sheet.canWriteHead).toBe(false);
    const mine = (sheet.rows as any[]).find((r) => r.classCommentEditable);
    expect(mine).toBeTruthy();
    const head = await call(teacher, '/school/report-cards/comments', {
      method: 'POST',
      body: JSON.stringify({ termId: currentTermId, items: [{ studentProfileId: mine.studentProfileId, principalComment: 'Not mine to write' }] }),
    });
    expect(head.body.saved).toBe(0);
    expect(head.body.refused).toHaveLength(1);
  });

  test('cannot open the allocation grid', async () => {
    expect((await call(teacher, `/school/teaching-allocation?termId=${currentTermId}`)).status).toBe(403);
  });
});

describe('Director of Studies', () => {
  test('runs the allocation grid and the term board', async () => {
    const grid = await call(dos, `/school/teaching-allocation?termId=${currentTermId}`);
    expect(grid.status).toBe(200);
    expect(grid.body.levels.length).toBeGreaterThan(0);
    const board = await call(dos, `/school/term-board?termId=${currentTermId}`);
    expect(board.status).toBe(200);
    expect(board.body.classes.some((c: any) => c.classId === p5Id)).toBe(true);
  });

  test('cannot release results to families (the head teacher does)', async () => {
    const res = await call(dos, '/school/term-board/publish', { method: 'POST', body: JSON.stringify({ termId: currentTermId, classIds: [p5Id] }) });
    expect(res.status).toBe(403);
  });
});

describe('Head Teacher', () => {
  test('may write the head teacher’s comment', async () => {
    const sheet = (await call(head, `/school/report-cards/comments?classId=${p5Id}&termId=${currentTermId}`)).body;
    expect(sheet.canWriteHead).toBe(true);
  });
});

describe('Released results are graded by level', () => {
  test('nursery is descriptors; P1 has no division; P5 has aggregate and division', async () => {
    const sets = (await call(dos, `/school/results/by-term/${releasedTermId}`)).body as any[];
    const of = (classId: string) => sets.find((s) => s.scopeId === classId && s.status === 'published');
    expect(of(topClassId).gradingSystem).toBe('ECD');
    const p1 = (await call(dos, `/school/results/${of(p1Id).id}`)).body;
    expect((p1.students as any[]).every((t) => t.division == null)).toBe(true);
    const p5 = (await call(dos, `/school/results/${of(p5Id).id}`)).body;
    const graded = (p5.students as any[]).filter((t) => t.aggregate != null);
    expect(graded.length).toBeGreaterThan(0);
    for (const t of graded) expect(['I', 'II', 'III', 'IV', 'U']).toContain(t.division);
    const nursery = (await call(dos, `/school/results/${of(topClassId).id}`)).body;
    expect((nursery.students as any[]).every((t) => t.classRank == null && t.division == null)).toBe(true);
  });
});
