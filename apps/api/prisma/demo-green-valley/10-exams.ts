/**
 * Demo stage 10 — examinations, the way a Ugandan primary school runs them.
 *
 * Term 3, as of today:
 *
 *  - **Beginning of Term III** (week 2) — sat, marked, approved, closed.
 *  - **P.7 Mock** (week 4) — the district-style mock for PLE candidates; results ready.
 *  - **Mid Term III** (week 5) — sat last week; marking in progress, so the
 *    approval queue has work in it (P.7 approved, P.5–P.6 submitted, P.4 still
 *    being entered, P.1–P.3 submitted).
 *  - **End of Term III** (last fortnight) — timetabled, venues and invigilators
 *    set, candidates registered, not yet sat.
 *
 * Each sat paper is an `exam_session` assessment (one per class and subject,
 * as the exam workspace mints them), with registrations, seat numbers,
 * attendance and a locked candidate list. They carry no weighting component, so
 * they appear in the gradebook beside the continuous assessment and
 * end-of-term papers without changing how published results were computed.
 *
 * P.7 pupils are registered with UNEB for the PLE: centre and index numbers.
 */
import { createHash } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { D, SCHOOL, addDays, createManyChunked, log, mondayOf, ok, rng, type School } from './shared';
import { coreSubjectsFor, type Reference } from './01-reference';
import type { DemoPupil, People } from './02-people';
import type { Enrollment } from './03-enrollment';
import type { Teaching } from './04-teaching';
import type { Assessment } from './05-assessment';

type Lifecycle = 'closed' | 'results_ready' | 'marking' | 'scheduled';

const PRIMARY = ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7'];

