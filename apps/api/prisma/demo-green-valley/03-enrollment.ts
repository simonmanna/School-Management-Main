/**
 * Green Valley demo — the enrolment spine (ADR-018).
 *
 * This is the part of the demo that makes everything else true. Class and
 * stream are NOT columns on a pupil: they come from an append-only,
 * effective-dated `EnrollmentPlacement` under a `StudentEnrollment`, which is
 * what lets the system answer "which stream was this child in during Term 1?"
 * two years later.
 *
 * The story it builds:
 *
 *  - **2025 (CLOSED).** Everybody who is not in Baby Class this year was one
 *    grade lower last year, with placements for all three terms. A handful
 *    repeated, and a handful transferred in part-way through.
 *  - **2026 (ACTIVE).** Each returning pupil has a PROMOTION placement into
 *    this year's grade, then TERM_ROLLOVER rows for Term 2 and Term 3. Baby
 *    Class is NEW.
 *
 * Exactly one placement row per enrolment is left open — the current term's.
 * Every earlier row is closed with an `effectiveTo` and an `endReason`, because
 * a placement history with two open rows is the bug the partial unique index
 * exists to catch.
 */
import { PrismaClient } from '@prisma/client';
import {
  ALL_GRADES, createManyChunked, int, log, ok, programmeCodeFor, rng, type School,
} from './shared';
import type { DemoPupil, People } from './02-people';
import type { Reference } from './01-reference';

/** The grade a pupil was in the year before, or null if they started here. */
function previousGrade(gradeCode: string): string | null {
  const i = ALL_GRADES.indexOf(gradeCode as never);
  return i > 0 ? ALL_GRADES[i - 1] : null;
}

export interface Placement {
  pupil: DemoPupil;
  enrollmentId2026: string;
}

