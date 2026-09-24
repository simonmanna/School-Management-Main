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
  { code: 'PRE', name: 'Nursery', stage: 'PRE_PRIMARY', order: 1, programme: 'Nursery (ECD)' },
  { code: 'PL', name: 'Lower Primary', stage: 'PRIMARY_LOWER', order: 2, programme: 'Lower Primary' },
  { code: 'PU', name: 'Upper Primary', stage: 'PRIMARY_UPPER', order: 3, programme: 'Upper Primary' },
] as const;

/** Grade ladder, youngest first. The last grade graduates (PLE). */
const GRADES: Array<{ name: string; code: string; level: (typeof LEVELS)[number]['code'] }> = [
  { name: 'Baby Class', code: 'BABY', level: 'PRE' },
  { name: 'Middle Class', code: 'MIDDLE', level: 'PRE' },
  { name: 'Top Class', code: 'TOP', level: 'PRE' },
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
  { code: 'excused', label: 'Excused', color: '#6366f1', isAbsent: true, sortOrder: 4 },
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
      },
    });
    const level = await db.academicLevel.create({
      data: {
        organizationId,
        code: l.code,
        name: l.name,
        stage: l.stage,
        displayOrder: l.order,
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
    data: { organizationId, name: 'PLE (UNEB)', bands: PLE_BANDS, isDefault: true },
  });
}
