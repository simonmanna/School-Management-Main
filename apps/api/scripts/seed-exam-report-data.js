/* Seed realistic exams + assessments + marks, then it's ready for report cards.
 * Run: node scripts/seed-exam-report-data.js   (from apps/api)
 */
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const rng = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
function gradeFor(m) {
  if (m >= 80) return { g: 'A', p: 1 };
  if (m >= 70) return { g: 'B', p: 2 };
  if (m >= 60) return { g: 'C', p: 3 };
  if (m >= 50) return { g: 'D', p: 4 };
  if (m >= 40) return { g: 'E', p: 5 };
  return { g: 'F', p: 6 };
}

async function main() {
  // Tenant = first Term's organization (consistent across tables).
  const term = await prisma.term.findFirst({ where: { isCurrent: true } });
  const useTerm = term || (await prisma.term.findFirst({ orderBy: { startDate: 'desc' } }));
  if (!useTerm) throw new Error('No Term found');
  const orgId = useTerm.organizationId;
  console.log(`Org=${orgId} Term=${useTerm.name} (${useTerm.id})`);

  const actor = await prisma.user.findFirst({ where: { organizationId: orgId } });
  const actorId = actor?.id || '00000000-0000-0000-0000-000000000000';

  // 1) Exam types
  const types = [
    { name: 'CAT 1', weight: 10 },
    { name: 'CAT 2', weight: 15 },
    { name: 'Midterm', weight: 25 },
    { name: 'End of Term', weight: 50, isFinal: true },
  ];
  const typeRows = [];
  for (const t of types) {
    typeRows.push(
      await prisma.examType.upsert({
        where: { organizationId_name: { organizationId: orgId, name: t.name } },
        create: { organizationId: orgId, name: t.name, weight: t.weight, isFinal: !!t.isFinal },
        update: { weight: t.weight, isFinal: !!t.isFinal },
      }),
    );
  }
  console.log('Exam types:', typeRows.map((t) => t.name).join(', '));

  // 2) Classes + Subjects
  const classes = await prisma.schoolClass.findMany({ where: { organizationId: orgId } });
  const subjects = await prisma.subject.findMany({ where: { organizationId: orgId } });
  const SUBJECTS_PER_CLASS = 8;
  console.log(`Classes=${classes.length} Subjects=${subjects.length}`);

  // 3) Exams + Schedules (one exam per type, covering each class's subjects)
  let schedCount = 0;
  const classSubjects = {}; // classId -> [subjectId]
  for (const c of classes) {
    classSubjects[c.id] = subjects.slice(0, SUBJECTS_PER_CLASS).map((s) => s.id);
  }
  for (const t of typeRows) {
    const exam = await prisma.exam.create({
      data: {
        organizationId: orgId,
        termId: useTerm.id,
        examTypeId: t.id,
        name: `${useTerm.name} - ${t.name}`,
        startDate: useTerm.startDate,
        endDate: useTerm.endDate,
        status: 'published',
      },
    });
    for (const c of classes) {
      for (const subjId of classSubjects[c.id]) {
        await prisma.examSchedule.upsert({
          where: { examId_classId_subjectId: { examId: exam.id, classId: c.id, subjectId: subjId } },
          create: {
            organizationId: orgId,
            examId: exam.id,
            classId: c.id,
            subjectId: subjId,
            date: useTerm.startDate,
            startTime: '09:00',
            durationMinutes: 120,
            maxMarks: 100,
          },
          update: {},
        });
        schedCount++;
      }
    }
  }
  console.log(`Exam schedules created/ensured: ${schedCount}`);

  // 4) Grade entries per student (ability ~ per student, noise per exam)
  const students = await prisma.studentProfile.findMany({
    where: { organizationId: orgId, currentClassId: { not: null }, deletedAt: null },
  });
  console.log(`Students with a class: ${students.length}`);

  let entryCount = 0;
  for (const stu of students) {
    const ability = rng(45, 88); // student baseline
    const schedules = await prisma.examSchedule.findMany({
      where: { classId: stu.currentClassId, organizationId: orgId },
    });
    for (const sch of schedules) {
      const marks = Math.max(20, Math.min(99, ability + rng(-12, 12)));
      const { g, p } = gradeFor(marks);
      await prisma.gradeEntry.upsert({
        where: { examScheduleId_studentProfileId: { examScheduleId: sch.id, studentProfileId: stu.id } },
        create: {
          organizationId: orgId,
          examScheduleId: sch.id,
          studentProfileId: stu.id,
          marksObtained: marks,
          maxMarks: 100,
          grade: g,
          gradePoint: p,
          status: 'approved',
          enteredById: actorId,
          enteredAt: new Date(),
          approvedById: actorId,
          approvedAt: new Date(),
        },
        update: {
          marksObtained: marks,
          maxMarks: 100,
          grade: g,
          gradePoint: p,
          status: 'approved',
          enteredAt: new Date(),
          approvedAt: new Date(),
        },
      });
      entryCount++;
    }
  }
  console.log(`Grade entries created/ensured: ${entryCount}`);
  console.log('SEED DONE');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
