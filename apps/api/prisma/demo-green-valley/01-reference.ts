/**
 * Green Valley demo — reference data.
 *
 * Everything the teaching records point at: programmes, subjects, departments,
 * the bell schedule, attendance codes and grading scales.
 *
 * The subjects follow Uganda's NCDC primary curriculum, which is three
 * different things in one school and the reason `academicLevelId` exists on
 * `Subject`:
 *
 *  - **Nursery** is assessed developmentally, not out of 100. Its learning
 *    areas are reported with the ECD descriptors ("Confident", "Developing"),
 *    and `result-computation.ts` prints no aggregate, division or position for
 *    a descriptor system.
 *  - **Lower primary (P1–P3)** runs the thematic curriculum: Literacy I in the
 *    local language, Literacy II in English, plus Numeracy.
 *  - **Upper primary (P4–P7)** is subject-based and ends at the PLE, whose four
 *    examinable subjects are English, Mathematics, Science and Social Studies.
 */
import { PrismaClient } from '@prisma/client';
import { defaultBands } from '../../src/modules/school/assessment/grade-bands';
import { D, log, ok, type School } from './shared';

interface SubjectSeed {
  code: string;
  name: string;
  /** Which band teaches it. `null` = every level. */
  level: 'PRE_PRIMARY' | 'PRIMARY' | null;
  department: string;
  /** Carries marks toward the term result. */
  core: boolean;
  order: number;
}

/**
 * The subject list.
 *
 * `core` marks the subjects a term result is computed from. For upper primary
 * those are deliberately the four PLE subjects — adding Religious Education or
 * ICT to the aggregate would misreport a pupil against the national standard.
 */
export const SUBJECTS: SubjectSeed[] = [
  // ── Nursery learning areas (developmental) ──
  { code: 'LANG-DEV', name: 'Language Development', level: 'PRE_PRIMARY', department: 'Early Years', core: true, order: 1 },
  { code: 'NUM-CONC', name: 'Mathematical Concepts', level: 'PRE_PRIMARY', department: 'Early Years', core: true, order: 2 },
  { code: 'ENV-AWARE', name: 'Environmental Awareness', level: 'PRE_PRIMARY', department: 'Early Years', core: true, order: 3 },
  { code: 'CREATIVE', name: 'Creative Arts', level: 'PRE_PRIMARY', department: 'Creative & Physical', core: true, order: 4 },
  { code: 'PHYS-DEV', name: 'Physical Development', level: 'PRE_PRIMARY', department: 'Creative & Physical', core: true, order: 5 },
  { code: 'SOC-EMO', name: 'Social & Emotional Development', level: 'PRE_PRIMARY', department: 'Early Years', core: true, order: 6 },

  // ── Lower primary, thematic (P1–P3) ──
  { code: 'LIT1', name: 'Literacy I (Luganda)', level: 'PRIMARY', department: 'Languages', core: true, order: 10 },
  { code: 'LIT2', name: 'Literacy II (English)', level: 'PRIMARY', department: 'Languages', core: true, order: 11 },
  { code: 'NUM', name: 'Numeracy', level: 'PRIMARY', department: 'Mathematics', core: true, order: 12 },

  // ── Upper primary, subject-based (P4–P7) ──
  { code: 'ENG', name: 'English', level: 'PRIMARY', department: 'Languages', core: true, order: 20 },
  { code: 'MTC', name: 'Mathematics', level: 'PRIMARY', department: 'Mathematics', core: true, order: 21 },
  { code: 'SCI', name: 'Science', level: 'PRIMARY', department: 'Science', core: true, order: 22 },
  { code: 'SST', name: 'Social Studies', level: 'PRIMARY', department: 'Social Studies', core: true, order: 23 },

  // ── Taught across the primary school, not in the PLE aggregate ──
  { code: 'RE', name: 'Religious Education', level: 'PRIMARY', department: 'Religious Education', core: false, order: 30 },
  { code: 'KIS', name: 'Kiswahili', level: 'PRIMARY', department: 'Languages', core: false, order: 31 },
  { code: 'ICT', name: 'Computer Studies', level: 'PRIMARY', department: 'ICT', core: false, order: 32 },
  { code: 'PE', name: 'Physical Education', level: 'PRIMARY', department: 'Creative & Physical', core: false, order: 33 },
  { code: 'MDD', name: 'Music, Dance & Drama', level: 'PRIMARY', department: 'Creative & Physical', core: false, order: 34 },
  { code: 'ART', name: 'Art & Craft', level: 'PRIMARY', department: 'Creative & Physical', core: false, order: 35 },
];