export async function seedEnrollment(
  prisma: PrismaClient,
  s: School,
  ref: Reference,
  people: People,
) {
  const { O } = s;
  const year2025 = s.years.get('2025');
  const year2026 = s.years.get('2026');
  if (!year2025 || !year2026) throw new Error('Academic years 2025 and 2026 are required.');

  const terms2025 = ['Term 1', 'Term 2', 'Term 3'].map((n) => s.terms.get(`2025:${n}`)!);
  const terms2026 = ['Term 1', 'Term 2', 'Term 3'].map((n) => s.terms.get(`2026:${n}`)!);
  const asOf = new Date();
  /**
   * Which term is open, by DATE rather than by `Term.isCurrent`.
   *
   * `loadSchool` reads the terms once, before stage 1 moves the current-term
   * flag, so the cached rows are stale. More importantly the database has an
   * exclusion constraint (`EnrollmentPlacement_no_overlap`): leaving two rows
   * open — one because the flag said so and one because the dates said so —
   * is refused outright, which is the constraint doing its job.
   */
  const isOpenTerm = (t: { startDate: Date; endDate: Date }) =>
    t.startDate <= asOf && t.endDate >= asOf;
  if (terms2025.some((t) => !t) || terms2026.some((t) => !t)) {
    throw new Error('Nine terms are required across 2025 and 2026.');
  }

  // ── Class cohorts: one per (year, class) ──────────────────────────────────
  // A cohort is the annual instance of a class, and a placement's section must
  // belong to its cohort's class — which is what makes "a teacher cannot pick a
  // stream from another class" enforceable rather than merely discouraged.
  const cohorts = new Map<string, string>(); // "2026:P5" -> cohortId
  for (const year of [year2025, year2026]) {
    for (const gradeCode of ALL_GRADES) {
      const cls = s.classes.get(gradeCode);
      if (!cls) continue;
      const programmeId = ref.programmes.get(programmeCodeFor(gradeCode))!;
      const row = await prisma.classCohort.upsert({
        where: {
          organizationId_academicYearId_classId: {
            organizationId: O,
            academicYearId: year.id,
            classId: cls.id,
          },
        },
        update: { programmeId, status: year.name === '2025' ? 'CLOSED' : 'ACTIVE' },
        create: {
          organizationId: O,
          academicYearId: year.id,
          classId: cls.id,
          programmeId,
          capacity: cls.capacity,
          status: year.name === '2025' ? 'CLOSED' : 'ACTIVE',
        },
      });
      cohorts.set(`${year.name}:${gradeCode}`, row.id);
    }
  }
  ok(`class cohorts: ${cohorts.size} (2025 closed, 2026 active)`);

  // ── Enrolments and placements ─────────────────────────────────────────────
  const placements: Placement[] = [];
  const enrollmentEvents: Array<Record<string, unknown>> = [];
  let created2025 = 0;
  let repeaters = 0;
  let transfersIn = 0;

  for (const pupil of people.pupils) {
    const r = rng(`enrol:${pupil.admissionNo}`);
    const prev = previousGrade(pupil.gradeCode);
    const cls2026 = s.classes.get(pupil.gradeCode)!;
    const section2026 = s.sections.get(`${pupil.gradeCode}:${pupil.streamCode}`)!;
    const programme2026 = ref.programmes.get(programmeCodeFor(pupil.gradeCode))!;
    const grade2026 = s.grades.get(pupil.gradeCode)!;

    // About 3% repeated their grade; about 2% joined from another school.
    const roll = r();
    const isRepeater = prev !== null && roll < 0.03;
    const isTransferIn = prev !== null && roll >= 0.03 && roll < 0.05;
    const wasHereIn2025 = prev !== null && !isTransferIn;

    // ── Last year ──
    if (wasHereIn2025) {
      const lastGradeCode = isRepeater ? pupil.gradeCode : prev!;
      const lastGrade = s.grades.get(lastGradeCode);
      const lastCohortId = cohorts.get(`2025:${lastGradeCode}`);
      // A pupil usually keeps their stream letter; a few move.
      const lastStreams = s.sectionsByClassCode(lastGradeCode);
      const sameLetter = lastStreams.find((x) => x.code === pupil.streamCode);
      const lastSection = sameLetter ?? lastStreams[int(r, 0, lastStreams.length - 1)];

      if (lastGrade && lastCohortId && lastSection) {
        const enrollment2025 = await prisma.studentEnrollment.upsert({
          where: {
            organizationId_studentProfileId_academicYearId: {
              organizationId: O,
              studentProfileId: pupil.id,
              academicYearId: year2025.id,
            },
          },
          update: { status: 'COMPLETED', gradeLevelId: lastGrade.id },
          create: {
            organizationId: O,
            studentProfileId: pupil.id,
            academicYearId: year2025.id,
            programmeId: ref.programmes.get(programmeCodeFor(lastGradeCode))!,
            gradeLevelId: lastGrade.id,
            admissionDate: new Date('2025-02-03'),
            completionDate: new Date('2025-12-05'),
            status: 'COMPLETED',
            enrollmentType: 'NEW',
          },
        });
        created2025 += 1;

        const existing2025 = await prisma.enrollmentPlacement.count({
          where: { organizationId: O, enrollmentId: enrollment2025.id },
        });
        if (existing2025 > 0 && existing2025 !== terms2025.length) {
          await prisma.enrollmentPlacement.deleteMany({
            where: { organizationId: O, enrollmentId: enrollment2025.id },
          });
        }
        if (existing2025 !== terms2025.length) {
          for (const [i, term] of terms2025.entries()) {
            await prisma.enrollmentPlacement.create({
              data: {
                organizationId: O,
                enrollmentId: enrollment2025.id,
                termId: term.id,
                classCohortId: lastCohortId,
                sectionId: lastSection.id,
                rollNumber: String(pupil.roll),
                classNameSnapshot: s.classes.get(lastGradeCode)?.name ?? lastGradeCode,
                sectionNameSnapshot: lastSection.name,
                effectiveFrom: term.startDate,
                // Every 2025 row is closed: the year is over.
                effectiveTo: term.endDate,
                movementReason: i === 0 ? 'INITIAL_PLACEMENT' : 'TERM_ROLLOVER',
                endReason: i === terms2025.length - 1 ? 'COMPLETION' : 'TERM_ROLLOVER',
              },
            });
          }
        }
      }
    }

    // ── This year ──
    const enrollmentType = prev === null ? 'NEW' : isRepeater ? 'REPEAT' : isTransferIn ? 'TRANSFER_IN' : 'CONTINUING';
    if (isRepeater) repeaters += 1;
    if (isTransferIn) transfersIn += 1;

    const enrollment2026 = await prisma.studentEnrollment.upsert({
      where: {
        organizationId_studentProfileId_academicYearId: {
          organizationId: O,
          studentProfileId: pupil.id,
          academicYearId: year2026.id,
        },
      },
      update: { status: 'ACTIVE', gradeLevelId: grade2026.id, enrollmentType },
      create: {
        organizationId: O,
        studentProfileId: pupil.id,
        academicYearId: year2026.id,
        programmeId: programme2026,
        gradeLevelId: grade2026.id,
        admissionDate: new Date('2026-02-02'),
        status: 'ACTIVE',
        enrollmentType,
      },
    });

    // A run that failed part-way leaves an incomplete history. Anything other
    // than the full three terms is rewritten rather than topped up, because
    // appending to a partial history is how overlapping rows appear.
    const existing2026 = await prisma.enrollmentPlacement.count({
      where: { organizationId: O, enrollmentId: enrollment2026.id },
    });
    if (existing2026 > 0 && existing2026 !== terms2026.length) {
      await prisma.enrollmentPlacement.deleteMany({
        where: { organizationId: O, enrollmentId: enrollment2026.id },
      });
    }
    if (existing2026 !== terms2026.length) {
      const cohort2026 = cohorts.get(`2026:${pupil.gradeCode}`)!;
      for (const [i, term] of terms2026.entries()) {
        const isCurrent = isOpenTerm(term);
        await prisma.enrollmentPlacement.create({
          data: {
            organizationId: O,
            enrollmentId: enrollment2026.id,
            termId: term.id,
            classCohortId: cohort2026,
            sectionId: section2026.id,
            rollNumber: String(pupil.roll),
            classNameSnapshot: cls2026.name,
            sectionNameSnapshot: section2026.name,
            effectiveFrom: term.startDate,
            // Only the live term stays open. A history with two open rows is
            // exactly what the partial unique index refuses.
            effectiveTo: isCurrent ? null : term.endDate,
            movementReason:
              i === 0
                ? enrollmentType === 'REPEAT'
                  ? 'REPEAT'
                  : enrollmentType === 'TRANSFER_IN'
                    ? 'TRANSFER_IN'
                    : enrollmentType === 'NEW'
                      ? 'INITIAL_PLACEMENT'
                      : 'PROMOTION'
                : 'TERM_ROLLOVER',
            endReason: isCurrent ? null : 'TERM_ROLLOVER',
          },
        });
      }
    }

    enrollmentEvents.push({
      organizationId: O,
      enrollmentId: enrollment2026.id,
      fromStatus: null,
      toStatus: 'ACTIVE',
      reason: `Demo seed — ${enrollmentType.toLowerCase().replace('_', ' ')}`,
    });

    placements.push({ pupil, enrollmentId2026: enrollment2026.id });
  }

  // The status ledger is append-only; duplicates are harmless but noisy, so it
  // is written only when empty.
  const existingEvents = await prisma.studentEnrollmentEvent.count({ where: { organizationId: O } });
  if (existingEvents === 0) {
    await createManyChunked(prisma.studentEnrollmentEvent as never, enrollmentEvents as never[]);
  }

  ok(
    `enrolment: ${placements.length} active in 2026 ` +
      `(${repeaters} repeating, ${transfersIn} transferred in), ${created2025} completed 2025`,
  );
  log('placements: 3 terms per year, only the live term left open');

  return { cohorts, placements, terms2025, terms2026, year2025, year2026 };
}

export type Enrollment = Awaited<ReturnType<typeof seedEnrollment>>;
