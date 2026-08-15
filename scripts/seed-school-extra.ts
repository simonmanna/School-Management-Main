/**
 * scripts/seed-school-extra.ts — Supplementary school demo data for SUNRISE.
 *
 * The base seed (scripts/seed-school.ts) populates org, campuses, academic year,
 * terms, subjects, grade levels, classes, sections, staff, students, fee
 * structures, meals and some attendance. This script fills the remaining
 * gaps so EVERY school screen has demo data to test:
 *   - Timetable slots (per class/section, all periods × weekdays)
 *   - Exam types, Exams, Exam schedules, and Grade entries (per student)
 *
 * Idempotent: skips any section that already has timetable slots, and any
 * exam that already exists for a term, so re-running is safe.
 *
 * Usage:
 *   pnpm --filter @erp/api exec tsx scripts/seed-school-extra.ts
 *   (DATABASE_URL must point at schooldb-planet; NODE_ENV must not be 'production')
 */
import { PrismaClient } from '@prisma/client';

const ORG_ID = process.env.SEED_ORG_ID ?? 'org_sunrise_academy';

function seedDatabaseUrl(): string | undefined {
  const url = process.env.DATABASE_URL;
  if (!url) return undefined;
  return url.includes('connection_limit=') ? url : `${url}${url.includes('?') ? '&' : '?'}connection_limit=1`;
}

const prisma = seedDatabaseUrl()
  ? new PrismaClient({ datasources: { db: { url: seedDatabaseUrl() } } })
  : new PrismaClient();

const DAYS = [1, 2, 3, 4, 5]; // Mon–Fri
const GRADE_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];

function gradeFromMarks(marks: number, max: number): { grade: string; point: number; remark: string } {
  const pct = (marks / max) * 100;
  if (pct >= 80) return { grade: 'A', point: 4.0, remark: 'Distinction' };
  if (pct >= 75) return { grade: 'B', point: 3.5, remark: 'Excellent' };
  if (pct >= 70) return { grade: 'C', point: 3.0, remark: 'Very Good' };
  if (pct >= 65) return { grade: 'D', point: 2.5, remark: 'Good' };
  if (pct >= 50) return { grade: 'E', point: 1.0, remark: 'Pass' };
  return { grade: 'F', point: 0.0, remark: 'Fail' };
}

async function ensureExamTypes() {
  const defs = [
    { name: 'CAT 1', weight: 10, isFinal: false },
    { name: 'Midterm', weight: 30, isFinal: false },
    { name: 'End of Term', weight: 60, isFinal: true },
  ];
  const out: Record<string, string> = {};
  for (const d of defs) {
    const row = await prisma.examType.upsert({
      where: { organizationId_name: { organizationId: ORG_ID, name: d.name } },
      create: { organizationId: ORG_ID, ...d },
      update: {},
    });
    out[d.name] = row.id;
  }
  return out;
}

async function ensurePeriods() {
  const existing = await prisma.period.count({ where: { organizationId: ORG_ID } });
  if (existing > 0) return existing;
  const defs = [
    { name: 'Period 1', startTime: '08:00', endTime: '08:45', order: 1 },
    { name: 'Period 2', startTime: '08:50', endTime: '09:35', order: 2 },
    { name: 'Period 3', startTime: '09:40', endTime: '10:25', order: 3 },
    { name: 'Period 4', startTime: '10:45', endTime: '11:30', order: 4 },
    { name: 'Period 5', startTime: '11:35', endTime: '12:20', order: 5 },
    { name: 'Period 6', startTime: '13:30', endTime: '14:15', order: 6 },
    { name: 'Period 7', startTime: '14:20', endTime: '15:05', order: 7 },
  ];
  for (const d of defs) {
    await prisma.period.create({ data: { organizationId: ORG_ID, ...d } });
  }
  return defs.length;
}

