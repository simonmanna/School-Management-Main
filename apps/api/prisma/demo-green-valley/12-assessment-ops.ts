/**
 * Demo stage 12 — teaching and assessment as the staff room actually runs it.
 *
 * Earlier stages put the marks in. This stage adds the people and the paper
 * trail around them, which is what a head teacher or inspector asks to see:
 *
 *  - every teacher has a login, so marks show who entered and submitted them,
 *    who approved them, and each mark has an entry record;
 *  - question papers for every sitting, with a hash-chained custody log from
 *    setting to the strongroom to the exam room and back;
 *  - Mid Term scripts allocated to the stream's subject teacher for marking;
 *  - moderation samples on the Beginning-of-Term and Mock papers;
 *  - exam-room incidents and special arrangements (extra time for SNE pupils);
 *  - the 2025 → 2026 promotion decisions, repeaters included;
 *  - merit certificates for Term II's top three per class, and nursery
 *    completion certificates for last year's Top Class.
 *
 * Idempotent: guarded by natural keys or by "only when none exist".
 */
import { createHash } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { D, SCHOOL, addDays, createManyChunked, log, mondayOf, ok, pick, rng, type School } from './shared';
import { coreSubjectsFor } from './01-reference';
import type { DemoStaff, People } from './02-people';
import type { Enrollment } from './03-enrollment';
import type { Teaching } from './04-teaching';
import type { Assessment } from './05-assessment';
import type { Curriculum } from './09-curriculum';

const PRIMARY = ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7'];
const ordinal = (n: number) => ['1st', '2nd', '3rd'][n - 1] ?? `${n}th`;

/** The custody chain hash, exactly as QuestionPaperCustodyService computes it. */
function custodyHash(previous: string, e: { action: string; occurredAt: Date; custodianId?: string | null; custodianName?: string | null; sealNumber?: string | null; copies?: number | null; location?: string | null }) {
  return createHash('sha256')
    .update(`${previous}|${e.action}|${e.occurredAt.toISOString()}|${e.custodianId ?? ''}|${e.custodianName ?? ''}|${e.sealNumber ?? ''}|${e.copies ?? ''}|${e.location ?? ''}`)
    .digest('hex');
}

