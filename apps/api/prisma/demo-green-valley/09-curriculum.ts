/**
 * Demo stage 9 — the curriculum content, and what pupils have mastered of it.
 *
 * Stages 4–8 built the containers (curricula, courses, schemes, plans) with
 * topic names as plain text. This stage gives them the structured layer the
 * academic screens read:
 *
 *  - competencies (subject strands), topics, learning outcomes and objectives
 *    for every subject line of every 2026 curriculum;
 *  - schemes of work and lesson plans pointed at those topics, outcomes and
 *    objectives;
 *  - every assessment tagged with the outcomes of the topics it covered;
 *  - a competency judgement (not met / approaching / met / exceeded) per pupil
 *    per outcome for the terms taught so far — the CBC-style report;
 *  - objective evidence and mastery for the pupils in built-out LMS courses.
 *
 * Idempotent: rows are found by natural key; bulk rows use skipDuplicates or
 * are written only when the organization has none.
 */
import { PrismaClient } from '@prisma/client';
import { D, createManyChunked, log, ok, rng, type School } from './shared';
import { coreSubjectsFor, type Reference } from './01-reference';
import type { People } from './02-people';
import type { Enrollment } from './03-enrollment';
import type { Teaching } from './04-teaching';
import type { Assessment } from './05-assessment';
import type { Lms } from './07-lms';
import { STRANDS, outcomesFor, syllabusObjectives, topicsFor } from './syllabus';

interface TopicRow {
  id: string;
  gradeCode: string;
  subjectCode: string;
  termIndex: number;
  title: string;
  outcomeIds: string[];
  objectiveIds: string[];
}

/** A judgement from a 0–100 score, on the scale the competency report uses. */
function levelFor(pct: number): 'not_met' | 'approaching' | 'met' | 'exceeded' {
  if (pct >= 80) return 'exceeded';
  if (pct >= 60) return 'met';
  if (pct >= 40) return 'approaching';
  return 'not_met';
}

export async function seedCurriculum(
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
  const asOf = new Date();
  const terms = enrol.terms2026;
  const liveIndex = terms.findIndex((t) => t.id === teaching.liveTerm.id);

  // ── Competencies: one per subject strand ──────────────────────────────────
  const competencyIds = new Map<string, string[]>(); // subjectCode -> ids by strand
  for (const [subjectCode, strands] of Object.entries(STRANDS)) {
    const subjectId = ref.subjects.get(subjectCode);
    if (!subjectId) continue;
    const ids: string[] = [];
    for (const st of strands) {
      const code = `${subjectCode}-${st.code}`;
      const row = await prisma.competency.upsert({
        where: { organizationId_code: { organizationId: O, code } },
        update: { description: st.description, subjectId },
        create: { organizationId: O, code, description: st.description, subjectId, level: 'primary' },
      });
      ids.push(row.id);
    }
    competencyIds.set(subjectCode, ids);
  }

  // ── Topics, outcomes, objectives per curriculum subject line ──────────────
  const subjectCodeById = new Map([...ref.subjects.entries()].map(([code, id]) => [id, code]));
  const topics: TopicRow[] = [];
  for (const [gradeCode, curriculumId] of teaching.curricula) {
    const lines = await prisma.curriculumSubject.findMany({ where: { organizationId: O, curriculumId } });
    for (const line of lines) {
      const subjectCode = subjectCodeById.get(line.subjectId);
      if (!subjectCode) continue;
      const byTerm = topicsFor(gradeCode, subjectCode);
      let order = 0;
      for (const [termIndex, titles] of byTerm.entries()) {
        for (const [i, title] of titles.entries()) {
          order += 1;
          const strands = competencyIds.get(subjectCode) ?? [];
          const competencyId = strands.length ? strands[i % strands.length] : null;
          const topic =
            (await prisma.topic.findFirst({ where: { organizationId: O, curriculumSubjectId: line.id, title } })) ??
            (await prisma.topic.create({
              data: { organizationId: O, curriculumId, curriculumSubjectId: line.id, competencyId, title, order },
            }));

          const outcomeIds: string[] = [];
          for (const [oi, text] of outcomesFor(subjectCode, title).entries()) {
            const row =
              (await prisma.learningOutcome.findFirst({ where: { organizationId: O, topicId: topic.id, title: text } })) ??
              (await prisma.learningOutcome.create({
                data: {
                  organizationId: O, subjectId: line.subjectId, topicId: topic.id, competencyId, title: text,
                  description: `${gradeCode} · Term ${termIndex + 1} · ${title}`, expectedLevel: 'met', order: oi,
                },
              }));
            outcomeIds.push(row.id);
          }

          // Objectives where the term's lessons are planned to that grain.
          const objectiveIds: string[] = [];
          for (const description of syllabusObjectives(subjectCode, title)) {
            const row =
              (await prisma.learningObjective.findFirst({ where: { organizationId: O, topicId: topic.id, description } })) ??
              (await prisma.learningObjective.create({
                data: { organizationId: O, topicId: topic.id, description, bloomLevel: 'apply' },
              }));
            objectiveIds.push(row.id);
          }
          topics.push({ id: topic.id, gradeCode, subjectCode, termIndex, title, outcomeIds, objectiveIds });
        }
      }
    }
  }
  const outcomeCount = topics.reduce((n, t) => n + t.outcomeIds.length, 0);
  ok(`curriculum content: ${topics.length} topics, ${outcomeCount} learning outcomes, ${[...competencyIds.values()].flat().length} competencies`);

  const topicsOf = (gradeCode: string, subjectCode: string, termIndex: number) =>
    topics.filter((t) => t.gradeCode === gradeCode && t.subjectCode === subjectCode && t.termIndex === termIndex);
  const findTopic = (gradeCode: string, subjectCode: string, title: string) =>
    topics.find((t) => t.gradeCode === gradeCode && t.subjectCode === subjectCode && t.title === title);

  // How much of a term has been taught, as a count of its topics.
  const taughtCount = (termIndex: number, total: number) => {
    if (termIndex < liveIndex) return total;
    if (termIndex > liveIndex) return 0;
    const t = terms[termIndex];
    const share = (asOf.getTime() - t.startDate.getTime()) / (t.endDate.getTime() - t.startDate.getTime());
    // Weekly upper-primary topics run six weeks; the rest spread over the term.
    return total >= 6
      ? Math.min(total, Math.max(1, Math.floor((asOf.getTime() - t.startDate.getTime()) / (7 * 86_400_000)) + 1))
      : Math.min(total, Math.max(1, Math.ceil(share * total)));
  };

  // ── Schemes of work and lesson plans, pointed at the structure ────────────
  const offeringById = new Map(teaching.offerings.map((o) => [o.id, o]));
  const schemes = await prisma.schemeOfWork.findMany({
    where: { organizationId: O },
    include: { weeks: { include: { items: true } } },
  });
  let linkedItems = 0;
  for (const scheme of schemes) {
    const offering = offeringById.get(scheme.courseOfferingId ?? '');
    if (!offering) continue;
    for (const week of scheme.weeks) {
      const topic = findTopic(offering.gradeCode, offering.subjectCode, week.theme ?? '');
      if (!topic) continue;
      for (const item of week.items) {
        if (item.topicId) continue;
        await prisma.schemeOfWorkItem.update({
          where: { id: item.id },
          data: {
            topicId: topic.id,
            learningOutcomeId: topic.outcomeIds[item.order === 0 ? 0 : 1] ?? null,
            learningObjectiveId: item.order === 0 ? null : topic.objectiveIds[0] ?? null,
          },
        });
        linkedItems += 1;
      }
      const plans = await prisma.lessonPlan.findMany({ where: { organizationId: O, schemeOfWorkWeekId: week.id } });
      for (const plan of plans) {
        if (!plan.topicId) await prisma.lessonPlan.update({ where: { id: plan.id }, data: { topicId: topic.id } });
        await prisma.lessonPlanObjective.createMany({
          skipDuplicates: true,
          data: topic.objectiveIds.map((learningObjectiveId) => ({ organizationId: O, lessonPlanId: plan.id, learningObjectiveId })),
        });
        await prisma.lessonPlanOutcome.createMany({
          skipDuplicates: true,
          data: topic.outcomeIds.map((learningOutcomeId) => ({ organizationId: O, lessonPlanId: plan.id, learningOutcomeId })),
        });
      }
    }
  }
  log(`schemes of work: ${linkedItems} items linked to topics and outcomes; lesson plans carry objectives`);

  // ── Assessments tagged with what they assessed ────────────────────────────
  const outcomeRows: Array<Record<string, unknown>> = [];
  for (const a of assessment.seeded) {
    const termIndex = terms.findIndex((t) => t.id === a.offering.termId);
    const covered = topicsOf(a.offering.gradeCode, a.offering.subjectCode, termIndex);
    // A CA covers what was taught before it; the examination covers the term.
    const upto = a.componentKind === 'exam' ? covered.length : taughtCount(termIndex, covered.length);
    for (const t of covered.slice(0, Math.max(1, upto))) {
      for (const learningOutcomeId of t.outcomeIds) {
        outcomeRows.push({ organizationId: O, assessmentId: a.id, learningOutcomeId });
      }
    }
  }
  await createManyChunked(prisma.assessmentOutcome as never, outcomeRows as never[]);
  log(`assessment outcomes: ${outcomeRows.length} links`);

  // ── Competency judgements per pupil ───────────────────────────────────────
  const existingAchievements = await prisma.studentOutcomeAchievement.count({ where: { organizationId: O } });
  let achievements = 0;
  if (existingAchievements === 0) {
    const assessors = new Map(teaching.offerings.map((o) => [`${o.termId}:${o.gradeCode}:${o.streamCode}:${o.subjectCode}`, o.teacher.id]));
    const rows: Array<Record<string, unknown>> = [];
    for (const pupil of people.pupils) {
      for (const subjectCode of coreSubjectsFor(pupil.gradeCode)) {
        for (let termIndex = 0; termIndex <= liveIndex; termIndex += 1) {
          const term = terms[termIndex];
          const covered = topicsOf(pupil.gradeCode, subjectCode, termIndex);
          for (const t of covered.slice(0, taughtCount(termIndex, covered.length))) {
            for (const learningOutcomeId of t.outcomeIds) {
              const r = rng(`outcome:${pupil.admissionNo}:${learningOutcomeId}`);
              // Centred where a sound school sits: most pupils meet the outcome.
              const pct = Math.round(Math.max(5, Math.min(99, 30 + assessment.subjectAptitude(pupil.admissionNo, subjectCode) * 68 + (r() - 0.5) * 22)));
              const level = levelFor(pct);
              rows.push({
                organizationId: O,
                studentProfileId: pupil.id,
                learningOutcomeId,
                termId: term.id,
                level,
                masteryPercent: pct,
                comment: level === 'not_met' ? 'Needs extra support and practice.' : level === 'exceeded' ? 'Excellent grasp — extend with harder tasks.' : null,
                assessedById: assessors.get(`${term.id}:${pupil.gradeCode}:${pupil.streamCode}:${subjectCode}`) ?? null,
              });
            }
          }
        }
      }
    }
    achievements = await createManyChunked(prisma.studentOutcomeAchievement as never, rows as never[], 2000);
  }
  ok(`competency judgements: ${achievements || existingAchievements} (pupil x outcome x term taught so far)`);

  // ── Objective evidence and mastery, for built-out LMS courses ─────────────
  const existingEvidence = await prisma.learningObjectiveEvidence.count({ where: { organizationId: O } });
  if (existingEvidence === 0) {
    const evidence: Array<Record<string, unknown>> = [];
    const progress: Array<Record<string, unknown>> = [];
    const weights: Record<string, number> = { ASSESSMENT: 0.4, QUIZ: 0.3, ASSIGNMENT: 0.2, TEACHER_OBSERVATION: 0.1 };
    for (const offering of lms.showcaseOfferings) {
      const covered = topicsOf(offering.gradeCode, offering.subjectCode, liveIndex);
      const done = covered.slice(0, Math.max(0, taughtCount(liveIndex, covered.length) - 1));
      const members = assessment.pupilsByStream.get(`${offering.gradeCode}:${offering.streamCode}`) ?? [];
      for (const pupil of members) {
        for (const [wi, t] of done.entries()) {
          const weekEnd = new Date(terms[liveIndex].startDate.getTime() + (wi + 1) * 7 * 86_400_000);
          for (const learningObjectiveId of t.objectiveIds) {
            let total = 0;
            let wsum = 0;
            for (const sourceType of ['TEACHER_OBSERVATION', 'ASSIGNMENT', ...(wi === 1 || wi === 4 ? ['QUIZ'] : [])]) {
              const r = rng(`evidence:${pupil.admissionNo}:${learningObjectiveId}:${sourceType}`);
              const score = Math.round(Math.max(10, Math.min(100, 25 + assessment.subjectAptitude(pupil.admissionNo, offering.subjectCode) * 72 + (r() - 0.45) * 30)));
              evidence.push({
                organizationId: O, studentProfileId: pupil.id, learningObjectiveId, sourceType,
                sourceId: offering.id, normalizedScore: D(score), proficiency: levelFor(score), observedAt: weekEnd,
              });
              total += score * weights[sourceType];
              wsum += weights[sourceType];
            }
            progress.push({
              organizationId: O, studentProfileId: pupil.id, learningObjectiveId,
              masteryPct: D((total / wsum).toFixed(2)), lastComputedAt: weekEnd,
            });
          }
        }
      }
    }
    await createManyChunked(prisma.learningObjectiveEvidence as never, evidence as never[], 2000);
    await createManyChunked(prisma.learningObjectiveProgress as never, progress as never[], 2000);
    ok(`mastery: ${evidence.length} pieces of objective evidence, ${progress.length} mastery scores`);
  } else {
    log(`mastery: ${existingEvidence} evidence rows already present`);
  }

  return { topics };
}

export type Curriculum = Awaited<ReturnType<typeof seedCurriculum>>;
