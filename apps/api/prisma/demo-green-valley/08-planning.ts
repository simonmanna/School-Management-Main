/**
 * Green Valley demo — schemes of work, lesson plans and delivery.
 *
 * This is the part a Ugandan head of department asks about first, because it is
 * what an inspector asks them for. The demo shows the whole paper trail:
 *
 *  - a **scheme of work** per course, broken into teaching weeks with the
 *    curriculum items each week covers;
 *  - **lesson plans** against those weeks, in every workflow state — approved
 *    for weeks gone by, submitted and awaiting the HOD for this week, draft for
 *    next week — because a demo where everything is approved cannot show the
 *    review queue;
 *  - **scheduled lessons** generated from the timetable, with **deliveries**
 *    recorded for the ones that have already happened, so "planned versus
 *    taught" coverage is a real number rather than a zero.
 *
 * Attendance registers are here too, for the same reason: an attendance rate
 * of 0% makes every dashboard look broken.
 */
import { PrismaClient } from '@prisma/client';
import {
  addDays, createManyChunked, log, mondayOf, ok, pick, rng, schoolDays, type School,
} from './shared';
import type { Reference } from './01-reference';
import type { People } from './02-people';
import type { Enrollment } from './03-enrollment';
import type { Teaching } from './04-teaching';
import type { Assessment } from './05-assessment';
import type { Lms } from './07-lms';

/** Teaching activities a primary lesson plan is built from. */
const ACTIVITY_SHAPES = [
  { type: 'teacher_instruction', title: 'Introduction and review of last lesson', minutes: 5 },
  { type: 'discussion', title: 'Class discussion of the new idea', minutes: 10 },
  { type: 'group', title: 'Group work with examples', minutes: 15 },
  { type: 'worksheet', title: 'Individual practice in exercise books', minutes: 8 },
  { type: 'teacher_instruction', title: 'Summary and homework', minutes: 2 },
];

