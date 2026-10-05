/**
 * Green Valley demo — assessment and marks.
 *
 * The story this builds, which is the thing a client most wants to see:
 *
 *  - **Terms 1 and 2 are finished.** Every core subject has a continuous
 *    assessment and an end-of-term examination, every pupil has a mark, and
 *    every mark is APPROVED. `06-results` turns these into published results
 *    and report cards.
 *  - **Term 3 is live.** The continuous assessment is marked and approved; the
 *    end-of-term examination exists, is open, and is only partly marked — some
 *    subjects entered and awaiting approval, some not started. That is what a
 *    school looks like in week eight, and it is what makes the approval queue
 *    and the "not released yet" state demonstrable.
 *
 * Nursery is deliberately different. Its assessments are `observation` kind
 * against the ECD descriptors, with no examination component, because
 * `result-computation.ts` prints no aggregate, division or position for a
 * descriptor system — and a nursery report card that showed a position would be
 * wrong, not merely unusual.
 *
 * Marks are drawn from a seeded generator keyed on the pupil, so a given child
 * is consistently strong or weak across subjects and across terms. Random
 * per-row marks produce a class where nobody has a profile, which is obvious
 * the moment anyone sorts a markbook.
 */
import { PrismaClient } from '@prisma/client';
import { D, createManyChunked, log, ok, programmeCodeFor, rng, type School } from './shared';
import { coreSubjectsFor, type Reference } from './01-reference';
import type { People } from './02-people';
import type { Enrollment } from './03-enrollment';
import type { Offering, Teaching } from './04-teaching';

/** A pupil's innate ability, 0..1, stable across every subject and term. */
function abilityOf(admissionNo: string): number {
  const r = rng(`ability:${admissionNo}`);
  // Pulled toward the middle so a class is mostly average with tails, rather
  // than uniformly spread.
  return (r() + r() + r()) / 3;
}

/** A pupil's aptitude for one subject — ability nudged per subject. */
function subjectAptitude(admissionNo: string, subjectCode: string): number {
  const base = abilityOf(admissionNo);
  const r = rng(`apt:${admissionNo}:${subjectCode}`);
  return Math.max(0.05, Math.min(0.99, base + (r() - 0.5) * 0.28));
}

/** A mark out of `max`, plausible for this pupil in this subject. */
function markFor(admissionNo: string, subjectCode: string, kind: string, max: number): number {
  const apt = subjectAptitude(admissionNo, subjectCode);
  const r = rng(`mark:${admissionNo}:${subjectCode}:${kind}`);
  // 35%..98% of the paper, centred on aptitude, with a little noise.
  const fraction = 0.35 + apt * 0.6 + (r() - 0.5) * 0.08;
  return Math.max(0, Math.min(max, Math.round(max * Math.max(0.08, Math.min(1, fraction)))));
}

export interface SeededAssessment {
  id: string;
  offering: Offering;
  kind: string;
  componentKind: 'ca' | 'exam';
  maxScore: number;
  /** false for the Term 3 exam rows left mid-marking. */
  approved: boolean;
}

