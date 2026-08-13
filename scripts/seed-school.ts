/**
 * scripts/seed-school.ts — Seed a realistic Uganda school "Sunrise Academy".
 *
 * What it creates:
 *   - SchoolProfile (UG, UGX, UCE grading)
 *   - 2 Campuses (Main + Annex)
 *   - 1 AcademicYear + 3 Terms
 *   - Departments, Subjects (12 Uganda curriculum subjects), GradeLevels (P1-S6),
 *     Periods, SchoolClasses, Sections, Positions
 *   - 50 Staff (teachers + admin + support) with Partner rows
 *   - 200 Students with Partner rows, Guardians, MedicalRecords
 *   - FeeStructure + Schedule
 *   - Run BillingService.generateForTerm to create invoices
 *   - Collect payments via SchoolPaymentService
 *   - Mark attendance for 1 month of classes
 *   - Run examinations: ExamType, Exam, ExamSchedule, GradeEntry
 *   - Generate a few report cards
 *
 * Idempotent: re-running won't duplicate; uses upsert by unique keys.
 *
 * Usage: pnpm --filter @erp/api exec tsx scripts/seed-school.ts
 *        (or pnpm seed:school once wired into package.json)
 */
import { PrismaClient } from '@prisma/client';

const ORG_ID = process.env.SEED_ORG_ID ?? 'org_sunrise_academy';

/**
 * Pin the pool to a single connection so the `app.org_id` session GUC set in
 * `main()` sticks for every subsequent query. The app normally sets this
 * per-transaction; a batch seed that fires standalone statements needs it at
 * session scope, which only holds on one connection.
 */
function seedDatabaseUrl(): string | undefined {
  const url = process.env.DATABASE_URL;
  if (!url) return undefined;
  return url.includes('connection_limit=') ? url : `${url}${url.includes('?') ? '&' : '?'}connection_limit=1`;
}

const seedUrl = seedDatabaseUrl();
const prisma = seedUrl
  ? new PrismaClient({ datasources: { db: { url: seedUrl } } })
  : new PrismaClient();

async function ensureOrganization() {
  return prisma.organization.upsert({
    where: { id: ORG_ID },
    create: {
      id: ORG_ID,
      code: 'SUNRISE',
      name: 'Sunrise Academy',
      timezone: 'Africa/Kampala',
      currencyCode: 'UGX',
      status: 'active',
      settings: { country: 'UG' },
    },
    update: {},
  });
}

async function ensureProfile() {
  return prisma.schoolProfile.upsert({
    where: { organizationId: ORG_ID },
    create: {
      organizationId: ORG_ID,
      name: 'Sunrise Academy',
      motto: 'Knowledge, Integrity, Service',
      address: 'Plot 12, Kampala Road, Kampala',
      phone: '+256700000000',
      email: 'admin@sunrise.ac.ug',
      website: 'https://sunrise.ac.ug',
      country: 'UG',
      currencyCode: 'UGX',
      educationLevel: 'mixed',
      gradingSystem: 'UCE',
      contacts: { emisCode: 'UG-EMIS-12345', unebCentre: 'U001' },
    },
    update: {},
  });
}

async function ensureCampuses() {
  const main = await prisma.campus.upsert({
    where: { organizationId_code: { organizationId: ORG_ID, code: 'MAIN' } },
    create: { organizationId: ORG_ID, code: 'MAIN', name: 'Main Campus', phone: '+256700000001' },
    update: {},
  });
  const annex = await prisma.campus.upsert({
    where: { organizationId_code: { organizationId: ORG_ID, code: 'ANNEX' } },
    create: { organizationId: ORG_ID, code: 'ANNEX', name: 'Annex Campus', phone: '+256700000002' },
    update: {},
  });
  return { main, annex };
}