export async function seedExams(
  prisma: PrismaClient,
  s: School,
  ref: Reference,
  people: People,
  enrol: Enrollment,
  teaching: Teaching,
  assessment: Assessment,
) {
  const { O } = s;
  const asOf = new Date();
  const term = teaching.liveTerm;
  const termIndex = enrol.terms2026.findIndex((t) => t.id === term.id);
  const roman = ['I', 'II', 'III'][termIndex] ?? String(termIndex + 1);
  const subjectName = new Map(
    (await prisma.subject.findMany({ where: { organizationId: O }, select: { id: true, code: true, name: true } })).map((x) => [x.code ?? '', x]),
  );

  // ── Exam types ────────────────────────────────────────────────────────────
  const typeSeeds = [
    { key: 'BOT', name: 'Beginning of Term', weight: 10, isFinal: false },
    { key: 'MOT', name: 'Mid Term', weight: 30, isFinal: false },
    { key: 'EOT', name: 'End of Term', weight: 60, isFinal: true },
    { key: 'MOCK', name: 'Mock Examination', weight: 0, isFinal: false },
  ];
  const examTypes = new Map<string, string>();
  for (const t of typeSeeds) {
    const row = await prisma.examType.upsert({
      where: { organizationId_name: { organizationId: O, name: t.name } },
      update: { weight: D(t.weight), isFinal: t.isFinal },
      create: { organizationId: O, name: t.name, weight: D(t.weight), isFinal: t.isFinal },
    });
    examTypes.set(t.key, row.id);
  }

  // ── Venues: every stream's classroom, the hall, the library ───────────────
  const campus = await prisma.campus.findFirst({ where: { organizationId: O }, orderBy: { createdAt: 'asc' } });
  const venues = new Map<string, string>();
  const upsertVenue = async (key: string, name: string, code: string, capacity: number) => {
    const row = await prisma.examVenue.upsert({
      where: { organizationId_name: { organizationId: O, name } },
      update: { capacity, code },
      create: { organizationId: O, name, code, capacity, campusId: campus?.id ?? null },
    });
    venues.set(key, row.id);
  };
  await upsertVenue('HALL', 'Main Hall', 'HALL', 220);
  await upsertVenue('LIB', 'Library', 'LIB', 60);
  for (const gradeCode of PRIMARY) {
    const cls = s.classes.get(gradeCode);
    for (const sec of s.sectionsByClassCode(gradeCode)) {
      await upsertVenue(`${gradeCode}:${sec.code}`, `${cls?.name ?? gradeCode} ${sec.name} classroom`, `${gradeCode}-${sec.code}`, sec.capacity ?? 35);
    }
  }
  log(`exam venues: ${venues.size}`);

  // ── Invigilators: the teaching staff ──────────────────────────────────────
  const teachingStaff = [...people.subjectTeachers, ...people.classTeachers.values()];
  const invigilators: string[] = [];
  for (const st of teachingStaff) {
    const row = await prisma.invigilator.upsert({
      where: { organizationId_staffId: { organizationId: O, staffId: st.id } },
      update: { name: st.name, isActive: true },
      create: { organizationId: O, staffId: st.id, name: st.name },
    });
    invigilators.push(row.id);
  }

  // ── The term's sittings ───────────────────────────────────────────────────
  const week = (n: number) => addDays(mondayOf(term.startDate), (n - 1) * 7);
  const eotStart = addDays(mondayOf(term.endDate), -7);
  const sittings: Array<{
    key: string; type: string; name: string; start: Date; days: number; grades: string[]; past: Lifecycle;
  }> = [
    { key: 'BOT', type: 'BOT', name: `Beginning of Term ${roman} Examinations 2026`, start: week(2), days: 3, grades: PRIMARY, past: 'closed' },
    { key: 'MOCK', type: 'MOCK', name: 'P.7 Mock Examinations 2026', start: week(4), days: 3, grades: ['P7'], past: 'results_ready' },
    { key: 'MOT', type: 'MOT', name: `Mid Term ${roman} Examinations 2026`, start: addDays(week(5), 1), days: 3, grades: PRIMARY, past: 'marking' },
    { key: 'EOT', type: 'EOT', name: `End of Term ${roman} Examinations 2026`, start: eotStart, days: 8, grades: PRIMARY, past: 'marking' },
  ];

  const pupilsByGrade = new Map<string, DemoPupil[]>();
  for (const p of people.pupils) pupilsByGrade.set(p.gradeCode, [...(pupilsByGrade.get(p.gradeCode) ?? []), p]);

  let schedulesMade = 0;
  let marks = 0;
  for (const sit of sittings) {
    const end = addDays(sit.start, sit.days - 1 + (sit.days > 5 ? 2 : 0));
    const lifecycle: Lifecycle = end.getTime() < asOf.getTime() ? sit.past : 'scheduled';
    const sat = lifecycle !== 'scheduled';
    const classIds = sit.grades.map((g) => s.classes.get(g)?.id).filter(Boolean) as string[];

    const exam =
      (await prisma.exam.findFirst({ where: { organizationId: O, termId: term.id, name: sit.name } })) ??
      (await prisma.exam.create({
        data: {
          organizationId: O, termId: term.id, examTypeId: examTypes.get(sit.type)!, name: sit.name,
          startDate: sit.start, endDate: end, classes: classIds,
          status: lifecycle === 'closed' ? 'closed' : 'published',
          lifecycleState: lifecycle,
          resultsReadyAt: lifecycle === 'closed' || lifecycle === 'results_ready' ? addDays(end, 6) : null,
          closedAt: lifecycle === 'closed' ? addDays(end, 10) : null,
        },
      }));

    // Exam days skip the weekend: an eight-day window is Mon–Fri then Mon–Wed.
    const examDays: Date[] = [];
    for (let d = new Date(sit.start); examDays.length < sit.days; d = addDays(d, 1)) {
      if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) examDays.push(d);
    }

    for (const gradeCode of sit.grades) {
      const cls = s.classes.get(gradeCode);
      if (!cls) continue;
      const subjects = coreSubjectsFor(gradeCode);
      const lower = ['P1', 'P2', 'P3'].includes(gradeCode);
      const pupils = pupilsByGrade.get(gradeCode) ?? [];
      const rosterId = assessment.rosters.get(`${term.name}:${gradeCode}`) ?? null;

      for (const [si, subjectCode] of subjects.entries()) {
        const subject = subjectName.get(subjectCode);
        if (!subject) continue;
        // Two papers a day: morning and after break.
        const day = examDays[Math.floor(si / 2) % examDays.length];
        const startTime = si % 2 === 0 ? '08:30' : '11:00';
        const schedule =
          (await prisma.examSchedule.findFirst({ where: { examId: exam.id, classId: cls.id, subjectId: subject.id } })) ??
          (await prisma.examSchedule.create({
            data: {
              organizationId: O, examId: exam.id, classId: cls.id, subjectId: subject.id, date: day, startTime,
              durationMinutes: lower ? 90 : subjectCode === 'MTC' || subjectCode === 'ENG' ? 135 : 120,
              maxMarks: D(100), paperNumber: 1, sitting: si % 2 === 0 ? 'Morning' : 'Mid-morning',
              venueId: gradeCode === 'P7' ? venues.get('HALL') ?? null : null,
              invigilatorId: invigilators[(si + gradeCode.charCodeAt(1)) % invigilators.length] ?? null,
              marksLockedAt: lifecycle === 'closed' || lifecycle === 'results_ready' ? addDays(end, 5) : null,
            },
          }));
        schedulesMade += 1;
        await prisma.invigilatorAssignment.createMany({
          skipDuplicates: true,
          data: [0, 7].map((k) => ({
            organizationId: O, examScheduleId: schedule.id,
            invigilatorId: invigilators[(si * 3 + k + gradeCode.charCodeAt(1)) % invigilators.length],
          })),
        });
        if (!sat) continue;

        // ── The paper's gradebook column and its marks ──
        const sourceRef = schedule.id;
        if (await prisma.assessment.findFirst({ where: { organizationId: O, sourceType: 'exam_session', sourceRef } })) continue;
        const approval = approvalFor(sit.key, lifecycle, gradeCode);
        const paper = await prisma.assessment.create({
          data: {
            organizationId: O, subjectId: subject.id, classId: cls.id, termId: term.id, rosterId,
            title: sit.name, maxScore: D(100), kind: 'exam', sequence: 1,
            contribution: 'summative', sourceType: 'exam_session', sourceRef,
            status: approval === 'approved' ? 'graded' : 'grading',
            marksReleaseAt: approval === 'approved' ? addDays(end, 7) : null,
            lockedAt: schedule.marksLockedAt,
          },
        });
        const attendance: Array<Record<string, unknown>> = [];
        const rows: Array<Record<string, unknown>> = [];
        for (const pupil of pupils) {
          const r = rng(`examsat:${pupil.admissionNo}:${sit.key}:${subjectCode}`);
          const roll = r();
          const absent = roll < 0.02;
          const late = !absent && roll < 0.05;
          // P.4's Mid Term marks are still being typed in: the last third of the class has none yet.
          const notYet = approval === 'draft' && pupil.roll > 20;
          const score = absent || notYet ? null : assessment.markFor(pupil.admissionNo, subjectCode, `exam:${sit.key}`, 100);
          attendance.push({
            organizationId: O, examScheduleId: schedule.id, studentProfileId: pupil.id,
            status: absent ? 'absent' : late ? 'late' : 'present',
            arrivedAt: absent ? null : new Date(`${day.toISOString().slice(0, 10)}T${late ? (startTime === '08:30' ? '08:47' : '11:12') : (startTime === '08:30' ? '08:15' : '10:50')}:00+03:00`),
            venueId: gradeCode === 'P7' ? venues.get('HALL') : venues.get(`${gradeCode}:${pupil.streamCode}`),
            seatNumber: String(pupil.roll), scriptNumber: absent ? null : `${sit.key}-${gradeCode}-${subjectCode}-${String(pupil.roll).padStart(3, '0')}`,
            note: late ? 'Arrived late; given no extra time.' : null,
          });
          rows.push({
            organizationId: O, assessmentId: paper.id, studentProfileId: pupil.id,
            classId: cls.id, sectionId: s.sections.get(`${gradeCode}:${pupil.streamCode}`)?.id ?? null,
            gradeLevelId: s.grades.get(gradeCode)!.id, termId: term.id, maxScore: D(100),
            status: score === null ? 'assigned' : 'graded',
            participation: absent ? 'absent' : notYet ? 'missing' : 'present',
            originalScore: score === null ? null : D(score), effectiveScore: score === null ? null : D(score),
            percentage: score === null ? null : D(score),
            approvalStatus: approval,
            enteredAt: score === null ? null : addDays(end, 2),
            submittedAt: approval === 'submitted' || approval === 'approved' ? addDays(end, 3) : null,
            approvedAt: approval === 'approved' ? addDays(end, 5) : null,
          });
        }
        await createManyChunked(prisma.examAttendance as never, attendance as never[]);
        await createManyChunked(prisma.studentAssessment as never, rows as never[]);
        marks += rows.length;
      }
    }

    // ── Registrations and the locked candidate list ──
    const candidates = sit.grades.flatMap((g) => pupilsByGrade.get(g) ?? []);
    await createManyChunked(
      prisma.examRegistration as never,
      candidates.map((p) => ({
        organizationId: O, examId: exam.id, studentProfileId: p.id, classId: s.classes.get(p.gradeCode)?.id ?? null,
        venueId: p.gradeCode === 'P7' ? venues.get('HALL') : venues.get(`${p.gradeCode}:${p.streamCode}`),
        seatNumber: `${p.streamCode.slice(0, 1)}${String(p.roll).padStart(2, '0')}`,
        status: sat ? 'sat' : 'registered',
      })) as never[],
    );
    if (sat && !exam.activeSnapshotId) {
      const checksum = createHash('sha256').update(candidates.map((p) => p.id).sort().join(',')).digest('hex');
      const snapshot = await prisma.examCandidateSnapshot.create({
        data: { organizationId: O, examId: exam.id, revision: 1, checksum, candidateCount: candidates.length, reason: 'Candidate list locked before the first paper', frozenAt: addDays(sit.start, -2) },
      });
      await createManyChunked(
        prisma.examCandidateEntry as never,
        candidates.map((p) => ({
          organizationId: O, snapshotId: snapshot.id, studentProfileId: p.id,
          classId: s.classes.get(p.gradeCode)?.id ?? null, sectionId: s.sections.get(`${p.gradeCode}:${p.streamCode}`)?.id ?? null,
          candidateNumber: `${p.gradeCode}${p.streamCode.slice(0, 1)}${String(p.roll).padStart(3, '0')}`,
          venueId: p.gradeCode === 'P7' ? venues.get('HALL') : venues.get(`${p.gradeCode}:${p.streamCode}`),
          seatNumber: String(p.roll),
        })) as never[],
      );
      await prisma.exam.update({
        where: { id: exam.id },
        data: { activeSnapshotId: snapshot.id, candidatesLockedAt: addDays(sit.start, -2) },
      });
    }
    log(`${sit.name}: ${lifecycle}, ${candidates.length} candidates`);
  }
  ok(`examinations: ${sittings.length} sittings, ${schedulesMade} papers timetabled, ${marks} exam marks`);

  // ── PLE registration with UNEB ────────────────────────────────────────────
  const p7 = (pupilsByGrade.get('P7') ?? []).slice().sort((a, b) => a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName));
  await createManyChunked(
    prisma.studentExamReference as never,
    p7.map((p, i) => ({
      organizationId: O, studentProfileId: p.id, board: 'UNEB', level: 'PLE', registrationYear: 2026,
      centreNumber: SCHOOL.unebCentre, candidateNumber: String(i + 1).padStart(3, '0'),
      indexNumber: `${SCHOOL.unebCentre}/${String(i + 1).padStart(3, '0')}`,
      status: 'registered', verifiedAt: new Date('2026-04-10'),
      note: i % 17 === 0 ? 'Birth certificate copy outstanding' : null,
    })) as never[],
  );
  ok(`PLE 2026: ${p7.length} candidates registered at centre ${SCHOOL.unebCentre}`);

  return { examTypes, venues };
}

/** Where a sitting's marks have got to, per class. */
function approvalFor(key: string, lifecycle: Lifecycle, gradeCode: string): 'approved' | 'submitted' | 'draft' {
  if (lifecycle !== 'marking') return 'approved';
  if (key !== 'MOT') return 'submitted';
  if (gradeCode === 'P7') return 'approved';
  if (gradeCode === 'P4') return 'draft';
  return 'submitted';
}
