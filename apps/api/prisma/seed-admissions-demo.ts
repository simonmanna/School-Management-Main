/**
 * Demo seed for Admissions & Applications (School-Management).
 *
 * Lands in the SAVE-DEMO org (admin@demo.test) so it's visible in the
 * School → Admissions / Applications UI. Creates a 2026 intake cycle, capacity,
 * and a realistic spread of applications driven through the admissions FSM so
 * every pipeline status is represented. Idempotent: re-running reuses rows
 * (deterministic application numbers + existence checks) instead of duplicating.
 *
 * Run (parallel LMS-enabled API on :3011):
 *   LMS_API_BASE=http://127.0.0.1:3011/api/v1 npx ts-node --transpile-only prisma/seed-admissions-demo.ts
 */
import { PrismaClient } from '@prisma/client';
import jwt from 'jsonwebtoken';

const ORG = '57c977d5-687f-456e-a5ab-6f7237f8c4d7';
const BASE = process.env.LMS_API_BASE || 'http://127.0.0.1:3011/api/v1';

// Stable permission set: read + manage admissions.
const TOKEN = jwt.sign(
  { sub: 'seed-bot', organizationId: ORG, email: 's@d.local', permissions: ['school:read', 'school:admissions:write'], type: 'access' },
  process.env.JWT_ACCESS_SECRET || 'dev-access-secret-must-be-at-least-32-chars',
  { expiresIn: '2h' },
);

type R = { id: string; status: string };
const prisma = new PrismaClient();

async function call(method: string, path: string, body?: any): Promise<{ status: number; json: any }> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  if (res.status >= 400) {
    throw new Error(`HTTP ${res.status} ${method} ${path} -> ${typeof json === 'string' ? json.slice(0, 200) : JSON.stringify(json).slice(0, 200)}`);
  }
  return { status: res.status, json };
}

const log = (...a: any[]) => console.log('[seed-adm]', ...a);

// Helpers to read an application's applicant fields for the enroll student object.
async function appRow(id: string) {
  return (await prisma.$queryRawUnsafe<{ applicantFirstName: string; applicantLastName: string; applicantDob: Date | null; applicantGender: string | null }[]>(
    `SELECT "applicantFirstName", "applicantLastName", "applicantDob", "applicantGender" FROM "AdmissionApplication" WHERE id=$1`, id))[0];
}
const appNm = (id: string) => { const r = appCache.get(id); return r ? `${r.applicantFirstName} ${r.applicantLastName}` : 'Applicant'; };
const appDob = (id: string) => { const r = appCache.get(id); return r?.applicantDob ? r.applicantDob.toISOString().slice(0, 10) : undefined; };
const appGender = (id: string) => { const r = appCache.get(id); return (r?.applicantGender as any) ?? undefined; };
const appCache = new Map<string, any>();