async function ensureTimetable() {
  // For every class+section that has no slots yet, build a weekly grid.
  const classes = await prisma.schoolClass.findMany({
    where: { organizationId: ORG_ID },
    include: { sections: true },
  });
  const periods = await prisma.period.findMany({ where: { organizationId: ORG_ID }, orderBy: { order: 'asc' } });
  const subjects = await prisma.subject.findMany({ where: { organizationId: ORG_ID } });
  const teachers = await prisma.staffProfile.findMany({
    where: { organizationId: ORG_ID, staffCategory: 'teaching' },
    take: 50,
  });
  const teacherPool = teachers.length
    ? teachers
    : await prisma.staffProfile.findMany({ where: { organizationId: ORG_ID }, take: 50 });

  if (periods.length === 0 || subjects.length === 0) {
    console.log('⚠ Skipping timetable: no periods/subjects found.');
    return 0;
  }

  let created = 0;
  for (const cls of classes) {
    const sections = cls.sections.length ? cls.sections : [null];
    for (const section of sections) {
      const sectionId = section ? section.id : null;
      const existing = await prisma.timetableSlot.count({
        where: { organizationId: ORG_ID, classId: cls.id, sectionId },
      });
      if (existing > 0) continue;

      let si = 0;
      for (const day of DAYS) {
        for (const period of periods) {
          const subject = subjects[si % subjects.length];
          const teacher = teacherPool[si % teacherPool.length];
          await prisma.timetableSlot.create({
            data: {
              organizationId: ORG_ID,
              classId: cls.id,
              sectionId,
              dayOfWeek: day,
              periodId: period.id,
              subjectId: subject.id,
              teacherPartnerId: teacher?.id ?? null,
              room: `R${((si % 12) + 1).toString().padStart(2, '0')}`,
            },
          });
          created++;
          si++;
        }
      }
    }
  }
  return created;
}

async function ensureExams(examTypeIds: Record<string, string>) {
  const terms = await prisma.term.findMany({ where: { organizationId: ORG_ID, isCurrent: true } });
  const classes = await prisma.schoolClass.findMany({
    where: { organizationId: ORG_ID },
    include: { sections: true },
  });
  const subjects = await prisma.subject.findMany({ where: { organizationId: ORG_ID } });
  const students = await prisma.studentProfile.findMany({ where: { organizationId: ORG_ID } });

  if (terms.length === 0 || classes.length === 0 || subjects.length === 0) {
    console.log('⚠ Skipping exams: missing terms/classes/subjects.');
    return;
  }

  let examCount = 0;
  let scheduleCount = 0;
  let gradeCount = 0;

  for (const term of terms) {
    for (const [typeName, typeId] of Object.entries(examTypeIds)) {
      const examName = `${typeName} - ${term.name}`;
      let exam = await prisma.exam.findFirst({
        where: { organizationId: ORG_ID, name: examName, termId: term.id },
      });
      if (!exam) {
        exam = await prisma.exam.create({
          data: {
            organizationId: ORG_ID,
            termId: term.id,
            examTypeId: typeId,
            name: examName,
            startDate: term.startDate,
            endDate: term.endDate,
            classes: JSON.stringify(classes.map((c) => c.id)),
            status: 'published',
          },
        });
        examCount++;
      }

      for (const cls of classes) {
        const classStudents = students.filter(
          (s) => s.currentClassId === cls.id || (cls.sections.length && cls.sections.some((sec) => sec.id === s.currentSectionId)),
        );
        // Cap roster to a realistic demo size for performance.
        const roster = (classStudents.length ? classStudents : students).slice(0, 30);

        for (const subject of subjects) {
          const existingSched = await prisma.examSchedule.findFirst({
            where: { organizationId: ORG_ID, examId: exam.id, classId: cls.id, subjectId: subject.id },
          });
          if (existingSched) continue;

          const sched = await prisma.examSchedule.create({
            data: {
              organizationId: ORG_ID,
              examId: exam.id,
              classId: cls.id,
              subjectId: subject.id,
              date: term.startDate,
              startTime: '09:00',
              durationMinutes: 60,
              maxMarks: 100,
            },
          });
          scheduleCount++;

          for (const stu of roster) {
            const max = 100;
            const marks = Math.floor(40 + Math.random() * 60); // 40–100
            const g = gradeFromMarks(marks, max);
            await prisma.gradeEntry.create({
              data: {
                organizationId: ORG_ID,
                examScheduleId: sched.id,
                studentProfileId: stu.id,
                marksObtained: marks,
                maxMarks: max,
                grade: g.grade,
                gradePoint: g.point,
                remarks: g.remark,
                status: 'approved',
                enteredAt: new Date(),
                approvedAt: new Date(),
              },
            });
            gradeCount++;
          }
        }
      }
    }
  }

  console.log(`   - Exams: ${examCount}, Schedules: ${scheduleCount}, Grade entries: ${gradeCount}`);
}

