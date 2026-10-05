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
 *   pnpm db:seed:sunrise          (same structure seed, Sunrise Academy profile)
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { TERMS, YEARS, activeSchool } from './demo-green-valley/schools';

const prisma = new PrismaClient();

/** `--school=sunrise` builds Sunrise Academy instead; see demo-green-valley/schools.ts. */
const SCHOOL = activeSchool();
const ORG_CODE = SCHOOL.orgCode;
const ORG_NAME = SCHOOL.orgName;

const log = (m: string) => console.log(`  - ${m}`);
const ok = (m: string) => console.log(`\x1b[32mOK\x1b[0m ${m}`);

/**
 * The structure, as DATA: `SCHOOL.structure` in demo-green-valley/schools.ts.
 *
 * None of the names mean anything to the code. "Pre-Primary", "Baby Class" and
 * "North" are seed values exactly like "Junior School", "Reception" and "Red"
 * would be. The only thing the application understands is the SHAPE:
 * level, grade, class, stream.
 *
 * `streams: []` on a grade is a real configuration, not an omission: it produces
 * a class with `allowsStreams: false`, which is how a small school runs.
 */
const STRUCTURE = SCHOOL.structure;

/**
 * Stream display order.
 *
 * North/South/East/West is not alphabetical and has no natural sort. Without an
 * explicit order the structure screen would render East, North, South, West,
 * which is not how any of these schools list them. Anything not named here falls
 * to the end, in the order it was seeded.
 */
const STREAM_ORDER = SCHOOL.streamOrder;
const streamOrder = (name: string): number => {
  const i = STREAM_ORDER.indexOf(name);
  return i === -1 ? STREAM_ORDER.length : i;
};

async function main(): Promise<void> {
  console.log(`\n=== ${ORG_NAME} — academic structure (DEMO DATA) ===\n`);

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

  // A nursery-and-primary school calls its subdivisions Streams. The domain
  // still calls them Sections; only the label changes (ADR-029). The shape
  // fields are refreshed on every run, so a school seeded earlier as something
  // else (Sunrise was once "mixed", UCE) reads as the primary school it is.
  const shape = {
    educationLevel: 'primary',
    gradingSystem: 'PLE',
    attendanceMode: 'daily',
    terminology: { section: 'Stream', sectionPlural: 'Streams', learner: 'Pupil' },
  };
  await prisma.schoolProfile.upsert({
    where: { organizationId: O },
    update: shape,
    create: {
      organizationId: O,
      ...SCHOOL.profile,
      country: 'UG',
      currencyCode: 'UGX',
      ...shape,
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
        // Dates follow the calendar here, so a school seeded earlier on other
        // dates lines up with the enrolment and assessment stages.
        update: { startDate: new Date(`${y.name}-${t.start}`), endDate: new Date(`${y.name}-${t.end}`) },
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
  console.log(`\nDEMO DATA — fictional school. Next: tsx prisma/demo-green-valley/index.ts --school=${SCHOOL.key}\n`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
