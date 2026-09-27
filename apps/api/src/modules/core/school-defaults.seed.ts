/**
 * The starting structure of a new Ugandan nursery/primary school (E2E audit
 * C2, Wave 5). Bootstrap used to create an organization with no grades, no
 * classes, no attendance statuses and no grading scale, so every school was
 * built by hand before it could register a single pupil — and rollover refused
 * everyone because no grade had a "promotes to".
 *
 * Plain data written through the caller's client (the bootstrap transaction),
 * with no imports from the school modules: `core` sits below them (ADR-011).
 * Everything is an ordinary editable row; a school renames, adds or removes
 * as it likes.
 */

type Db = any; // Prisma transaction client

const LEVELS = [
  // `ratio` is the most children one adult may be responsible for in the band.
  // Nursery is why it exists: a seat count says nothing about whether a room of
  // thirty two-year-olds is safe. Advisory — placement warns, never refuses,
  // because staffing changes faster than enrolment. Null for primary, where a
  // school's own rules and the class capacity are the constraint.
  { code: 'PRE', name: 'Nursery', stage: 'PRE_PRIMARY', order: 1, programme: 'Nursery (ECD)', ratio: 12 },
  { code: 'PL', name: 'Lower Primary', stage: 'PRIMARY_LOWER', order: 2, programme: 'Lower Primary', ratio: null },
  { code: 'PU', name: 'Upper Primary', stage: 'PRIMARY_UPPER', order: 3, programme: 'Upper Primary', ratio: null },
] as const;

/**
 * Nursery reporting, written into the Nursery programme's versioned config.
 *
 * A nursery-and-primary school has one SchoolProfile and therefore one
 * school-wide grading system, which used to be applied to Baby Class as readily
 * as to P7 — so Top Class was reported in D1–F9 with a GPA and a position in
 * class. The programme is where assessment and ranking rules belong, and this is
 * an ordinary editable row: a school that wants its nursery ranked sets
 * `rankOn` back.
 */
const NURSERY_CONFIG = {
  gradingSystem: 'ECD',
  rankOn: 'none',
};

/**
 * Nursery descriptors. The levels a nursery teacher actually reports in, held as
 * an ordinary GradingScale so the school can reword them. Not `isDefault`: the
 * primary scale stays the school default, and `resolveBands` prefers the scale
 * registered for the system being reported.
 */
const ECD_BANDS = [
  { min: 80, max: 100, grade: 'Confident', gpa: 0, remark: 'Doing this confidently and on their own' },
  { min: 60, max: 79, grade: 'Developing', gpa: 0, remark: 'Doing this well, with a little help' },
  { min: 40, max: 59, grade: 'Beginning', gpa: 0, remark: 'Beginning to do this with help' },
  { min: 0, max: 39, grade: 'Support', gpa: 0, remark: 'Needs more time and practice' },
];

/**
 * Grade ladder, youngest first. The last grade graduates (PLE).
 *
 * `minAge`/`maxAge` are in MONTHS and are measured at the start of the term
 * being placed into — the way a school states an intake cutoff ("three by the
 * first day"). Only the nursery grades carry one, because only nursery bands are
 * narrow enough for age to be the rule; a school edits or clears them.
 */
const GRADES: Array<{
  name: string;
  code: string;
  level: (typeof LEVELS)[number]['code'];
  minAge?: number;
  maxAge?: number;
}> = [
  { name: 'Baby Class', code: 'BABY', level: 'PRE', minAge: 30, maxAge: 47 },
  { name: 'Middle Class', code: 'MIDDLE', level: 'PRE', minAge: 36, maxAge: 59 },
  { name: 'Top Class', code: 'TOP', level: 'PRE', minAge: 48, maxAge: 71 },
  { name: 'P1', code: 'P1', level: 'PL' },
  { name: 'P2', code: 'P2', level: 'PL' },
  { name: 'P3', code: 'P3', level: 'PL' },
  { name: 'P4', code: 'P4', level: 'PU' },
  { name: 'P5', code: 'P5', level: 'PU' },
  { name: 'P6', code: 'P6', level: 'PU' },
  { name: 'P7', code: 'P7', level: 'PU' },
];