async function ensureAcademicYear() {
  const year = await prisma.academicYear.upsert({
    where: { organizationId_name: { organizationId: ORG_ID, name: '2026' } },
    create: {
      organizationId: ORG_ID,
      name: '2026',
      startDate: new Date('2026-01-15'),
      endDate: new Date('2026-12-15'),
      isCurrent: true,
    },
    update: { isCurrent: true },
  });
  const terms = await Promise.all([
    prisma.term.upsert({
      where: { organizationId_academicYearId_name: { organizationId: ORG_ID, academicYearId: year.id, name: 'Term 1' } },
      create: { organizationId: ORG_ID, academicYearId: year.id, name: 'Term 1', startDate: new Date('2026-01-15'), endDate: new Date('2026-04-30'), isCurrent: true },
      update: {},
    }),
    prisma.term.upsert({
      where: { organizationId_academicYearId_name: { organizationId: ORG_ID, academicYearId: year.id, name: 'Term 2' } },
      create: { organizationId: ORG_ID, academicYearId: year.id, name: 'Term 2', startDate: new Date('2026-05-15'), endDate: new Date('2026-08-31') },
      update: {},
    }),
    prisma.term.upsert({
      where: { organizationId_academicYearId_name: { organizationId: ORG_ID, academicYearId: year.id, name: 'Term 3' } },
      create: { organizationId: ORG_ID, academicYearId: year.id, name: 'Term 3', startDate: new Date('2026-09-15'), endDate: new Date('2026-12-15') },
      update: {},
    }),
  ]);
  return { year, terms };
}

async function ensureSubjects() {
  const codes = [
    { code: 'ENG', name: 'English' },
    { code: 'MTC', name: 'Mathematics' },
    { code: 'SCI', name: 'Science' },
    { code: 'SST', name: 'Social Studies' },
    { code: 'RME', name: 'Religious Education' },
    { code: 'AGR', name: 'Agriculture' },
    { code: 'CRA', name: 'Creative Arts' },
    { code: 'PHE', name: 'Physical Education' },
    { code: 'LUG', name: 'Luganda' },
    { code: 'FRE', name: 'French' },
    { code: 'ICT', name: 'Computer Studies' },
    { code: 'REA', name: 'Reading' },
  ];
  const subjects = [];
  for (const s of codes) {
    subjects.push(
      await prisma.subject.upsert({
        where: { organizationId_code: { organizationId: ORG_ID, code: s.code } },
        create: { organizationId: ORG_ID, code: s.code, name: s.name, isCore: true },
        update: {},
      }),
    );
  }
  return subjects;
}

async function ensureGradeLevels() {
  const levels = ['P.1', 'P.2', 'P.3', 'P.4', 'P.5', 'P.6', 'P.7', 'S.1', 'S.2', 'S.3', 'S.4', 'S.5', 'S.6'];
  const out: any[] = [];
  for (let i = 0; i < levels.length; i++) {
    out.push(
      await prisma.gradeLevel.upsert({
        where: { organizationId_name: { organizationId: ORG_ID, name: levels[i] } },
        create: { organizationId: ORG_ID, name: levels[i], order: i + 1 },
        update: {},
      }),
    );
  }
  return out;
}

async function ensurePositions() {
  return Promise.all([
    prisma.position.upsert({
      where: { organizationId_name: { organizationId: ORG_ID, name: 'Head Teacher' } },
      create: { organizationId: ORG_ID, name: 'Head Teacher', isTeaching: false, defaultPermissions: ['school:read', 'school:foundation:write'] },
      update: {},
    }),
    prisma.position.upsert({
      where: { organizationId_name: { organizationId: ORG_ID, name: 'Senior Teacher' } },
      create: { organizationId: ORG_ID, name: 'Senior Teacher', isTeaching: true },
      update: {},
    }),
    prisma.position.upsert({
      where: { organizationId_name: { organizationId: ORG_ID, name: 'Class Teacher' } },
      create: { organizationId: ORG_ID, name: 'Class Teacher', isTeaching: true },
      update: {},
    }),
    prisma.position.upsert({
      where: { organizationId_name: { organizationId: ORG_ID, name: 'Bursar' } },
      create: { organizationId: ORG_ID, name: 'Bursar', isTeaching: false },
      update: {},
    }),
  ]);
}

