const { Client } = require('pg');
require('dotenv').config({ path: require('path').join(__dirname, '..', 'apps', 'api', '.env') });
const c = new Client({ connectionString: process.env.DATABASE_URL });
const fmt = (n) => Number(n).toLocaleString('en-US');
(async () => {
  await c.connect();
  const OID = 'org_sunrise_academy';
  const T = {};
  (await c.query('SELECT id,name FROM "Term" WHERE "organizationId"=$1', [OID])).rows.forEach((t) => (T[t.name] = t.id));

  console.log('=== Term 1 / 2 / 3 billing (real invoices via billing engine) ===');
  for (const t of ['Term 1', 'Term 2', 'Term 3']) {
    const r = await c.query(
      `SELECT count(*) inv, COALESCE(SUM(d."totalAmount"),0) total
       FROM "SchoolFeeInvoice" sfi JOIN "Document" d ON d.id=sfi."documentId"
       WHERE sfi."organizationId"=$1 AND sfi."termId"=$2`, [OID, T[t]]);
    console.log(`  ${t.padEnd(7)}: invoices=${r.rows[0].inv}  billed=UGX ${fmt(r.rows[0].total)}`);
  }

  console.log('\n=== ChatGPT personas -> correct grade/residence + Term 1 invoice ===');
  // map each persona to the student we named (lookup by exact Partner name)
  const personas = [
    ['John Okello', 'P.1', 'day', []],
    ['Mary Namukasa', 'P.2', 'day', ['TRANSPORT']],
    ['Brian Ouma', 'P.3', 'day', ['PORRIDGE']],
    ['Sarah Nanyonga', 'P.4', 'day', ['TRANSPORT', 'SWIMMING']],
    ['David Kato', 'P.5', 'boarding', []],
    ['Grace Achieng', 'P.6', 'day', ['TRANSPORT']],
    ['Isaac Mugisha', 'P.7', 'day', ['COACHING']],
    ['Anna Nakato', 'P.1', 'day-intake', []],
  ];
  for (const [nm, grade, residence, opts] of personas) {
    const sp = await c.query(
      `SELECT sp.id, gl.name grade, sp."residenceType", sc.name cls
       FROM "StudentProfile" sp JOIN "Partner" p ON p.id=sp."partnerId"
       JOIN "SchoolClass" sc ON sc.id=sp."currentClassId" JOIN "GradeLevel" gl ON gl.id=sc."gradeLevelId"
       WHERE sp."organizationId"=$1 AND p.name=$2`, [OID, nm]);
    if (!sp.rows[0]) { console.log(`  ${nm}: NOT FOUND`); continue; }
    const s = sp.rows[0];
    const inv = await c.query(
      `SELECT d."totalAmount", d.id FROM "SchoolFeeInvoice" sfi JOIN "Document" d ON d.id=sfi."documentId"
       WHERE sfi."studentProfileId"=$1 AND sfi."termId"=$2`, [s.id, T['Term 1']]);
    const lines = inv.rows[0]
      ? (await c.query('SELECT description,"unitPrice" FROM "DocumentLine" WHERE "documentId"=$1 ORDER BY description', [inv.rows[0].id])).rows
      : [];
    const optLines = lines.filter((l) => ['School Transport','Break Tea / Porridge','Swimming','Extra Coaching','After-school Care','Music / Instrument','Educational Trip','Co-curricular Activities'].includes(l.description)).map((l)=>l.description);
    const gradeOk = s.grade === grade || (residence === 'day-intake' && s.grade === 'P.1');
    console.log(`  ${nm.padEnd(15)} grade=${s.grade} (want ${grade}) ${gradeOk?'OK':'MISMATCH'} | ${s.residenceType} | T1=UGX ${inv.rows[0]?fmt(inv.rows[0].totalAmount):'NONE'} | opts=[${optLines.join(', ')}]`);
  }

  console.log('\n=== Optional-fee line coverage in Term 1 (students billed) ===');
  const opt = await c.query(
    `SELECT dl.description, count(DISTINCT sfi.id) students, COALESCE(SUM(dl."unitPrice"),0) total
     FROM "DocumentLine" dl JOIN "Document" d ON d.id=dl."documentId" JOIN "SchoolFeeInvoice" sfi ON sfi."documentId"=d.id
     WHERE d."organizationId"=$1 AND d."reference"=$2 AND dl.description IN
       ('School Transport','Break Tea / Porridge','Swimming','Extra Coaching','After-school Care','Music / Instrument','Educational Trip','Co-curricular Activities')
     GROUP BY dl.description ORDER BY students DESC`, [OID, 'TERM-' + T['Term 1']]);
  opt.rows.forEach((r) => console.log(`  ${r.description.padEnd(24)} ${r.students} students  UGX ${fmt(r.total)}`));

  console.log('\n=== Run 4 = Term 2 Transport (real invoices re-used) ===');
  const r4 = await c.query('SELECT id,status,"totalStudents","postedCount" FROM "BillingRun" WHERE status=$1 ORDER BY "createdAt" DESC LIMIT 1', ['completed']);
  // the transport run is the one with totalStudents=50
  const tr = await c.query('SELECT id,"totalStudents","postedCount" FROM "BillingRun" WHERE "totalStudents"=50');
  console.log('  transport run:', JSON.stringify(tr.rows));

  await c.end();
})().catch((e) => { console.error(e.message); process.exit(1); });