export async function seedAssessment(
  prisma: PrismaClient,
  s: School,
  ref: Reference,
  people: People,
  enrol: Enrollment,
  teaching: Teaching,
) {
  const { O } = s;
  const liveTerm = teaching.liveTerm;

  const pupilsByStream = new Map<string, typeof people.pupils>();
  for (const p of people.pupils) {
    const key = `${p.gradeCode}:${p.streamCode}`;
    const list = pupilsByStream.get(key) ?? [];
    list.push(p);
    pupilsByStream.set(key, list);
  }

  // ── Frozen rosters, one per (class, term) ─────────────────────────────────
  // Publishing an assessment freezes who sat it (ADR-021). A result computed
  // from "whoever is in the class today" changes after a transfer, which is the
  // whole reason these snapshots exist.
  const rosters = new Map<string, string>(); // "Term 3:P5" -> rosterId
  for (const term of enrol.terms2026) {
    for (const gradeCode of [...new Set(people.pupils.map((p) => p.gradeCode))]) {
      const cls = s.classes.get(gradeCode);
      if (!cls) continue;
      const key = `${term.name}:${gradeCode}`;
      const name = `${cls.name} — 2026 ${term.name} (frozen)`;
      // A roster is CAPTURED and then FROZEN, in that order.
      //
      // A database trigger refuses any membership change to a roster that
      // already carries `frozenAt` — which is the point of freezing one. So the
      // row is created unfrozen, the members are written, and only then is it
      // frozen. Creating it frozen and inserting afterwards is rejected
      // outright.
      const existing = await prisma.academicRoster.findFirst({
        where: { organizationId: O, termId: term.id, classId: cls.id, name },
      });
      const roster =
        existing ??
        (await prisma.academicRoster.create({
          data: {
            organizationId: O,
            termId: term.id,
            scopeType: 'class',
            classId: cls.id,
            name,
            source: 'derived_current_class',
            capturedAt: term.startDate,
          },
        }));
      rosters.set(key, roster.id);

      // Self-healing: a run that failed between create and freeze leaves an
      // empty roster, which would otherwise stay empty for ever.
      const memberCount = await prisma.academicRosterMember.count({
        where: { organizationId: O, rosterId: roster.id },
      });
      const members = people.pupils.filter((p) => p.gradeCode === gradeCode);
      if (memberCount !== members.length) {
        if (roster.frozenAt) {
          await prisma.academicRoster.update({ where: { id: roster.id }, data: { frozenAt: null } });
        }
        if (memberCount > 0) {
          await prisma.academicRosterMember.deleteMany({
            where: { organizationId: O, rosterId: roster.id },
          });
        }
        await createManyChunked(
          prisma.academicRosterMember as never,
          members.map((p) => ({
            organizationId: O,
            rosterId: roster.id,
            studentProfileId: p.id,
            classId: cls.id,
            sectionId: s.sections.get(`${p.gradeCode}:${p.streamCode}`)!.id,
            gradeLevelId: s.grades.get(gradeCode)!.id,
          })) as never[],
        );
        await prisma.academicRoster.update({
          where: { id: roster.id },
          data: { frozenAt: term.startDate },
        });
      }
    }
  }
  ok(`frozen rosters: ${rosters.size} (class x term)`);

  // ── Assessments ───────────────────────────────────────────────────────────
  // Only CORE subjects are assessed, because only core subjects carry marks
  // into the term result. RE, ICT, PE and Music are taught and timetabled but
  // not aggregated — adding them to a PLE aggregate would misreport a pupil
  // against the national standard.
  const seeded: SeededAssessment[] = [];
  const studentAssessmentRows: Array<Record<string, unknown>> = [];

  for (const offering of teaching.offerings) {
    const core = coreSubjectsFor(offering.gradeCode);
    if (!core.includes(offering.subjectCode)) continue;

    const programme = programmeCodeFor(offering.gradeCode);
    const isNursery = programme === 'ECD';
    const policy = ref.policies.get(isNursery ? 'ECD' : programme === 'LOWER_PRIMARY' ? 'LOWER' : 'UPPER')!;
    const rosterId = rosters.get(`${offering.termName}:${offering.gradeCode}`) ?? null;
    const members = pupilsByStream.get(`${offering.gradeCode}:${offering.streamCode}`) ?? [];
    const isLive = offering.termId === liveTerm.id;

    /**
     * Which papers this offering has.
     *
     * Nursery gets one observation record per term. Primary gets a continuous
     * assessment and an end-of-term examination, matching the 40/60 policy.
     */
    const papers: Array<{
      title: string;
      kind: string;
      componentKind: 'ca' | 'exam';
      componentId: string;
      max: number;
      /** Whether marks exist, and whether they are approved. */
      state: 'approved' | 'entered' | 'empty';
    }> = isNursery
      ? [
          {
            title: `${offering.termName} observation`,
            kind: 'observation',
            componentKind: 'ca',
            componentId: policy.caId,
            max: 100,
            state: isLive ? 'entered' : 'approved',
          },
        ]
      : [
          {
            title: `${offering.termName} continuous assessment`,
            kind: 'cat',
            componentKind: 'ca',
            componentId: policy.caId,
            max: 40,
            state: 'approved',
          },
          {
            title: `${offering.termName} end of term examination`,
            kind: 'exam',
            componentKind: 'exam',
            componentId: policy.examId ?? policy.caId,
            max: 100,
            // The live term's examination is mid-marking: that is what makes the
            // approval queue and the withheld-mark state demonstrable.
            state: isLive ? (examSat(offering) ? markingStateFor(offering) : 'empty') : 'approved',
          },
        ];

    for (const paper of papers) {
      // `(organizationId, sourceType, sourceRef)` is the idempotency key the
      // adapters use, so the demo borrows it: re-running finds the same row
      // rather than minting a second paper. `manual` is the honest source type —
      // these are teacher-entered papers, not an LMS or exam-session import.
      const sourceRef = `demo:${offering.code}:${paper.kind}`;
      const existing = await prisma.assessment.findFirst({
        where: { organizationId: O, sourceType: 'manual', sourceRef },
      });

      const marksReleased = paper.state === 'approved';
      const assessment =
        existing ??
        (await prisma.assessment.create({
          data: {
            organizationId: O,
            componentId: paper.componentId,
            courseOfferingId: offering.id,
            rosterId,
            subjectId: offering.subjectId,
            classId: offering.classId,
            sectionId: offering.sectionId,
            termId: offering.termId,
            title: paper.title,
            kind: paper.kind as never,
            contribution: 'summative',
            sourceType: 'manual',
            sourceRef,
            maxScore: D(paper.max),
            status: paper.state === 'empty' ? 'published' : paper.state === 'entered' ? 'grading' : 'graded',
            openAt: offering.termName === 'Term 1' ? new Date('2026-02-09') : undefined,
            // A mark reaches a learner only once it is released. The live
            // term's unapproved paper has no release date at all.
            marksReleaseAt: marksReleased ? releaseDateFor(offering.termName) : null,
            hiddenFromStudents: false,
          },
        }));

      seeded.push({
        id: assessment.id,
        offering,
        kind: paper.kind,
        componentKind: paper.componentKind,
        maxScore: paper.max,
        approved: paper.state === 'approved',
      });

      if (existing) continue; // marks already fanned out on a previous run
      if (paper.state === 'empty') continue; // published, nothing entered yet

      for (const pupil of members) {
        const r = rng(`sat:${pupil.admissionNo}:${sourceRef}`);
        // A couple of pupils per class miss a paper; a demo with 100% presence
        // never shows the absence handling.
        const absent = r() < 0.02;
        const score = absent ? null : markFor(pupil.admissionNo, offering.subjectCode, paper.kind, paper.max);
        studentAssessmentRows.push({
          organizationId: O,
          assessmentId: assessment.id,
          studentProfileId: pupil.id,
          classId: offering.classId,
          sectionId: offering.sectionId,
          gradeLevelId: s.grades.get(offering.gradeCode)!.id,
          termId: offering.termId,
          maxScore: D(paper.max),
          status: absent ? 'assigned' : 'graded',
          participation: absent ? 'absent' : 'present',
          originalScore: score === null ? null : D(score),
          effectiveScore: score === null ? null : D(score),
          percentage: score === null ? null : D(((score / paper.max) * 100).toFixed(3)),
          // THE INVARIANT ON DISPLAY: only an approved mark reaches a learner.
          approvalStatus: paper.state === 'approved' ? 'approved' : 'submitted',
        });
      }
    }
  }

  if (studentAssessmentRows.length > 0) {
    await createManyChunked(prisma.studentAssessment as never, studentAssessmentRows as never[], 1000);
  }
  ok(
    `assessments: ${seeded.length} papers, ${studentAssessmentRows.length} pupil marks ` +
      `(${seeded.filter((x) => x.approved).length} approved)`,
  );
  log('Term 3 examination is part-marked on purpose: approval queue + withheld marks');

  return { seeded, rosters, pupilsByStream, abilityOf, subjectAptitude, markFor };
}