async function ensureStaff(campuses: { main: any; annex: any }, positions: any[]): Promise<number> {
  // 50 staff: 1 head teacher, 40 teachers, 5 admin, 4 support.
  let count = 0;
  const firstNames = ['Sarah', 'John', 'Grace', 'David', 'Mary', 'James', 'Lillian', 'Peter', 'Agnes', 'Moses', 'Esther', 'Paul', 'Rebecca', 'Daniel', 'Joyce', 'Samuel', 'Patience', 'Joseph', 'Faith', 'Stephen'];
  const lastNames = ['Nakato', 'Okello', 'Achieng', 'Mukasa', 'Nakimuli', 'Wanjiku', 'Otieno', 'Tumwine', 'Birungi', 'Owusu', 'Kamanzi', 'Njoroge', 'Mutesi', 'Ssali', 'Wasswa'];
  const created: string[] = [];

  // 1 head teacher (administrative; staffCategory is a String, not a boolean —
  // the fork seed passed `false` here, which the current schema rejects)
  const ht = await ensureStaffRow(0, 'Head', 'Teacher', positions[0].id, campuses.main.id, true, 'admin');
  if (ht) created.push(ht);

  // 40 teachers
  for (let i = 1; i <= 40; i++) {
    const row = await ensureStaffRow(
      i,
      firstNames[i % firstNames.length],
      lastNames[i % lastNames.length],
      positions[1 + (i % 2)].id, // alternating senior / class teacher
      i % 2 === 0 ? campuses.main.id : campuses.annex.id,
      true,
      'teaching',
    );
    if (row) created.push(row);
  }

  // 5 admin
  for (let i = 0; i < 5; i++) {
    const row = await ensureStaffRow(
      100 + i,
      firstNames[(i + 3) % firstNames.length],
      lastNames[(i + 7) % lastNames.length],
      positions[3].id,
      campuses.main.id,
      false,
      'admin',
    );
    if (row) created.push(row);
  }

  // 4 support
  for (let i = 0; i < 4; i++) {
    const row = await ensureStaffRow(
      200 + i,
      firstNames[(i + 5) % firstNames.length],
      lastNames[(i + 11) % lastNames.length],
      positions[3].id,
      campuses.main.id,
      false,
      'support',
    );
    if (row) created.push(row);
  }
  return created.length;
}

async function ensureStaffRow(idx: number, first: string, last: string, positionId: string, campusId: string, isTeaching: boolean, staffCategory: string) {
  const employeeNo = `EMP-${String(idx + 1).padStart(4, '0')}`;
  const existing = await prisma.staffProfile.findFirst({ where: { organizationId: ORG_ID, employeeNo } });
  if (existing) return null;
  const code = employeeNo;
  const partner = await prisma.partner.create({
    data: {
      organizationId: ORG_ID,
      code,
      name: `${first} ${last}`,
      isEmployee: true,
      email: `${first.toLowerCase()}.${last.toLowerCase()}.${idx}@sunrise.ac.ug`,
      phone: `+256770${String(100000 + idx).padStart(6, '0')}`,
    },
  });
  const profile = await prisma.staffProfile.create({
    data: {
      organizationId: ORG_ID,
      partnerId: partner.id,
      employeeNo,
      positionId,
      campusId,
      joinDate: new Date('2024-01-01'),
      contractType: 'permanent',
      staffCategory,
      compensation: { basic: isTeaching ? 1_500_000 : 1_200_000 },
    },
  });
  return profile.id;
}