async function ensureMeals() {
  const ay = await prisma.academicYear.findFirst({ where: { organizationId: ORG_ID } });
  const term = await prisma.term.findFirst({ where: { organizationId: ORG_ID, isCurrent: true } });
  const students = await prisma.studentProfile.findMany({ where: { organizationId: ORG_ID }, take: 60 });
  if (!ay || !term) {
    console.log('⚠ Skipping meals: no academic year/term.');
    return;
  }

  // Meal types (Breakfast, Lunch, Dinner, Snack)
  const mealTypes: Record<string, string> = {};
  for (const [name, start, end] of [
    ['Breakfast', '07:30', '08:00'],
    ['Lunch', '12:30', '13:30'],
    ['Dinner', '18:00', '19:00'],
    ['Snack', '15:30', '16:00'],
  ] as [string, string, string][]) {
    const mt = await prisma.mealType.upsert({
      where: { organizationId_name: { organizationId: ORG_ID, name } },
      create: { organizationId: ORG_ID, name, startTime: start, endTime: end, order: Object.keys(mealTypes).length + 1 },
      update: {},
    });
    mealTypes[name] = mt.id;
  }

  // Meal programs (Day, Day+Boarding, Custom)
  const programs: Record<string, string> = {};
  for (const [name, kind] of [
    ['Day School', 'day'],
    ['Day + Boarding', 'day_boarding'],
    ['Custom', 'custom'],
  ] as [string, string][]) {
    const p = await prisma.mealProgram.upsert({
      where: { organizationId_name: { organizationId: ORG_ID, name } },
      create: { organizationId: ORG_ID, name, kind },
      update: {},
    });
    programs[name] = p.id;
  }

  // Meal plans per program
  const planDefs = [
    { name: 'Day Full Board', program: 'Day School', type: 'full', price: 800_000 },
    { name: 'Day Lunch Only', program: 'Day School', type: 'lunch_only', price: 400_000 },
    { name: 'Boarding Full', program: 'Day + Boarding', type: 'full', price: 1_200_000 },
    { name: 'Custom Half', program: 'Custom', type: 'half', price: 600_000 },
  ];
  const plans: Record<string, string> = {};
  for (const d of planDefs) {
    const plan = await prisma.mealPlan.upsert({
      where: { organizationId_name: { organizationId: ORG_ID, name: d.name } },
      create: {
        organizationId: ORG_ID,
        mealProgramId: programs[d.program],
        name: d.name,
        type: d.type,
        pricePerTerm: d.price,
        billingModel: 'term_plan',
        fundingModel: 'parent_funded',
        isActive: true,
      },
      update: {},
    });
    plans[d.name] = plan.id;

    // Entitlements: link all meal types to each plan
    for (const mtId of Object.values(mealTypes)) {
      await prisma.mealPlanEntitlement.upsert({
        where: { organizationId_mealPlanId_mealTypeId: { organizationId: ORG_ID, mealPlanId: plan.id, mealTypeId: mtId } },
        create: { organizationId: ORG_ID, mealPlanId: plan.id, mealTypeId: mtId },
        update: {},
      });
    }
  }

  // Assign first 30 students to the Boarding Full plan for the current term
  let assigned = 0;
  for (const stu of students.slice(0, 30)) {
    const existing = await prisma.mealPlanAssignment.findFirst({
      where: { organizationId: ORG_ID, studentProfileId: stu.id, termId: term.id, status: 'active' },
    });
    if (existing) continue;
    await prisma.mealPlanAssignment.create({
      data: {
        organizationId: ORG_ID,
        studentProfileId: stu.id,
        mealPlanId: plans['Boarding Full'],
        termId: term.id,
        startDate: term.startDate,
        status: 'active',
      },
    });
    assigned++;
  }

  // A few meal sessions + attendance so the Meals screen has live data
  const sessions = [];
  for (let d = 0; d < 3; d++) {
    const date = new Date(term.startDate);
    date.setDate(date.getDate() + d);
    for (const mtId of Object.values(mealTypes).slice(0, 2)) {
      const existing = await prisma.mealSession.findFirst({
        where: { organizationId: ORG_ID, date, mealTypeId: mtId },
      });
      if (existing) {
        sessions.push(existing);
        continue;
      }
      const sess = await prisma.mealSession.create({
        data: { organizationId: ORG_ID, mealTypeId: mtId, date, expectedCount: students.length, servedCount: 0, status: 'open' },
      });
      sessions.push(sess);
    }
  }

  console.log(`   - Meal types: ${Object.keys(mealTypes).length}, Programs: ${Object.keys(programs).length}, Plans: ${Object.keys(plans).length}, Assignments: ${assigned}, Sessions: ${sessions.length}`);
}