/** Same codes and flags as prisma/seed-attendance-statuses.ts. */
const ATTENDANCE = [
  { code: 'present', label: 'Present', color: '#16a34a', isDefault: true, isPresent: true, sortOrder: 1 },
  { code: 'absent', label: 'Absent', color: '#dc2626', isAbsent: true, sortOrder: 2 },
  { code: 'late', label: 'Late', color: '#f59e0b', isPresent: true, isLate: true, sortOrder: 3 },
  { code: 'excused', label: 'Excused', color: '#6366f1', isAbsent: true, isExcused: true, sortOrder: 4 },
];

/** UNEB PLE divisions of marks (same as the built-in `defaultBands('PLE')`). */
const PLE_BANDS = [
  { min: 90, max: 100, grade: 'D1', gpa: 4.0, points: 1, remark: 'Distinction' },
  { min: 80, max: 89, grade: 'D2', gpa: 3.6, points: 2, remark: 'Distinction' },
  { min: 70, max: 79, grade: 'C3', gpa: 3.2, points: 3, remark: 'Credit' },
  { min: 65, max: 69, grade: 'C4', gpa: 2.8, points: 4, remark: 'Credit' },
  { min: 60, max: 64, grade: 'C5', gpa: 2.4, points: 5, remark: 'Credit' },
  { min: 50, max: 59, grade: 'C6', gpa: 2.0, points: 6, remark: 'Credit' },
  { min: 40, max: 49, grade: 'P7', gpa: 1.5, points: 7, remark: 'Pass' },
  { min: 35, max: 39, grade: 'P8', gpa: 1.0, points: 8, remark: 'Pass' },
  { min: 0, max: 34, grade: 'F9', gpa: 0.0, points: 9, remark: 'Fail' },
];

export async function seedSchoolDefaults(db: Db, organizationId: string): Promise<void> {
  await db.campus.create({ data: { organizationId, code: 'MAIN', name: 'Main campus', isMain: true } });

  const levelIds = new Map<string, string>();
  for (const l of LEVELS) {
    const programme = await db.academicProgramme.create({
      data: {
        organizationId,
        code: l.code,
        name: l.programme,
        stage: l.stage,
        isActive: true,
        effectiveFrom: new Date('2000-01-01'),
        config: l.stage === 'PRE_PRIMARY' ? NURSERY_CONFIG : {},
      },
    });
    const level = await db.academicLevel.create({
      data: {
        organizationId,
        code: l.code,
        name: l.name,
        stage: l.stage,
        displayOrder: l.order,
        staffChildRatio: l.ratio ?? null,
        defaultProgrammeId: programme.id,
      },
    });
    levelIds.set(l.code, level.id);
  }

  // Create top-down so each grade can point at the one above it.
  let next: string | null = null;
  for (let i = GRADES.length - 1; i >= 0; i--) {
    const g = GRADES[i];
    const grade: { id: string } = await db.gradeLevel.create({
      data: {
        organizationId,
        name: g.name,
        code: g.code,
        order: i + 1,
        academicLevelId: levelIds.get(g.level),
        minAgeMonths: g.minAge ?? null,
        maxAgeMonths: g.maxAge ?? null,
        nextGradeLevelId: next,
        isTerminal: next === null,
      },
    });
    // One undivided class per grade; a school adds streams when it has them.
    await db.schoolClass.create({
      data: { organizationId, gradeLevelId: grade.id, name: g.name, allowsStreams: false },
    });
    next = grade.id;
  }

  await db.attendanceStatusConfig.createMany({
    data: ATTENDANCE.map((a) => ({ organizationId, ...a })),
    skipDuplicates: true,
  });
  await db.gradingScale.create({
    data: { organizationId, name: 'PLE (UNEB)', system: 'PLE', bands: PLE_BANDS, isDefault: true },
  });
  // Each scale names its system; resolveScale never borrows across systems.
  await db.gradingScale.create({
    data: { organizationId, name: 'ECD nursery descriptors', system: 'ECD', bands: ECD_BANDS, isDefault: false },
  });
}