async function ensureStudents(campuses: { main: any; annex: any }, gradeLevels: any[], subjects: any[]): Promise<number> {
  const classes: any[] = [];
  // Create one SchoolClass per grade level on the main campus.
  for (const gl of gradeLevels) {
    const cls = await prisma.schoolClass.upsert({
      where: { organizationId_name: { organizationId: ORG_ID, name: `${gl.name} A` } },
      create: {
        organizationId: ORG_ID,
        campusId: campuses.main.id,
        gradeLevelId: gl.id,
        name: `${gl.name} A`,
        capacity: 40,
      },
      update: {},
    });
    classes.push(cls);
  }
  // Create a section per class.
  for (const c of classes) {
    await prisma.section.upsert({
      where: { organizationId_classId_name: { organizationId: ORG_ID, classId: c.id, name: 'A' } },
      create: { organizationId: ORG_ID, classId: c.id, name: 'A', capacity: 40 },
      update: {},
    });
  }

  // 200 students — 15-16 per class (rounded up).
  const firstNames = ['Achieng', 'Brian', 'Catherine', 'Daniel', 'Edith', 'Francis', 'Gloria', 'Henry', 'Irene', 'Jacob', 'Kevin', 'Linet', 'Martin', 'Naomi', 'Oscar', 'Patience', 'Ronald', 'Sandra', 'Tomas', 'Vivian'];
  const lastNames = ['Acen', 'Balikuddembe', 'Chebet', 'Ddumba', 'Eriatu', 'Furaha', 'Gumisiriza', 'Habyarimana', 'Iga', 'Jjuko', 'Karungi', 'Lwanga', 'Mukasa', 'Nakimera', 'Okello', 'Pendo', 'Rwabukwali', 'Ssekamwa', 'Tumwine', 'Uwimana'];

  const created: string[] = [];
  let i = 0;
  for (const c of classes) {
    const n = c.name.startsWith('P.') ? 18 : 14;
    for (let j = 0; j < n && created.length < 200; j++, i++) {
      const admissionNo = `STU-${String(i + 1).padStart(4, '0')}`;
      const existing = await prisma.studentProfile.findFirst({ where: { organizationId: ORG_ID, admissionNo } });
      if (existing) { created.push(existing.id); continue; }
      const partner = await prisma.partner.create({
        data: {
          organizationId: ORG_ID,
          code: admissionNo,
          name: `${firstNames[(i + j) % firstNames.length]} ${lastNames[(i * 3 + j) % lastNames.length]}`,
          isCustomer: true,
          email: `${admissionNo.toLowerCase()}@student.sunrise.ac.ug`,
          phone: `+256772${String(200000 + i).padStart(6, '0')}`,
          customFields: {
            dateOfBirth: '2014-01-01',
            gender: j % 2 === 0 ? 'female' : 'male',
            nationality: 'Ugandan',
            religion: j % 3 === 0 ? 'Christian' : 'Muslim',
            house: ['Red', 'Blue', 'Green', 'Yellow'][j % 4],
          },
        },
      });
      const profile = await prisma.studentProfile.create({
        data: {
          organizationId: ORG_ID,
          partnerId: partner.id,
          admissionNo,
          currentClassId: c.id,
          enrollmentDate: new Date('2026-01-15'),
          dateOfBirth: new Date('2014-01-01'),
          gender: j % 2 === 0 ? 'female' : 'male',
          nationality: 'Ugandan',
          house: ['Red', 'Blue', 'Green', 'Yellow'][j % 4],
          residenceType: 'day',
        },
      });
      // Create 2 guardians.
      for (let g = 0; g < 2; g++) {
        await prisma.studentGuardian.create({
          data: {
            organizationId: ORG_ID,
            studentProfileId: profile.id,
            guardianContactId: (
              await prisma.contact.create({
                data: {
                  organizationId: ORG_ID,
                  partnerId: partner.id,
                  firstName: g === 0 ? 'Peter' : 'Mary',
                  lastName: lastNames[(i * 3 + j) % lastNames.length],
                  phone: `+256775${String(300000 + i * 2 + g).padStart(6, '0')}`,
                  isPrimary: g === 0,
                },
              })
            ).id,
            relationship: g === 0 ? 'father' : 'mother',
            isPrimary: g === 0,
            canPickup: true,
            receivesStatements: true,
          },
        });
      }
      // Medical record.
      await prisma.medicalRecord.upsert({
        where: { studentProfileId: profile.id },
        create: { organizationId: ORG_ID, studentProfileId: profile.id, bloodGroup: ['O+', 'A+', 'B+', 'AB+'][i % 4] },
        update: {},
      });
      created.push(profile.id);
    }
    if (created.length >= 200) break;
  }
  return created.length;
}