async function ensureAdmissions() {
  const ay = await prisma.academicYear.findFirst({ where: { organizationId: ORG_ID } });
  const classes = await prisma.schoolClass.findMany({ where: { organizationId: ORG_ID }, take: 13 });
  if (!ay || classes.length === 0) {
    console.log('⚠ Skipping admissions: no academic year/classes.');
    return;
  }
  const firstNames = ['Alice', 'Bob', 'Carol', 'David', 'Emma', 'Frank', 'Grace', 'Henry', 'Ivy', 'Jack', 'Katie', 'Leo', 'Mia', 'Noah', 'Olivia', 'Paul', 'Quinn', 'Ruth', 'Sam', 'Tina'];
  const lastNames = ['Okello', 'Nakato', 'Ssebugwawo', 'Kizza', 'Nabukenya', 'Muwanga', 'Auma', 'Kato', 'Nakimuli', 'Sserwadda', 'Nanjala', 'Ouma', 'Kemigisha', 'Mugisha', 'Nabwire', 'Tumusiime', 'Akello', 'Nambi', 'Kasozi', 'Nakigozi'];
  const statuses = ['submitted', 'under_review', 'accepted', 'enrolled', 'rejected'] as const;

  const existing = await prisma.admissionApplication.count({ where: { organizationId: ORG_ID } });
  if (existing > 0) {
    console.log(`   - Admissions already present (${existing}), skipping.`);
    return;
  }

  let n = 0;
  for (let i = 0; i < 20; i++) {
    const first = firstNames[i % firstNames.length];
    const last = lastNames[i % lastNames.length];
    const status = statuses[i % statuses.length];
    const app = await prisma.admissionApplication.create({
      data: {
        organizationId: ORG_ID,
        academicYearId: ay.id,
        applicationNumber: `APP-${String(1000 + i)}`,
        applicantFirstName: first,
        applicantLastName: last,
        applicantDob: new Date(2012 + (i % 6), (i % 12), ((i * 3) % 28) + 1),
        applicantGender: i % 2 === 0 ? 'male' : 'female',
        applyingForClassId: classes[i % classes.length].id,
        status,
        submittedAt: new Date(),
      },
    });
    n++;
    void app;
  }
  console.log(`   - Admission applications created: ${n}`);
}

async function ensureFeeStructures() {
  const ay = await prisma.academicYear.findFirst({ where: { organizationId: ORG_ID } });
  const term = await prisma.term.findFirst({ where: { organizationId: ORG_ID, isCurrent: true } });
  const tuition = await prisma.product.upsert({
    where: { organizationId_code: { organizationId: ORG_ID, code: 'TUITION' } },
    create: { organizationId: ORG_ID, code: 'TUITION', name: 'Tuition Fee', productType: 'service', salesPrice: 1_500_000 },
    update: {},
  });
  const transport = await prisma.product.upsert({
    where: { organizationId_code: { organizationId: ORG_ID, code: 'TRANSPORT' } },
    create: { organizationId: ORG_ID, code: 'TRANSPORT', name: 'Transport Fee', productType: 'service', salesPrice: 300_000 },
    update: {},
  });

  const existing = await prisma.feeStructure.count({ where: { organizationId: ORG_ID } });
  if (existing > 0) {
    console.log(`   - Fee structures already present (${existing}), skipping.`);
    return;
  }
  if (!ay || !term) {
    console.log('⚠ Skipping fee structures: no academic year/term.');
    return;
  }

  const fs = await prisma.feeStructure.create({
    data: {
      organizationId: ORG_ID,
      name: '2026 Standard Fees',
      academicYearId: ay.id,
      components: JSON.stringify([
        { code: 'TUITION', productId: tuition.id, amount: 1_500_000, isOptional: false },
        { code: 'TRANSPORT', productId: transport.id, amount: 300_000, isOptional: true },
      ]),
      applicableTo: JSON.stringify({}),
      isActive: true,
    },
  });
  await prisma.feeSchedule.upsert({
    where: { organizationId_name: { organizationId: ORG_ID, name: `Term 1 - ${fs.name}` } },
    create: { organizationId: ORG_ID, feeStructureId: fs.id, termId: term.id, dueDate: term.startDate, name: `Term 1 - ${fs.name}` },
    update: {},
  });
  console.log(`   - Fee structures created: 1 (${fs.name})`);
}

