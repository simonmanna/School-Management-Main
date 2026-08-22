/**
 * Demo seed for the Moodle-shaped LMS (ADR-014) — FULL SET.
 *
 * Lands in the SAVE-DEMO org (the one `admin@demo.test` logs into) so the data
 * is visible in the School → LMS UI. Generates a course for every
 * (Subject × Class) combination in the org, each with sections, modules
 * (resource/url/page/label), a group, enrolled students, a badge, a question
 * category and a published lesson plan.
 *
 * Deterministic UUIDs (slug-derived) make every run idempotent: re-running
 * reuses the same rows instead of duplicating or violating uniques.
 *
 * Run:
 *   LMS_API_BASE=http://127.0.0.1:3011/api/v1 \
 *     npx ts-node prisma/seed-lms-demo.ts
 */
import { PrismaClient } from '@prisma/client';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';

const prisma = new PrismaClient();

// ── Org + runtime config ─────────────────────────────────────────────────────
const ORG = '57c977d5-687f-456e-a5ab-6f7237f8c4d7';
const API_BASE = process.env.LMS_API_BASE ?? 'http://127.0.0.1:3011/api/v1';
const JWT_SECRET = process.env.JWT_ACCESS_SECRET ?? 'dev-access-secret-must-be-at-least-32-chars';