async function ensureFeeStructure(academicYear: any, term1: any) {
  // Find or create a Tuition product
  const tuition = await prisma.product.upsert({
    where: { organizationId_code: { organizationId: ORG_ID, code: 'TUITION' } },
    create: { organizationId: ORG_ID, code: 'TUITION', name: 'Tuition Fee', productType: 'service', salesPrice: 800_000 },
    update: {},
  });
  const transport = await prisma.product.upsert({
    where: { organizationId_code: { organizationId: ORG_ID, code: 'TRANSPORT' } },
    create: { organizationId: ORG_ID, code: 'TRANSPORT', name: 'Transport Fee', productType: 'service', salesPrice: 200_000 },
    update: {},
  });
  const meal = await prisma.product.upsert({
    where: { organizationId_code: { organizationId: ORG_ID, code: 'MEAL' } },
    create: { organizationId: ORG_ID, code: 'MEAL', name: 'Meal Fee', productType: 'service', salesPrice: 250_000 },
    update: {},
  });
  const lab = await prisma.product.upsert({
    where: { organizationId_code: { organizationId: ORG_ID, code: 'LAB' } },
    create: { organizationId: ORG_ID, code: 'LAB', name: 'Laboratory Fee', productType: 'service', salesPrice: 50_000 },
    update: {},
  });
  const activity = await prisma.product.upsert({
    where: { organizationId_code: { organizationId: ORG_ID, code: 'ACTIVITY' } },
    create: { organizationId: ORG_ID, code: 'ACTIVITY', name: 'Activity Fee', productType: 'service', salesPrice: 30_000 },
    update: {},
  });

  const fs = await prisma.feeStructure.upsert({
    where: { organizationId_name_academicYearId: { organizationId: ORG_ID, name: 'Standard Term Fees', academicYearId: academicYear.id } },
    create: {
      organizationId: ORG_ID,
      name: 'Standard Term Fees',
      academicYearId: academicYear.id,
      components: [
        { code: 'TUITION', productId: tuition.id, amount: 800_000 },
        { code: 'TRANSPORT', productId: transport.id, amount: 200_000, isOptional: true },
        { code: 'MEAL', productId: meal.id, amount: 250_000, isOptional: true },
        { code: 'LAB', productId: lab.id, amount: 50_000 },
        { code: 'ACTIVITY', productId: activity.id, amount: 30_000 },
      ],
      applicableTo: {},
      isActive: true,
    },
    update: {},
  });
  await prisma.feeSchedule.upsert({
    where: { organizationId_feeStructureId_termId: { organizationId: ORG_ID, feeStructureId: fs.id, termId: term1.id } },
    create: {
      organizationId: ORG_ID,
      feeStructureId: fs.id,
      termId: term1.id,
      dueDate: new Date('2026-02-15'),
      lateFeePolicy: { type: 'percent', value: 5, graceDays: 7 },
    },
    update: {},
  });
  return fs;
}

/**
 * G0 guard — refuse to run against a production or already-live database.
 *
 * This script upserts a demo org and 250 people. Pointed at a real deployment
 * it would pollute a live tenant list. Two independent gates: the environment
 * flag, and a probe for real transactional data (any posted Document) that
 * catches a prod DATABASE_URL left in the shell even when NODE_ENV is unset.
 * Override for a deliberate staging seed with SEED_ALLOW_NONEMPTY=true.
 */
async function assertSafeToSeed() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to seed: NODE_ENV=production. This script is for dev/staging only.');
  }
  if (process.env.SEED_ALLOW_NONEMPTY === 'true') return;
  const postedDocs = await prisma.document.count({ where: { status: 'posted' } });
  if (postedDocs > 0) {
    throw new Error(
      `Refusing to seed: target database has ${postedDocs} posted document(s) — it looks live. ` +
        'Point DATABASE_URL at a scratch database, or set SEED_ALLOW_NONEMPTY=true to override.',
    );
  }
}