async function ensureTeacherAssignments() {
  const classes = await prisma.schoolClass.findMany({
    where: { organizationId: ORG_ID },
    include: { sections: true },
  });
  const subjects = await prisma.subject.findMany({ where: { organizationId: ORG_ID } });
  const teachers = await prisma.staffProfile.findMany({
    where: { organizationId: ORG_ID, staffCategory: 'teaching' },
    take: 50,
  });
  const term = await prisma.term.findFirst({ where: { organizationId: ORG_ID, isCurrent: true } });
  if (classes.length === 0 || subjects.length === 0 || teachers.length === 0 || !term) {
    console.log('⚠ Skipping teacher assignments: missing classes/subjects/teachers/term.');
    return;
  }

  let n = 0;
  for (const cls of classes) {
    const sections = cls.sections.length ? cls.sections : [null];
    for (const sec of sections) {
      for (let si = 0; si < subjects.length; si++) {
        const subject = subjects[si];
        const teacher = teachers[(si + n) % teachers.length];
        const existing = await prisma.teacherAssignment.findFirst({
          where: {
            organizationId: ORG_ID,
            teacherPartnerId: teacher.id,
            subjectId: subject.id,
            classId: cls.id,
            sectionId: sec?.id ?? null,
            termId: term.id,
          },
        });
        if (existing) continue;
        await prisma.teacherAssignment.create({
          data: {
            organizationId: ORG_ID,
            teacherPartnerId: teacher.id,
            subjectId: subject.id,
            classId: cls.id,
            sectionId: sec?.id ?? null,
            termId: term.id,
            periodsPerWeek: 3 + (si % 3),
          },
        });
        n++;
      }
    }
  }
  console.log(`   - Teacher assignments created: ${n}`);
}

async function ensureAttendance() {
  const term = await prisma.term.findFirst({ where: { organizationId: ORG_ID, isCurrent: true } });
  const students = await prisma.studentProfile.findMany({ where: { organizationId: ORG_ID } });
  const aTeacher = await prisma.staffProfile.findFirst({ where: { organizationId: ORG_ID, staffCategory: 'teaching' } });
  if (!term || students.length === 0) {
    console.log('⚠ Skipping attendance: no term/students.');
    return;
  }

  const existing = await prisma.studentAttendance.count({ where: { organizationId: ORG_ID } });
  if (existing > 500) {
    console.log(`   - Attendance already populated (${existing}), skipping.`);
    return;
  }

  // Build ~40 school days across the current term (Mon–Fri).
  const days: Date[] = [];
  const start = new Date(term.startDate);
  let d = new Date(start);
  while (days.length < 40 && d <= new Date(term.endDate)) {
    const dow = d.getDay();
    if (dow >= 1 && dow <= 5) days.push(new Date(d));
    d.setDate(d.getDate() + 1);
  }

  const STATUSES = ['present', 'present', 'present', 'present', 'present', 'present', 'present', 'late', 'absent', 'excused'];
  let n = 0;
  for (const day of days) {
    // Group students by class for bulk inserts.
    const byClass = new Map<string, typeof students>();
    for (const s of students) {
      const cid = s.currentClassId;
      if (!cid) continue;
      if (!byClass.has(cid)) byClass.set(cid, []);
      byClass.get(cid)!.push(s);
    }
    for (const [classId, roster] of byClass) {
      const data = roster.map((s) => {
        const status = STATUSES[Math.floor(Math.random() * STATUSES.length)];
        return {
          organizationId: ORG_ID,
          studentProfileId: s.id,
          classId,
          sectionId: s.currentSectionId,
          date: day,
          status,
          minutesLate: status === 'late' ? 5 + Math.floor(Math.random() * 20) : 0,
          reason: status === 'absent' ? 'Sick / family' : status === 'excused' ? 'Medical appointment' : null,
          markedById: aTeacher?.id ?? null,
          markedAt: new Date(),
        };
      });
      await prisma.studentAttendance.createMany({ data });
      n += data.length;
    }
  }
  console.log(`   - Attendance records created: ${n} (${days.length} school days × ${students.length} students)`);
}

async function main() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to seed: NODE_ENV=production.');
  }
  await prisma.$executeRawUnsafe(`SELECT set_config('app.org_id', $1, false)`, ORG_ID);

  console.log('Seeding supplementary school demo data for SUNRISE…');
  const periods = await ensurePeriods();
  console.log(`   - Periods ensured: ${periods}`);
  const timetable = await ensureTimetable();
  console.log(`   - Timetable slots created: ${timetable}`);
  const examTypes = await ensureExamTypes();
  await ensureExams(examTypes);
  await ensureMeals();
  await ensureAdmissions();
  await ensureFeeStructures();
  await ensureTeacherAssignments();
  await ensureAttendance();
  console.log('✅ Supplementary seed complete.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
