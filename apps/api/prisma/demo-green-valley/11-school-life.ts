/**
 * Demo stage 11 — the running school around the teaching.
 *
 *  - the 2026 school calendar: term dates, Uganda's public holidays, visiting
 *    days, sports day, the MDD festival, PLE, speech day;
 *  - teaching rooms, with every timetabled lesson placed in one;
 *  - pupil categories, school policies and notices;
 *  - marking rubrics;
 *  - weekly homework for P1–P7 this term: set, handed in, marked;
 *  - LMS quizzes made sittable (slots) and sat (attempts, responses, scores);
 *  - course progress rolled up from activity completion.
 *
 * Idempotent: rows are found by natural key; bulk rows skip duplicates.
 */
import { PrismaClient } from '@prisma/client';
import { D, SCHOOL, addDays, createManyChunked, log, mondayOf, ok, pick, rng, type School } from './shared';
import { coreSubjectsFor, type Reference } from './01-reference';
import type { People } from './02-people';
import type { Enrollment } from './03-enrollment';
import type { Teaching } from './04-teaching';
import type { Assessment } from './05-assessment';
import type { Lms } from './07-lms';
import type { Curriculum } from './09-curriculum';

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

export async function seedSchoolLife(
  prisma: PrismaClient,
  s: School,
  ref: Reference,
  people: People,
  enrol: Enrollment,
  teaching: Teaching,
  assessment: Assessment,
  lms: Lms,
  curriculum: Curriculum,
) {
  const { O } = s;
  const asOf = new Date();
  const [t1, t2, t3] = enrol.terms2026;
  const live = teaching.liveTerm;

  // ── Calendar ──────────────────────────────────────────────────────────────
  type Ev = { title: string; type: string; start: string; end?: string; termId?: string; description?: string };
  const events: Ev[] = [
    { title: 'New Year’s Day', type: 'holiday', start: '2026-01-01' },
    { title: 'NRM Liberation Day', type: 'holiday', start: '2026-01-26' },
    { title: 'Archbishop Janani Luwum Day', type: 'holiday', start: '2026-02-16', termId: t1.id },
    { title: 'International Women’s Day', type: 'holiday', start: '2026-03-08', termId: t1.id },
    { title: 'Eid al-Fitr', type: 'holiday', start: '2026-03-20', termId: t1.id },
    { title: 'Good Friday', type: 'holiday', start: '2026-04-03', termId: t1.id },
    { title: 'Easter Monday', type: 'holiday', start: '2026-04-06', termId: t1.id },
    { title: 'Labour Day', type: 'holiday', start: '2026-05-01' },
    { title: 'Eid al-Adha', type: 'holiday', start: '2026-05-27', termId: t2.id },
    { title: 'Uganda Martyrs’ Day', type: 'holiday', start: '2026-06-03', termId: t2.id },
    { title: 'National Heroes’ Day', type: 'holiday', start: '2026-06-09', termId: t2.id },
    { title: 'Independence Day', type: 'holiday', start: '2026-10-09', termId: t3.id, description: 'Uganda’s 64th Independence anniversary. No classes.' },
    { title: 'Christmas Day', type: 'holiday', start: '2026-12-25' },
    { title: 'Boxing Day', type: 'holiday', start: '2026-12-26' },
    // Term 1
    { title: 'Term I opens — new pupils report', type: 'event', start: t1.startDate.toISOString().slice(0, 10), termId: t1.id },
    { title: 'Term I PTA general meeting', type: 'meeting', start: '2026-02-21', termId: t1.id, description: 'Annual general meeting of the Parents and Teachers Association. Main Hall, 9:00 am.' },
    { title: 'Term I visiting day (boarders)', type: 'event', start: '2026-03-01', termId: t1.id },
    { title: 'Inter-house athletics day', type: 'sports', start: '2026-03-27', termId: t1.id, description: 'Kagera, Mpanga, Kafu and Achwa houses compete. Parents welcome.' },
    { title: 'Term I closes', type: 'event', start: t1.endDate.toISOString().slice(0, 10), termId: t1.id },
    // Term 2
    { title: 'Term II opens', type: 'event', start: t2.startDate.toISOString().slice(0, 10), termId: t2.id },
    { title: 'Music, Dance and Drama festival (zonal)', type: 'event', start: '2026-06-19', termId: t2.id },
    { title: 'P.5 educational trip — Uganda Museum', type: 'trip', start: '2026-07-10', termId: t2.id },
    { title: 'Term II visiting day (boarders)', type: 'event', start: '2026-07-05', termId: t2.id },
    { title: 'Term II closes', type: 'event', start: t2.endDate.toISOString().slice(0, 10), termId: t2.id },
    // Term 3
    { title: 'Term III opens', type: 'event', start: t3.startDate.toISOString().slice(0, 10), termId: t3.id },
    { title: 'P.7 study trip — Source of the Nile, Jinja', type: 'trip', start: '2026-09-18', termId: t3.id },
    { title: 'Independence Day assembly and flag ceremony', type: 'ceremony', start: '2026-10-08', termId: t3.id },
    { title: 'Term III visiting day (boarders)', type: 'event', start: '2026-10-18', termId: t3.id },
    { title: 'Staff meeting — end-of-year planning', type: 'meeting', start: '2026-10-21', termId: t3.id },
    { title: 'P.7 candidates’ prayer day and blessing', type: 'ceremony', start: '2026-10-23', termId: t3.id, description: 'Parents of P.7 candidates invited. Main Hall, 10:00 am.' },
    { title: 'PLE 2026 — Primary Leaving Examinations (UNEB)', type: 'exam', start: '2026-11-02', end: '2026-11-03', termId: t3.id, description: `Centre ${SCHOOL.unebCentre}. Candidates report by 7:30 am with index numbers.` },
    { title: 'Top Class graduation', type: 'ceremony', start: '2026-11-28', termId: t3.id },
    { title: 'Speech and prize-giving day', type: 'ceremony', start: '2026-12-04', termId: t3.id },
    { title: 'Term III closes — reports issued', type: 'event', start: t3.endDate.toISOString().slice(0, 10), termId: t3.id },
  ];
  // The exam sittings from stage 10 belong on the calendar too.
  for (const exam of await prisma.exam.findMany({ where: { organizationId: O, termId: live.id } })) {
    events.push({ title: exam.name, type: 'exam', start: exam.startDate.toISOString().slice(0, 10), end: exam.endDate.toISOString().slice(0, 10), termId: live.id });
  }
  let made = 0;
  for (const e of events) {
    const startDate = day(e.start);
    const found = await prisma.schoolCalendarEvent.findFirst({ where: { organizationId: O, title: e.title, startDate } });
    if (found) continue;
    await prisma.schoolCalendarEvent.create({
      data: { organizationId: O, title: e.title, type: e.type, startDate, endDate: day(e.end ?? e.start), termId: e.termId ?? null, description: e.description ?? null },
    });
    made += 1;
  }
  log(`calendar: ${events.length} events (${made} new) — holidays, term dates, exams, PLE, trips`);

  // ── Teaching rooms, and every lesson in one ───────────────────────────────
  const rooms = new Map<string, string>();
  const room = async (key: string, name: string, code: string, type: string, capacity: number) => {
    const row = await prisma.teachingRoom.upsert({
      where: { organizationId_name: { organizationId: O, name } },
      update: { code, type, capacity, isActive: true },
      create: { organizationId: O, name, code, type, capacity },
    });
    rooms.set(key, row.id);
  };
  await room('ICT', 'Computer Laboratory', 'LAB-ICT', 'lab', 40);
  await room('SCI', 'Science Room', 'LAB-SCI', 'lab', 40);
  await room('MUSIC', 'Music Room', 'MUSIC', 'classroom', 40);
  await room('HALL', 'Main Hall', 'HALL', 'hall', 220);
  await room('FIELD', 'Sports Field', 'FIELD', 'gym', 300);
  await room('LIB', 'Library', 'LIB', 'classroom', 60);
  for (const cls of s.classes.values()) {
    for (const sec of s.sectionsByClassCode(cls.code ?? '')) {
      await room(`${cls.code}:${sec.code}`, `${cls.name} ${sec.name} classroom`, `${cls.code}-${sec.code}`, 'classroom', sec.capacity ?? 35);
    }
  }
  const special: Record<string, string> = { ICT: 'ICT', PE: 'FIELD', 'PHYS-DEV': 'FIELD', MDD: 'MUSIC' };
  const subjectCodeById = new Map([...ref.subjects.entries()].map(([code, id]) => [id, code]));
  const slots = await prisma.timetableSlot.findMany({
    where: { organizationId: O, teachingRoomId: null },
    select: { id: true, sectionId: true, subjectId: true, dayOfWeek: true, periodId: true },
    orderBy: [{ dayOfWeek: 'asc' }, { classId: 'asc' }],
  });
  const sectionKey = new Map([...s.sections.entries()].map(([k, v]) => [v.id, k]));
  const roomName = new Map((await prisma.teachingRoom.findMany({ where: { organizationId: O } })).map((r) => [r.id, r.name]));
  // A room holds one class per period: the database refuses a double booking.
  // A specialist room already taken that period sends the lesson back to the
  // stream's own classroom, which is what a school actually does.
  const booked = new Set(
    (await prisma.timetableSlot.findMany({ where: { organizationId: O, teachingRoomId: { not: null } }, select: { teachingRoomId: true, dayOfWeek: true, periodId: true } }))
      .map((b) => `${b.teachingRoomId}:${b.dayOfWeek}:${b.periodId}`),
  );
  let placed = 0;
  for (const slot of slots) {
    const subjectCode = subjectCodeById.get(slot.subjectId) ?? '';
    const own = slot.sectionId ? rooms.get(sectionKey.get(slot.sectionId) ?? '') : undefined;
    const specialist = special[subjectCode] ? rooms.get(special[subjectCode]) : undefined;
    const free = (id?: string) => id && !booked.has(`${id}:${slot.dayOfWeek}:${slot.periodId}`);
    const teachingRoomId = free(specialist) ? specialist : free(own) ? own : undefined;
    if (!teachingRoomId) continue;
    booked.add(`${teachingRoomId}:${slot.dayOfWeek}:${slot.periodId}`);
    await prisma.timetableSlot.update({ where: { id: slot.id }, data: { teachingRoomId, room: roomName.get(teachingRoomId) } });
    placed += 1;
  }
  log(`teaching rooms: ${rooms.size}; ${placed} timetabled lessons placed`);

  // ── Pupil categories ──────────────────────────────────────────────────────
  const categorySeeds = [
    ['Day scholar', 'Goes home every evening.'],
    ['Boarder', 'Lives in the school dormitories during term.'],
    ['Sibling (2+ children)', 'Has a brother or sister in the school; sibling fee discount applies.'],
    ['Staff child', 'Child of a member of staff.'],
    ['Sponsored / bursary', 'Fees fully or partly paid by a sponsor or bursary.'],
    ['Special needs (SNE)', 'Has an individual learning plan agreed with the SNE coordinator.'],
  ];
  const categories = new Map<string, string>();
  for (const [name, description] of categorySeeds) {
    const row = await prisma.studentCategory.upsert({
      where: { organizationId_name: { organizationId: O, name } },
      update: { description },
      create: { organizationId: O, name, description },
    });
    categories.set(name, row.id);
  }
  const profiles = await prisma.studentProfile.findMany({ where: { organizationId: O, studentCategoryId: null }, select: { id: true, admissionNo: true, residenceType: true } });
  const byCategory = new Map<string, string[]>();
  for (const p of profiles) {
    const v = rng(`category:${p.admissionNo}`)();
    const name = v < 0.02 ? 'Staff child' : v < 0.06 ? 'Sponsored / bursary' : v < 0.08 ? 'Special needs (SNE)' : v < 0.2 ? 'Sibling (2+ children)'
      : p.residenceType === SCHOOL.boarderValue ? 'Boarder' : 'Day scholar';
    byCategory.set(name, [...(byCategory.get(name) ?? []), p.id]);
  }
  for (const [name, ids] of byCategory) {
    await prisma.studentProfile.updateMany({ where: { id: { in: ids } }, data: { studentCategoryId: categories.get(name) } });
  }
  log(`pupil categories: ${categories.size}`);

  // ── School policies ───────────────────────────────────────────────────────
  const policies: Array<[string, string, string, unknown, string]> = [
    ['academic.assessment_weighting', 'Assessment weighting', 'academic', { continuousAssessment: 40, endOfTermExam: 60 }, 'Term results combine continuous assessment (40%) and the end-of-term examination (60%).'],
    ['academic.promotion_criteria', 'Promotion criteria', 'academic', { minimumAverage: 50, repeatIfBelow: 35, headTeacherReview: true }, 'Pupils averaging 50% and above are promoted; below 35% are reviewed by the head teacher with parents.'],
    ['academic.homework', 'Homework', 'academic', { lowerPrimaryMinutes: 20, upperPrimaryMinutes: 45, weekendHomework: true }, 'P.1–P.3 about 20 minutes a night, P.4–P.7 about 45 minutes. Nursery has no written homework.'],
    ['academic.ple_candidates', 'PLE candidate preparation', 'academic', { remedialLessons: '4:30–5:30 pm', saturdayClasses: true, mockExams: 2 }, 'P.7 candidates attend evening remedial lessons and two mock examinations before PLE.'],
    ['attendance.reporting_time', 'Reporting time', 'attendance', { gatesOpen: '07:00', lateAfter: '07:45', assembly: '07:50' }, 'Pupils arriving after 7:45 am are marked late.'],
    ['attendance.absence', 'Absence', 'attendance', { notifyParentAfterDays: 2, sickNoteRequired: true }, 'Parents are contacted after two consecutive days of unexplained absence.'],
    ['welfare.child_protection', 'Child protection', 'welfare', { designatedOfficer: 'Deputy Head Teacher', corporalPunishment: false }, 'Corporal punishment is prohibited. Concerns go to the designated child protection officer.'],
    ['welfare.visiting', 'Visiting days (boarders)', 'welfare', { frequency: 'once a term', hours: '10:00–16:00', foodFromHome: 'dry snacks only' }, 'One visiting Sunday each term for boarding pupils.'],
    ['general.uniform', 'School uniform', 'general', { weekday: 'sky-blue shirt/dress, navy shorts/skirt', sports: 'house T-shirt', shoes: 'black' }, 'Full uniform every school day; house T-shirts on sports afternoons.'],
    ['finance.fees_deadline', 'Fees payment deadline', 'finance', { firstInstalmentPercent: 60, firstInstalmentByWeek: 2, balanceByWeek: 8 }, 'At least 60% of fees by the end of week two, the balance by week eight.'],
  ];
  for (const [key, name, category, value, description] of policies) {
    await prisma.schoolPolicy.upsert({
      where: { organizationId_key: { organizationId: O, key } },
      update: { name, category, value: value as object, description },
      create: { organizationId: O, key, name, category, value: value as object, description },
    });
  }
  log(`school policies: ${policies.length}`);

  // ── Notices ───────────────────────────────────────────────────────────────
  const head = people.leadership[0];
  const headUser = await prisma.user.findFirst({ where: { organizationId: O, email: head.email }, select: { id: true } });
  const p7 = s.classes.get('P7');
  const notices: Array<{ title: string; body: string; days: number; priority?: string; audience?: string[]; classId?: string }> = [
    { title: 'Mid Term III results', body: 'Mid Term III papers are being marked. Class teachers will share results with parents by Friday.', days: -1, audience: ['all'] },
    { title: 'Independence Day — no classes on Friday 9 October', body: 'School is closed on Friday 9 October for Independence Day. Day pupils report back on Monday 12 October.', days: -2, priority: 'high', audience: ['parents', 'students'] },
    { title: 'P.7 PLE registration confirmed', body: `All P.7 candidates are registered with UNEB at centre ${SCHOOL.unebCentre}. Index numbers are on the class notice board.`, days: -12, audience: ['parents', 'students'], classId: p7?.id },
    { title: 'Term III visiting day — Sunday 18 October', body: 'Boarders’ visiting day runs 10:00 am – 4:00 pm. Please bring dry snacks only.', days: -5, audience: ['parents'] },
    { title: 'Evening remedial lessons for P.7', body: 'P.7 remedial lessons run Monday–Friday 4:30–5:30 pm until PLE. Parents please arrange pick-up at 5:45 pm.', days: -25, classId: p7?.id, audience: ['parents', 'students'] },
    { title: 'Fees reminder', body: 'The Term III fees balance is due by week eight. Pay at the bursar’s office, by bank or Mobile Money.', days: -9, audience: ['parents'] },
    { title: 'Staff: schemes of work due', body: 'Heads of department: Term III schemes of work and lesson plans must be approved in the system by Friday of week two.', days: -30, audience: ['staff'] },
    { title: 'Welcome back to Term III', body: 'Welcome back! This term: Mid Term exams in week five, PLE for P.7 in November and speech day on 4 December.', days: -33, audience: ['all'] },
  ];
  for (const n of notices) {
    const exists = await prisma.announcement.findFirst({ where: { organizationId: O, title: n.title } });
    if (exists) continue;
    await prisma.announcement.create({
      data: {
        organizationId: O, title: n.title, body: n.body, scope: n.classId ? 'class' : 'school', scopeId: n.classId ?? null,
        classId: n.classId ?? null, authorId: headUser?.id ?? null, publishedAt: addDays(asOf, n.days),
        expiresAt: addDays(asOf, 45), priority: n.priority ?? 'normal', audience: n.audience ?? ['all'],
      },
    });
  }
  log(`notices: ${notices.length}`);

  // ── Rubrics ───────────────────────────────────────────────────────────────
  const rubricSeeds = [
    {
      name: 'Composition writing (P.4–P.7)',
      description: 'For English compositions, letters and stories.',
      criteria: [
        ['Content and ideas', 'Relevant, well-developed ideas that answer the question.', 8],
        ['Organisation', 'Clear introduction, body and conclusion; paragraphs.', 6],
        ['Language and vocabulary', 'Correct grammar, tenses and a good range of words.', 8],
        ['Spelling, punctuation and handwriting', 'Mechanics and neat, legible work.', 3],
      ],
    },
    {
      name: 'Science practical activity',
      description: 'For P.4–P.7 science activities and observations.',
      criteria: [
        ['Following instructions safely', 'Carries out each step safely and in order.', 5],
        ['Observation and recording', 'Records accurate observations in a table or drawing.', 8],
        ['Explanation', 'Explains the result using science ideas.', 7],
      ],
    },
    {
      name: 'Oral reading (lower primary)',
      description: 'Reading aloud in Literacy II.',
      criteria: [
        ['Accuracy', 'Reads words correctly.', 4],
        ['Fluency', 'Reads smoothly with expression.', 3],
        ['Understanding', 'Answers simple questions on what was read.', 3],
      ],
    },
  ];
  const rubrics = new Map<string, string>();
  for (const rs of rubricSeeds) {
    let rubric = await prisma.rubric.findFirst({ where: { organizationId: O, name: rs.name } });
    if (!rubric) {
      rubric = await prisma.rubric.create({ data: { organizationId: O, name: rs.name, description: rs.description } });
      for (const [i, [name, description, max]] of rs.criteria.entries()) {
        const criterion = await prisma.rubricCriterion.create({
          data: { organizationId: O, rubricId: rubric.id, name: name as string, description: description as string, maxScore: D(max as number), order: i },
        });
        const levels: Array<[string, number]> = [['Excellent', 1], ['Good', 0.75], ['Fair', 0.5], ['Needs improvement', 0.25]];
        await prisma.rubricLevel.createMany({
          data: levels.map(([label, f], li) => ({
            organizationId: O, criterionId: criterion.id, label, score: D(Math.round((max as number) * f)), order: li,
          })),
        });
      }
    }
    rubrics.set(rs.name, rubric.id);
  }
  log(`rubrics: ${rubrics.size}`);

  // ── Homework, P1–P7, this term ────────────────────────────────────────────
  const weekMs = 7 * 86_400_000;
  const weekOfTerm = Math.floor((asOf.getTime() - mondayOf(live.startDate).getTime()) / weekMs) + 1;
  const liveIndex = enrol.terms2026.findIndex((t) => t.id === live.id);
  const topicFor = (gradeCode: string, subjectCode: string, wi: number) => {
    const list = curriculum.topics.filter((t) => t.gradeCode === gradeCode && t.subjectCode === subjectCode && t.termIndex === liveIndex);
    if (!list.length) return 'Revision';
    // Weekly topics in upper primary; a theme lasts about four weeks lower down.
    return list[list.length >= 6 ? Math.min(wi, list.length - 1) : Math.min(list.length - 1, Math.floor(wi / 4))].title;
  };
  const homeworkText: Record<string, (topic: string, wi: number) => [string, string]> = {
    MTC: (t, wi) => [`${t}: exercise ${wi + 3}.${(wi % 3) + 1}`, `Answer questions 1–10 on ${t.toLowerCase()} in your exercise book. Show all your working.`],
    ENG: (t, wi) => wi % 2 ? [`Composition: ${t}`, `Write a composition of about 150 words on "${t}". Use paragraphs and check your spelling.`] : [`${t}: grammar exercise`, `Complete the exercise on ${t.toLowerCase()} on page ${40 + wi * 6} of your English book.`],
    SCI: (t) => [`${t}: questions`, `Answer the six questions on ${t.toLowerCase()}. Draw and label one diagram.`],
    SST: (t) => [`${t}: map and questions`, `Draw a sketch map for ${t.toLowerCase()} and answer the questions that follow.`],
    LIT2: (t) => [`Reading and writing: ${t}`, `Read the story about ${t.toLowerCase()} with a parent, then write five sentences about it.`],
    NUM: (t) => [`Numeracy: ${t}`, `Do the ten sums on ${t.toLowerCase()} in your homework book.`],
  };
  const liveOfferings = teaching.offerings.filter((o) => o.termId === live.id && homeworkText[o.subjectCode] && o.gradeCode.startsWith('P'));
  let homeworkMade = 0;
  let submissionsMade = 0;
  for (const offering of liveOfferings) {
    const members = assessment.pupilsByStream.get(`${offering.gradeCode}:${offering.streamCode}`) ?? [];
    const rosterId = assessment.rosters.get(`${live.name}:${offering.gradeCode}`) ?? null;
    const lower = ['P1', 'P2', 'P3'].includes(offering.gradeCode);
    const weeks = Math.min(weekOfTerm + 1, 13);
    for (let wi = 0; wi < weeks; wi += 1) {
      if (lower && wi % 2 === 1) continue; // lower primary: fortnightly per subject
      const set = addDays(mondayOf(live.startDate), wi * 7 + 1);
      const due = addDays(set, 3);
      if (set.getTime() > asOf.getTime() + 7 * 86_400_000) break;
      const [title, instructions] = homeworkText[offering.subjectCode](topicFor(offering.gradeCode, offering.subjectCode, wi), wi);
      const fullTitle = `Week ${wi + 1} homework — ${title}`;
      if (await prisma.assessment.findFirst({ where: { organizationId: O, courseOfferingId: offering.id, title: fullTitle } })) continue;
      const isDone = due.getTime() < asOf.getTime() - 2 * 86_400_000;
      const isOpen = !isDone && set.getTime() <= asOf.getTime();
      const marked = isDone && rng(`hwmark:${offering.code}:${wi}`)() < 0.9;
      const composition = offering.subjectCode === 'ENG' && wi % 2 === 1;
      const maxScore = composition ? 25 : 10;
      const hw = await prisma.assessment.create({
        data: {
          organizationId: O, courseOfferingId: offering.id, rosterId, subjectId: offering.subjectId, classId: offering.classId,
          sectionId: offering.sectionId, termId: live.id, teacherPartnerId: offering.teacher.id,
          title: fullTitle, description: instructions, kind: 'homework', contribution: 'formative', maxScore: D(maxScore),
          sourceType: 'assignment', status: marked ? 'graded' : isDone ? 'grading' : isOpen ? 'open' : 'published',
          openAt: set, dueAt: new Date(due.getTime() + 8 * 3_600_000), closeAt: addDays(due, 2),
          marksReleaseAt: marked ? addDays(due, 3) : null, hiddenFromStudents: false,
        },
      });
      const assignment = await prisma.assignment.create({
        data: {
          organizationId: O, assessmentId: hw.id, rosterId, instructions, allowLate: true, latePenaltyPercent: D(10),
          maxAttempts: 1, gradingMode: composition ? 'rubric' : 'points', rubricId: composition ? rubrics.get('Composition writing (P.4–P.7)') : null,
          rubricVersion: composition ? 1 : null,
        },
      });
      homeworkMade += 1;
      if (!isDone && !isOpen) continue;

      const saRows: Array<Record<string, unknown>> = [];
      const handIns = new Map<string, { at: Date; late: boolean; score: number | null }>();
      for (const pupil of members) {
        const r = rng(`hw:${pupil.admissionNo}:${hw.title}:${offering.code}`);
        const handedIn = r() < (isOpen ? 0.55 : 0.9);
        const late = handedIn && r() < 0.08;
        const score = handedIn && marked ? assessment.markFor(pupil.admissionNo, offering.subjectCode, `hw:${wi}`, maxScore) : null;
        const at = new Date(due.getTime() + (late ? 30 : -14) * 3_600_000);
        if (handedIn) handIns.set(pupil.id, { at, late, score });
        saRows.push({
          organizationId: O, assessmentId: hw.id, studentProfileId: pupil.id, classId: offering.classId, sectionId: offering.sectionId,
          gradeLevelId: s.grades.get(offering.gradeCode)!.id, termId: live.id, maxScore: D(maxScore),
          status: score !== null ? 'graded' : handedIn ? 'submitted' : 'assigned',
          participation: handedIn || !isDone ? 'present' : 'missing',
          originalScore: score === null ? null : D(score), effectiveScore: score === null ? null : D(score),
          percentage: score === null ? null : D(((score / maxScore) * 100).toFixed(3)),
          approvalStatus: score === null ? 'draft' : 'approved',
          submittedAt: handedIn ? at : null,
          approvedAt: score === null ? null : addDays(due, 3),
          feedback: score === null ? null : score / maxScore >= 0.8 ? 'Very good work.' : score / maxScore < 0.5 ? 'See me — redo the corrections.' : 'Good effort. Do your corrections.',
        });
      }
      await prisma.studentAssessment.createMany({ data: saRows as never[] });
      const saIds = await prisma.studentAssessment.findMany({ where: { assessmentId: hw.id }, select: { id: true, studentProfileId: true } });
      const subs = saIds.filter((x) => handIns.has(x.studentProfileId)).map((x) => {
        const h = handIns.get(x.studentProfileId)!;
        return {
          organizationId: O, assignmentId: assignment.id, studentAssessmentId: x.id, attemptNo: 1, submittedAt: h.at, isLate: h.late,
          content: 'Handed in in the exercise book.', rawScore: h.score === null ? null : D(h.score),
          penaltyApplied: h.late && h.score !== null ? D(Math.round(h.score * 0.1)) : null,
        };
      });
      await prisma.assignmentSubmission.createMany({ data: subs });
      submissionsMade += subs.length;
    }
  }
  ok(`homework: ${homeworkMade} set this term, ${submissionsMade} handed in`);

  // ── LMS quizzes: slots, gradebook column, attempts ────────────────────────
  const quizModules = await prisma.courseModule.findMany({
    where: { organizationId: O, activityType: 'quiz', deletedAt: null },
    select: { id: true, instanceId: true, courseOfferingId: true, assessmentId: true },
  });
  const offeringById = new Map(teaching.offerings.map((o) => [o.id, o]));
  let attempts = 0;
  for (const cm of quizModules) {
    const quiz = await prisma.modQuiz.findFirst({ where: { id: cm.instanceId } });
    const offering = offeringById.get(cm.courseOfferingId);
    if (!quiz?.questionPaperId || !offering) continue;
    const pqs = await prisma.paperQuestion.findMany({ where: { paperId: quiz.questionPaperId }, orderBy: { order: 'asc' } });
    await prisma.quizSlot.createMany({
      skipDuplicates: true,
      data: pqs.map((pq, i) => ({ organizationId: O, quizId: quiz.id, slotNo: i + 1, page: 1, questionId: pq.questionId, maxMark: pq.marks ?? D(1) })),
    });
    if (cm.assessmentId) continue; // already sat on a previous run

    const sat = quiz.openAt !== null && quiz.openAt.getTime() < asOf.getTime();
    const closed = quiz.closeAt !== null && quiz.closeAt.getTime() < asOf.getTime();
    const column = await prisma.assessment.create({
      data: {
        organizationId: O, courseOfferingId: offering.id, subjectId: offering.subjectId, classId: offering.classId, sectionId: offering.sectionId,
        termId: offering.termId, teacherPartnerId: offering.teacher.id, title: quiz.name, kind: 'quiz', contribution: 'formative',
        maxScore: quiz.maxScore, sourceType: 'lms_activity', sourceRef: cm.id, status: closed ? 'graded' : sat ? 'open' : 'published',
        openAt: quiz.openAt, closeAt: quiz.closeAt, marksReleaseAt: closed ? quiz.closeAt : null, hiddenFromStudents: false,
      },
    });
    await prisma.courseModule.update({ where: { id: cm.id }, data: { assessmentId: column.id } });
    if (!sat) continue;

    const questions = await prisma.question.findMany({ where: { id: { in: pqs.map((q) => q.questionId) } }, include: { options: true } });
    const realised = pqs.map((pq) => {
      const q = questions.find((x) => x.id === pq.questionId)!;
      return { questionId: q.id, type: q.type, marks: Number(pq.marks ?? 1), prompt: q.prompt, options: q.options.map((o) => ({ id: o.id, label: o.label, isCorrect: o.isCorrect })), answerKey: q.answerKey };
    });
    const max = realised.reduce((n, q) => n + q.marks, 0);
    const members = assessment.pupilsByStream.get(`${offering.gradeCode}:${offering.streamCode}`) ?? [];
    for (const pupil of members) {
      const r = rng(`quiz:${pupil.admissionNo}:${quiz.id}`);
      if (r() > (closed ? 0.9 : 0.6)) continue;
      const apt = assessment.subjectAptitude(pupil.admissionNo, offering.subjectCode);
      const tries = apt < 0.45 && r() < 0.5 ? 2 : 1;
      let best = 0;
      const sa = await prisma.studentAssessment.create({
        data: {
          organizationId: O, assessmentId: column.id, studentProfileId: pupil.id, classId: offering.classId, sectionId: offering.sectionId,
          gradeLevelId: s.grades.get(offering.gradeCode)!.id, termId: offering.termId, maxScore: quiz.maxScore, status: 'graded',
          participation: 'present', approvalStatus: 'approved',
        },
      });
      for (let attemptNumber = 1; attemptNumber <= tries; attemptNumber += 1) {
        const startedAt = new Date(quiz.openAt!.getTime() + (1 + Math.floor(r() * 5)) * 86_400_000 + (16 + attemptNumber) * 3_600_000);
        const responses = realised.map((q) => {
          const right = r() < apt * 0.9 + 0.1 + (attemptNumber - 1) * 0.1;
          const correct = q.options.find((o) => o.isCorrect)!;
          const chosen = right ? correct : pick(q.options.filter((o) => !o.isCorrect), r);
          return { q, chosen, right };
        });
        const score = responses.reduce((n, x) => n + (x.right ? x.q.marks : 0), 0);
        best = Math.max(best, score);
        const attempt = await prisma.quizAttempt.create({
          data: {
            organizationId: O, paperId: quiz.questionPaperId, studentProfileId: pupil.id, courseOfferingId: offering.id,
            studentAssessmentId: sa.id, attemptNumber, status: 'submitted', startedAt,
            expiresAt: new Date(startedAt.getTime() + (quiz.timeLimitSec ?? 1200) * 1000),
            submittedAt: new Date(startedAt.getTime() + (8 + Math.floor(r() * 10)) * 60_000),
            realisedQuestions: realised as object, autoScore: D(score), manualPending: 0, maxScore: D(max),
          },
        });
        await prisma.quizResponse.createMany({
          data: responses.map((x, i) => ({
            organizationId: O, attemptId: attempt.id, questionId: x.q.questionId, sequenceNumber: i + 1,
            response: { optionId: x.chosen.id }, autoScore: D(x.right ? x.q.marks : 0), isCorrect: x.right,
          })),
        });
        attempts += 1;
      }
      await prisma.studentAssessment.update({
        where: { id: sa.id },
        data: { originalScore: D(best), effectiveScore: D(best), percentage: D(((best / max) * 100).toFixed(3)) },
      });
      await prisma.courseModuleCompletion.upsert({
        where: { courseModuleId_studentProfileId: { courseModuleId: cm.id, studentProfileId: pupil.id } },
        update: {},
        create: { organizationId: O, courseModuleId: cm.id, studentProfileId: pupil.id, state: best / max >= 0.5 ? 'complete_pass' : 'complete_fail', completedAt: new Date() },
      });
    }
  }
  ok(`quizzes: ${quizModules.length} made sittable, ${attempts} attempts submitted`);

  // ── Course progress from completion ───────────────────────────────────────
  const tracked = await prisma.courseModule.findMany({
    where: { organizationId: O, deletedAt: null, completionMode: { not: 'none' } },
    select: { id: true, courseOfferingId: true },
  });
  const modulesByCourse = new Map<string, string[]>();
  for (const m of tracked) modulesByCourse.set(m.courseOfferingId, [...(modulesByCourse.get(m.courseOfferingId) ?? []), m.id]);
  const progressRows: Array<Record<string, unknown>> = [];
  for (const [courseOfferingId, ids] of modulesByCourse) {
    const offering = offeringById.get(courseOfferingId);
    if (!offering) continue;
    const done = await prisma.courseModuleCompletion.groupBy({
      by: ['studentProfileId'],
      where: { organizationId: O, courseModuleId: { in: ids }, state: { not: 'incomplete' } },
      _count: { _all: true },
    });
    const counts = new Map(done.map((d) => [d.studentProfileId, d._count._all]));
    for (const pupil of assessment.pupilsByStream.get(`${offering.gradeCode}:${offering.streamCode}`) ?? []) {
      progressRows.push({
        organizationId: O, studentProfileId: pupil.id, courseOfferingId,
        progressPct: D(Math.round(((counts.get(pupil.id) ?? 0) / ids.length) * 10000) / 100), lastComputedAt: asOf,
      });
    }
  }
  await createManyChunked(prisma.studentCourseProgress as never, progressRows as never[]);
  ok(`course progress: ${progressRows.length} pupil x course rollups`);
}