const DEPARTMENTS = [
  'Languages',
  'Mathematics',
  'Science',
  'Social Studies',
  'Religious Education',
  'Creative & Physical',
  'Early Years',
  'ICT',
];

/** Which subjects each grade is taught, and in what order. */
export const GRADE_SUBJECTS: Record<string, string[]> = {
  BABY: ['LANG-DEV', 'NUM-CONC', 'ENV-AWARE', 'CREATIVE', 'PHYS-DEV', 'SOC-EMO'],
  MIDDLE: ['LANG-DEV', 'NUM-CONC', 'ENV-AWARE', 'CREATIVE', 'PHYS-DEV', 'SOC-EMO'],
  TOP: ['LANG-DEV', 'NUM-CONC', 'ENV-AWARE', 'CREATIVE', 'PHYS-DEV', 'SOC-EMO'],
  P1: ['LIT1', 'LIT2', 'NUM', 'RE', 'PE', 'MDD', 'ART'],
  P2: ['LIT1', 'LIT2', 'NUM', 'RE', 'PE', 'MDD', 'ART'],
  P3: ['LIT1', 'LIT2', 'NUM', 'RE', 'PE', 'MDD', 'ART'],
  P4: ['ENG', 'MTC', 'SCI', 'SST', 'RE', 'KIS', 'ICT', 'PE'],
  P5: ['ENG', 'MTC', 'SCI', 'SST', 'RE', 'KIS', 'ICT', 'PE'],
  P6: ['ENG', 'MTC', 'SCI', 'SST', 'RE', 'KIS', 'ICT', 'PE'],
  P7: ['ENG', 'MTC', 'SCI', 'SST', 'RE', 'ICT'],
};

/** The subjects a term result is computed from, per grade. */
export function coreSubjectsFor(gradeCode: string): string[] {
  const taught = GRADE_SUBJECTS[gradeCode] ?? [];
  const coreCodes = new Set(SUBJECTS.filter((s) => s.core).map((s) => s.code));
  return taught.filter((c) => coreCodes.has(c));
}

/**
 * The bell schedule. Eight 40-minute periods with a short break and lunch,
 * which is how a Ugandan day school runs.
 */
const PERIODS = [
  { name: 'Period 1', startTime: '08:00', endTime: '08:40', order: 1 },
  { name: 'Period 2', startTime: '08:40', endTime: '09:20', order: 2 },
  { name: 'Period 3', startTime: '09:20', endTime: '10:00', order: 3 },
  { name: 'Break', startTime: '10:00', endTime: '10:20', order: 4 },
  { name: 'Period 4', startTime: '10:20', endTime: '11:00', order: 5 },
  { name: 'Period 5', startTime: '11:00', endTime: '11:40', order: 6 },
  { name: 'Period 6', startTime: '11:40', endTime: '12:20', order: 7 },
  { name: 'Lunch', startTime: '12:20', endTime: '13:20', order: 8 },
  { name: 'Period 7', startTime: '13:20', endTime: '14:00', order: 9 },
  { name: 'Period 8', startTime: '14:00', endTime: '14:40', order: 10 },
];

/** Teaching periods only — break and lunch carry no lesson. */
export const TEACHING_PERIODS = PERIODS.filter((p) => p.name.startsWith('Period')).map((p) => p.name);