export async function seedAssessmentOps(
  prisma: PrismaClient,
  s: School,
  people: People,
  enrol: Enrollment,
  teaching: Teaching,
  assessment: Assessment,
  curriculum: Curriculum,
) {
  const { O } = s;
  const live = teaching.liveTerm;
  const subjects = await prisma.subject.findMany({ where: { organizationId: O }, select: { id: true, code: true, name: true } });
  const subjectById = new Map(subjects.map((x) => [x.id, x]));
  const classCodeById = new Map([...s.classes.values()].map((c) => [c.id, c.code ?? '']));

  // ── Every teacher signs in ────────────────────────────────────────────────
  const staffHash = await bcrypt.hash(people.passwords.staff, 10);
  const teachers: Array<{ st: DemoStaff; role: string }> = [
    ...people.subjectTeachers.map((st) => ({ st, role: 'Subject Teacher' })),
    ...[...people.classTeachers.values()].map((st) => ({ st, role: 'Class Teacher' })),
  ];
  const userByStaff = new Map<string, string>();
  const staffRows = await prisma.staffProfile.findMany({ where: { organizationId: O }, select: { id: true, partnerId: true, employeeNo: true } });
  const staffByPartner = new Map(staffRows.map((r) => [r.partnerId, r]));
  for (const hr of await prisma.hrEmployee.findMany({ where: { organizationId: O, userId: { not: null } }, select: { userId: true, partnerId: true } })) {
    const st = hr.partnerId ? staffByPartner.get(hr.partnerId) : undefined;
    if (st && hr.userId) userByStaff.set(st.id, hr.userId);
  }
  let newLogins = 0;
  for (const { st, role } of teachers) {
    if (userByStaff.has(st.id)) continue;
    const [first, ...rest] = st.name.split(' ');
    const user = await prisma.user.upsert({
      where: { organizationId_email: { organizationId: O, email: st.email } },
      update: { isActive: true },
      create: { organizationId: O, email: st.email, passwordHash: staffHash, firstName: first, lastName: rest.join(' '), isActive: true },
    });
    const roleId = people.roleIds.get(role);
    if (roleId) await prisma.user.update({ where: { id: user.id }, data: { roles: { set: [{ id: roleId }] } } });
    const employeeNo = staffByPartner.get(st.partnerId)?.employeeNo ?? st.id;
    const hr = await prisma.hrEmployee.findFirst({ where: { organizationId: O, employeeCode: employeeNo } });
    if (hr) await prisma.hrEmployee.update({ where: { id: hr.id }, data: { userId: user.id, partnerId: st.partnerId } });
    else await prisma.hrEmployee.create({
      data: { organizationId: O, employeeCode: employeeNo, userId: user.id, partnerId: st.partnerId, firstName: first, lastName: rest.join(' '), email: st.email, employmentType: 'FULL_TIME', hireDate: new Date('2023-01-09') },
    });
    userByStaff.set(st.id, user.id);
    newLogins += 1;
  }
  const dos = people.leadership.find((l) => l.role === 'Director of Studies') ?? people.leadership[0];
  const head = people.leadership[0];
  const dosUser = userByStaff.get(dos.id) ?? null;
  const headUser = userByStaff.get(head.id) ?? null;
  log(`teacher logins: ${newLogins} new — every teacher signs in (${people.passwords.staff})`);

  // ── Who entered, submitted and approved each mark ─────────────────────────
  const offeringTeacher = new Map(teaching.offerings.map((o) => [o.id, o.teacher.id]));
  const assessments = await prisma.assessment.findMany({
    where: { organizationId: O },
    select: { id: true, courseOfferingId: true, sourceType: true, sourceRef: true, classId: true, subjectId: true },
  });
  const sectionCodeById = new Map([...s.sections.entries()].map(([k, v]) => [v.id, k.split(':')[1]]));
  let attributed = 0;
  for (const a of assessments) {
    if (a.courseOfferingId) {
      const teacher = userByStaff.get(offeringTeacher.get(a.courseOfferingId) ?? '');
      if (!teacher) continue;
      attributed += (await prisma.studentAssessment.updateMany({ where: { assessmentId: a.id, originalScore: { not: null }, enteredById: null }, data: { enteredById: teacher } })).count;
      await prisma.studentAssessment.updateMany({ where: { assessmentId: a.id, approvalStatus: { in: ['submitted', 'approved'] }, submittedById: null }, data: { submittedById: teacher } });
    } else if (a.sourceType === 'exam_session' && a.classId && a.subjectId) {
      // A class-wide paper: each stream's scripts are marked by that stream's teacher.
      const gradeCode = classCodeById.get(a.classId) ?? '';
      const subjectCode = subjectById.get(a.subjectId)?.code ?? '';
      // The paper's owner — who the approval queue shows as submitting it — is
      // the subject teacher of the class's first stream.
      const owner = teaching.teacherFor(gradeCode, s.sectionsByClassCode(gradeCode)[0]?.code ?? '', subjectCode);
      if (owner) await prisma.assessment.updateMany({ where: { id: a.id, teacherPartnerId: null }, data: { teacherPartnerId: owner.id } });
      for (const sec of s.sectionsByClassCode(gradeCode)) {
        const teacher = userByStaff.get(teaching.teacherFor(gradeCode, sec.code, subjectCode)?.id ?? '');
        if (!teacher) continue;
        attributed += (await prisma.studentAssessment.updateMany({ where: { assessmentId: a.id, sectionId: sec.id, originalScore: { not: null }, enteredById: null }, data: { enteredById: teacher } })).count;
        await prisma.studentAssessment.updateMany({ where: { assessmentId: a.id, sectionId: sec.id, approvalStatus: { in: ['submitted', 'approved'] }, submittedById: null }, data: { submittedById: teacher } });
      }
    }
  }
  if (dosUser) await prisma.studentAssessment.updateMany({ where: { organizationId: O, approvalStatus: 'approved', approvedById: null }, data: { approvedById: dosUser } });

  if ((await prisma.markEntry.count({ where: { organizationId: O } })) === 0) {
    const marked = await prisma.studentAssessment.findMany({
      where: { organizationId: O, originalScore: { not: null } },
      select: { id: true, originalScore: true, enteredById: true, enteredAt: true, submittedAt: true, updatedAt: true },
    });
    await createManyChunked(
      prisma.markEntry as never,
      marked.map((m) => ({
        organizationId: O, studentAssessmentId: m.id, markerId: m.enteredById, round: 'first', score: m.originalScore,
        enteredAt: m.enteredAt ?? m.submittedAt ?? m.updatedAt,
      })) as never[],
      2000,
    );
  }
  log(`marks attributed to their teachers: ${attributed}; approvals by ${dos.name}`);

  // ── Question papers and their custody chain ───────────────────────────────
  const exams = await prisma.exam.findMany({ where: { organizationId: O, termId: live.id }, include: { schedules: true } });
  const asOf = new Date();
  let papers = 0;
  let custody = 0;
  for (const exam of exams) {
    const key = exam.name.startsWith('Beginning') ? 'BOT' : exam.name.includes('Mock') ? 'MOCK' : exam.name.startsWith('Mid') ? 'MOT' : 'EOT';
    for (const sch of exam.schedules) {
      if (await prisma.questionPaper.findFirst({ where: { examScheduleId: sch.id } })) continue;
      const gradeCode = classCodeById.get(sch.classId) ?? '';
      const subject = subjectById.get(sch.subjectId);
      const lower = ['P1', 'P2', 'P3'].includes(gradeCode);
      const streams = s.sectionsByClassCode(gradeCode);
      const setter = teaching.teacherFor(gradeCode, streams[0]?.code ?? '', subject?.code ?? '');
      const sections = lower
        ? [{ section: 'A', questions: 20, marks: 40, style: 'short answer' }, { section: 'B', questions: 6, marks: 60, style: 'structured' }]
        : [{ section: 'A', questions: 40, marks: 40, style: 'short answer' }, { section: 'B', questions: 15, marks: 60, style: 'structured' }];
      const qp = await prisma.questionPaper.create({
        data: {
          organizationId: O, examScheduleId: sch.id, title: `${subject?.name ?? 'Paper'} — ${s.classes.get(gradeCode)?.name ?? gradeCode} — ${exam.name}`,
          paperKind: 'theory', paperNumber: 1, totalMarks: D(100), questions: sections, setterId: setter?.id ?? null, moderatorId: dos.id,
        },
      });
      papers += 1;
      const copies = streams.reduce((n, sec) => n + (assessment.pupilsByStream.get(`${gradeCode}:${sec.code}`)?.length ?? 0), 0) + 5;
      const seal = `${SCHOOL.codePrefix}-${key}-${gradeCode}-${subject?.code ?? 'X'}-${String(rng(`seal:${sch.id}`)() * 9000 + 1000).slice(0, 4)}`;
      const start = exam.startDate;
      const day = sch.date;
      const [hh, mm] = sch.startTime.split(':').map(Number);
      const at = (d: Date, h: number, m: number) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), h - 3, m));
      const steps: Array<{ action: string; occurredAt: Date; custodianId?: string; custodianName?: string; sealNumber?: string; copies?: number; location?: string; note?: string }> = [
        { action: 'authored', occurredAt: at(addDays(start, -14), 15, 0), custodianId: setter?.id, custodianName: setter?.name, location: 'Staff room', note: 'Draft set against the term’s scheme of work.' },
        { action: 'moderated', occurredAt: at(addDays(start, -10), 11, 0), custodianId: dos.id, custodianName: dos.name, location: 'Director of Studies’ office', note: 'Two items reworded; marking guide checked.' },
        { action: 'approved', occurredAt: at(addDays(start, -9), 16, 30), custodianId: dos.id, custodianName: dos.name, location: 'Director of Studies’ office' },
        { action: 'printed', occurredAt: at(addDays(start, -5), 10, 0), custodianId: dos.id, custodianName: dos.name, copies, location: 'School printing room' },
        { action: 'sealed', occurredAt: at(addDays(start, -5), 12, 0), custodianId: dos.id, custodianName: dos.name, sealNumber: seal, copies, location: 'School printing room' },
        { action: 'stored', occurredAt: at(addDays(start, -5), 12, 30), custodianId: head.id, custodianName: head.name, sealNumber: seal, location: 'Strongroom — Head Teacher’s office' },
      ];
      const examEnd = new Date(at(day, hh, mm).getTime() + sch.durationMinutes * 60_000);
      if (examEnd.getTime() < asOf.getTime()) {
        const inv = sch.invigilatorId ? await prisma.invigilator.findFirst({ where: { id: sch.invigilatorId } }) : null;
        steps.push(
          { action: 'opened', occurredAt: at(day, hh, mm - 5), custodianId: inv?.staffId ?? undefined, custodianName: inv?.name, sealNumber: seal, location: gradeCode === 'P7' ? 'Main Hall' : `${s.classes.get(gradeCode)?.name} classrooms`, note: 'Seal intact, opened in front of candidates.' },
          { action: 'distributed', occurredAt: at(day, hh, mm), custodianId: inv?.staffId ?? undefined, custodianName: inv?.name, copies: copies - 5 },
          { action: 'collected', occurredAt: examEnd, custodianId: inv?.staffId ?? undefined, custodianName: inv?.name, copies: copies - 5, note: 'Scripts counted against the register.' },
          { action: 'returned', occurredAt: new Date(examEnd.getTime() + 40 * 60_000), custodianId: dos.id, custodianName: dos.name, location: 'Director of Studies’ office', note: 'Scripts handed over for marking.' },
        );
      }
      let previous = '';
      let previousId: string | null = null;
      for (const st of steps) {
        const chainHash = custodyHash(previous, st);
        const ev: { id: string } = await prisma.questionPaperCustodyEvent.create({
          data: {
            organizationId: O, questionPaperId: qp.id, examScheduleId: sch.id, action: st.action as never, occurredAt: st.occurredAt,
            actorId: dosUser, actorName: dos.name, custodianId: st.custodianId ?? null, custodianName: st.custodianName ?? null,
            sealNumber: st.sealNumber ?? null, copies: st.copies ?? null, location: st.location ?? null, note: st.note ?? null,
            previousEventId: previousId, chainHash,
          },
        });
        previous = chainHash;
        previousId = ev.id;
        custody += 1;
      }
    }
  }
  log(`question papers: ${papers}, custody events: ${custody} (hash-chained)`);

  // ── Mid Term scripts allocated to stream teachers ─────────────────────────
  const mot = exams.find((e) => e.name.startsWith('Mid'));
  let scripts = 0;
  if (mot && (await prisma.scriptAllocation.count({ where: { organizationId: O, examSchedule: { examId: mot.id } } })) === 0) {
    for (const sch of mot.schedules) {
      const gradeCode = classCodeById.get(sch.classId) ?? '';
      if (!['P4', 'P5', 'P6', 'P7'].includes(gradeCode)) continue;
      const subjectCode = subjectById.get(sch.subjectId)?.code ?? '';
      const paper = await prisma.assessment.findFirst({ where: { organizationId: O, sourceType: 'exam_session', sourceRef: sch.id } });
      if (!paper) continue;
      const marks = await prisma.studentAssessment.findMany({ where: { assessmentId: paper.id }, select: { studentProfileId: true, sectionId: true, originalScore: true, participation: true, submittedAt: true } });
      const rows = marks.filter((m) => m.participation !== 'absent').map((m, i) => {
        const streamCode = sectionCodeById.get(m.sectionId ?? '') ?? '';
        const marker = userByStaff.get(teaching.teacherFor(gradeCode, streamCode, subjectCode)?.id ?? '') ?? dosUser!;
        return {
          organizationId: O, examScheduleId: sch.id, studentProfileId: m.studentProfileId,
          anonymousCode: `${gradeCode}${streamCode.slice(0, 1)}-${subjectCode}-${String(i + 1).padStart(4, '0')}`,
          // Single marking: a marked script's first mark is the agreed mark.
          markerId: marker, role: 'first', status: m.originalScore === null ? 'allocated' : 'reconciled', maxScore: D(100),
          score: m.originalScore, allocatedById: dosUser, allocatedAt: addDays(sch.date, 1), submittedAt: m.originalScore === null ? null : addDays(sch.date, 3),
        };
      });
      await createManyChunked(prisma.scriptAllocation as never, rows as never[]);
      scripts += rows.length;
    }
  }
  if (mot) {
    await prisma.scriptAllocation.updateMany({
      where: { organizationId: O, status: 'submitted', score: { not: null }, examSchedule: { examId: mot.id, markingMode: 'single' } },
      data: { status: 'reconciled' },
    });
  }
  log(`Mid Term scripts allocated for marking: ${scripts}`);

  // ── Moderation samples on the papers already closed ───────────────────────
  let samples = 0;
  for (const exam of exams.filter((e) => e.lifecycleState === 'closed' || e.lifecycleState === 'results_ready')) {
    for (const sch of exam.schedules) {
      const gradeCode = classCodeById.get(sch.classId) ?? '';
      if (!['P4', 'P5', 'P6', 'P7'].includes(gradeCode)) continue;
      if (await prisma.moderationSample.findFirst({ where: { examScheduleId: sch.id } })) continue;
      const paper = await prisma.assessment.findFirst({ where: { organizationId: O, sourceType: 'exam_session', sourceRef: sch.id } });
      if (!paper) continue;
      const marks = (await prisma.studentAssessment.findMany({ where: { assessmentId: paper.id, originalScore: { not: null } }, select: { studentProfileId: true, originalScore: true } }))
        .sort((a, b) => Number(a.originalScore) - Number(b.originalScore));
      const size = Math.max(3, Math.round(marks.length * 0.1));
      const pickEvery = Math.max(1, Math.floor(marks.length / size));
      const chosen = marks.filter((_, i) => i % pickEvery === 0).slice(0, size);
      const adjusted = rng(`moderation:${sch.id}`)() < 0.15;
      const items = chosen.map((m, i) => {
        const r = rng(`mod:${sch.id}:${m.studentProfileId}`);
        const delta = adjusted && i % 3 === 0 ? -(6 + Math.floor(r() * 3)) : Math.round((r() - 0.5) * 6);
        const original = Number(m.originalScore);
        return { studentProfileId: m.studentProfileId, original, moderated: Math.max(0, Math.min(100, original + delta)), delta };
      });
      const sample = await prisma.moderationSample.create({
        data: {
          organizationId: O, examScheduleId: sch.id, method: 'stratified', seed: sch.id.slice(0, 8), sampleSize: items.length, toleranceMarks: D(5),
          status: adjusted ? 'adjusted' : 'agreed', drawnById: dosUser, drawnAt: addDays(sch.date, 5), moderatorId: dosUser, reviewedAt: addDays(sch.date, 7),
          outcome: { agreed: items.filter((x) => Math.abs(x.delta) <= 5).length, outside: items.filter((x) => Math.abs(x.delta) > 5).length, meanDelta: +(items.reduce((n, x) => n + x.delta, 0) / items.length).toFixed(2) },
          note: adjusted ? 'Marker generous on Section B; marks adjusted after discussion with the subject teacher.' : 'Marking consistent with the guide.',
        },
      });
      await prisma.moderationSampleItem.createMany({
        data: items.map((x, i) => ({
          organizationId: O, sampleId: sample.id, studentProfileId: x.studentProfileId, anonymousCode: `M-${String(i + 1).padStart(3, '0')}`,
          originalScore: D(x.original), moderatedScore: D(x.moderated), delta: D(x.delta), withinTolerance: Math.abs(x.delta) <= 5,
          comment: Math.abs(x.delta) > 5 ? 'Q42–45 over-credited; apply marking guide strictly.' : null,
        })),
      });
      samples += 1;
    }
  }
  log(`moderation samples: ${samples}`);

  // ── Exam-room incidents and special arrangements ──────────────────────────
  if ((await prisma.examIncident.count({ where: { organizationId: O } })) === 0) {
    const byGrade = (g: string) => people.pupils.filter((p) => p.gradeCode === g);
    const pick = (g: string, n: number) => byGrade(g)[n % Math.max(1, byGrade(g).length)];
    const schedOf = (exam: (typeof exams)[number] | undefined, g: string, subj: string) =>
      exam?.schedules.find((x) => classCodeById.get(x.classId) === g && subjectById.get(x.subjectId)?.code === subj);
    const bot = exams.find((e) => e.name.startsWith('Beginning'));
    const mock = exams.find((e) => e.name.includes('Mock'));
    const incidents = [
      { exam: bot, g: 'P5', subj: 'MTC', type: 'disruption', severity: 'low', status: 'resolved', pupil: null as null | ReturnType<typeof pick>, d: 'Heavy rain on the iron roof — paper started 15 minutes late in all P.5 rooms.', res: 'Full time allowed; finish moved to 11:00.' },
      { exam: mock, g: 'P7', subj: 'SCI', type: 'missing_script', severity: 'medium', status: 'resolved', pupil: pick('P7', 11), d: 'One script missing from the P.7 Science bundle at collection.', res: 'Found misfiled in the Social Studies bundle; marked normally.' },
      { exam: mot, g: 'P4', subj: 'ENG', type: 'late_arrival', severity: 'low', status: 'resolved', pupil: pick('P4', 3), d: 'Candidate arrived 25 minutes late (transport).', res: 'Allowed to sit; no extra time given, per policy.' },
      { exam: mot, g: 'P2', subj: 'NUM', type: 'illness', severity: 'medium', status: 'resolved', pupil: pick('P2', 7), d: 'Pupil complained of a headache and fever 40 minutes in.', res: 'Taken to the sick bay; script marked as handed in. Parent informed.' },
      { exam: mot, g: 'P6', subj: 'SST', type: 'malpractice', severity: 'high', status: 'under_review', pupil: pick('P6', 15), d: 'Notes on a piece of paper found under the desk during the paper.', res: null },
    ];
    for (const inc of incidents) {
      const sch = schedOf(inc.exam, inc.g, inc.subj);
      if (!inc.exam || !sch) continue;
      await prisma.examIncident.create({
        data: {
          organizationId: O, examId: inc.exam.id, examScheduleId: sch.id, studentProfileId: inc.pupil?.id ?? null, type: inc.type as never,
          status: inc.status as never, severity: inc.severity, description: inc.d, occurredAt: sch.date, reportedById: dosUser,
          reviewedById: inc.res ? dosUser : null, reviewedAt: inc.res ? addDays(sch.date, 1) : null, resolution: inc.res,
        },
      });
    }

    // Extra time for pupils on an SNE plan, for every sitting this term.
    const sne = await prisma.studentProfile.findMany({
      where: { organizationId: O, studentCategory: { name: 'Special needs (SNE)' } },
      select: { id: true },
    });
    const sneIds = new Set(sne.map((x) => x.id));
    const snePupils = people.pupils.filter((p) => sneIds.has(p.id) && PRIMARY.includes(p.gradeCode));
    const arrangements: Array<Record<string, unknown>> = [];
    for (const exam of exams) {
      const classIds = (exam.classes as string[]) ?? [];
      for (const p of snePupils) {
        if (!classIds.includes(s.classes.get(p.gradeCode)?.id ?? '')) continue;
        arrangements.push({
          organizationId: O, examId: exam.id, studentProfileId: p.id, type: 'extra_time', status: 'approved', extraTimeMinutes: 15,
          reason: 'Individual learning plan (reading difficulty) — 15 minutes extra per paper.', requestedById: userByStaff.get(teaching.teacherFor(p.gradeCode, p.streamCode, 'ENG')?.id ?? '') ?? dosUser,
          decidedById: dosUser, decidedAt: addDays(exam.startDate, -7), decisionNote: 'Approved per the SNE coordinator’s plan.',
        });
      }
    }
    const scribePupil = pick('P7', 22);
    if (mot && scribePupil) {
      arrangements.push({
        organizationId: O, examId: mot.id, studentProfileId: scribePupil.id, type: 'scribe', status: 'approved',
        reason: 'Fractured right wrist (football). Doctor’s note on file.', requestedById: userByStaff.get(people.classTeachers.get(`P7:${scribePupil.streamCode}`)?.id ?? '') ?? dosUser,
        decidedById: dosUser, decidedAt: addDays(mot.startDate, -1), decisionNote: 'Scribe and separate room in the Library.',
      });
    }
    await createManyChunked(prisma.specialConsideration as never, arrangements as never[]);
    log(`exam incidents: ${incidents.length}; special arrangements: ${arrangements.length}`);
  }

  // ── 2025 → 2026 promotion decisions ───────────────────────────────────────
  let promotions = 0;
  const t2025 = enrol.terms2025[2];
  if ((await prisma.promotionDecision.count({ where: { organizationId: O } })) === 0 && t2025) {
    const results = await prisma.studentTermResult.findMany({ where: { organizationId: O, termId: t2025.id } });
    const enr2026 = await prisma.studentEnrollment.findMany({
      where: { organizationId: O, academicYearId: enrol.year2026.id },
      select: { studentProfileId: true, gradeLevelId: true, enrollmentType: true, placements: { where: { termId: enrol.terms2026[0].id }, select: { id: true, sectionId: true, classCohort: { select: { classId: true } } } } },
    });
    const next = new Map(enr2026.map((e) => [e.studentProfileId, e]));
    const rows: Array<Record<string, unknown>> = [];
    for (const r of results) {
      const n = next.get(r.studentProfileId);
      if (!n) continue;
      const repeat = n.enrollmentType === 'REPEAT';
      const placement = n.placements[0];
      rows.push({
        organizationId: O, studentProfileId: r.studentProfileId, resultSetId: r.resultSetId, termId: t2025.id, academicYearId: enrol.year2025.id,
        fromGradeLevelId: r.gradeLevelId, fromClassId: r.classId, recommendation: repeat ? 'repeat' : 'promote', decision: repeat ? 'repeat' : 'promote',
        toGradeLevelId: n.gradeLevelId, toClassId: placement?.classCohort.classId ?? null, toSectionId: placement?.sectionId ?? null,
        status: 'applied', basis: { meanPercent: r.meanPercent ? Number(r.meanPercent) : null, classRank: r.classRank, division: r.division },
        reason: repeat ? 'Average below the promotion mark; repeat agreed with the parents at the end-of-year meeting.' : 'Met the promotion criteria.',
        proposedById: dosUser, decidedById: headUser, decidedAt: new Date('2025-12-10'), appliedAt: new Date('2026-01-20'), appliedById: headUser,
        enrollmentPlacementId: placement?.id ?? null,
      });
    }
    promotions = await createManyChunked(prisma.promotionDecision as never, rows as never[]);
  }
  log(`promotion decisions 2025 → 2026: ${promotions}`);

  // ── Certificates ──────────────────────────────────────────────────────────
  let certs = 0;
  if ((await prisma.certificate.count({ where: { organizationId: O } })) === 0) {
    const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
    const code = (key: string) => {
      const r = rng(`${SCHOOL.key}:cert:${key}`);
      let out = '';
      for (let i = 0; i < 12; i += 1) out += ALPHABET[Math.floor(r() * ALPHABET.length)];
      return `CERT-${out.slice(0, 4)}-${out.slice(4, 8)}-${out.slice(8, 12)}`;
    };
    const pupilById = new Map(people.pupils.map((p) => [p.id, p]));
    const t2 = enrol.terms2026[1];
    const rows: Array<Record<string, unknown>> = [];
    let serial = 0;
    const top = await prisma.studentTermResult.findMany({ where: { organizationId: O, termId: t2.id, classRank: { lte: 3, gte: 1 } }, orderBy: { classRank: 'asc' } });
    for (const r of top) {
      const p = pupilById.get(r.studentProfileId);
      const className = r.classId ? [...s.classes.values()].find((c) => c.id === r.classId)?.name : undefined;
      if (!p || !className || !PRIMARY.includes(p.gradeCode)) continue;
      serial += 1;
      rows.push({
        organizationId: O, studentProfileId: p.id, type: 'merit', status: 'issued',
        serialNumber: `${SCHOOL.codePrefix}-MERIT-2026-${String(serial).padStart(4, '0')}`, verificationCode: code(`merit:${p.id}`),
        title: `Certificate of Merit — ${ordinal(r.classRank!)} position, ${className}, Term II 2026`,
        payload: { holderName: p.name, admissionNo: p.admissionNo, className, term: 'Term II 2026', position: r.classRank, meanPercent: r.meanPercent ? Number(r.meanPercent) : null, division: r.division, signedBy: head.name },
        issuedAt: new Date('2026-08-14'), issuedById: headUser,
      });
    }
    const completers = await prisma.studentEnrollment.findMany({
      where: { organizationId: O, academicYearId: enrol.year2025.id, gradeLevelId: s.grades.get('TOP')?.id, status: 'COMPLETED' },
      select: { studentProfileId: true },
    });
    for (const c of completers) {
      const p = pupilById.get(c.studentProfileId);
      if (!p) continue;
      serial += 1;
      rows.push({
        organizationId: O, studentProfileId: p.id, type: 'completion', status: 'issued',
        serialNumber: `${SCHOOL.codePrefix}-ECD-2025-${String(serial).padStart(4, '0')}`, verificationCode: code(`ecd:${p.id}`),
        title: 'Nursery Completion Certificate — Top Class 2025',
        payload: { holderName: p.name, admissionNo: p.admissionNo, completed: 'Top Class', year: 2025, nextClass: 'P.1', signedBy: head.name },
        issuedAt: new Date('2025-11-29'), issuedById: headUser,
      });
    }
    certs = await createManyChunked(prisma.certificate as never, rows as never[]);
  }
  const earlyPlans = await seedEarlyYearsPlanning(prisma, s, people, enrol, teaching, curriculum);
  ok(`teaching & assessment trail: ${earlyPlans} nursery/lower-primary lesson plans, ${papers} question papers, ${scripts} scripts allocated, ${samples} moderation samples, ${promotions} promotions, ${certs} certificates`);
}