// Deterministic v4-shaped UUID from a namespace + slug (stable across runs).
function slugId(ns: string, slug: string): string {
  const h = crypto.createHash('md5').update(`${ns}:${slug}`).digest();
  h[6] = (h[6] & 0x0f) | 0x40; // version 4
  h[8] = (h[8] & 0x3f) | 0x80; // variant 10xx
  const hex = h.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

const CO_ID = (slug: string) => slugId('co', slug);
const CURR_ID = (slug: string) => slugId('curr', slug);
const LP_ID = (slug: string) => slugId('lp', slug);

const log = (...a: unknown[]) => console.log('[seed-lms]', ...a);

async function main() {
  // Resolve reference rows from the live DB.
  const ay = (await prisma.$queryRawUnsafe<{ id: string; name: string }[]>(
    `SELECT id, name FROM "AcademicYear" WHERE "organizationId"=$1 AND name='2026' LIMIT 1`, ORG,
  ))[0];
  const term = (await prisma.$queryRawUnsafe<{ id: string; name: string }[]>(
    `SELECT id, name FROM "Term" WHERE "organizationId"=$1 AND name='Term 2' LIMIT 1`, ORG,
  ))[0];
  const subjects = await prisma.$queryRawUnsafe<{ id: string; name: string }[]>(
    `SELECT id, name FROM "Subject" WHERE "organizationId"=$1 AND name NOT LIKE 'ZZZ%' ORDER BY name`, ORG,
  );
  const classes = await prisma.$queryRawUnsafe<{ id: string; name: string }[]>(
    `SELECT id, name FROM "SchoolClass" WHERE "organizationId"=$1 AND name NOT LIKE 'ZZZ%' ORDER BY name`, ORG,
  );
  const students = await prisma.$queryRawUnsafe<{ id: string }[]>(
    `SELECT sp.id FROM "StudentProfile" sp WHERE sp."organizationId"=$1 ORDER BY sp.id`, ORG,
  );
  if (!ay || !term || !subjects.length || !classes.length || !students.length) {
    throw new Error('Missing reference rows in org ' + ORG);
  }
  log(`references: ${subjects.length} subjects, ${classes.length} classes, ${students.length} students, ${ay.name}/${term.name}`);

  // Mint a JWT (manager-level perms) so the seed doubles as a CRUD proof.
  const tok = jwt.sign(
    { sub: 'seed-bot', organizationId: ORG, email: 'seed@demo.local',
      permissions: ['school:lms:read', 'school:courses:write', 'school:questionbank:write',
        'school:courses:enrol', 'school:grades:write'], type: 'access' },
    JWT_SECRET, { expiresIn: '2h' },
  );
  const H = { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' };
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await fetch(`${API_BASE}${path}`, { method, headers: H, body: body ? JSON.stringify(body) : undefined });
    const text = await res.text();
    if (res.status >= 400) throw new Error(`${method} ${path} -> ${res.status}: ${text.slice(0, 300)}`);
    return { status: res.status, json: text ? JSON.parse(text) : null };
  };

  // Seed the 8 archetype roles once.
  await call('POST', '/school/lms/roles/seed');
  log('roles/seed OK');

  // Build the course matrix.
  const courses: { subj: string; subjId: string; cls: string; clsId: string }[] = [];
  for (const s of subjects) for (const c of classes) courses.push({ subj: s.name, subjId: s.id, cls: c.name, clsId: c.id });

  let totalSections = 0, totalModules = 0, totalGroups = 0, totalEnrol = 0, totalBadges = 0, totalLP = 0;

  for (const co of courses) {
    const slug = `${co.subj}-${co.cls}`.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
    const coId = CO_ID(slug);
    const lpId = LP_ID(slug);

    // Curriculum (FK target) — one per (org, class, AY). Reuse if it exists, else insert.
    const existingCurr = await prisma.$queryRawUnsafe<{ id: string }[]>(
      `SELECT id FROM "Curriculum" WHERE "organizationId"=$1 AND "classId"=$2 AND "academicYearId"=$3 AND version=1 LIMIT 1`,
      ORG, co.clsId, ay.id,
    );
    let currId: string;
    if (existingCurr.length) {
      currId = existingCurr[0].id;
    } else {
      currId = CURR_ID(co.cls);
      await prisma.$executeRawUnsafe(
        `INSERT INTO "Curriculum" (id,"organizationId","classId","academicYearId",name,version,status,"createdAt","updatedAt")
         VALUES ($1,$2,$3,$4,$5,1,'published',now(),now())
         ON CONFLICT ("organizationId","classId","academicYearId",version) DO NOTHING;`,
        currId, ORG, co.clsId, ay.id, `${co.cls} Curriculum`,
      );
    }

    // CourseOffering — idempotent.
    await prisma.$executeRawUnsafe(
      `INSERT INTO "CourseOffering"
        (id,"organizationId","academicYearId","termId","subjectId","classId","sectionId","curriculumId",
         status,format,"numSections","completionEnabled","createdAt","updatedAt")
       VALUES ($1,$2,$3,$4,$5,$6,NULL,$7,'active','weeks',6,true,now(),now())
       ON CONFLICT (id) DO UPDATE SET status='active',"completionEnabled"=true;`,
      coId, ORG, ay.id, term.id, co.subjId, co.clsId, currId,
    );

    // LessonPlan — idempotent (published into the course).
    await prisma.$executeRawUnsafe(
      `INSERT INTO "LessonPlan"
        (id,"organizationId","subjectId","classId","termId",title,"weekOf",status,"createdAt","updatedAt","courseOfferingId")
       VALUES ($1,$2,$3,$4,$5,$6,'2026-01-12','approved',now(),now(),$7)
       ON CONFLICT (id) DO UPDATE SET title=$6,"courseOfferingId"=$7;`,
      lpId, ORG, co.subjId, co.clsId, term.id, `${co.subj} Scheme of Work`, coId,
    );

    // Assign a course manager (uses the fixed upsert) before mutating.
    await call('POST', '/school/lms/roles/assign', { courseOfferingId: coId, roleShortname: 'manager', userId: 'seed-bot' });

    // Question category (skip if exists).
    const cats = await call('GET', `/school/lms/question-categories?courseOfferingId=${coId}`);
    if (!((cats.json as any[]) ?? []).some((c: any) => c.name === `${co.subj} Bank`)) {
      await call('POST', '/school/lms/question-categories', { name: `${co.subj} Bank`, courseOfferingId: coId });
    }

    // Two sections per course.
    const secIds: string[] = [];
    for (const secName of [`${co.subj} · Week A`, `${co.subj} · Week B`]) {
      const prior = await call('GET', `/school/lms/courses/${coId}?studentProfileId=`);
      const existing = ((prior.json as any)?.sections ?? []).find((s: any) => s.name === secName);
      if (existing) { secIds.push(existing.id); }
      else { const s = await call('POST', `/school/lms/courses/${coId}/sections`, { name: secName }); secIds.push((s.json as any).id); totalSections++; }
    }

    // Modules: one of each content plugin, across the two sections.
    const mods = [
      { sec: 0, type: 'resource', name: `${co.subj} Notes (PDF)` },
      { sec: 0, type: 'url', name: `${co.subj} Reference`, body: { url: 'https://example.com/ref' } },
      { sec: 0, type: 'page', name: `${co.subj} Lecture`, body: { content: `<p>${co.subj} intro…</p>` } },
      { sec: 1, type: 'label', name: `⚠️ ${co.subj} assignment due` },
      { sec: 1, type: 'resource', name: `${co.subj} Worksheet` },
    ];
    const priorMods = new Set(((await call('GET', `/school/lms/courses/${coId}?studentProfileId=`)).json as any)?.sections?.flatMap((s: any) => (s.modules ?? []).map((m: any) => m.name)) ?? []);
    for (const m of mods) {
      if (priorMods.has(m.name)) continue;
      await call('POST', `/school/lms/courses/${coId}/modules`,
        { sectionId: secIds[m.sec], activityType: m.type, name: m.name, ...(m.body ?? {}) });
      totalModules++;
    }

    // Group with 3 students (skip if exists).
    const existingGroups = await call('GET', `/school/lms/courses/${coId}/groups`);
    const grpName = `${co.cls} Lab Group`;
    let grpId: string;
    const g = ((existingGroups.json as any[]) ?? []).find((x: any) => x.name === grpName);
    if (g) grpId = g.id;
    else { const ng = await call('POST', `/school/lms/courses/${coId}/groups`, { name: grpName }); grpId = (ng.json as any).id; totalGroups++; }
    const trio = students.slice(0, 3).map((s) => s.id); // deterministic 3 per course
    for (const st of trio) await call('POST', `/school/lms/groups/${grpId}/members`, { studentProfileId: st });

    // Enrol the trio as students.
    for (const st of trio) { await call('POST', `/school/lms/courses/${coId}/enrol`, { studentProfileId: st, roleShortname: 'student' }); totalEnrol++; }

    // Badge (skip if exists).
    const existingBadges = await call('GET', `/school/lms/badges?courseOfferingId=${coId}`);
    if (!((existingBadges.json as any[]) ?? []).some((b: any) => b.name === `${co.subj} Star`)) {
      await call('POST', '/school/lms/badges', { courseOfferingId: coId, name: `${co.subj} Star`, description: `Top of ${co.subj}` });
      totalBadges++;
    }

    // Publish the lesson plan into the course.
    await call('POST', `/school/lms/lesson-plans/${lpId}/publish-to-course`, { courseOfferingId: coId, sectionNo: 0 });
    totalLP++;

    log(`course ${co.subj} · ${co.cls}: sections+${secIds.length} modules+${mods.length} group+1 enrol+${trio.length} badge+1 lp+1`);
  }

  log('─'.repeat(60));
  log(`TOTALS: courses=${courses.length} sections+=${totalSections} modules+=${totalModules} groups+=${totalGroups} enrol+=${totalEnrol} badges+=${totalBadges} lessonPlans+=${totalLP}`);
  log('FULL DEMO SEED COMPLETE ✅');
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => { console.error('[seed-lms] FAILED:', e.message); await prisma.$disconnect(); process.exit(1); });
