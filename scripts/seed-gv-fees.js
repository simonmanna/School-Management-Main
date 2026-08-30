/*
 * Seed "Green Valley Primary School — 2026" fee demo data into the live
 * SUNRISE (org_sunrise_academy) organization in schooldb-planet.
 *
 * Faithfully ports the ChatGPT Ugandan-primary-school fee dataset:
 *   - Fee Categories catalog (extends the existing 8 with the GV set)
 *   - Fee Structures: Primary Day (per grade, per term), Primary Boarding
 *     (per grade, per term), and a New-Student intake structure
 *   - Optional fees (StudentOptionalFee opt-ins) for transport, break tea,
 *     swimming, extra coaching, after-school care, music, trip
 *   - Billing runs driven through the REAL billing engine via the API:
 *       Run 1 Term 1 (completed), Run 2 Term 2 (completed),
 *       Run 3 Term 3 (draft / left unprocessed),
 *       Run 4 Term 2 Transport (real transport invoices from Run 2)
 *
 * Idempotent: re-running skips if the GV marker structure already exists.
 */
const path = require('path');
const { Client } = require('pg');
require('dotenv').config({ path: path.join(__dirname, '..', 'apps', 'api', '.env') });

// ── live API (runs on Simon's Windows host; reachable from this terminal) ──
const API = process.env.API_BASE || 'http://localhost:3001/api/v1';
const ORG = 'org_sunrise_academy';
const ORG_CODE = 'SUNRISE';
const EMAIL = 'admin@sunrise.test';
const PASSWORD = 'Admin@123';

const c = new Client({ connectionString: process.env.DATABASE_URL });

const now = () => new Date().toISOString();
const j = (o) => JSON.stringify(o);
const RESET = process.argv.includes('--reset');

// wipe everything this script created (invoices + GL postings + opt-ins + structures)
async function resetGv() {
  console.log('== RESET: wiping GV fee demo data ==');
  // 1) journal entries/lines posted by GV school-fee invoices
  await c.query(
    `DELETE FROM "JournalLine" WHERE "journalEntryId" IN (SELECT id FROM "JournalEntry" WHERE "organizationId"=$1 AND "sourceType"='school_fee_invoice')`,
    [ORG],
  );
  await c.query(`DELETE FROM "JournalEntry" WHERE "organizationId"=$1 AND "sourceType"='school_fee_invoice'`, [ORG]);
  // 2) documents + school fee invoices (GV only -> 2026 primary structures)
  await c.query(
    `DELETE FROM "SchoolFeeInvoice" WHERE "organizationId"=$1 AND "termId" IN (SELECT id FROM "Term" WHERE "academicYearId"=(SELECT id FROM "AcademicYear" WHERE "organizationId"=$1 AND name='2026'))`,
    [ORG],
  );
  await c.query(
    `DELETE FROM "Document" WHERE "organizationId"=$1 AND "sourceType"='school_fee' AND "reference" LIKE 'TERM-%'`,
    [ORG],
  );
  // 3) billing runs + items (GV)
  await c.query(`DELETE FROM "BillingRunItem" WHERE "organizationId"=$1`, [ORG]);
  await c.query(`DELETE FROM "BillingRun" WHERE "organizationId"=$1`, [ORG]);
  // 4) optional fee opt-ins
  await c.query(`DELETE FROM "StudentOptionalFee" WHERE "organizationId"=$1`, [ORG]);
  // 5) structures + versions + items + schedules
  const structs = await c.query(
    `SELECT id FROM "FeeStructure" WHERE "organizationId"=$1 AND (name ILIKE 'Primary % 2026' OR name ILIKE 'New Student%')`,
    [ORG],
  );
  for (const s of structs.rows) {
    await c.query(`DELETE FROM "FeeItem" WHERE "feeStructureVersionId" IN (SELECT id FROM "FeeStructureVersion" WHERE "feeStructureId"=$1)`, [s.id]);
    await c.query(`DELETE FROM "FeeStructureVersion" WHERE "feeStructureId"=$1`, [s.id]);
    await c.query(`DELETE FROM "FeeSchedule" WHERE "feeStructureId"=$1`, [s.id]);
    await c.query(`DELETE FROM "FeeStructure" WHERE id=$1`, [s.id]);
  }
  // revert demo student renames/boarding/intake
  await c.query(`UPDATE "StudentProfile" SET "residenceType"='day' WHERE "organizationId"=$1 AND "currentClassId" IN (SELECT id FROM "SchoolClass" WHERE "organizationId"=$1)`, [ORG]);
  await c.query(`UPDATE "StudentProfile" SET "currentClassId"=NULL WHERE "organizationId"=$1 AND "currentClassId"=(SELECT id FROM "SchoolClass" WHERE "organizationId"=$1 AND name='P.1 New')`, [ORG]);
  await c.query(`DELETE FROM "SchoolClass" WHERE "organizationId"=$1 AND name='P.1 New'`, [ORG]);
  // restore Partner names that this script set (clear ALL rows carrying a
  // ChatGPT persona name so re-runs never leave duplicates)
  for (const nm of ['John Okello', 'Mary Namukasa', 'Brian Ouma', 'Sarah Nanyonga', 'David Kato', 'Grace Achieng', 'Isaac Mugisha', 'Anna Nakato']) {
    await c.query(`UPDATE "Partner" SET name=CONCAT('Student ', substr(gen_random_uuid()::text,1,8)) WHERE id IN (SELECT p.id FROM "Partner" p JOIN "StudentProfile" sp ON sp."partnerId"=p.id WHERE sp."organizationId"=$1 AND p.name=$2)`, [ORG, nm]);
  }
  // GV-added categories (keep the original 8 if you want; we remove the GV additions)
  for (const code of ['LUNCH', 'PORRIDGE', 'DEVELOPMENT', 'ADMISSION', 'EXAM', 'MEDICAL', 'BOARDING', 'ACTIVITIES', 'TRIP', 'PLE', 'COACHING', 'CARE', 'MUSIC', 'UNIFORM_EXTRA']) {
    await c.query(`DELETE FROM "FeeCategory" WHERE "organizationId"=$1 AND code=$2`, [ORG, code]);
  }
  console.log('== RESET done ==');
}