/** Lesson shapes for young learners: short, active, with a song and a story. */
const EARLY_SHAPES: Record<'nursery' | 'lower', Array<{ type: string; title: string; minutes: number }>> = {
  nursery: [
    { type: 'teacher_instruction', title: 'Circle time: greeting song and rhyme', minutes: 5 },
    { type: 'discussion', title: 'Story and picture talk on the theme', minutes: 7 },
    { type: 'group', title: 'Learning corners: sorting, colouring, play dough', minutes: 12 },
    { type: 'teacher_instruction', title: 'Closing song; tidy up', minutes: 6 },
  ],
  lower: [
    { type: 'teacher_instruction', title: 'Song or rhyme linked to the theme', minutes: 5 },
    { type: 'discussion', title: 'Oral work: picture reading and new words', minutes: 10 },
    { type: 'group', title: 'Group activity with real objects', minutes: 10 },
    { type: 'worksheet', title: 'Writing / sums in exercise books', minutes: 10 },
    { type: 'teacher_instruction', title: 'Recap and reading aloud', minutes: 5 },
  ],
};

/**
 * Schemes of work and weekly lesson plans for nursery and P1–P3.
 *
 * Stage 8 plans the upper-primary courses from their LMS week pages. Lower down
 * a class teacher plans by theme, so these follow the NCDC theme for the term:
 * past weeks approved with a reflection, this week submitted for the Director
 * of Studies, next week still a draft.
 */