/** Attendance codes. `isPresent`/`isAbsent` drive every rate in the system. */
const ATTENDANCE_CODES = [
  { code: 'P', label: 'Present', isPresent: true, isLate: false, isAbsent: false, isExcused: false, order: 1 },
  { code: 'L', label: 'Late', isPresent: true, isLate: true, isAbsent: false, isExcused: false, order: 2 },
  { code: 'A', label: 'Absent', isPresent: false, isLate: false, isAbsent: true, isExcused: false, order: 3 },
  { code: 'S', label: 'Sick (excused)', isPresent: false, isLate: false, isAbsent: true, isExcused: true, order: 4 },
  { code: 'E', label: 'Excused', isPresent: false, isLate: false, isAbsent: true, isExcused: true, order: 5 },
];

export async function seedReference(prisma: PrismaClient, s: School) {
  const { O } = s;

  // ── Term 3 2026 is "now" ──────────────────────────────────────────────────
  // The structure seed marked Term 2 current. Today falls inside Term 3, and a
  // demo whose "current term" ended two months ago undermines every screen that
  // defaults to it.
  const asOf = new Date();
  const allTerms = await prisma.term.findMany({ where: { organizationId: O } });
  const live = allTerms.find((t) => t.startDate <= asOf && t.endDate >= asOf);
  if (live) {
    await prisma.term.updateMany({ where: { organizationId: O, isCurrent: true }, data: { isCurrent: false } });
    await prisma.term.update({ where: { id: live.id }, data: { isCurrent: true } });
    const year = await prisma.academicYear.findUnique({ where: { id: live.academicYearId } });
    log(`current term: ${year?.name} ${live.name} (contains today)`);
  }

  // ── Programmes ────────────────────────────────────────────────────────────
  // Three, because the NCDC curriculum genuinely differs between them. Uganda's
  // rules live on these rows, never in an `if (className === 'P2')`.
  const programmeSeeds = [
    {
      code: 'ECD',
      name: 'Early Childhood Development',
      stage: 'PRE_PRIMARY' as const,
      description: 'Nursery. Developmental assessment against the ECD descriptors; no aggregate or position.',
      levels: ['PRE_PRIMARY'],
      config: { reporting: 'descriptor', gradingSystem: 'ECD', ranksLearners: false },
    },
    {
      code: 'LOWER_PRIMARY',
      name: 'Lower Primary (P1–P3)',
      stage: 'PRIMARY_LOWER' as const,
      description: 'Thematic curriculum: Literacy I (local language), Literacy II (English) and Numeracy.',
      levels: [],
      config: { reporting: 'marks', gradingSystem: 'PLE', ranksLearners: true, thematic: true },
    },
    {
      code: 'UPPER_PRIMARY',
      name: 'Upper Primary (P4–P7)',
      stage: 'PRIMARY_UPPER' as const,
      description: 'Subject-based, leading to the Primary Leaving Examination in English, Mathematics, Science and Social Studies.',
      levels: ['PRIMARY'],
      config: { reporting: 'marks', gradingSystem: 'PLE', ranksLearners: true, pleSubjects: ['ENG', 'MTC', 'SCI', 'SST'] },
    },
  ];

  const programmes = new Map<string, string>();
  for (const p of programmeSeeds) {
    const row = await prisma.academicProgramme.upsert({
      where: { organizationId_code: { organizationId: O, code: p.code } },
      update: {
        name: p.name,
        stage: p.stage,
        description: p.description,
        curriculumAuthority: 'NCDC',
        config: p.config,
        isActive: true,
      },
      create: {
        organizationId: O,
        code: p.code,
        name: p.name,
        stage: p.stage,
        description: p.description,
        curriculumAuthority: 'NCDC',
        effectiveFrom: new Date('2025-01-01'),
        config: p.config,
      },
    });
    programmes.set(p.code, row.id);

    // A level's default programme is what a new enrolment picks up.
    for (const levelCode of p.levels) {
      const level = s.levels.get(levelCode);
      if (level) {
        await prisma.academicLevel.update({
          where: { id: level.id },
          data: { defaultProgrammeId: row.id },
        });
      }
    }
  }
  ok(`programmes: ${programmeSeeds.map((p) => p.code).join(', ')} (NCDC)`);

  // ── Departments ───────────────────────────────────────────────────────────
  const departments = new Map<string, string>();
  for (const name of DEPARTMENTS) {
    const row = await prisma.department.upsert({
      where: { organizationId_name: { organizationId: O, name } },
      update: {},
      create: { organizationId: O, name },
    });
    departments.set(name, row.id);
  }
  log(`departments: ${DEPARTMENTS.length}`);

  // ── Subject categories ────────────────────────────────────────────────────
  const categorySeeds = [
    { code: 'CORE', name: 'Core (examinable)' },
    { code: 'TAUGHT', name: 'Taught (not examinable)' },
    { code: 'ECD-AREA', name: 'Nursery learning area' },
  ];
  const categories = new Map<string, string>();
  for (const c of categorySeeds) {
    const row = await prisma.subjectCategory.upsert({
      where: { organizationId_code: { organizationId: O, code: c.code } },
      update: { name: c.name },
      create: { organizationId: O, code: c.code, name: c.name },
    });
    categories.set(c.code, row.id);
  }

  // ── Subjects ──────────────────────────────────────────────────────────────
  const subjects = new Map<string, string>();
  for (const sub of SUBJECTS) {
    const categoryCode = sub.level === 'PRE_PRIMARY' ? 'ECD-AREA' : sub.core ? 'CORE' : 'TAUGHT';
    const row = await prisma.subject.upsert({
      where: { organizationId_code: { organizationId: O, code: sub.code } },
      update: {
        name: sub.name,
        departmentId: departments.get(sub.department) ?? null,
        subjectCategoryId: categories.get(categoryCode) ?? null,
        academicLevelId: sub.level ? (s.levels.get(sub.level)?.id ?? null) : null,
        isCore: sub.core,
        displayOrder: sub.order,
        isActive: true,
      },
      create: {
        organizationId: O,
        code: sub.code,
        name: sub.name,
        departmentId: departments.get(sub.department) ?? null,
        subjectCategoryId: categories.get(categoryCode) ?? null,
        academicLevelId: sub.level ? (s.levels.get(sub.level)?.id ?? null) : null,
        isCore: sub.core,
        displayOrder: sub.order,
      },
    });
    subjects.set(sub.code, row.id);
  }
  ok(`subjects: ${SUBJECTS.length} (nursery areas, thematic, PLE)`);

  // ── Bell schedule ─────────────────────────────────────────────────────────
  const periods = new Map<string, string>();
  for (const p of PERIODS) {
    const existing = await prisma.period.findFirst({
      where: { organizationId: O, name: p.name, campusId: null },
    });
    const row = existing
      ? await prisma.period.update({
          where: { id: existing.id },
          data: { startTime: p.startTime, endTime: p.endTime, order: p.order },
        })
      : await prisma.period.create({
          data: {
            organizationId: O,
            name: p.name,
            startTime: p.startTime,
            endTime: p.endTime,
            order: p.order,
          },
        });
    periods.set(p.name, row.id);
  }
  log(`periods: ${PERIODS.length} (08:00–14:40, break and lunch)`);

  // ── Attendance codes ──────────────────────────────────────────────────────
  for (const a of ATTENDANCE_CODES) {
    await prisma.attendanceStatusConfig.upsert({
      where: { organizationId_code: { organizationId: O, code: a.code } },
      update: { label: a.label, isPresent: a.isPresent, isLate: a.isLate, isAbsent: a.isAbsent, isExcused: a.isExcused, sortOrder: a.order },
      create: {
        organizationId: O,
        code: a.code,
        label: a.label,
        isPresent: a.isPresent,
        isLate: a.isLate,
        isAbsent: a.isAbsent,
        isExcused: a.isExcused,
        sortOrder: a.order,
      },
    });
  }
  log(`attendance codes: ${ATTENDANCE_CODES.map((a) => a.code).join(' ')}`);

  // ── Grading scales ────────────────────────────────────────────────────────
  // Taken from the application's own `defaultBands`, so what the demo prints is
  // what the grader computes. PLE is the school default; ECD serves nursery and
  // reports descriptors with no GPA, aggregate or position.
  const scaleSeeds = [
    { name: 'PLE (Primary Leaving Examination)', system: 'PLE', isDefault: true },
    { name: 'Nursery descriptors (ECD)', system: 'ECD', isDefault: false },
  ];
  const scales = new Map<string, string>();
  for (const sc of scaleSeeds) {
    const existing = await prisma.gradingScale.findFirst({
      where: { organizationId: O, name: sc.name },
    });
    const bands = defaultBands(sc.system);
    const row = existing
      ? await prisma.gradingScale.update({
          where: { id: existing.id },
          data: { bands: bands as object, system: sc.system, isDefault: sc.isDefault },
        })
      : await prisma.gradingScale.create({
          data: {
            organizationId: O,
            name: sc.name,
            bands: bands as object,
            system: sc.system,
            isDefault: sc.isDefault,
            bandRounding: 'half_up_integer',
          },
        });
    scales.set(sc.system, row.id);
  }
  ok(`grading scales: PLE (default) + ECD descriptors`);

  // ── Assessment policies ───────────────────────────────────────────────────
  // Continuous assessment 40% / end-of-term examination 60% — the usual Ugandan
  // split. Nursery carries a policy too, so the screens behave, but its
  // reporting is descriptor-only.
  const policySeeds = [
    { code: 'ECD', name: 'Nursery — developmental', programme: 'ECD', ca: 100, exam: 0, passMark: 0 },
    { code: 'LOWER', name: 'Lower Primary — 40% CA / 60% exam', programme: 'LOWER_PRIMARY', ca: 40, exam: 60, passMark: 50 },
    { code: 'UPPER', name: 'Upper Primary — 40% CA / 60% exam', programme: 'UPPER_PRIMARY', ca: 40, exam: 60, passMark: 50 },
  ];
  const policies = new Map<string, { id: string; caId: string; examId: string | null }>();
  for (const p of policySeeds) {
    const existing = await prisma.assessmentPolicy.findFirst({
      where: { organizationId: O, name: p.name },
    });
    const policy = existing
      ? await prisma.assessmentPolicy.update({
          where: { id: existing.id },
          data: { programmeId: programmes.get(p.programme) ?? null, passMark: D(p.passMark) },
        })
      : await prisma.assessmentPolicy.create({
          data: {
            organizationId: O,
            name: p.name,
            programmeId: programmes.get(p.programme) ?? null,
            passMark: D(p.passMark),
            roundingMode: 'half_up',
            decimalPlaces: 2,
            rankingPolicy: { rankOn: 'meanPercent', tie: 'higher_grade_first' },
            aggregationPolicy: { ca: 'mean', exam: 'mean' },
          },
        });

    const upsertComponent = async (name: string, kind: 'cat' | 'exam', weight: number) => {
      const found = await prisma.assessmentComponent.findFirst({
        where: { organizationId: O, policyId: policy.id, name },
      });
      if (found) {
        return prisma.assessmentComponent.update({
          where: { id: found.id },
          data: { weight: D(weight), kind, aggregation: 'mean' },
        });
      }
      return prisma.assessmentComponent.create({
        data: { organizationId: O, policyId: policy.id, name, kind, weight: D(weight), aggregation: 'mean' },
      });
    };

    const ca = await upsertComponent('Continuous Assessment', 'cat', p.ca);
    const exam = p.exam > 0 ? await upsertComponent('End of Term Examination', 'exam', p.exam) : null;
    policies.set(p.code, { id: policy.id, caId: ca.id, examId: exam?.id ?? null });
  }
  ok('assessment policies: nursery developmental, primary 40/60');

  return { programmes, departments, subjects, periods, scales, policies, categories };
}

export type Reference = Awaited<ReturnType<typeof seedReference>>;
