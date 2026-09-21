/**
 * ════════════════════════════════════════════════════════════════════════════
 *  DEMO DATA — FICTIONAL SCHOOL, FICTIONAL PEOPLE
 *
 *  Green Valley Primary School, Kampala does not exist. Every name, admission
 *  number and record created by this file is invented for demonstration and
 *  development. Nothing here describes a real school, a real learner or a real
 *  member of staff.
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Green Valley — academic structure (Phase 2 of the academic structure redesign).
 *
 * This file seeds STRUCTURE only: levels, grades, classes, streams, years and
 * terms. Learners, guardians, teachers and enrollments arrive in Phase 6, once
 * capacity enforcement and the promotion engine exist to create them properly.
 *
 * Why a separate organization: the existing `seed-school-demo` builds an S1–S6
 * secondary school. A nursery-plus-primary school is a different shape, and
 * mixing the two in one tenant makes every screen ambiguous. Green Valley gets
 * its own organization so the two demos never interfere.
 *
 * IDEMPOTENT BY CONSTRUCTION. Every write is keyed on a stable code
 * (`organizationId` + `code`), never on a display name. `seed-admissions-demo`
 * looks classes up by NAME, which breaks the moment a class is renamed; that is
 * the pattern this file deliberately avoids. Run it as many times as you like.
 *
 * Run (from apps/api, with DATABASE_URL present):
 *   pnpm db:seed:green-valley
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const ORG_CODE = 'GREENVALLEY';
const ORG_NAME = 'Green Valley Primary School (DEMO)';

const log = (m: string) => console.log(`  - ${m}`);
const ok = (m: string) => console.log(`\x1b[32mOK\x1b[0m ${m}`);

/**
 * The structure, as DATA.
 *
 * None of these names mean anything to the code. "Pre-Primary", "Baby Class" and
 * "North" are seed values exactly like "Junior School", "Reception" and "Red"
 * would be. The only thing the application understands is the SHAPE:
 * level → grade → class → stream.
 *
 * `streams: []` on a grade is a real configuration, not an omission — it produces
 * a class with `allowsStreams: false`, which is how a small school runs.
 */
interface GradeSeed {
  code: string;
  name: string;
  /** Streams within this grade's class. Empty means the class is not subdivided. */
  streams: string[];
  /** Seats per stream, or for the whole class when it has no streams. */
  capacity?: number;
}

interface LevelSeed {
  code: string;
  name: string;
  description: string;
  stage: 'PRE_PRIMARY' | 'PRIMARY';
  grades: GradeSeed[];
}

const STRUCTURE: LevelSeed[] = [
  {
    code: 'PRE_PRIMARY',
    name: 'Pre-Primary',
    description: 'Nursery classes. Assessment here is developmental, not mark-based.',
    stage: 'PRE_PRIMARY',
    grades: [
      { code: 'BABY', name: 'Baby Class', streams: ['North', 'South'], capacity: 25 },
      { code: 'MIDDLE', name: 'Middle Class', streams: ['North', 'South'], capacity: 25 },
      { code: 'TOP', name: 'Top Class', streams: ['North', 'South', 'East'], capacity: 25 },
    ],
  },
  {
    code: 'PRIMARY',
    name: 'Primary',
    description: 'Primary One through Primary Seven.',
    stage: 'PRIMARY',
    grades: [
      { code: 'P1', name: 'Primary 1', streams: ['North', 'South', 'East'], capacity: 35 },
      { code: 'P2', name: 'Primary 2', streams: ['North', 'South', 'East'], capacity: 35 },
      { code: 'P3', name: 'Primary 3', streams: ['North', 'South', 'East', 'West'], capacity: 35 },
      { code: 'P4', name: 'Primary 4', streams: ['North', 'South', 'East', 'West'], capacity: 35 },
      { code: 'P5', name: 'Primary 5', streams: ['North', 'South', 'East'], capacity: 35 },
      { code: 'P6', name: 'Primary 6', streams: ['North', 'South', 'East'], capacity: 35 },
      { code: 'P7', name: 'Primary 7', streams: ['North', 'South', 'East'], capacity: 35 },
    ],
  },
];