export async function seedPlanning(
  prisma: PrismaClient,
  s: School,
  ref: Reference,
  people: People,
  enrol: Enrollment,
  teaching: Teaching,
  assessment: Assessment,
  lms: Lms,
) {
  const { O } = s;
  const liveTerm = teaching.liveTerm;
  const asOf = new Date();

  // Planning records are built for the courses that have content — a scheme of
  // work for two hundred courses is noise, and no school writes them all.
  const planned = lms.showcaseOfferings;

  let schemes = 0;
  let weeks = 0;
  let items = 0;
  let plans = 0;
  let scheduled = 0;
  let delivered = 0;

  // The syllabus is the same source the LMS course pages used, read back off
  // the course sections so the two cannot drift.
  for (const offering of planned) {
    const sections = await prisma.courseSection.findMany({
      where: { organizationId: O, courseOfferingId: offering.id, sectionNo: { gt: 0 } },
      orderBy: { sectionNo: 'asc' },
    });
    if (sections.length === 0) continue;

    // ── Scheme of work ──────────────────────────────────────────────────────
    const existingScheme = await prisma.schemeOfWork.findFirst({
      where: { organizationId: O, courseOfferingId: offering.id },
    });
    const scheme =
      existingScheme ??
      (await prisma.schemeOfWork.create({
        data: {
          organizationId: O,
          courseOfferingId: offering.id,
          title: `${offering.gradeCode} ${offering.subjectCode} — ${liveTerm.name} scheme of work`,
          status: 'active',
          summary: `Scheme of work for ${offering.gradeCode} ${offering.streamCode} ${offering.subjectCode}, ${liveTerm.name} 2026.`,
          approvedAt: liveTerm.startDate,
        },
      }));
    if (!existingScheme) schemes += 1;

    for (const section of sections) {
      const weekNo = section.sectionNo;
      const weekStart = mondayOf(addDays(liveTerm.startDate, (weekNo - 1) * 7));
      const topic = (section.name ?? `Week ${weekNo}`).replace(/^Week \d+:\s*/, '');

      const existingWeek = await prisma.schemeOfWorkWeek.findFirst({
        where: { schemeOfWorkId: scheme.id, weekNumber: weekNo },
      });
      const week =
        existingWeek ??
        (await prisma.schemeOfWorkWeek.create({
          data: {
            organizationId: O,
            schemeOfWorkId: scheme.id,
            weekNumber: weekNo,
            weekStart,
            theme: topic,
            plannedPeriods: 5,
            notes: weekNo === 3 ? 'Two periods lost to the sports gala.' : null,
          },
        }));
      if (!existingWeek) {
        weeks += 1;
        // One scheme item per objective — the units of work the plans deliver.
        const objectives = (section.summary ?? '').replace(/<[^>]+>/g, '').replace(/\.$/, '');
        const titles = [topic, objectives].filter(Boolean);
        for (const [i, title] of titles.entries()) {
          await prisma.schemeOfWorkItem.create({
            data: {
              organizationId: O,
              schemeOfWorkWeekId: week.id,
              title,
              order: i,
              plannedPeriods: i === 0 ? 3 : 2,
            },
          });
          items += 1;
        }
      }

      // ── Lesson plan for the week ──────────────────────────────────────────
      //
      // The workflow state is staged against the CURRENT WEEK, not against the
      // exact instant: weeks before last are approved, last week and this week
      // are submitted and waiting on the head of department, and later weeks
      // are still drafts.
      //
      // Comparing `weekEnd < now` instead looked right and produced an empty
      // review queue whenever the seed happened to run on a weekend — the day
      // boundary fell between "finished" and "started", so no plan was ever
      // `submitted`. A demo of an approval workflow with nothing to approve is
      // worse than no demo, so the staging is explicit.
      const currentWeekStart = mondayOf(asOf);
      const state =
        weekStart < addDays(currentWeekStart, -7)
          ? 'approved'
          : weekStart <= currentWeekStart
            ? 'submitted'
            : 'draft';

      const existingPlan = await prisma.lessonPlan.findFirst({
        where: {
          organizationId: O,
          courseOfferingId: offering.id,
          schemeOfWorkWeekId: week.id,
        },
      });
      if (existingPlan) continue;

      const plan = await prisma.lessonPlan.create({
        data: {
          organizationId: O,
          courseOfferingId: offering.id,
          subjectId: offering.subjectId,
          classId: offering.classId,
          termId: offering.termId,
          teacherPartnerId: offering.teacher.id,
          schemeOfWorkWeekId: week.id,
          weekOf: weekStart,
          title: `${topic} — ${offering.gradeCode} ${offering.streamCode}`,
          objectives: (section.summary ?? '').replace(/<[^>]+>/g, ''),
          materials: pick(
            [
              'Chalkboard, counters, exercise books',
              'Wall chart, flash cards, exercise books',
              'Textbook, manila paper, markers',
              'Real objects from around the school, exercise books',
            ],
            rng(`materials:${offering.code}:${weekNo}`),
          ),
          subtopic: topic,
          workflowStatus: state,
          version: 1,
          publishedAt: state === 'approved' ? weekStart : null,
        },
      });
      plans += 1;

      // Activities, so a printed plan has a lesson in it rather than a title.
      for (const [i, shape] of ACTIVITY_SHAPES.entries()) {
        const activity = await prisma.learningActivity.create({
          data: {
            organizationId: O,
            type: shape.type,
            title: shape.title,
            content: {},
          },
        });
        await prisma.lessonPlanActivity.create({
          data: {
            organizationId: O,
            lessonPlanId: plan.id,
            learningActivityId: activity.id,
            sequence: i,
            durationMin: shape.minutes,
            teacherInstructions:
              i === 0
                ? `Recap last week briefly, then introduce ${topic.toLowerCase()}.`
                : i === 2
                  ? 'Move around the groups and check every book.'
                  : null,
            studentInstructions: i === 3 ? 'Work on your own. Put your hand up if you are stuck.' : null,
          },
        });
      }

      // Assessment and differentiation — the sections an inspector looks for.
      await prisma.lessonPlanAssessment.createMany({
        data: [
          {
            organizationId: O,
            lessonPlanId: plan.id,
            kind: 'exit_ticket',
            prompt: `Two questions on ${topic.toLowerCase()} before the pupils leave.`,
            sequence: 0,
          },
          {
            organizationId: O,
            lessonPlanId: plan.id,
            kind: 'success_criteria',
            prompt: 'A pupil can explain the idea in their own words and work one example unaided.',
            sequence: 1,
          },
        ],
      });
      await prisma.lessonPlanDifferentiation.createMany({
        data: [
          {
            organizationId: O,
            lessonPlanId: plan.id,
            tier: 'support',
            description: 'Counters stay on the desk; work in a pair with a stronger pupil.',
          },
          {
            organizationId: O,
            lessonPlanId: plan.id,
            tier: 'extension',
            description: 'Two harder word problems for the pupils who finish early.',
          },
        ],
      });

      // A reflection, but only on lessons already taught — a reflection written
      // before the lesson is the thing an inspector would query.
      if (state === 'approved') {
        const rr = rng(`reflect:${offering.code}:${weekNo}`);
        await prisma.lessonPlanReflection.create({
          data: {
            organizationId: O,
            lessonPlanId: plan.id,
            whatWorked: pick(
              [
                'The group work went well. Most pupils could explain the idea back to me.',
                'Using real objects helped the slower pupils follow.',
                'The exit ticket showed most of the class had understood.',
              ],
              rr,
            ),
            whatDidnt: pick(
              [
                'The last activity was rushed; I will give it a full period next time.',
                'Two groups had no textbook to share.',
                'Time was short because the lesson started late.',
              ],
              rr,
            ),
            teacherPerceivedAchievement: pick(
              ['Most met the objective', 'About half met the objective', 'Nearly all met the objective'],
              rr,
            ),
            studentsNeedingSupport: 'Three pupils to be seen in the remedial class on Friday.',
            followUp: 'Re-teach the second objective at the start of next week.',
          },
        });
      }

      // The HOD's review, for the plans that were approved.
      if (state === 'approved') {
        await prisma.lessonPlanReview.create({
          data: {
            organizationId: O,
            lessonPlanId: plan.id,
            reviewerId: people.leadership.find((l) => l.role === 'Director of Studies')?.partnerId ?? null,
            fromStatus: 'submitted',
            toStatus: 'approved',
            comment: 'Clear objectives and good differentiation. Approved.',
          },
        });
      }
    }
  }
  ok(`schemes of work: ${schemes}, ${weeks} weeks, ${items} curriculum items`);
  ok(`lesson plans: ${plans} (approved for past weeks, submitted for this week, draft for next)`);

  // ── Scheduled lessons, from the timetable ────────────────────────────────
  // The timetable is the schedule authority, so the week's lessons are
  // materialised from its slots rather than invented here.
  const plannedIds = new Set(planned.map((p) => p.id));
  const slots = await prisma.timetableSlot.findMany({
    where: { organizationId: O, courseOfferingId: { in: [...plannedIds] }, type: 'lesson' },
  });
  const plansByOfferingWeek = new Map<string, string>();
  for (const plan of await prisma.lessonPlan.findMany({
    where: { organizationId: O, courseOfferingId: { in: [...plannedIds] } },
    select: { id: true, courseOfferingId: true, weekOf: true },
  })) {
    plansByOfferingWeek.set(`${plan.courseOfferingId}:${plan.weekOf.toISOString().slice(0, 10)}`, plan.id);
  }

  const existingLessons = await prisma.scheduledLesson.count({
    where: { organizationId: O, courseOfferingId: { in: [...plannedIds] } },
  });
  if (existingLessons === 0) {
    // Six weeks of the live term, up to and including the current week.
    const termStart = mondayOf(liveTerm.startDate);
    for (let w = 0; w < 6; w += 1) {
      const weekStart = addDays(termStart, w * 7);
      if (weekStart > addDays(asOf, 7)) break;
      for (const slot of slots) {
        const date = addDays(weekStart, slot.dayOfWeek - 1);
        if (date > addDays(asOf, 7)) continue;
        const lessonPlanId = plansByOfferingWeek.get(
          `${slot.courseOfferingId}:${weekStart.toISOString().slice(0, 10)}`,
        );
        const isPast = date < asOf;
        const lesson = await prisma.scheduledLesson.create({
          data: {
            organizationId: O,
            courseOfferingId: slot.courseOfferingId!,
            timetableSlotId: slot.id,
            lessonPlanId: lessonPlanId ?? null,
            plannedDate: date,
            teacherPartnerId: slot.teacherPartnerId,
            room: slot.room,
            status: isPast ? 'completed' : 'scheduled',
          },
        });
        scheduled += 1;

        // What actually happened. Coverage is "planned versus delivered", so a
        // demo with no deliveries reports nothing taught all term.
        if (isPast) {
          const dr = rng(`deliver:${lesson.id}`);
          const roll = dr();
          await prisma.lessonDelivery.create({
            data: {
              organizationId: O,
              scheduledLessonId: lesson.id,
              lessonPlanId: lessonPlanId ?? null,
              status: roll < 0.08 ? 'partially_delivered' : 'delivered',
              startedAt: date,
              completedAt: date,
              deliveredById: slot.teacherPartnerId,
              coveredContent:
                roll < 0.08
                  ? 'Covered the first two objectives only.'
                  : 'Covered the week’s objectives as planned.',
              // Coverage reporting reads the variance, so a partly delivered
              // lesson has to say why.
              varianceReason:
                roll < 0.08 ? 'Ran out of time; the last objective moves to the next lesson.' : null,
            },
          });
          delivered += 1;
        }
      }
    }
  }
  ok(`scheduled lessons: ${scheduled}, with ${delivered} deliveries recorded`);

  // ── Attendance registers ─────────────────────────────────────────────────
  // Three weeks for every stream, which is enough for a rate, a trend and a
  // few absences to follow up.
  const existingAttendance = await prisma.studentAttendance.count({ where: { organizationId: O } });
  if (existingAttendance === 0) {
    const statuses = await prisma.attendanceStatusConfig.findMany({ where: { organizationId: O } });
    const statusByCode = new Map(statuses.map((x) => [x.code, x]));
    const from = addDays(mondayOf(asOf), -14);
    const days = schoolDays(from, addDays(asOf, -1));
    const rows: Array<Record<string, unknown>> = [];

    for (const pupil of people.pupils) {
      const section = s.sections.get(`${pupil.gradeCode}:${pupil.streamCode}`)!;
      const cls = s.classes.get(pupil.gradeCode)!;
      // A pupil's own attendance habit, so the register shows persistent
      // absentees rather than noise evenly spread.
      const habit = rng(`attend:${pupil.admissionNo}`);
      const reliability = 0.84 + habit() * 0.15;
      for (const day of days) {
        const dr = rng(`attend:${pupil.admissionNo}:${day.toISOString().slice(0, 10)}`);
        const v = dr();
        const code = v < reliability ? 'P' : v < reliability + 0.04 ? 'L' : v < reliability + 0.1 ? 'S' : 'A';
        const cfg = statusByCode.get(code);
        rows.push({
          organizationId: O,
          studentProfileId: pupil.id,
          classId: cls.id,
          sectionId: section.id,
          date: day,
          status: code,
          statusCfgId: cfg?.id ?? null,
          markedById: people.classTeachers.get(`${pupil.gradeCode}:${pupil.streamCode}`)?.partnerId ?? null,
        });
      }
    }
    await createManyChunked(prisma.studentAttendance as never, rows as never[], 1000);
    ok(`attendance: ${rows.length} register entries over ${days.length} school days`);
  } else {
    log(`attendance: ${existingAttendance} entries already present, left alone`);
  }

  return { schemes, plans, scheduled, delivered };
}

export type Planning = Awaited<ReturnType<typeof seedPlanning>>;
