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
import { defaultBands } from '../../src/modules/school/assessment/grade-bands';
import { D, createManyChunked, log, ok, programmeCodeFor, rng, type School } from './shared';
import { coreSubjectsFor, type Reference } from './01-reference';
import type { People } from './02-people';
import type { Enrollment } from './03-enrollment';
import type { Teaching } from './04-teaching';
import type { Assessment } from './05-assessment';

/** The band a percentage falls in, for a given system. */
function bandFor(system: string, percent: number) {
  const bands = defaultBands(system);
  // Bands are ordered high to low and cover [min, next.min).
  return bands.find((b) => percent >= b.min) ?? bands[bands.length - 1];
}

/**
 * The PLE division from four subject grades.
 *
 * Uganda aggregates the four examinable subjects' grade points (1–9) and reads
 * a division off the total: 4–12 is Division 1, 13–23 Division 2, 24–29
 * Division 3, 30–34 Division 4, and above that is Ungraded. Worth getting right
 * — a P7 parent reads the division before anything else on the page.
 */
function pleDivision(aggregate: number): string {
  if (aggregate <= 12) return 'Division 1';
  if (aggregate <= 23) return 'Division 2';
  if (aggregate <= 29) return 'Division 3';
  if (aggregate <= 34) return 'Division 4';
  return 'Ungraded';
}

