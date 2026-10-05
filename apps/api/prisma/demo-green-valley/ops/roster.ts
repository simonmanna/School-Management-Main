/**
 * ════════════════════════════════════════════════════════════════════════════
 *  DEMO DATA — FICTIONAL SCHOOL, FICTIONAL PEOPLE
 * ════════════════════════════════════════════════════════════════════════════
 *
 * The school as the operations stages need it: the 2026 roll with each pupil's
 * class, stream, residence and paying guardian, the three 2026 terms, and the
 * staff. Read from the academic demo, never invented here.
 */
import type { Ctx } from './kit';
import { iso } from './kit';

export interface Pupil {
  id: string;
  partnerId: string;
  name: string;
  admissionNo: string;
  gender: string;
  residence: 'day' | 'boarding';
  grade: string;
  gradeLevelId: string;
  classId: string | null;
  className: string | null;
  sectionId: string | null;
  stream: string | null;
  isNew: boolean;
  guardianName: string;
  guardianPhone: string | null;
}

export interface Term {
  id: string;
  name: string;
  no: 1 | 2 | 3;
  start: string;
  end: string;
  isCurrent: boolean;
}

export interface Roster {
  yearId: string;
  terms: Term[];
  term: (no: 1 | 2 | 3) => Term;
  pupils: Pupil[];
  byGrade: (grade: string) => Pupil[];
  gradeLevelId: (grade: string) => string;
  classIdByGrade: (grade: string) => string;
}

export async function loadRoster(ctx: Ctx): Promise<Roster> {
  const { prisma, O, school } = ctx;
  const year = school.years.get('2026');
  if (!year) throw new Error('Academic year 2026 missing');

  const terms: Term[] = (
    await prisma.term.findMany({ where: { organizationId: O, academicYearId: year.id }, orderBy: { startDate: 'asc' } })
  ).map((t, i) => ({
    id: t.id,
    name: t.name,
    no: (i + 1) as 1 | 2 | 3,
    start: iso(t.startDate),
    end: iso(t.endDate),
    isCurrent: t.isCurrent,
  }));
  if (terms.length !== 3) throw new Error(`Expected three 2026 terms, found ${terms.length}`);

  const rows: any[] = await prisma.$queryRawUnsafe(
    `SELECT sp.id, sp."partnerId", p.name, sp."admissionNo", sp.gender, sp."residenceType",
            g.code AS grade, g.id AS "gradeLevelId", e."enrollmentType",
            cc."classId", cls.name AS "className", sec.id AS "sectionId", sec.code AS stream,
            gc."firstName" AS "gFirst", gc."lastName" AS "gLast", gc.phone AS "gPhone"
       FROM "StudentProfile" sp
       JOIN "Partner" p ON p.id = sp."partnerId"
       JOIN "StudentEnrollment" e ON e."studentProfileId" = sp.id AND e."academicYearId" = $2
       JOIN "GradeLevel" g ON g.id = e."gradeLevelId"
       LEFT JOIN LATERAL (
            SELECT ep."classCohortId", ep."sectionId" FROM "EnrollmentPlacement" ep
             WHERE ep."enrollmentId" = e.id
             ORDER BY ep."effectiveFrom" DESC LIMIT 1) pl ON true
       LEFT JOIN "ClassCohort" cc ON cc.id = pl."classCohortId"
       LEFT JOIN "SchoolClass" cls ON cls.id = cc."classId"
       LEFT JOIN "Section" sec ON sec.id = pl."sectionId"
       LEFT JOIN LATERAL (
            SELECT c."firstName", c."lastName", c.phone FROM "StudentGuardian" sg
              JOIN "Contact" c ON c.id = sg."guardianContactId"
             WHERE sg."studentProfileId" = sp.id AND sg."deletedAt" IS NULL
             ORDER BY sg."isPrimary" DESC, sg."createdAt" ASC LIMIT 1) gc ON true
      WHERE sp."organizationId" = $1 AND sp.status IN ('active', 'suspended')
      ORDER BY g."order", sec.code, sp."admissionNo"`,
    O,
    year.id,
  );

  const pupils: Pupil[] = rows.map((r) => ({
    id: r.id,
    partnerId: r.partnerId,
    name: r.name,
    admissionNo: r.admissionNo,
    gender: r.gender ?? 'M',
    residence: r.residenceType === 'boarding' || r.residenceType === 'boarder' ? 'boarding' : 'day',
    grade: r.grade,
    gradeLevelId: r.gradeLevelId,
    classId: r.classId,
    className: r.className,
    sectionId: r.sectionId,
    stream: r.stream,
    isNew: r.enrollmentType === 'NEW',
    guardianName: [r.gFirst, r.gLast].filter(Boolean).join(' ') || 'Parent',
    guardianPhone: r.gPhone,
  }));

  const grades = new Map<string, string>(pupils.map((p) => [p.grade, p.gradeLevelId]));
  const classes = new Map<string, string>();
  for (const p of pupils) if (p.classId && !classes.has(p.grade)) classes.set(p.grade, p.classId);

  return {
    yearId: year.id,
    terms,
    term: (no) => terms[no - 1],
    pupils,
    byGrade: (grade) => pupils.filter((p) => p.grade === grade),
    gradeLevelId: (grade) => {
      const id = grades.get(grade) ?? school.grades.get(grade)?.id;
      if (!id) throw new Error(`Grade ${grade} missing`);
      return id;
    },
    classIdByGrade: (grade) => {
      const id = classes.get(grade);
      if (!id) throw new Error(`No class for ${grade}`);
      return id;
    },
  };
}

export const NURSERY = ['BABY', 'MIDDLE', 'TOP'];
export const PRIMARY = ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7'];
export const ALL = [...NURSERY, ...PRIMARY];