async function seedEarlyYearsPlanning(
  prisma: PrismaClient,
  s: School,
  people: People,
  enrol: Enrollment,
  teaching: Teaching,
  curriculum: Curriculum,
): Promise<number> {
  const { O } = s;
  const live = teaching.liveTerm;
  const liveIndex = enrol.terms2026.findIndex((t) => t.id === live.id);
  const currentWeek = mondayOf(new Date());
  const termStart = mondayOf(live.startDate);
  const weeksInTerm = Math.ceil((live.endDate.getTime() - termStart.getTime()) / (7 * 86_400_000));
  const dos = people.leadership.find((l) => l.role === 'Director of Studies');
  const PLANNED: Record<string, string[]> = {
    BABY: ['LANG-DEV', 'NUM-CONC', 'ENV-AWARE'], MIDDLE: ['LANG-DEV', 'NUM-CONC', 'ENV-AWARE'], TOP: ['LANG-DEV', 'NUM-CONC', 'ENV-AWARE'],
    P1: ['LIT1', 'LIT2', 'NUM'], P2: ['LIT1', 'LIT2', 'NUM'], P3: ['LIT1', 'LIT2', 'NUM'],
  };
  const offerings = teaching.offerings.filter((o) => o.termId === live.id && PLANNED[o.gradeCode]?.includes(o.subjectCode));
  let plans = 0;
  for (const offering of offerings) {
    if (await prisma.schemeOfWork.findFirst({ where: { organizationId: O, courseOfferingId: offering.id } })) continue;
    const nursery = ['BABY', 'MIDDLE', 'TOP'].includes(offering.gradeCode);
    const topics = curriculum.topics.filter((t) => t.gradeCode === offering.gradeCode && t.subjectCode === offering.subjectCode && t.termIndex === liveIndex);
    if (!topics.length) continue;
    const scheme = await prisma.schemeOfWork.create({
      data: {
        organizationId: O, courseOfferingId: offering.id, status: 'active', approvedAt: live.startDate,
        title: `${offering.gradeCode} ${offering.subjectCode} — ${live.name} scheme of work`,
        summary: `Theme-based scheme for ${offering.gradeCode} ${offering.streamCode}, ${live.name} 2026: ${topics.map((t) => t.title).join('; ')}.`,
      },
    });
    for (let w = 1; w <= weeksInTerm; w += 1) {
      const weekStart = addDays(termStart, (w - 1) * 7);
      // Each theme runs about a third of the term.
      const topic = topics[Math.min(topics.length - 1, Math.floor(((w - 1) * topics.length) / weeksInTerm))];
      const week = await prisma.schemeOfWorkWeek.create({
        data: { organizationId: O, schemeOfWorkId: scheme.id, weekNumber: w, weekStart, theme: topic.title, plannedPeriods: nursery ? 5 : 6 },
      });
      await prisma.schemeOfWorkItem.createMany({
        data: topic.outcomeIds.map((learningOutcomeId, i) => ({
          organizationId: O, schemeOfWorkWeekId: week.id, topicId: topic.id, learningOutcomeId, order: i, plannedPeriods: 3,
          title: i === 0 ? topic.title : `${topic.title}: practice and assessment`,
        })),
      });
      if (weekStart > addDays(currentWeek, 7)) continue; // planned up to next week
      const state = weekStart < addDays(currentWeek, -7) ? 'approved' : weekStart <= currentWeek ? 'submitted' : 'draft';
      const r = rng(`early-plan:${offering.code}:${w}`);
      const plan = await prisma.lessonPlan.create({
        data: {
          organizationId: O, courseOfferingId: offering.id, subjectId: offering.subjectId, classId: offering.classId, termId: offering.termId,
          teacherPartnerId: offering.teacher.id, schemeOfWorkWeekId: week.id, topicId: topic.id, weekOf: weekStart,
          title: `${topic.title} — ${offering.gradeCode} ${offering.streamCode}`, subtopic: topic.title,
          objectives: nursery
            ? `By the end of the week the child can talk about ${topic.title.toLowerCase()}, sing the theme song and complete the corner activities.`
            : `By the end of the week learners can read, say and write the key words for "${topic.title}" and use them in short sentences.`,
          materials: pick(nursery
            ? ['Picture cards, crayons, play dough, bottle tops', 'Story book, puppets, sand tray', 'Charts, counters, beads and strings']
            : ['Flash cards, wall chart, exercise books', 'Real objects, sentence strips, manila paper', 'Counters, bottle tops, number chart'], r),
          workflowStatus: state, version: 1, publishedAt: state === 'approved' ? weekStart : null,
        },
      });
      plans += 1;
      for (const [i, shape] of EARLY_SHAPES[nursery ? 'nursery' : 'lower'].entries()) {
        const activity = await prisma.learningActivity.create({ data: { organizationId: O, type: shape.type, title: shape.title, content: {} } });
        await prisma.lessonPlanActivity.create({
          data: { organizationId: O, lessonPlanId: plan.id, learningActivityId: activity.id, sequence: i, durationMin: shape.minutes },
        });
      }
      await prisma.lessonPlanOutcome.createMany({
        skipDuplicates: true,
        data: topic.outcomeIds.map((learningOutcomeId) => ({ organizationId: O, lessonPlanId: plan.id, learningOutcomeId })),
      });
      await prisma.lessonPlanDifferentiation.createMany({
        data: [
          { organizationId: O, lessonPlanId: plan.id, tier: 'support', description: nursery ? 'Sit near the teacher; use picture cards only.' : 'Trace the words first; work with a reading buddy.' },
          { organizationId: O, lessonPlanId: plan.id, tier: 'extension', description: nursery ? 'Retell the story to the group.' : 'Write two extra sentences about the theme.' },
        ],
      });
      if (state === 'approved') {
        await prisma.lessonPlanReflection.create({
          data: {
            organizationId: O, lessonPlanId: plan.id,
            whatWorked: pick(['The children enjoyed the song and joined in.', 'Real objects kept the class engaged.', 'Group corners worked well; most finished.'], r),
            whatDidnt: pick(['Some children were shy during picture talk.', 'The writing activity took longer than planned.', 'Rain noise made the story hard to hear.'], r),
            teacherPerceivedAchievement: pick(['Most met the objective', 'Nearly all met the objective', 'About half met the objective'], r),
            studentsNeedingSupport: 'Four learners need more practice with letter sounds.',
            followUp: 'Repeat the key words during circle time on Monday.',
          },
        });
        await prisma.lessonPlanReview.create({
          data: { organizationId: O, lessonPlanId: plan.id, reviewerId: dos?.partnerId ?? null, fromStatus: 'submitted', toStatus: 'approved', comment: 'Good use of the theme and local materials. Approved.' },
        });
      }
    }
  }
  return plans;
}