/** PLE grade points: D1=1 … F9=9, from a percentage. */
function plePoints(percent: number): number {
  if (percent >= 85) return 1;
  if (percent >= 80) return 2;
  if (percent >= 70) return 3;
  if (percent >= 65) return 4;
  if (percent >= 60) return 5;
  if (percent >= 55) return 6;
  if (percent >= 50) return 7;
  if (percent >= 40) return 8;
  return 9;
}

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

      const programme = programmeCodeFor(gradeCode);
      const system = programme === 'ECD' ? 'ECD' : 'PLE';
      const descriptor = system === 'ECD';
      const isP7 = gradeCode === 'P7';

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
      const scale = defaultBands(system);

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
          policySnapshot: descriptor
            ? { reporting: 'descriptor', ranksLearners: false }
            : { passMark: 50, weights: { ca: 40, exam: 60 } },
          gradingScaleSnapshot: scale as unknown as Prisma.InputJsonValue,
          rankingPolicySnapshot: descriptor ? { ranksLearners: false } : { rankOn: 'meanPercent' },
          aggregationSnapshot: { ca: 'mean', exam: 'mean' },
          studentCount: members.length,
          publishedAt: term.endDate,
          publishedById: head?.partnerId ?? null,
        },
      });
      resultSets += 1;

      const subjectRows: Array<Record<string, unknown>> = [];
      const termRows: Array<{
        pupilId: string;
        mean: number;
        aggregate: number;
        subjectsPassed: number;
        sectionId: string;
      }> = [];

      for (const pupil of members) {
        let total = 0;
        let counted = 0;
        let aggregate = 0;
        let passed = 0;
        const sectionId = s.sections.get(`${pupil.gradeCode}:${pupil.streamCode}`)!.id;

        for (const subjectCode of core) {
          const subjectId = ref.subjects.get(subjectCode);
          if (!subjectId) continue;

          let caPercent: number;
          let examPercent: number;

          if (run.historical) {
            // No assessment detail last year, so the mark is derived from the
            // pupil's stable aptitude — through the SAME mapping
            // `05-assessment` uses, less a few points because they were a year
            // younger. Deriving it differently gave last year a long tail of
            // 12% means that this year never produces, which reads as a data
            // error rather than as history.
            const r = rng(`hist:${pupil.admissionNo}:${subjectCode}`);
            const apt = assessment.subjectAptitude(pupil.admissionNo, subjectCode);
            const fraction = 0.35 + apt * 0.6 + (r() - 0.5) * 0.08;
            const pct = Math.round(Math.max(20, Math.min(98, fraction * 100 - 3)));
            caPercent = pct;
            examPercent = pct;
          } else {
            caPercent = markIndex.get(`${term.id}|${pupil.id}|${subjectCode}|ca`) ?? 0;
            examPercent = markIndex.get(`${term.id}|${pupil.id}|${subjectCode}|exam`) ?? 0;
            if (caPercent === 0 && examPercent === 0) continue; // nothing approved
          }

          // Nursery is observation-only, so the single record is the result.
          const finalPercent = descriptor
            ? caPercent
            : Math.round((caPercent * 0.4 + examPercent * 0.6) * 100) / 100;
          const band = bandFor(system, finalPercent);
          const points = descriptor ? null : plePoints(finalPercent);
          if (points !== null) aggregate += points;
          if (!descriptor && finalPercent >= 50) passed += 1;

          subjectRows.push({
            organizationId: O,
            resultSetId: resultSet.id,
            studentProfileId: pupil.id,
            subjectId,
            classId: cls.id,
            sectionId,
            gradeLevelId: gradeLevel.id,
            termId: term.id,
            caScore: D(caPercent.toFixed(3)),
            examScore: descriptor ? null : D(examPercent.toFixed(3)),
            finalPercent: D(finalPercent.toFixed(3)),
            grade: band.grade,
            gradePoint: descriptor ? null : D(band.gpa ?? 0),
            points: points === null ? null : points,
            componentBreakdown: descriptor
              ? [{ observation: caPercent }]
              : [{ ca: caPercent, exam: examPercent, weights: { ca: 40, exam: 60 } }],
          });
          total += finalPercent;
          counted += 1;
        }

        if (counted === 0) continue;
        termRows.push({
          pupilId: pupil.id,
          mean: Math.round((total / counted) * 100) / 100,
          aggregate,
          subjectsPassed: passed,
          sectionId,
        });
      }

      subjectResults += subjectRows.length;
      await createManyChunked(prisma.studentSubjectResult as never, subjectRows as never[], 1000);

      // Positions, once every mean is known. Nursery is not ranked.
      const ranked = [...termRows].sort((a, b) => b.mean - a.mean);
      const rankOf = new Map(ranked.map((row, i) => [row.pupilId, i + 1]));

      await createManyChunked(
        prisma.studentTermResult as never,
        termRows.map((row) => ({
          organizationId: O,
          resultSetId: resultSet.id,
          studentProfileId: row.pupilId,
          classId: cls.id,
          sectionId: row.sectionId,
          gradeLevelId: gradeLevel.id,
          termId: term.id,
          meanPercent: D(row.mean.toFixed(3)),
          gpa: descriptor ? null : D((row.mean / 25).toFixed(2)),
          aggregate: descriptor ? null : row.aggregate,
          division: descriptor ? null : isP7 ? pleDivision(row.aggregate) : null,
          subjectsCount: core.length,
          eligible: descriptor ? true : row.subjectsPassed >= Math.ceil(core.length / 2),
          promotionRecommendation: descriptor
            ? 'promote'
            : row.subjectsPassed >= Math.ceil(core.length / 2)
              ? 'promote'
              : row.mean >= 35
                ? 'review'
                : 'repeat',
          // Descriptor systems report no position.
          classRank: descriptor ? null : (rankOf.get(row.pupilId) ?? null),
        })) as never[],
        1000,
      );

      // ── Report cards ────────────────────────────────────────────────────
      // Only for the terms a parent would actually have received one for.
      const cardRows = termRows.map((row) => {
        const pupil = people.pupils.find((p) => p.id === row.pupilId)!;
        const rank = rankOf.get(row.pupilId) ?? null;
        const band = bandFor(system, row.mean);
        return {
          organizationId: O,
          studentProfileId: row.pupilId,
          termId: term.id,
          generatedAt: term.endDate,
          publishedAt: term.endDate,
          classTeacherComment: commentFor(row.mean, descriptor, `${pupil.admissionNo}:ct:${term.id}`),
          principalComment: commentFor(row.mean, descriptor, `${pupil.admissionNo}:hm:${term.id}`),
          payload: {
            student: pupil.name,
            admissionNo: pupil.admissionNo,
            // The class this RESULT SET belongs to, not the pupil's class today.
            class: cls.name,
            term: `${term.name}`,
            gradingSystem: system,
            reporting: descriptor ? 'descriptor' : 'marks',
            meanPercent: descriptor ? null : row.mean,
            descriptor: descriptor ? band.grade : null,
            aggregate: descriptor ? null : row.aggregate,
            division: descriptor || !isP7 ? null : pleDivision(row.aggregate),
            position: descriptor ? null : rank,
            outOf: descriptor ? null : termRows.length,
            subjects: core.length,
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
