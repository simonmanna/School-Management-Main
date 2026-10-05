/**
 * Green Valley demo — teaching contexts.
 *
 * Curricula, who teaches what, the timetable, and the `CourseOffering` rows the
 * rest of the system hangs off.
 *
 * `CourseOffering` is the canonical teaching instance (ADR-020): one row per
 * (year, term, class, stream, subject). Assessments, lesson plans, schemes of
 * work, timetable slots and LMS courses all point at it, which is why it is
 * built here before any of them.
 *
 * Offerings are created for Terms 1–3 of 2026 only. Last year's teaching
 * contexts are not needed for a demo — 2025 exists as enrolment history and
 * published results, which is how a school that imported its history looks.
 */
import { PrismaClient } from '@prisma/client';
import { createManyChunked, int, log, ok, rng, type School } from './shared';
import { GRADE_SUBJECTS, SUBJECTS, TEACHING_PERIODS, type Reference } from './01-reference';
import { ALL_GRADES, SCHOOL } from './shared';
import type { DemoStaff, People } from './02-people';
import type { Enrollment } from './03-enrollment';

/** A stable string hash, so a class teacher keeps the same subject on re-seed. */
function hashCode(text: string): number {
  let h = 0;
  for (let i = 0; i < text.length; i += 1) h = (Math.imul(31, h) + text.charCodeAt(i)) | 0;
  return h;
}

export interface Offering {
  id: string;
  code: string;
  gradeCode: string;
  streamCode: string;
  subjectCode: string;
  termName: string;
  termId: string;
  /** Last day of the offering's term. */
  termEnd: Date;
  classId: string;
  sectionId: string;
  subjectId: string;
  teacher: DemoStaff;
}