async function main() {
// ── Reference data ────────────────────────────────────────────────────────────
const ay = (await prisma.$queryRawUnsafe<{ id: string }[]>(
  `SELECT id FROM "AcademicYear" WHERE "organizationId"=$1 ORDER BY name DESC LIMIT 1`, ORG))[0];
const classes = await prisma.$queryRawUnsafe<{ id: string; name: string }[]>(
  `SELECT id, name FROM "SchoolClass" WHERE "organizationId"=$1 ORDER BY name`, ORG);
const clsEast = classes.find((c) => c.name === 'S3 East')!;
const clsWest = classes.find((c) => c.name === 'S3 West')!;

// ── 1. Admission cycle (idempotent by unique org+ay+name) ──────────────────────
const CYCLE_NAME = '2026 Intake';
let cycle: { id: string };
const existingCycle = await prisma.$queryRawUnsafe<{ id: string }[]>(
  `SELECT id FROM "AdmissionCycle" WHERE "organizationId"=$1 AND "academicYearId"=$2 AND name=$3`, ORG, ay.id, CYCLE_NAME);
if (existingCycle.length) {
  cycle = existingCycle[0];
  log('cycle reused:', cycle.id);
} else {
  const c = await call('POST', '/school/admissions/cycles', { academicYearId: ay.id, name: CYCLE_NAME });
  cycle = c.json;
  log('cycle created:', cycle.id);
}

// ── 2. Capacity (idempotent: setCapacity upserts) ──────────────────────────────
await call('POST', '/school/admissions/capacity', { admissionCycleId: cycle.id, classId: clsEast.id, capacity: 40 });
await call('POST', '/school/admissions/capacity', { admissionCycleId: cycle.id, classId: clsWest.id, capacity: 40 });
log('capacity set for S3 East / S3 West');

// ── 3. Applications ─────────────────────────────────────────────────────────────
// Each: [firstName, lastName, classId, gender, dob, source, draft?]
type AppSpec = { first: string; last: string; cls: string; gender: string; dob: string; source: string; draft?: boolean; guardians: { firstName: string; lastName?: string; relationship: string; phone: string }[] };
const APPS: AppSpec[] = [
  { first: 'Amina', last: 'Nakato', cls: clsEast.id, gender: 'female', dob: '2011-03-12', source: 'website',
    guardians: [{ firstName: 'Grace', lastName: 'Nakato', relationship: 'mother', phone: '+256771000101' }] },
  { first: 'Brian', last: 'Mukasa', cls: clsEast.id, gender: 'male', dob: '2011-07-04', source: 'referral',
    guardians: [{ firstName: 'David', lastName: 'Mukasa', relationship: 'father', phone: '+256771000102' }] },
  { first: 'Charity', last: 'Auma', cls: clsWest.id, gender: 'female', dob: '2011-01-22', source: 'walk_in',
    guardians: [{ firstName: 'Rose', lastName: 'Auma', relationship: 'mother', phone: '+256771000103' }] },
  { first: 'David', last: 'Okello', cls: clsWest.id, gender: 'male', dob: '2010-11-30', source: 'agent',
    guardians: [{ firstName: 'John', lastName: 'Okello', relationship: 'father', phone: '+256771000104' }] },
  { first: 'Esther', last: 'Nabuuma', cls: clsEast.id, gender: 'female', dob: '2011-05-18', source: 'sibling',
    guardians: [{ firstName: 'Sarah', lastName: 'Nabuuma', relationship: 'guardian', phone: '+256771000105' }] },
  { first: 'Frank', last: 'Ssempijja', cls: clsEast.id, gender: 'male', dob: '2011-09-09', source: 'website',
    guardians: [{ firstName: 'Peter', lastName: 'Ssempijja', relationship: 'father', phone: '+256771000106' }] },
  { first: 'Gloria', last: 'Nanteza', cls: clsWest.id, gender: 'female', dob: '2011-02-14', source: 'referral',
    guardians: [{ firstName: 'Alice', lastName: 'Nanteza', relationship: 'mother', phone: '+256771000107' }] },
  { first: 'Henry', last: 'Kato', cls: clsWest.id, gender: 'male', dob: '2010-12-01', source: 'walk_in',
    guardians: [{ firstName: 'Michael', lastName: 'Kato', relationship: 'father', phone: '+256771000108' }] },
  { first: 'Irene', last: 'Nakigozi', cls: clsEast.id, gender: 'female', dob: '2011-06-25', source: 'website',
    guardians: [{ firstName: 'Joy', lastName: 'Nakigozi', relationship: 'mother', phone: '+256771000109' }] },
  { first: 'Joel', last: 'Lubwama', cls: clsWest.id, gender: 'male', dob: '2011-04-03', source: 'agent',
    guardians: [{ firstName: 'Sam', lastName: 'Lubwama', relationship: 'guardian', phone: '+256771000110' }] },
  { first: 'Kevin', last: 'Ssali', cls: clsEast.id, gender: 'male', dob: '2011-08-19', source: 'other',
    guardians: [{ firstName: 'Tom', lastName: 'Ssali', relationship: 'father', phone: '+256771000111' }] },
  { first: 'Lydia', last: 'Namugenyi', cls: clsWest.id, gender: 'female', dob: '2011-10-07', source: 'sibling',
    guardians: [{ firstName: 'Mary', lastName: 'Namugenyi', relationship: 'mother', phone: '+256771000112' }] },
  // Two kept as drafts (never submitted).
  { first: 'Miriam', last: 'Kukundakwe', cls: clsEast.id, gender: 'female', dob: '2011-03-30', source: 'website', draft: true,
    guardians: [{ firstName: 'Hope', lastName: 'Kukundakwe', relationship: 'mother', phone: '+256771000113' }] },
  { first: 'Nicholas', last: 'Mutebi', cls: clsWest.id, gender: 'male', dob: '2011-07-21', source: 'referral', draft: true,
    guardians: [{ firstName: 'Paul', lastName: 'Mutebi', relationship: 'father', phone: '+256771000114' }] },
];

// FSM paths to showcase. Index aligns with APPS (skipping the 2 drafts).
// Each entry: ordered list of review actions to apply.
const PATHS: string[][] = [
  ['review', 'screen', 'schedule_interview', 'complete_interview', 'score', 'accept'], // -> accepted (seed issues offer + enroll)
  ['review', 'screen', 'schedule_interview', 'complete_interview', 'score', 'waitlist'], // -> waitlisted
  ['review', 'screen', 'schedule_interview', 'complete_interview', 'score', 'reject'], // -> rejected
  ['review', 'request_documents'], // -> documents_pending
  ['review', 'screen', 'schedule_exam', 'exam_done', 'score', 'accept'], // -> accepted (seed issues offer + enroll)
  ['review', 'screen', 'schedule_interview', 'complete_interview', 'score'], // -> scored (awaiting decision)
  ['review', 'screen'], // -> screening
  ['review'], // -> under_review
  ['review', 'screen', 'schedule_interview', 'complete_interview', 'score', 'accept'], // -> accepted (seed issues offer + enroll)
  ['review', 'screen', 'schedule_interview'], // -> interview_scheduled
  ['review', 'screen'], // -> screening
];

const created: { app: R; path: string[] }[] = [];
for (let i = 0; i < APPS.length; i++) {
  const a = APPS[i];
  // Idempotency: match by (org, firstName, lastName, academicYear) to reuse.
  const existing = await prisma.$queryRawUnsafe<{ id: string; status: string }[]>(
    `SELECT id, status FROM "AdmissionApplication" WHERE "organizationId"=$1 AND "applicantFirstName"=$2 AND "applicantLastName"=$3 AND "academicYearId"=$4 LIMIT 1`,
    ORG, a.first, a.last, ay.id);
  let app: R;
  if (existing.length) {
    app = existing[0];
    log(`reused ${a.first} ${a.last} (${app.status})`);
  } else {
    const c = await call('POST', '/school/admissions', {
      academicYearId: ay.id,
      admissionCycleId: cycle.id,
      applicantFirstName: a.first,
      applicantLastName: a.last,
      applicantDob: a.dob,
      applicantGender: a.gender,
      applyingForClassId: a.cls,
      sourceOfEnquiry: a.source,
      asDraft: !!a.draft,
      guardians: a.guardians,
    });
    app = c.json;
    log(`created ${a.first} ${a.last} (${app.status}) id=${app.id}`);
  }
  if (!a.draft && i < PATHS.length) created.push({ app, path: PATHS[i] });
}

// ── 4. Drive the FSM ────────────────────────────────────────────────────────────
// Apps flagged `enroll: true` go all the way to enrolled (use the dedicated
// issueOffer controller so an OfferLetter row exists for the enroll guard).
const TERM = (await prisma.$queryRawUnsafe<{ id: string }[]>(`SELECT id FROM "Term" WHERE "organizationId"=$1 LIMIT 1`, ORG))[0]?.id;
for (const { app, path } of created) {
  appCache.set(app.id, await appRow(app.id));
  let cur = app;
  for (const action of path) {
    try {
      const r = await call('POST', `/school/admissions/${cur.id}/review`, { action, notes: `demo: ${action}` });
      cur = r.json;
    } catch (e: any) {
      log(`  (skip ${action} on ${cur.id}: ${e.message})`);
      break;
    }
  }
  // For the "accepted" terminal of the path, issue a real offer letter, accept, enroll.
  if (cur.status === 'accepted') {
    try {
      await call('POST', `/school/admissions/${cur.id}/offer`, { body: 'Welcome — please find your provisional offer attached.', expiresAt: new Date(Date.now() + 14 * 864e5).toISOString() });
      await call('POST', `/school/admissions/${cur.id}/review`, { action: 'accept_offer', notes: 'demo: accept_offer' });
      if (TERM) {
        const r = await call('POST', '/school/admissions/enroll', {
          applicationId: cur.id,
          classId: clsEast.id,
          termId: TERM,
          rollNumber: `DEMO-${cur.id.slice(0, 6)}`,
          student: { name: `${appNm(cur.id)}`, dateOfBirth: appDob(cur.id), gender: appGender(cur.id) },
        });
        log(`  enrolled ${cur.id} ->`, (r.json as any).status ?? r.status);
      } else {
        log(`  (enroll skip ${cur.id}: no Term)`);
      }
    } catch (e: any) {
      log(`  (enroll path skip ${cur.id}: ${e.message})`);
    }
  } else if (cur.status === 'offer_accepted' && TERM) {
    // Already accepted the offer in a prior run — just enroll.
    try {
      const r = await call('POST', '/school/admissions/enroll', {
        applicationId: cur.id,
        classId: clsEast.id,
        termId: TERM,
        rollNumber: `DEMO-${cur.id.slice(0, 6)}`,
        student: { name: `${appNm(cur.id)}`, dateOfBirth: appDob(cur.id), gender: appGender(cur.id) },
      });
      log(`  enrolled ${cur.id} ->`, (r.json as any).status ?? r.status);
    } catch (e: any) {
      log(`  (enroll skip ${cur.id}: ${e.message})`);
    }
  } else {
    log(`  final status ${cur.id}: ${cur.status}`);
  }
}

// ── 5. Charge + settle a fee on a couple of apps (showcases fee lifecycle) ──
const feeTargets = created.filter((c) => ['submitted', 'under_review', 'screening', 'scored', 'documents_pending'].includes(c.app.status)).slice(0, 3);
for (const { app } of feeTargets) {
  try {
    await call('POST', `/school/admissions/${app.id}/fee`, { amount: 50000, currency: 'UGX' });
    await call('POST', `/school/admissions/${app.id}/fee/settle`, { waived: false });
    log(`  fee charged+settled for ${app.id}`);
  } catch (e: any) {
    log(`  (fee skip ${app.id}: ${e.message})`);
  }
}

// ── 6. Summary ──────────────────────────────────────────────────────────────────
const summary = await prisma.$queryRawUnsafe<{ status: string; n: number }[]>(
  `SELECT status, count(*)::int n FROM "AdmissionApplication" WHERE "organizationId"=$1 GROUP BY status ORDER BY n DESC`, ORG);
log('─'.repeat(50));
log('Admissions demo seeded. Status breakdown (org):');
for (const s of summary) log(`  ${s.status.padEnd(18)} ${s.n}`);
log('DONE ✅');

await prisma.$disconnect();
}

main().catch((e) => { console.error('SEED FAILED:', e.message); process.exit(1); });