async function main() {
  await c.connect();
  if (RESET) await resetGv();

  // ---- auth against live API (real token) ----
  const login = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ organizationCode: ORG_CODE, email: EMAIL, password: PASSWORD }),
  });
  if (!login.ok) throw new Error('login failed: ' + (await login.text()).slice(0, 200));
  const { accessToken } = await login.json();
  const auth = { Authorization: `Bearer ${accessToken}` };
  console.log('API token acquired');

  // ---- fetch org scaffolding ----
  const ay = (await c.query('SELECT id,name FROM "AcademicYear" WHERE id=$1', [ORG])).rows; // placeholder
  const years = (await c.query('SELECT id,name FROM "AcademicYear" WHERE "organizationId"=$1', [ORG])).rows;
  const year = years.find((y) => y.name === '2026');
  if (!year) throw new Error('2026 academic year not found for SUNRISE');
  const AY = year.id;

  const terms = (await c.query('SELECT id,name FROM "Term" WHERE "organizationId"=$1 AND "academicYearId"=$2', [ORG, AY])).rows;
  const T1 = terms.find((t) => t.name === 'Term 1').id;
  const T2 = terms.find((t) => t.name === 'Term 2').id;
  const T3 = terms.find((t) => t.name === 'Term 3').id;

  const grades = (await c.query('SELECT id,name FROM "GradeLevel" WHERE "organizationId"=$1 ORDER BY name', [ORG])).rows;
  const gmap = {};
  for (const g of grades) gmap[g.name] = g.id;
  const PRIMARY = ['P.1', 'P.2', 'P.3', 'P.4', 'P.5', 'P.6', 'P.7'];
  for (const p of PRIMARY) if (!gmap[p]) throw new Error('missing grade ' + p);

  // existing classes (one per grade, e.g. "P.1 A")
  const classes = (await c.query('SELECT id,name,"gradeLevelId" FROM "SchoolClass" WHERE "organizationId"=$1', [ORG])).rows;
  const classByGrade = {};
  for (const cl of classes) {
    const gname = grades.find((g) => g.id === cl.gradeLevelId)?.name;
    if (gname && PRIMARY.includes(gname)) classByGrade[gname] = cl.id;
  }

  // ---- idempotency guard (structure phase handled later by `seeded`) ----
  // ---- 1) Fee Categories ----
  const existing = (await c.query('SELECT id,code FROM "FeeCategory" WHERE "organizationId"=$1', [ORG])).rows;
  const catByCode = {};
  for (const r of existing) catByCode[r.code] = r.id;

  const cats = [
    ['TUITION', 'Tuition Fees', 'mandatory', 1],
    ['REGISTRATION', 'Registration Fee', 'mandatory', 2],
    ['UNIFORM', 'School Uniform', 'mandatory', 3],
    ['TRANSPORT', 'School Transport', 'optional', 4],
    ['MEAL', 'Meals', 'optional', 5],
    ['SWIMMING', 'Swimming', 'optional', 6],
    ['LAB', 'Laboratory', 'mandatory', 7],
    ['ACTIVITY', 'Activity', 'mandatory', 8],
    // --- GV additions ---
    ['LUNCH', 'Lunch', 'mandatory', 9],
    ['PORRIDGE', 'Break Tea / Porridge', 'optional', 10],
    ['DEVELOPMENT', 'Development Fee', 'mandatory', 11],
    ['ADMISSION', 'Admission Fee', 'mandatory', 12],
    ['EXAM', 'Examination Fee', 'mandatory', 13],
    ['MEDICAL', 'Medical / Health Fee', 'mandatory', 14],
    ['BOARDING', 'Boarding Fees', 'mandatory', 15],
    ['ACTIVITIES', 'Co-curricular Activities', 'optional', 16],
    ['TRIP', 'Educational Trip', 'optional', 17],
    ['PLE', 'PLE / Candidate Fee', 'mandatory', 18],
    ['COACHING', 'Extra Coaching', 'optional', 19],
    ['CARE', 'After-school Care', 'optional', 20],
    ['MUSIC', 'Music / Instrument', 'optional', 21],
    ['UNIFORM_EXTRA', 'Extra Uniform Set', 'optional', 22],
  ];
  for (const [code, name, type, order] of cats) {
    if (catByCode[code]) continue;
    const r = await c.query(
      'INSERT INTO "FeeCategory" (id,"organizationId",code,name,type,"paymentOrder","isActive","createdAt","updatedAt") VALUES (gen_random_uuid(),$1,$2,$3,$4,$5,true,now(),now()) RETURNING id',
      [ORG, code, name, type, order],
    );
    catByCode[code] = r.rows[0].id;
    console.log('  + category', code);
  }
  const C = (code) => catByCode[code];

  // ---- P.1 New intake class for new students ----
  let newClassId = (await c.query('SELECT id FROM "SchoolClass" WHERE "organizationId"=$1 AND name=$2', [ORG, 'P.1 New'])).rows[0]?.id;
  if (!newClassId) {
    const r = await c.query(
      'INSERT INTO "SchoolClass" (id,"organizationId",name,"gradeLevelId",capacity,"customFields","createdAt","updatedAt") VALUES (gen_random_uuid(),$1,$2,$3,0,\'{}\',now(),now()) RETURNING id',
      [ORG, 'P.1 New', gmap['P.1']],
    );
    newClassId = r.rows[0].id;
    console.log('  + class P.1 New');
  }

  // ---- helper: create a structure + immutable version + fee items + schedule ----
  async function makeStructure({ name, components, gradeLevelIds, residenceTypes, classIds }) {
    const applicableTo = {};
    if (gradeLevelIds) applicableTo.gradeLevelIds = gradeLevelIds;
    if (residenceTypes) applicableTo.residenceTypes = residenceTypes;
    if (classIds) applicableTo.classIds = classIds;

    const structRes = await c.query(
      `INSERT INTO "FeeStructure" (id,"organizationId",name,"academicYearId",components,"applicableTo","isActive",status,"createdAt","updatedAt")
       VALUES (gen_random_uuid(),$1,$2,$3,$4,$5,true,'published',now(),now()) RETURNING id`,
      [ORG, name, AY, j(components), j(applicableTo)],
    );
    const structId = structRes.rows[0].id;

    // immutable published version
    const verRes = await c.query(
      `INSERT INTO "FeeStructureVersion" (id,"organizationId","feeStructureId","versionNo","isImmutable","publishedAt","publishedById","createdAt")
       VALUES (gen_random_uuid(),$1,$2,1,true,now(),$3,now()) RETURNING id`,
      [ORG, structId, null],
    );
    const verId = verRes.rows[0].id;

    for (const comp of components) {
      await c.query(
        `INSERT INTO "FeeItem" (id,"organizationId","feeStructureVersionId",code,name,"productId",amount,"isOptional",frequency,"appliesTo","createdAt")
         VALUES (gen_random_uuid(),$1,$2,$3,$4,null,$5,$6,$7,$8,now())`,
        [ORG, verId, comp.code, comp.name, comp.amount, comp.isOptional, comp.frequency || 'per_term', j({})],
      );
    }
    await c.query('UPDATE "FeeStructure" SET "currentVersionId"=$1 WHERE id=$2', [verId, structId]);
    return structId;
  }

  async function makeSchedule(structId, termId, dueDate, lateType, lateValue, graceDays) {
    await c.query(
      `INSERT INTO "FeeSchedule" (id,"organizationId","feeStructureId","termId","dueDate","lateFeePolicy","createdAt","updatedAt")
       VALUES (gen_random_uuid(),$1,$2,$3,$4,$5,now(),now())`,
      [ORG, structId, termId, dueDate, j({ type: lateType, value: lateValue, graceDays })],
    );
  }

  // ---- ChatGPT fee model ----
  const tuition = { 'P.1': 400000, 'P.2': 400000, 'P.3': 420000, 'P.4': 420000, 'P.5': 450000, 'P.6': 450000, 'P.7': 500000 };
  const exam = { 'P.1': 20000, 'P.2': 20000, 'P.3': 20000, 'P.4': 20000, 'P.5': 20000, 'P.6': 20000, 'P.7': 30000 };

  // optional components shared (only billed to opted-in students)
  const OPTIONAL = [
    { code: 'TRANSPORT', name: 'School Transport', amount: 180000, frequency: 'per_term' },
    { code: 'SWIMMING', name: 'Swimming', amount: 60000, frequency: 'per_term' },
    { code: 'PORRIDGE', name: 'Break Tea / Porridge', amount: 40000, frequency: 'per_term' },
    { code: 'COACHING', name: 'Extra Coaching', amount: 50000, frequency: 'per_term' },
    { code: 'CARE', name: 'After-school Care', amount: 100000, frequency: 'per_term' },
    { code: 'MUSIC', name: 'Music / Instrument', amount: 75000, frequency: 'per_term' },
    { code: 'ACTIVITIES', name: 'Co-curricular Activities', amount: 30000, frequency: 'per_term' },
    { code: 'TRIP', name: 'Educational Trip', amount: 50000, frequency: 'one_event' },
  ];

  const IGNORE = new Set(); // not used

  async function buildComponents(grade, residence, term) {
    const comps = [];
    comps.push({ code: 'TUITION', name: 'Tuition Fees', amount: tuition[grade], isOptional: false, frequency: 'per_term' });
    if (residence === 'day') comps.push({ code: 'LUNCH', name: 'Lunch', amount: 80000, isOptional: false, frequency: 'per_term' });
    if (residence === 'boarding') comps.push({ code: 'BOARDING', name: 'Boarding Fees', amount: 500000, isOptional: false, frequency: 'per_term' });
    comps.push({ code: 'EXAM', name: 'Examination Fee', amount: exam[grade], isOptional: false, frequency: 'per_term' });
    comps.push({ code: 'MEDICAL', name: 'Medical / Health Fee', amount: 20000, isOptional: false, frequency: 'per_term' });
    if (term === 'T1') {
      comps.push({ code: 'DEVELOPMENT', name: 'Development Fee', amount: 100000, isOptional: false, frequency: 'one_time' });
      comps.push({ code: 'REGISTRATION', name: 'Registration Fee', amount: 20000, isOptional: false, frequency: 'one_time' });
    }
    for (const o of OPTIONAL) comps.push({ code: o.code, name: o.name, amount: o.amount, isOptional: true, frequency: o.frequency });
    return comps;
  }

  const due = { T1: '2026-02-15T00:00:00Z', T2: '2026-06-15T00:00:00Z', T3: '2026-10-15T00:00:00Z' };

  const seeded = (await c.query('SELECT id FROM "FeeStructure" WHERE "organizationId"=$1 AND name=$2', [ORG, 'Primary P.1 Day T1 2026'])).rows.length > 0;
  if (seeded) {
    console.log('  (structures already present — skipping structure creation)');
  } else {
    let structCount = 0;
    for (const grade of PRIMARY) {
      for (const residence of ['day', 'boarding']) {
        for (const [term, termId] of [['T1', T1], ['T2', T2], ['T3', T3]]) {
          const comps = await buildComponents(grade, residence, term);
          const name = `Primary ${grade} ${residence === 'day' ? 'Day' : 'Boarding'} ${term} 2026`;
          const sid = await makeStructure({
            name,
            components: comps,
            gradeLevelIds: [gmap[grade]],
            residenceTypes: [residence],
          });
          await makeSchedule(sid, termId, due[term], term === 'T1' ? 'percent' : 'fixed', term === 'T1' ? 5 : 0, 7);
          structCount++;
        }
      }
    }
    console.log(`  + ${structCount} primary day/boarding per-term structures`);

    // New-student intake structure (scoped to P.1 New class)
    const newComps = [
      { code: 'ADMISSION', name: 'Admission Fee', amount: 50000, isOptional: false, frequency: 'one_time' },
      { code: 'REGISTRATION', name: 'Registration Fee', amount: 20000, isOptional: false, frequency: 'one_time' },
      { code: 'TUITION', name: 'Tuition Fees', amount: 400000, isOptional: false, frequency: 'per_term' },
      { code: 'LUNCH', name: 'Lunch', amount: 80000, isOptional: false, frequency: 'per_term' },
      { code: 'EXAM', name: 'Examination Fee', amount: 20000, isOptional: false, frequency: 'per_term' },
      { code: 'DEVELOPMENT', name: 'Development Fee', amount: 100000, isOptional: false, frequency: 'one_time' },
      { code: 'UNIFORM', name: 'School Uniform', amount: 150000, isOptional: false, frequency: 'one_time' },
    ];
    const newSid = await makeStructure({
      name: 'New Student 2026 (P.1 Intake)',
      components: newComps,
      classIds: [newClassId],
      residenceTypes: ['day'],
    });
    await makeSchedule(newSid, T1, due.T1, 'percent', 5, 7);
    console.log('  + New Student 2026 structure');

    // ---- disable the legacy "Standard Term Fees" schedules so secondary students are skipped ----
    const legacy = await c.query('SELECT id FROM "FeeStructure" WHERE "organizationId"=$1 AND name=$2', [ORG, 'Standard Term Fees']);
    if (legacy.rows.length) {
      const del = await c.query('DELETE FROM "FeeSchedule" WHERE "organizationId"=$1 AND "feeStructureId"=$2', [ORG, legacy.rows[0].id]);
      console.log(`  - removed ${del.rowCount} legacy Standard schedules (kept structure)`);
    }
  }

  // ---- 3) Students: assign the 8 ChatGPT personas deterministically ----
  // `taken` only tracks students WE rename, so a pre-existing "Okello" elsewhere
  // never blocks us from placing a persona on a different student.
  const taken = [];
  // personas: keyed by grade; residence = 'day' unless noted; newStudent = intake
  const personas = [
    { grade: 'P.1', name: 'John Okello', residence: 'day' },
    { grade: 'P.2', name: 'Mary Namukasa', residence: 'day' },
    { grade: 'P.3', name: 'Brian Ouma', residence: 'day' },
    { grade: 'P.4', name: 'Sarah Nanyonga', residence: 'day' },
    { grade: 'P.5', name: 'David Kato', residence: 'boarding' },
    { grade: 'P.6', name: 'Grace Achieng', residence: 'day' },
    { grade: 'P.7', name: 'Isaac Mugisha', residence: 'day' },
  ];
  const boardingSet = new Set();
  async function renameStudent(studentId, full) {
    await c.query('UPDATE "Partner" SET name=$1 WHERE id=(SELECT "partnerId" FROM "StudentProfile" WHERE id=$2)', [full, studentId]);
  }
  for (const per of personas) {
    // clear any pre-existing duplicate of this persona name (idempotent re-runs)
    await c.query('UPDATE "Partner" SET name=CONCAT(\'Student \', substr(gen_random_uuid()::text,1,8)) WHERE id IN (SELECT p.id FROM "Partner" p JOIN "StudentProfile" sp ON sp."partnerId"=p.id WHERE sp."organizationId"=$1 AND p.name=$2)', [ORG, per.name]);
    // pick the first day student of that grade not yet assigned to a persona.
    const r = await c.query(
      `SELECT sp.id FROM "StudentProfile" sp JOIN "SchoolClass" sc ON sc.id=sp."currentClassId"
       WHERE sp."organizationId"=$1 AND sc."gradeLevelId"=$2 AND sp."residenceType"='day' AND sp.id <> ALL($3)
       ORDER BY sp."admissionNo" LIMIT 1`,
      [ORG, gmap[per.grade], taken],
    );
    if (!r.rows[0]) { console.log(`  ! no candidate for ${per.name}`); continue; }
    const id = r.rows[0].id;
    if (per.residence === 'boarding') {
      await c.query('UPDATE "StudentProfile" SET "residenceType"=$1 WHERE id=$2', ['boarding', id]);
      boardingSet.add(id);
    }
    await renameStudent(id, per.name);
    taken.push(id);
  }
  console.log('  ~ assigned 7 named personas');

  // Anna Nakato -> new intake student (P.1 New)
  const anna = await c.query(
    `SELECT sp.id FROM "StudentProfile" sp JOIN "SchoolClass" sc ON sc.id=sp."currentClassId"
     WHERE sp."organizationId"=$1 AND sc."gradeLevelId"=$2 AND sp."residenceType"='day' AND sp.id <> ALL($3) LIMIT 1`,
    [ORG, gmap['P.1'], taken],
  );
  if (anna.rows[0]) {
    await renameStudent(anna.rows[0].id, 'Anna Nakato');
    await c.query('UPDATE "StudentProfile" SET "currentClassId"=$1 WHERE id=$2', [newClassId, anna.rows[0].id]);
    console.log('  ~ Anna Nakato placed in P.1 New intake');
  }

  // force the two special-residence personas (belt-and-suspenders; the loop
  // branch is unreliable because the same student can be re-touched by the flip)
  async function idOf(name) {
    const r = await c.query('SELECT sp.id FROM "StudentProfile" sp JOIN "Partner" p ON p.id=sp."partnerId" WHERE sp."organizationId"=$1 AND p.name=$2 LIMIT 1', [ORG, name]);
    return r.rows[0]?.id;
  }
  const davidId = await idOf('David Kato');
  if (davidId) await c.query('UPDATE "StudentProfile" SET "residenceType"=$1 WHERE id=$2', ['boarding', davidId]);
  const annaId = await idOf('Anna Nakato');
  if (annaId) await c.query('UPDATE "StudentProfile" SET "residenceType"=$1 WHERE id=$2', ['day', annaId]);
  // make sure David is counted as boarding and both are protected from the flip
  if (davidId) boardingSet.add(davidId);
  if (annaId) taken.push(annaId);

  // flip ~20 more primary students to boarding for a realistic boarding roll.
  // JS-side exclusion: do NOT touch named personas (John/Anna) or already-boarding.
  const primaryDayAll = await c.query(
    `SELECT sp.id, sc."gradeLevelId", gl.name AS grade FROM "StudentProfile" sp
     JOIN "SchoolClass" sc ON sc.id=sp."currentClassId" JOIN "GradeLevel" gl ON gl.id=sc."gradeLevelId"
     WHERE sp."organizationId"=$1 AND sc."gradeLevelId"=ANY($2) AND sp."residenceType"='day'
     ORDER BY sp."admissionNo"`,
    [ORG, PRIMARY.map((p) => gmap[p])],
  );
  const protect = new Set([...taken, ...boardingSet]); // named personas stay as-is
  const flipCandidates = primaryDayAll.rows.map((r) => r.id).filter((id) => !protect.has(id));
  const toFlip = flipCandidates.slice(0, 20);
  for (const id of toFlip) {
    await c.query('UPDATE "StudentProfile" SET "residenceType"=$1 WHERE id=$2', ['boarding', id]);
    boardingSet.add(id);
  }
  console.log(`  ~ ${boardingSet.size} boarding students total (${toFlip.length} flipped + ${boardingSet.size - toFlip.length} named)`);

  // ---- 4) Optional fee opt-ins (the "Optional Fee" demo) ----
  // create AFTER boarding flips so we only opt-in students who remain DAY.
  const primaryDay = await c.query(
    `SELECT sp.id, sc."gradeLevelId", gl.name AS grade FROM "StudentProfile" sp
     JOIN "SchoolClass" sc ON sc.id=sp."currentClassId" JOIN "GradeLevel" gl ON gl.id=sc."gradeLevelId"
     WHERE sp."organizationId"=$1 AND sc."gradeLevelId"=ANY($2) AND sp."residenceType"='day'
     ORDER BY sp."admissionNo"`,
    [ORG, PRIMARY.map((p) => gmap[p])],
  );
  const dayIds = primaryDay.rows.map((r) => r.id);
  // pick N evenly-spread ids from a list
  function pick(list, n) {
    if (list.length <= n) return list.slice();
    const out = [];
    const step = list.length / n;
    for (let i = 0; i < n; i++) out.push(list[Math.floor(i * step)]);
    return out;
  }
  const byGrade = (gs) => primaryDay.rows.filter((r) => gs.includes(r.grade)).map((r) => r.id);

  const transportStudents = pick(dayIds, 48);                 // ~48 (ChatGPT Run 4)
  const swimmingStudents = pick(dayIds, 30);                  // ~30
  const porridgeStudents = pick(dayIds, 30);                  // ~30
  const coachingStudents = pick(byGrade(['P.5', 'P.6', 'P.7']), 15);
  const careStudents = pick(byGrade(['P.1', 'P.2', 'P.3', 'P.4']), 12);
  const musicStudents = pick(dayIds, 10);                    // ~10
  const tripStudents = pick(dayIds, 15);                      // ~15 (Term 1 only)

  async function optIn(studentId, catCode, terms) {
    const cid = C(catCode);
    for (const termId of terms) {
      await c.query(
        `INSERT INTO "StudentOptionalFee" (id,"organizationId","studentProfileId","termId","feeCategoryId",amount,"isActive","createdAt","updatedAt")
         VALUES (gen_random_uuid(),$1,$2,$3,$4,null,true,now(),now())
         ON CONFLICT ("organizationId","studentProfileId","termId","feeCategoryId") DO NOTHING`,
        [ORG, studentId, termId, cid],
      );
    }
  }
  for (const id of transportStudents) await optIn(id, 'TRANSPORT', [T1, T2, T3]);
  for (const id of swimmingStudents) await optIn(id, 'SWIMMING', [T1, T2, T3]);
  for (const id of porridgeStudents) await optIn(id, 'PORRIDGE', [T1, T2, T3]);
  for (const id of coachingStudents) await optIn(id, 'COACHING', [T1, T2, T3]);
  for (const id of careStudents) await optIn(id, 'CARE', [T1, T2, T3]);
  for (const id of musicStudents) await optIn(id, 'MUSIC', [T1, T2, T3]);
  for (const id of tripStudents) await optIn(id, 'TRIP', [T1]);
  // ensure named students have their described opt-ins
  const byName = async (first) => (await c.query('SELECT sp.id FROM "StudentProfile" sp JOIN "Partner" p ON p.id=sp."partnerId" WHERE sp."organizationId"=$1 AND p.name ILIKE $2 LIMIT 1', [ORG, first + '%'])).rows[0]?.id;
  const mary = await byName('Mary'); if (mary) await optIn(mary, 'TRANSPORT', [T1, T2, T3]);
  const brian = await byName('Brian'); if (brian) await optIn(brian, 'PORRIDGE', [T1, T2, T3]);
  const sarah = await byName('Sarah'); if (sarah) { await optIn(sarah, 'TRANSPORT', [T1, T2, T3]); await optIn(sarah, 'SWIMMING', [T1, T2, T3]); }
  const grace = await byName('Grace'); if (grace) await optIn(grace, 'TRANSPORT', [T1, T2, T3]);
  const isaac = await byName('Isaac'); if (isaac) await optIn(isaac, 'COACHING', [T1, T2, T3]);
  console.log(`  + optional opt-ins: transport=${transportStudents.length} swimming=${swimmingStudents.length} porridge=${porridgeStudents.length} coaching=${coachingStudents.length} care=${careStudents.length} music=${musicStudents.length} trip=${tripStudents.length}`);

  // ---- 5) Billing runs via the REAL engine (API) ----
  async function startRun(termId) {
    const r = await fetch(`${API}/school/billing-runs`, {
      method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ termId }),
    });
    if (!r.ok) throw new Error('start run failed: ' + (await r.text()).slice(0, 200));
    return (await r.json()).id;
  }
  async function processRun(id) {
    const r = await fetch(`${API}/school/billing-runs/${id}/process?limit=1000`, { method: 'POST', headers: auth });
    if (!r.ok) throw new Error('process run failed: ' + (await r.text()).slice(0, 200));
    return r.json();
  }

  // Run 1 — Term 1 (completed)
  const run1 = await startRun(T1);
  const res1 = await processRun(run1);
  console.log(`  > Run1 Term1: posted=${res1.posted} failed=${res1.failed} skipped=${res1.skipped}`);

  // Run 2 — Term 2 (completed)
  const run2 = await startRun(T2);
  const res2 = await processRun(run2);
  console.log(`  > Run2 Term2: posted=${res2.posted} failed=${res2.failed} skipped=${res2.skipped}`);

  // Run 3 — Term 3 (DRAFT: create but do NOT process)
  const run3 = await startRun(T3);
  await c.query('UPDATE "BillingRun" SET status=$1 WHERE id=$2', ['queued', run3]);
  console.log(`  > Run3 Term3: created (draft, unprocessed) id=${run3}`);

  // Run 4 — Term 2 Transport (real transport invoices already in Run 2; build metadata run)
  const transportInvoices = await c.query(
    `SELECT sfi.id, sfi."studentProfileId", sfi."documentId", d."totalAmount"
     FROM "SchoolFeeInvoice" sfi
     JOIN "Document" d ON d.id=sfi."documentId"
     JOIN "StudentOptionalFee" sof ON sof."studentProfileId"=sfi."studentProfileId" AND sof."termId"=$1 AND sof."feeCategoryId"=$2
     WHERE sfi."organizationId"=$3 AND sfi."termId"=$1 AND sof."isActive"=true
     GROUP BY sfi.id, sfi."studentProfileId", sfi."documentId", d."totalAmount"`,
    [T2, C('TRANSPORT'), ORG],
  );
  const run4 = await c.query(
    `INSERT INTO "BillingRun" (id,"organizationId","termId",status,"totalStudents","postedCount","startedAt","createdAt","updatedAt")
     VALUES (gen_random_uuid(),$1,$2,'completed',$3,$3,now(),now(),now()) RETURNING id`,
    [ORG, T2, transportInvoices.rows.length],
  );
  for (const inv of transportInvoices.rows) {
    await c.query(
      `INSERT INTO "BillingRunItem" (id,"organizationId","billingRunId","studentProfileId",status,"documentId","schoolFeeInvoiceId",amount,"processedAt","createdAt")
       VALUES (gen_random_uuid(),$1,$2,$3,'posted',$4,$5,$6,now(),now())`,
      [ORG, run4.rows[0].id, inv.studentProfileId, inv.documentId, inv.id, inv.totalAmount],
    );
  }
  console.log(`  > Run4 Transport: ${transportInvoices.rows.length} transport invoices linked (metadata run)`);

  // ---- verification summary ----
  const inv = (await c.query('SELECT count(*) c FROM "SchoolFeeInvoice" WHERE "organizationId"=$1', [ORG])).rows[0].c;
  const docs = (await c.query("SELECT count(*) c FROM \"Document\" WHERE \"organizationId\"=$1 AND \"sourceType\"='school_fee'", [ORG])).rows[0].c;
  const opt = (await c.query('SELECT count(*) c FROM "StudentOptionalFee" WHERE "organizationId"=$1', [ORG])).rows[0].c;
  const runs = (await c.query('SELECT id,status FROM "BillingRun" WHERE "organizationId"=$1 ORDER BY "createdAt"', [ORG])).rows;
  const t1total = (await c.query("SELECT COALESCE(SUM(d.\"totalAmount\"),0) s FROM \"SchoolFeeInvoice\" sfi JOIN \"Document\" d ON d.id=sfi.\"documentId\" WHERE sfi.\"organizationId\"=$1 AND sfi.\"termId\"=$2", [ORG, T1])).rows[0].s;
  console.log('\n=== SEED COMPLETE ===');
  console.log('SchoolFeeInvoice:', inv, '| school_fee Documents:', docs, '| StudentOptionalFee:', opt);
  console.log('Term1 billed total (UGX):', Number(t1total).toLocaleString());
  console.log('BillingRuns:');
  for (const r of runs) console.log('  ', r.id, r.status);

  await c.end();
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