export async function seedTeaching(
  prisma: PrismaClient,
  s: School,
  ref: Reference,
  people: People,
  enrol: Enrollment,
) {
  const { O } = s;
  const year2026 = enrol.year2026;

  /**
   * Who teaches a subject to a stream.
   *
   * Nursery and lower primary are taught by the class teacher — one adult, all
   * day, which is how those classes actually run. Upper primary is specialist:
   * the subject teachers are shared across streams, assigned round-robin so the
   * load spreads.
   */
  function teacherFor(gradeCode: string, streamCode: string, subjectCode: string): DemoStaff {
    const classTeacher = people.classTeachers.get(`${gradeCode}:${streamCode}`)!;
    const specialists = people.subjectTeachers.filter((t) => t.teaches.includes(subjectCode));
    if (specialists.length === 0) return classTeacher;

    const isUpper = ['P4', 'P5', 'P6', 'P7'].includes(gradeCode);
    // Lower primary keeps its class teacher for the thematic subjects, but the
    // specialists still take RE, PE, Music and Art.
    const thematic = ['LIT1', 'LIT2', 'NUM'].includes(subjectCode);
    if (!isUpper && thematic) return classTeacher;

    // An upper-primary class teacher also teaches ONE core subject to their own
    // stream, which is how these schools staff a class — and without it a
    // "class teacher" has a register, a report-card comment and no lessons at
    // all, so their My Courses screen is empty.
    if (isUpper) {
      const core = ['ENG', 'MTC', 'SCI', 'SST'];
      const own = core[
        Math.abs(hashCode(`${gradeCode}:${streamCode}`)) % core.length
      ];
      if (subjectCode === own) return classTeacher;
    }

    const r = rng(`teacher:${gradeCode}:${streamCode}:${subjectCode}`);
    return specialists[int(r, 0, specialists.length - 1)];
  }

  // ── Curricula ─────────────────────────────────────────────────────────────
  // One published curriculum per class per year, listing the subjects that
  // class is taught. Everything downstream — coverage, schemes of work, the
  // lesson-plan context — reads this rather than guessing from a class name.
  let curriculumSubjects = 0;
  const curricula = new Map<string, string>(); // gradeCode -> curriculumId
  for (const gradeCode of ALL_GRADES) {
    const cls = s.classes.get(gradeCode);
    if (!cls) continue;
    const existing = await prisma.curriculum.findFirst({
      where: { organizationId: O, classId: cls.id, academicYearId: year2026.id, version: 1 },
    });
    const curriculum =
      existing ??
      (await prisma.curriculum.create({
        data: {
          organizationId: O,
          classId: cls.id,
          academicYearId: year2026.id,
          name: `${cls.name} — 2026 curriculum (NCDC)`,
          version: 1,
          status: 'published',
        },
      }));
    curricula.set(gradeCode, curriculum.id);

    for (const [i, subjectCode] of (GRADE_SUBJECTS[gradeCode] ?? []).entries()) {
      const subjectId = ref.subjects.get(subjectCode);
      if (!subjectId) continue;
      await prisma.curriculumSubject.upsert({
        where: { curriculumId_subjectId: { curriculumId: curriculum.id, subjectId } },
        update: { isCore: true },
        create: {
          organizationId: O,
          curriculumId: curriculum.id,
          subjectId,
          isCore: true,
          // Core subjects get more of the week than the extras.
          periodsPerWeek: i < 4 ? 5 : 2,
        },
      });
      curriculumSubjects += 1;
    }
  }
  ok(`curricula: ${curricula.size} classes, ${curriculumSubjects} subject lines (2026, published)`);

  // ── Teacher assignments ───────────────────────────────────────────────────
  // `TeacherAssignment` is what the data-scope guard reads to answer "may this
  // teacher see this class?", so it has to exist for teacher logins to behave.
  // By date, not by `Term.isCurrent`: the cached rows predate stage 1's move of
  // the current-term flag.
  const now = new Date();
  const liveTerm =
    enrol.terms2026.find((t) => t.startDate <= now && t.endDate >= now) ?? enrol.terms2026[2];
  let assignments = 0;
  for (const gradeCode of ALL_GRADES) {
    for (const section of s.sectionsByClassCode(gradeCode)) {
      const cls = s.classes.get(gradeCode)!;
      for (const subjectCode of GRADE_SUBJECTS[gradeCode] ?? []) {
        const subjectId = ref.subjects.get(subjectCode);
        if (!subjectId) continue;
        const teacher = teacherFor(gradeCode, section.code, subjectCode);
        await prisma.teacherAssignment.upsert({
          where: {
            organizationId_teacherPartnerId_subjectId_classId_sectionId_termId: {
              organizationId: O,
              teacherPartnerId: teacher.id,
              subjectId,
              classId: cls.id,
              sectionId: section.id,
              termId: liveTerm.id,
            },
          },
          update: { periodsPerWeek: 5 },
          create: {
            organizationId: O,
            teacherPartnerId: teacher.id,
            subjectId,
            classId: cls.id,
            sectionId: section.id,
            termId: liveTerm.id,
            periodsPerWeek: 5,
          },
        });
        assignments += 1;
      }
    }
  }
  ok(`teacher assignments: ${assignments} (subject x stream, current term)`);

  // ── Course offerings ──────────────────────────────────────────────────────
  // One per (term, stream, subject) for all three terms of 2026. Status tracks
  // the FSM: finished terms are CLOSED, the live term is ACTIVE.
  const offerings: Offering[] = [];
  for (const term of enrol.terms2026) {
    const status = term.id === liveTerm.id ? 'ACTIVE' : term.endDate < now ? 'CLOSED' : 'PUBLISHED';
    const termSlug = term.name.replace(/\s+/g, '').toUpperCase(); // TERM1

    for (const gradeCode of ALL_GRADES) {
      const cls = s.classes.get(gradeCode)!;
      const cohortId = enrol.cohorts.get(`2026:${gradeCode}`)!;
      for (const section of s.sectionsByClassCode(gradeCode)) {
        for (const subjectCode of GRADE_SUBJECTS[gradeCode] ?? []) {
          const subjectId = ref.subjects.get(subjectCode);
          if (!subjectId) continue;
          const teacher = teacherFor(gradeCode, section.code, subjectCode);
          const code = `${SCHOOL.codePrefix}-2026-${termSlug}-${gradeCode}-${section.code}-${subjectCode}`;
          const subjectName = SUBJECTS.find((x) => x.code === subjectCode)?.name ?? subjectCode;
          const name = `${cls.name} ${section.name} — ${subjectName}`;

          const row = await prisma.courseOffering.upsert({
            where: { organizationId_code: { organizationId: O, code } },
            update: { status, name },
            create: {
              organizationId: O,
              code,
              name,
              academicYearId: year2026.id,
              termId: term.id,
              programmeId: ref.programmes.get(
                gradeCode.startsWith('P')
                  ? ['P1', 'P2', 'P3'].includes(gradeCode)
                    ? 'LOWER_PRIMARY'
                    : 'UPPER_PRIMARY'
                  : 'ECD',
              )!,
              classCohortId: cohortId,
              subjectId,
              classId: cls.id,
              sectionId: section.id,
              curriculumId: curricula.get(gradeCode) ?? null,
              offeringType: 'SUBJECT',
              audienceScope: 'COHORT',
              status,
              effectiveFrom: term.startDate,
              // Moodle-shaped course settings: a Ugandan term is about 13
              // teaching weeks, so the course page opens with that many.
              format: 'weeks',
              numSections: 13,
              startDate: term.startDate,
              endDate: term.endDate,
              visible: true,
              completionEnabled: true,
              showGradesToStudents: true,
            },
          });

          // No natural key on this table, so find-then-create keeps it idempotent.
          const existingLead = await prisma.courseOfferingTeacher.findFirst({
            where: { organizationId: O, courseOfferingId: row.id, teacherPartnerId: teacher.id },
          });
          if (!existingLead) {
            await prisma.courseOfferingTeacher.create({
              data: {
                organizationId: O,
                courseOfferingId: row.id,
                teacherPartnerId: teacher.id,
                role: 'LEAD',
                isResponsible: true,
                effectiveFrom: term.startDate,
              },
            });
          }

          offerings.push({
            id: row.id,
            code,
            gradeCode,
            streamCode: section.code,
            subjectCode,
            termName: term.name,
            termEnd: term.endDate,
            termId: term.id,
            classId: cls.id,
            sectionId: section.id,
            subjectId,
            teacher,
          });
        }
      }
    }
  }
  ok(`course offerings: ${offerings.length} across 3 terms of 2026`);

  // ── Academic course rosters ───────────────────────────────────────────────
  // `CourseEnrollment` is the academic truth for "who is on this course",
  // derived from official enrolment (ADR-021). COMPULSORY, because a Ugandan
  // primary pupil does not elect their subjects.
  const enrollmentByPupil = new Map(enrol.placements.map((p) => [p.pupil.id, p.enrollmentId2026]));
  const rosterRows: Array<Record<string, unknown>> = [];
  for (const offering of offerings) {
    const members = people.pupils.filter(
      (p) => p.gradeCode === offering.gradeCode && p.streamCode === offering.streamCode,
    );
    for (const pupil of members) {
      const studentEnrollmentId = enrollmentByPupil.get(pupil.id);
      if (!studentEnrollmentId) continue;
      rosterRows.push({
        organizationId: O,
        courseOfferingId: offering.id,
        studentEnrollmentId,
        source: 'COMPULSORY',
        status: 'ENROLLED',
        startDate: offering.termName === 'Term 1' ? new Date('2026-02-02') : new Date('2026-05-15'),
      });
    }
  }
  const existingRoster = await prisma.courseEnrollment.count({ where: { organizationId: O } });
  if (existingRoster === 0) {
    await createManyChunked(prisma.courseEnrollment as never, rosterRows as never[]);
    log(`course rosters: ${rosterRows.length} compulsory memberships`);
  } else {
    log(`course rosters: ${existingRoster} already present, left alone`);
  }

  // ── Timetable ─────────────────────────────────────────────────────────────
  //
  // A real scheduler, because the database enforces a real constraint: a
  // trigger refuses any slot that double-books a teacher, a room, or a stream
  // in the same day and period. Filling the grid stream by stream — the obvious
  // way — books the shared subject specialists into thirty streams at once and
  // is rejected on the first upper-primary class.
  //
  // So: a weekly demand per stream (how many periods each subject needs), then
  // a greedy pass over the grid cell by cell, taking the subject with the most
  // periods still owed whose teacher is free in that cell. Streams are visited
  // in a rotating order so the same class does not always get first pick, and a
  // cell with nothing schedulable is simply left as a free period, which is
  // what a real timetable has.
  const teachingPeriodIds = TEACHING_PERIODS.map((n) => ref.periods.get(n)!).filter(Boolean);
  const liveOfferings = offerings.filter((o) => o.termId === liveTerm.id);

  /** Periods a week per subject: core subjects get the most. */
  const periodsFor = (gradeCode: string, subjectCode: string): number => {
    const core = ['ENG', 'MTC', 'SCI', 'SST', 'LIT1', 'LIT2', 'NUM'];
    if (['BABY', 'MIDDLE', 'TOP'].includes(gradeCode)) return 4; // nursery: even spread
    return core.includes(subjectCode) ? 5 : 2;
  };

  interface Demand {
    offering: Offering;
    owed: number;
  }
  const streamKeys: string[] = [];
  const demands = new Map<string, Demand[]>();
  for (const gradeCode of ALL_GRADES) {
    for (const section of s.sectionsByClassCode(gradeCode)) {
      const key = `${gradeCode}:${section.code}`;
      const mine = liveOfferings.filter(
        (o) => o.gradeCode === gradeCode && o.streamCode === section.code,
      );
      if (mine.length === 0) continue;
      streamKeys.push(key);
      demands.set(
        key,
        mine.map((offering) => ({ offering, owed: periodsFor(gradeCode, offering.subjectCode) })),
      );
    }
  }

  /** `day:period:teacher` — who is already teaching in this cell. */
  const busy = new Set<string>();
  const slotRows: Array<Record<string, unknown>> = [];
  let unfilled = 0;

  for (let day = 1; day <= 5; day += 1) {
    for (const [pIndex, periodId] of teachingPeriodIds.entries()) {
      // Rotate who picks first, so period 1 on Monday is not always the same
      // class getting the subject it wants.
      const offset = (day * teachingPeriodIds.length + pIndex) % Math.max(1, streamKeys.length);
      for (let i = 0; i < streamKeys.length; i += 1) {
        const key = streamKeys[(i + offset) % streamKeys.length];
        const list = demands.get(key)!;
        // Most-owed first, so core subjects land before the extras.
        const candidate = list
          .filter((d) => d.owed > 0 && !busy.has(`${day}:${periodId}:${d.offering.teacher.id}`))
          .sort((a, b) => b.owed - a.owed)[0];
        if (!candidate) {
          unfilled += 1;
          continue;
        }
        candidate.owed -= 1;
        busy.add(`${day}:${periodId}:${candidate.offering.teacher.id}`);
        slotRows.push({
          organizationId: O,
          classId: candidate.offering.classId,
          sectionId: candidate.offering.sectionId,
          dayOfWeek: day,
          periodId,
          subjectId: candidate.offering.subjectId,
          teacherPartnerId: candidate.offering.teacher.id,
          courseOfferingId: candidate.offering.id,
          type: 'lesson',
          published: true,
        });
      }
    }
  }

  const stillOwed = [...demands.values()].flat().reduce((n, d) => n + Math.max(0, d.owed), 0);

  // Derived wholly from the offerings, so a partial grid left by a failed run is
  // rebuilt rather than topped up — appending to it is what trips the trigger.
  const existingSlots = await prisma.timetableSlot.count({ where: { organizationId: O } });
  if (existingSlots !== slotRows.length) {
    if (existingSlots > 0) {
      await prisma.timetableSlot.deleteMany({ where: { organizationId: O } });
    }
    // One at a time: the clash trigger is per-row, and a failed createMany
    // would leave no clue which row clashed.
    for (const row of slotRows) {
      await prisma.timetableSlot.create({ data: row as never });
    }
    ok(
      `timetable: ${slotRows.length} published slots ` +
        `(Mon–Fri x ${teachingPeriodIds.length} periods; ${unfilled} free, ${stillOwed} periods unplaced)`,
    );
  } else {
    log(`timetable: ${existingSlots} slots already match, left alone`);
  }

  return { offerings, curricula, liveTerm, teacherFor };
}

export type Teaching = Awaited<ReturnType<typeof seedTeaching>>;