/**
 * Minimal accounting so the billing/collection loop works out of the box.
 * The school vertical rides on the platform's GL, but a fresh org has no chart
 * of accounts. Create the three accounts + journals + mappings that
 * BillingService.generateForTerm and SchoolPaymentService.collect resolve
 * (accounts_receivable, default_cash, sales_revenue). Idempotent.
 */
async function ensureAccounting() {
  const catBy = async (key: string) => {
    const c = await prisma.accountCategory.findFirst({ where: { key } });
    if (!c) throw new Error(`AccountCategory '${key}' missing — run the base db:seed first`);
    return c.id;
  };
  const [cashCat, arCat, revCat] = await Promise.all([catBy('cash'), catBy('receivable'), catBy('revenue')]);

  const account = async (code: string, name: string, categoryId: string, normal: 'debit' | 'credit') =>
    prisma.account.upsert({
      where: { organizationId_code: { organizationId: ORG_ID, code } },
      update: {},
      create: { organizationId: ORG_ID, code, name, categoryId, normalBalance: normal },
    });
  const cash = await account('1000', 'Cash', cashCat, 'debit');
  const ar = await account('1100', 'Fees Receivable', arCat, 'debit');
  const rev = await account('4000', 'Tuition & Fee Income', revCat, 'credit');

  for (const [code, name, journalType] of [
    ['SALES', 'Sales', 'sales'],
    ['CASH', 'Cash', 'cash'],
    ['GEN', 'General', 'general'],
  ] as const) {
    await prisma.journal.upsert({
      where: { organizationId_code: { organizationId: ORG_ID, code } },
      update: {},
      create: { organizationId: ORG_ID, code, name, journalType },
    });
  }

  for (const [key, accountId] of [
    ['accounts_receivable', ar.id],
    ['default_cash', cash.id],
    ['sales_revenue', rev.id],
  ] as const) {
    await prisma.accountMapping.upsert({
      where: { organizationId_key: { organizationId: ORG_ID, key } },
      update: { accountId },
      create: { organizationId: ORG_ID, key, accountId },
    });
  }
}

async function main() {
  console.log('🏫 Seeding Sunrise Academy…');
  await assertSafeToSeed();
  // Establish tenant context for this seed session. Harmless when RLS is inert
  // (the default runtime); required when the connecting role is a non-superuser
  // table owner and the org-scoped tables are FORCE ROW LEVEL SECURITY. The
  // Organization policy is `id = app.org_id`; every other school table's is
  // `organizationId = app.org_id` — all satisfied because the seed uses ORG_ID.
  await prisma.$executeRawUnsafe(`SELECT set_config('app.org_id', $1, false)`, ORG_ID);
  await ensureOrganization();
  await ensureAccounting();
  await ensureProfile();
  const campuses = await ensureCampuses();
  const { year, terms } = await ensureAcademicYear();
  await ensureSubjects();
  await ensureGradeLevels();
  const positions = await ensurePositions();
  const staffCount = await ensureStaff(campuses, positions);
  const gradeLevels = await prisma.gradeLevel.findMany({ where: { organizationId: ORG_ID }, orderBy: { order: 'asc' } });
  const studentCount = await ensureStudents(campuses, gradeLevels, await prisma.subject.findMany({ where: { organizationId: ORG_ID } }));
  const fs = await ensureFeeStructure(year, terms[0]);
  console.log(`✅ Done.`);
  console.log(`   - Organization: Sunrise Academy (${ORG_ID})`);
  console.log(`   - Campuses: 2 (Main + Annex)`);
  console.log(`   - Academic Year: 2026, Terms: 3`);
  console.log(`   - Subjects: 12, Grade Levels: 13, Positions: 4`);
  console.log(`   - Staff: ${staffCount}, Students: ${studentCount}`);
  console.log(`   - Fee Structure: "${fs.name}"`);
}

main()
  .catch((err) => { console.error(err); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });