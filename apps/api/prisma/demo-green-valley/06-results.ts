/**
 * Green Valley demo — results and report cards.
 *
 * What a client asks to see first, and the hardest thing to fake convincingly.
 *
 * Three vintages, which is what makes the demo read as a working school rather
 * than a fresh install:
 *
 *  - **2025 Term 3 — historical.** Term results and report cards only, no
 *    assessment detail. This is honestly what a school that imported last
 *    year's results looks like, and it gives the promotion decisions something
 *    to stand on.
 *  - **2026 Terms 1 and 2 — published.** Computed from the approved marks in
 *    `05-assessment`, with subject results, term results, class positions and
 *    published report cards.
 *  - **2026 Term 3 — nothing.** The term is live and its examination is still
 *    being marked, so there is no result set. That absence is the point: it is
 *    what the "results not ready" state looks like.
 *
 * Nursery reports descriptors. `isDescriptorSystem` in the real
 * `result-computation.ts` suppresses aggregate, division, GPA and position for
 * an ECD scale, so the nursery result sets here carry no rank and no GPA —
 * printing a position for a four-year-old would be wrong, not merely unusual.
 */
import { PrismaClient, Prisma } from '@prisma/client';
import { resolveScale } from '../../src/modules/school/assessment/grade-bands';
import {
  computeResultSet,
  isDescriptorSystem,
  type ResultInput,
  type StudentInput,
  type SubjectInput,
} from '../../src/modules/school/assessment/result-computation';
import { reportingPolicy } from '../../src/modules/school/assessment/reporting-policy';
import { createManyChunked, log, ok, programmeCodeFor, rng, type School } from './shared';
import { coreSubjectsFor, type Reference } from './01-reference';
import type { People } from './02-people';
import type { Enrollment } from './03-enrollment';
import type { Teaching } from './04-teaching';
import type { Assessment } from './05-assessment';

export async function seedResults(
  prisma: PrismaClient,
  s: School,
  ref: Reference,
  people: People,
  enrol: Enrollment,
  teaching: Teaching,
  assessment: Assessment,
) {
  const { O } = s;
  const head = people.leadership.find((l) => l.role === 'Head Teacher');
  // `resolveScale` reads through a tenant client; the seed's client is not
  // scoped, so scope it to this school.
  const orgScales = {
    gradingScale: {
      findMany: (args: { where?: Record<string, unknown> }) =>
        prisma.gradingScale.findMany({ ...args, where: { ...(args?.where ?? {}), organizationId: O } }),
    },
  };

  const gradeCodes = [...new Set(people.pupils.map((p) => p.gradeCode))];

  /**
   * Who was in which grade LAST year.
   *
   * Read from the 2025 `StudentEnrollment` rows rather than derived by
   * subtracting one from this year's grade: `03-enrollment` already decided who
   * repeated and who transferred in, and a second, differently-derived answer
   * here would disagree with it. A 2025 result set has to belong to the class
   * those pupils were actually in, or the report card says P4 while the result
   * set says P5.
   */
  const gradeIdToCode = new Map([...s.grades.entries()].map(([code, g]) => [g.id, code]));
  const enrolments2025 = await prisma.studentEnrollment.findMany({
    where: { organizationId: O, academicYearId: enrol.year2025.id },
    select: { studentProfileId: true, gradeLevelId: true },
  });
  const pupilsByGrade2025 = new Map<string, string[]>();
  for (const e of enrolments2025) {
    const code = gradeIdToCode.get(e.gradeLevelId);
    if (!code) continue;
    const list = pupilsByGrade2025.get(code) ?? [];
    list.push(e.studentProfileId);
    pupilsByGrade2025.set(code, list);
  }

  /** Published result sets: 2026 Terms 1 and 2, plus 2025 Term 3 as history. */
  const runs: Array<{ term: (typeof enrol.terms2026)[number]; label: string; historical: boolean }> = [
    { term: enrol.terms2025[2], label: '2025 Term 3', historical: true },
    { term: enrol.terms2026[0], label: '2026 Term 1', historical: false },
    { term: enrol.terms2026[1], label: '2026 Term 2', historical: false },
  ];

  // Marks, indexed for the computed terms.
  const approvedByTerm = new Map<string, Map<string, { ca: number[]; exam: number[]; max: { ca: number; exam: number } }>>();
  for (const a of assessment.seeded) {
    if (!a.approved) continue;
    const perTerm = approvedByTerm.get(a.offering.termId) ?? new Map();
    approvedByTerm.set(a.offering.termId, perTerm);
  }

  // Load the approved marks once per computed term rather than per pupil.
  const markIndex = new Map<string, number>(); // "termId|pupilId|subject|componentKind" -> score%
  for (const term of enrol.terms2026.slice(0, 2)) {
    const ids = assessment.seeded.filter((a) => a.offering.termId === term.id && a.approved).map((a) => a.id);
    if (ids.length === 0) continue;
    const byAssessment = new Map(
      assessment.seeded.filter((a) => ids.includes(a.id)).map((a) => [a.id, a]),
    );
    const marks = await prisma.studentAssessment.findMany({
      where: { organizationId: O, assessmentId: { in: ids }, approvalStatus: 'approved' },
      select: { assessmentId: true, studentProfileId: true, percentage: true },
    });
    for (const m of marks) {
      const a = byAssessment.get(m.assessmentId);
      if (!a || m.percentage === null) continue;
      markIndex.set(
        `${term.id}|${m.studentProfileId}|${a.offering.subjectCode}|${a.componentKind}`,
        Number(m.percentage),
      );
    }
  }

  let resultSets = 0;
  let subjectResults = 0;
  let reportCards = 0;

  for (const run of runs) {
    const term = run.term;
    if (!term) continue;

    for (const gradeCode of gradeCodes) {
      const cls = s.classes.get(gradeCode);
      const gradeLevel = s.grades.get(gradeCode);
      if (!cls || !gradeLevel) continue;

      // A historical set belongs to the class those pupils were in LAST year,
      // so it is built from the 2025 enrolment rows for THIS grade.
      const members = run.historical
        ? people.pupils.filter((p) => (pupilsByGrade2025.get(gradeCode) ?? []).includes(p.id))
        : people.pupils.filter((p) => p.gradeCode === gradeCode);
      if (members.length === 0) continue;

      const core = coreSubjectsFor(gradeCode);
      if (core.length === 0) continue;

      const idempotencyKey = `demo:${term.id}:${gradeCode}`;
      const existingRun = await prisma.resultProcessingRun.findFirst({
        where: { organizationId: O, idempotencyKey },
      });
      if (existingRun) continue; // already seeded

      const rosterId = assessment.rosters.get(`${term.name}:${gradeCode}`) ?? null;

      // The SAME rules the product applies (review A6 / Phase 0.8): the
      // programme's grading profile through `reportingPolicy`, the school's own
      // scale through `resolveScale`, and the numbers from the real result
      // kernel. The demo used to write its own grades, points and divisions,
      // which printed "80% C3 … Distinction" and P7-only divisions.
      const programmeCode = programmeCodeFor(gradeCode);
      const programmeRow = await prisma.academicProgramme.findFirst({
        where: { organizationId: O, code: programmeCode },
        select: { stage: true, config: true },
      });
      const policy = reportingPolicy(programmeRow, 'PLE');
      const system = policy.gradingSystem;
      const descriptor = isDescriptorSystem(system);
      const aggregateSubjectIds =
        system === 'PLE'
          ? [...new Set([
              ...policy.aggregateSubjectIds,
              ...policy.aggregateSubjectCodes.map((c) => ref.subjects.get(c)).filter((x): x is string => !!x),
            ])].sort()
          : undefined;
      const scale = await resolveScale(orgScales, system);
      const weighting = ref.policies.get(programmeCode === 'ECD' ? 'ECD' : programmeCode === 'LOWER_PRIMARY' ? 'LOWER' : 'UPPER')!;
      const caWeight = weighting.examId ? 40 : 100;
      const components = [
        { id: weighting.caId, kind: 'cat', weight: caWeight, aggregation: 'mean' as const },
        ...(weighting.examId ? [{ id: weighting.examId, kind: 'exam', weight: 100 - caWeight, aggregation: 'mean' as const }] : []),
      ];

      const sectionOf = new Map(members.map((p) => [p.id, s.sections.get(`${p.gradeCode}:${p.streamCode}`)!.id]));
      const students: StudentInput[] = [];
      for (const pupil of members) {
        const subjects: SubjectInput[] = [];
        for (const subjectCode of core) {
          const subjectId = ref.subjects.get(subjectCode);
          if (!subjectId) continue;
          let caPercent: number | undefined;
          let examPercent: number | undefined;
          if (run.historical) {
            // No assessment detail last year, so the mark is derived from the
            // pupil's stable aptitude — through the SAME mapping
            // `05-assessment` uses, less a few points because they were a year
            // younger.
            const r = rng(`hist:${pupil.admissionNo}:${subjectCode}`);
            const apt = assessment.subjectAptitude(pupil.admissionNo, subjectCode);
            const fraction = 0.35 + apt * 0.6 + (r() - 0.5) * 0.08;
            caPercent = Math.round(Math.max(20, Math.min(98, fraction * 100 - 3)));
            examPercent = caPercent;
          } else {
            caPercent = markIndex.get(`${term.id}|${pupil.id}|${subjectCode}|ca`);
            examPercent = markIndex.get(`${term.id}|${pupil.id}|${subjectCode}|exam`);
            if (caPercent === undefined && examPercent === undefined) continue; // nothing approved
          }
          const datum = (componentId: string, kind: string, pct: number | undefined) =>
            pct === undefined
              ? []
              : [{ componentId, kind, effectiveScore: pct.toFixed(3), maxScore: '100', participation: 'present' }];
          subjects.push({
            subjectId,
            isCompulsory: true,
            passMark: descriptor ? 0 : 50,
            components,
            assessments: [
              ...datum(weighting.caId, 'cat', caPercent),
              ...(weighting.examId ? datum(weighting.examId, 'exam', examPercent) : []),
            ],
          });
        }
        if (subjects.length) {
          students.push({ studentProfileId: pupil.id, classId: cls.id, sectionId: sectionOf.get(pupil.id), gradeLevelId: gradeLevel.id, termId: term.id, subjects });
        }
      }
      if (students.length === 0) continue;

      const input: ResultInput = {
        gradingSystem: system as ResultInput['gradingSystem'],
        bands: scale.bands,
        bandRounding: scale.rounding,
        roundingMode: 'half_up',
        decimalPlaces: 2,
        rankOn: policy.rankOn,
        aggregateSubjectIds,
        students,
      };
      const output = computeResultSet(input);

      const processing = await prisma.resultProcessingRun.create({
        data: {
          organizationId: O,
          termId: term.id,
          scopeType: 'class',
          scopeId: cls.id,
          rosterId,
          status: 'succeeded',
          calculationVersion: 'v1',
          idempotencyKey,
          inputChecksum: `demo-${gradeCode}-${term.id}`,
          outputChecksum: `demo-${gradeCode}-${term.id}`,
          completedAt: term.endDate,
        },
      });

      const resultSet = await prisma.resultSet.create({
        data: {
          organizationId: O,
          runId: processing.id,
          termId: term.id,
          scopeType: 'class',
          scopeId: cls.id,
          rosterId,
          revision: 1,
          status: 'published',
          calculationVersion: 'v1',
          gradingSystem: system,
          policySnapshot: { components, passMark: descriptor ? 0 : 50 } as unknown as Prisma.InputJsonValue,
          gradingScaleSnapshot: { bands: scale.bands, bandRounding: scale.rounding, scaleId: scale.scaleId } as unknown as Prisma.InputJsonValue,
          rankingPolicySnapshot: { rankOn: input.rankOn, aggregateSubjectIds: aggregateSubjectIds ?? null } as unknown as Prisma.InputJsonValue,
          aggregationSnapshot: { cat: 'mean', exam: 'mean' },
          studentCount: output.students.length,
          publishedAt: term.endDate,
          publishedById: head?.partnerId ?? null,
        },
      });
      resultSets += 1;

      const subjectRows: Array<Record<string, unknown>> = [];
      const termRows: Array<Record<string, unknown>> = [];
      for (const st of output.students) {
        const position = { classId: cls.id, sectionId: sectionOf.get(st.studentProfileId) ?? null, gradeLevelId: gradeLevel.id, termId: term.id };
        for (const sub of st.subjects) {
          subjectRows.push({
            organizationId: O,
            resultSetId: resultSet.id,
            studentProfileId: st.studentProfileId,
            subjectId: sub.subjectId,
            ...position,
            caScore: sub.caScore ?? null,
            examScore: sub.examScore ?? null,
            finalPercent: sub.finalPercent ?? null,
            grade: sub.grade,
            gradePoint: sub.gradePoint ?? null,
            points: sub.points ?? null,
            subjectRank: sub.subjectRank ?? null,
            componentBreakdown: sub.componentBreakdown as unknown as Prisma.InputJsonValue,
          });
        }
        termRows.push({
          organizationId: O,
          resultSetId: resultSet.id,
          studentProfileId: st.studentProfileId,
          ...position,
          gpa: st.term.gpa ?? null,
          aggregate: st.term.aggregate ?? null,
          division: st.term.division ?? null,
          meanPercent: st.term.meanPercent ?? null,
          classRank: st.term.classRank ?? null,
          subjectsCount: st.term.subjectsCount,
          eligible: st.term.eligible,
          promotionRecommendation: st.term.promotionRecommendation,
        });
      }
      subjectResults += subjectRows.length;
      await createManyChunked(prisma.studentSubjectResult as never, subjectRows as never[], 1000);
      await createManyChunked(prisma.studentTermResult as never, termRows as never[], 1000);

      // ── Report cards ────────────────────────────────────────────────────
      // Only for the terms a parent would actually have received one for. The
      // card prints from the stored result above; the payload carries the same
      // headline for the portal, never a figure of its own.
      const ranked = output.students.filter((x) => x.term.classRank != null).length;
      const cardRows = output.students.map((st) => {
        const pupil = people.pupils.find((p) => p.id === st.studentProfileId)!;
        const mean = st.term.meanPercent != null ? Number(st.term.meanPercent) : 0;
        return {
          organizationId: O,
          studentProfileId: st.studentProfileId,
          termId: term.id,
          generatedAt: term.endDate,
          publishedAt: term.endDate,
          classTeacherComment: commentFor(mean, descriptor, `${pupil.admissionNo}:ct:${term.id}`),
          principalComment: headComment(mean, descriptor, st.term.division, `${pupil.admissionNo}:hm:${term.id}`),
          payload: {
            student: pupil.name,
            admissionNo: pupil.admissionNo,
            // The class this RESULT SET belongs to, not the pupil's class today.
            class: cls.name,
            term: `${term.name}`,
            gradingSystem: system,
            descriptorOnly: descriptor,
            meanPercent: descriptor ? null : mean,
            aggregate: st.term.aggregate,
            division: st.term.division,
            position: st.term.classRank,
            outOf: st.term.classRank != null ? ranked : null,
            subjects: st.subjects.length,
          } as Prisma.InputJsonValue,
        };
      });
      reportCards += cardRows.length;
      await createManyChunked(prisma.reportCard as never, cardRows as never[], 500);
    }

    log(`${run.label}: published${run.historical ? ' (historical import)' : ''}`);
  }

  ok(
    `results: ${resultSets} published sets, ${subjectResults} subject results, ${reportCards} report cards`,
  );
  log('2026 Term 3 has no result set on purpose — the term is still running');

  return { resultSets, subjectResults, reportCards };
}

/**
 * A teacher's comment that fits the mark.
 *
 * Picked from pools rather than generated, because a report card whose comment
 * contradicts the mark is the first thing a head teacher notices.
 */
function commentFor(mean: number, descriptor: boolean, key: string): string {
  const r = rng(`comment:${key}`);
  const pools = descriptor
    ? [
        'Settling in well and joining in with the group.',
        'Confident with numbers and enjoys story time.',
        'Growing in confidence. Needs a little encouragement to speak up.',
        'Plays well with others and follows instructions.',
      ]
    : mean >= 80
      ? [
          'An excellent term. Keep up this standard.',
          'Outstanding work throughout the term. Well done.',
          'Very strong performance. A pleasure to teach.',
        ]
      : mean >= 65
        ? [
            'A good term. More practice in the weaker subjects will help.',
            'Working well. Aim a little higher next term.',
            'Steady progress. Keep revising consistently.',
          ]
        : mean >= 50
          ? [
              'A fair term. More effort is needed in class work.',
              'Can do better. Please complete homework on time.',
              'Shows ability but needs to be more consistent.',
            ]
          : [
              'This term was difficult. Extra support has been arranged.',
              'Needs to attend regularly and complete all work.',
              'Please see the class teacher to agree a plan for next term.',
            ];
  return pools[Math.floor(r() * pools.length) % pools.length];
}

export type Results = Awaited<ReturnType<typeof seedResults>>;

/**
 * The head teacher's comment: shorter than the class teacher's, and read off
 * the division where the class has one (P4–P7), else the mean.
 */
function headComment(mean: number, descriptor: boolean, division: string | null, key: string): string {
  const r = rng(`head:${key}`);
  const pools = descriptor
    ? ['A lovely term. Thank you for your support at home.', 'Good progress. We look forward to next term.']
    : division === 'I' || (!division && mean >= 80)
      ? ['Excellent results. Congratulations.', 'Outstanding. Keep shining.']
      : division === 'II' || (!division && mean >= 65)
        ? ['Good results. Keep improving.', 'A good term. Aim for the top.']
        : division === 'III' || (!division && mean >= 50)
          ? ['Fair results. Work harder next term.', 'There is room to improve. More effort, please.']
          : ['Must improve. Parents, please follow up closely.', 'Below expectation. The school will support — please work with us.'];
  return pools[Math.floor(r() * pools.length) % pools.length];
}