/**
 * Stream display order.
 *
 * North/South/East/West is not alphabetical and has no natural sort. Without an
 * explicit order the structure screen would render East, North, South, West,
 * which is not how any of these schools list them. Anything not named here falls
 * to the end, in the order it was seeded.
 */
const STREAM_ORDER = ['North', 'South', 'East', 'West'];
const streamOrder = (name: string): number => {
  const i = STREAM_ORDER.indexOf(name);
  return i === -1 ? STREAM_ORDER.length : i;
};

/** Academic years. Exactly one ACTIVE, per the brief. */
const YEARS = [
  { name: '2025', status: 'CLOSED' as const, isCurrent: false },
  { name: '2026', status: 'ACTIVE' as const, isCurrent: true },
  { name: '2027', status: 'PLANNING' as const, isCurrent: false },
];

/** Three terms per year, as Ugandan schools run them. Dates are illustrative. */
const TERMS = [
  { name: 'Term 1', start: '02-01', end: '04-30' },
  { name: 'Term 2', start: '05-15', end: '08-15' },
  { name: 'Term 3', start: '09-01', end: '12-05' },
];

async function main(): Promise<void> {
  console.log('\n=== Green Valley — academic structure (DEMO DATA) ===\n');

  // ── organization ──────────────────────────────────────────────────────────
  const org = await prisma.organization.upsert({
    where: { code: ORG_CODE },
    update: { name: ORG_NAME },
    create: {
      code: ORG_CODE,
      name: ORG_NAME,
      timezone: 'Africa/Kampala',
      currencyCode: 'UGX',
    },
  });
  const O = org.id;
  ok(`organization ${ORG_CODE} (${O})`);

  await prisma.schoolProfile.upsert({
    where: { organizationId: O },
    update: {},
    create: {
      organizationId: O,
      name: 'Green Valley Primary School',
      motto: 'Learning, together',
      address: 'Kampala, Uganda',
      country: 'UG',
      currencyCode: 'UGX',
      educationLevel: 'primary',
      attendanceMode: 'daily',
      // A nursery-and-primary school calls its subdivisions Streams. The domain
      // still calls them Sections; only the label changes (ADR-029).
      terminology: { section: 'Stream', sectionPlural: 'Streams', learner: 'Pupil' },
    },
  });
  ok('school profile');

  // ── academic years + terms ────────────────────────────────────────────────
  for (const y of YEARS) {
    const year = await prisma.academicYear.upsert({
      where: { organizationId_name: { organizationId: O, name: y.name } },
      update: { status: y.status, isCurrent: y.isCurrent },
      create: {
        organizationId: O,
        name: y.name,
        startDate: new Date(`${y.name}-01-15`),
        endDate: new Date(`${y.name}-12-15`),
        status: y.status,
        isCurrent: y.isCurrent,
        ...(y.status === 'CLOSED' ? { closedAt: new Date(`${y.name}-12-15`) } : {}),
      },
    });

    for (const t of TERMS) {
      await prisma.term.upsert({
        where: {
          organizationId_academicYearId_name: {
            organizationId: O,
            academicYearId: year.id,
            name: t.name,
          },
        },
        update: {},
        create: {
          organizationId: O,
          academicYearId: year.id,
          name: t.name,
          startDate: new Date(`${y.name}-${t.start}`),
          endDate: new Date(`${y.name}-${t.end}`),
          // Term 2 of the active year is "now" for demo purposes.
          isCurrent: y.isCurrent && t.name === 'Term 2',
        },
      });
    }
    log(`${y.name} (${y.status}) with ${TERMS.length} terms`);
  }
  ok('academic years and terms');

  // ── levels ────────────────────────────────────────────────────────────────
  const levelIds = new Map<string, string>();
  for (const [i, l] of STRUCTURE.entries()) {
    const level = await prisma.academicLevel.upsert({
      where: { organizationId_code: { organizationId: O, code: l.code } },
      update: { name: l.name, description: l.description, stage: l.stage, displayOrder: i + 1 },
      create: {
        organizationId: O,
        code: l.code,
        name: l.name,
        description: l.description,
        stage: l.stage,
        displayOrder: i + 1,
      },
    });
    levelIds.set(l.code, level.id);
    log(`${l.name} (${l.code})`);
  }
  ok('academic levels');

  // ── grades, classes, streams ──────────────────────────────────────────────
  // A flat ladder across both levels, so `order` and the progression chain run
  // Baby -> Middle -> Top -> P1 -> ... -> P7 without a break at the level
  // boundary. Crossing that boundary is exactly the case a hard-coded ladder
  // gets wrong.
  const flatGrades = STRUCTURE.flatMap((l) => l.grades.map((g) => ({ ...g, level: l.code })));
  const gradeIds = new Map<string, string>();

  for (const [i, g] of flatGrades.entries()) {
    const grade = await prisma.gradeLevel.upsert({
      where: { organizationId_code: { organizationId: O, code: g.code } },
      update: {
        name: g.name,
        order: i + 1,
        academicLevelId: levelIds.get(g.level)!,
        isActive: true,
      },
      create: {
        organizationId: O,
        code: g.code,
        name: g.name,
        order: i + 1,
        academicLevelId: levelIds.get(g.level)!,
      },
    });
    gradeIds.set(g.code, grade.id);

    const className = g.name;
    const classCode = g.code;
    const hasStreams = g.streams.length > 0;

    const schoolClass = await prisma.schoolClass.upsert({
      where: { organizationId_code: { organizationId: O, code: classCode } },
      update: {
        name: className,
        gradeLevelId: grade.id,
        allowsStreams: hasStreams,
        displayOrder: i + 1,
        capacity: hasStreams ? (g.capacity ?? 35) * g.streams.length : (g.capacity ?? 35),
        isActive: true,
      },
      create: {
        organizationId: O,
        code: classCode,
        name: className,
        gradeLevelId: grade.id,
        allowsStreams: hasStreams,
        displayOrder: i + 1,
        capacity: hasStreams ? (g.capacity ?? 35) * g.streams.length : (g.capacity ?? 35),
      },
    });

    for (const streamName of g.streams) {
      const streamCode = streamName.toUpperCase();
      await prisma.section.upsert({
        where: {
          organizationId_classId_code: {
            organizationId: O,
            classId: schoolClass.id,
            code: streamCode,
          },
        },
        update: {
          name: streamName,
          capacity: g.capacity ?? 35,
          displayOrder: streamOrder(streamName),
          isActive: true,
        },
        create: {
          organizationId: O,
          classId: schoolClass.id,
          code: streamCode,
          name: streamName,
          capacity: g.capacity ?? 35,
          displayOrder: streamOrder(streamName),
        },
      });
    }

    log(
      `${g.name.padEnd(14)} ${hasStreams ? `${g.streams.length} streams (${g.streams.join(', ')})` : 'no streams'}`,
    );
  }
  ok('grades, classes and streams');

  // ── progression ladder ────────────────────────────────────────────────────
  // Configured explicitly, including Top Class -> Primary 1, which crosses the
  // level boundary, and Primary 7 as terminal. Nothing infers this.
  for (const [i, g] of flatGrades.entries()) {
    const next = flatGrades[i + 1];
    await prisma.gradeLevel.update({
      where: { id: gradeIds.get(g.code)! },
      data: {
        nextGradeLevelId: next ? gradeIds.get(next.code)! : null,
        isTerminal: !next,
      },
    });
  }
  const chain = flatGrades.map((g) => g.code).join(' -> ');
  ok(`progression: ${chain} -> (completed)`);

  // ── summary ───────────────────────────────────────────────────────────────
  const counts = {
    levels: await prisma.academicLevel.count({ where: { organizationId: O } }),
    grades: await prisma.gradeLevel.count({ where: { organizationId: O } }),
    classes: await prisma.schoolClass.count({ where: { organizationId: O } }),
    streams: await prisma.section.count({ where: { organizationId: O } }),
    years: await prisma.academicYear.count({ where: { organizationId: O } }),
    terms: await prisma.term.count({ where: { organizationId: O } }),
  };
  console.log('\n' + JSON.stringify(counts, null, 2));
  console.log('\nDEMO DATA — fictional school. Learners arrive in Phase 6.\n');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