/**
 * How far the live term's examination has got, per offering.
 *
 * Deterministic, and deliberately mixed: roughly half the subjects are marked
 * and awaiting approval, a third are untouched, and the rest are approved
 * already. A demo where everything is in one state shows one screen.
 */
function markingStateFor(offering: Offering): 'approved' | 'entered' | 'empty' {
  const r = rng(`marking:${offering.code}`);
  const v = r();
  if (v < 0.25) return 'approved';
  if (v < 0.7) return 'entered';
  return 'empty';
}

/**
 * Whether the live term's end-of-term paper has been written yet.
 *
 * The examination fortnight is the last two weeks of term. Before it, the paper
 * exists and is published but nobody has sat it, so it carries no marks: a
 * demo in October showing December's examination half-marked reads as invented.
 */
function examSat(offering: Offering): boolean {
  const asOf = process.env.DEMO_AS_OF ? new Date(process.env.DEMO_AS_OF) : new Date();
  return asOf.getTime() >= offering.termEnd.getTime() - 14 * 86_400_000;
}

/** Marks go home at the end of the term, not the moment they are entered. */
function releaseDateFor(termName: string): Date {
  if (termName === 'Term 1') return new Date('2026-05-04');
  if (termName === 'Term 2') return new Date('2026-08-19');
  return new Date('2026-12-08');
}

export type Assessment = Awaited<ReturnType<typeof seedAssessment>>;
