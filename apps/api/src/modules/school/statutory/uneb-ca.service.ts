import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { EXAM_LEVEL_STAGE } from './candidate-reference.service';

/** One thing standing between the school and a submittable file. */
export interface CaFinding {
  code:
    | 'NO_CANDIDATE_REFERENCE'
    | 'NO_CANDIDATE_NUMBER'
    | 'NO_CENTRE_NUMBER'
    | 'DUPLICATE_CANDIDATE_NUMBER'
    | 'NO_SUBJECT_ACHIEVEMENT'
    | 'NO_ACTIVITY_OF_INTEGRATION'
    | 'NO_PROJECT_WORK'
    | 'MARKS_NOT_APPROVED'
    | 'NO_PARTICIPATION'
    | 'SCORE_OUT_OF_RANGE'
    | 'NO_SUBJECT_CODE';
  severity: 'blocking' | 'warning';
  detail: string;
  studentProfileId?: string;
  subjectId?: string;
  assessmentId?: string;
}

/** What one candidate contributes for one subject. */
export interface CaSubjectRow {
  subjectId: string;
  subjectCode: string | null;
  subjectName: string;
  subjectAchievement: number | null;
  activityOfIntegration: number | null;
  projectScore: number | null;
  caTotal: number | null;
  caPercent: number | null;
  assessmentCount: number;
  approvedCount: number;
  pendingCount: number;
}

export interface CaCandidateRow {
  studentProfileId: string;
  name: string | null;
  admissionNo: string;
  sex: string | null;
  dateOfBirth: Date | null;
  className: string | null;
  streamName: string | null;
  centreNumber: string | null;
  candidateNumber: string | null;
  indexNumber: string | null;
  referenceStatus: string | null;
  subjects: CaSubjectRow[];
  findings: CaFinding[];
  ready: boolean;
}

/**
 * The UNEB continuous-assessment readiness board (Phase 6).
 *
 * A CA submission is refused wholesale for one bad row, and the deadline does
 * not move. What a school needs before the deadline is therefore not a file —
 * it is the list of exactly which candidates and which subjects are not ready
 * yet, in time to do something about it.
 *
 * Everything here is derived. It reads the canonical mark store
 * (StudentAssessment) and the candidate registry, computes, and writes nothing:
 * a readiness board that could adjust a mark to make itself green would be
 * worse than no board at all.
 *
 * The kinds that make up a CA score are read from the programme's versioned
 * `config`, not hard-coded, so a circular that adds a component is a
 * configuration change. UNEB's current process carries Subject Achievement,
 * Activities of Integration and project work for S3/S4.
 */
@Injectable()
export class UnebCaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
  ) {}

  /**
   * Readiness for one term at one level.
   *
   * `classIds` narrows to the classes an office is working through; without it
   * every class whose programme sits that level is included.
   */
  async readiness(query: { termId: string; level: string; registrationYear?: number; classIds?: string[] }) {
    const stage = EXAM_LEVEL_STAGE[query.level];
    if (!stage) throw new BadRequestException(`Unknown examination level '${query.level}'.`);

    const term = await this.prisma.client.term.findFirst({
      where: { id: query.termId, deletedAt: null },
      select: { id: true, name: true, academicYearId: true, academicYear: { select: { name: true } } },
    });
    if (!term) throw new NotFoundException('Term not found.');

    const registrationYear = query.registrationYear ?? new Date().getFullYear();

    const enrollments = await this.prisma.client.studentEnrollment.findMany({
      where: { status: 'ACTIVE', academicYearId: term.academicYearId, programme: { stage: stage as never } },
      select: {
        studentProfileId: true,
        programme: { select: { id: true, code: true, config: true } },
        gradeLevel: { select: { id: true, name: true } },
      },
    });
    if (enrollments.length === 0) {
      return this.emptyBoard(term, query.level, registrationYear, 'No active learner is enrolled on a programme that sits this level.');
    }

    const learners = await this.prisma.client.studentProfile.findMany({
      where: {
        id: { in: enrollments.map((e) => e.studentProfileId) },
        deletedAt: null,
        ...(query.classIds?.length ? { currentClassId: { in: query.classIds } } : {}),
      },
      select: {
        id: true,
        admissionNo: true,
        gender: true,
        dateOfBirth: true,
        partner: { select: { name: true } },
        currentClass: { select: { id: true, name: true } },
        currentStream: { select: { name: true } },
      },
    });
    if (learners.length === 0) {
      return this.emptyBoard(term, query.level, registrationYear, 'No learner in the selected classes sits this level.');
    }
    const studentIds = learners.map((l) => l.id);

    // Requirements are the UNION across the programmes the selected learners are
    // enrolled on, not the first one's. A level can be sat under more than one
    // programme version mid-transition, and reading only the first would quietly
    // drop a requirement for everybody on the other.
    const configs = enrollments.map((e) => (e.programme?.config ?? {}) as Record<string, unknown>);
    const requiresAoi = configs.some((c) => c.activitiesOfIntegration === true);
    const requiresProject = configs.some((c) => c.projectWork === true);

    const references = await this.prisma.client.studentExamReference.findMany({
      where: { studentProfileId: { in: studentIds }, level: query.level, registrationYear, deletedAt: null },
    });
    const refByStudent = new Map(references.map((r) => [r.studentProfileId, r]));
    const candidateNoCounts = new Map<string, number>();
    for (const r of references) {
      if (!r.candidateNumber) continue;
      candidateNoCounts.set(r.candidateNumber, (candidateNoCounts.get(r.candidateNumber) ?? 0) + 1);
    }

    // The mark ledger for the term, one read.
    //
    // Two kinds are excluded. An `exam` is the sat paper, which is the board's
    // own mark and not continuous assessment. An `attendance` assessment is a
    // presence record projected into the spine — counting it as a subject
    // achievement score would put a register percentage into a CA submission.
    const marks = await this.prisma.client.studentAssessment.findMany({
      where: {
        studentProfileId: { in: studentIds },
        termId: query.termId,
        deletedAt: null,
        assessment: { deletedAt: null, kind: { notIn: ['exam', 'attendance'] } },
      },
      select: {
        studentProfileId: true,
        effectiveScore: true,
        maxScore: true,
        percentage: true,
        participation: true,
        approvalStatus: true,
        assessment: { select: { id: true, kind: true, subjectId: true, title: true, courseOffering: { select: { subjectId: true } } } },
      },
    });

    const subjectIds = [
      ...new Set(
        marks
          .map((m) => m.assessment?.subjectId ?? m.assessment?.courseOffering?.subjectId)
          .filter((v): v is string => Boolean(v)),
      ),
    ];
    const subjects = subjectIds.length
      ? await this.prisma.client.subject.findMany({ where: { id: { in: subjectIds } }, select: { id: true, code: true, name: true } })
      : [];
    const subjectById = new Map(subjects.map((s) => [s.id, s]));

    const marksByStudent = new Map<string, typeof marks>();
    for (const m of marks) {
      const bucket = marksByStudent.get(m.studentProfileId) ?? [];
      bucket.push(m);
      marksByStudent.set(m.studentProfileId, bucket);
    }

    const rows: CaCandidateRow[] = learners.map((learner) => {
      const ref = refByStudent.get(learner.id) ?? null;
      const findings: CaFinding[] = [];

      if (!ref) {
        findings.push({
          code: 'NO_CANDIDATE_REFERENCE',
          severity: 'blocking',
          detail: 'This learner has no candidate reference for the sitting.',
          studentProfileId: learner.id,
        });
      } else {
        if (!ref.candidateNumber) {
          findings.push({ code: 'NO_CANDIDATE_NUMBER', severity: 'blocking', detail: 'No candidate number assigned.', studentProfileId: learner.id });
        } else if ((candidateNoCounts.get(ref.candidateNumber) ?? 0) > 1) {
          findings.push({
            code: 'DUPLICATE_CANDIDATE_NUMBER',
            severity: 'blocking',
            detail: `Candidate number ${ref.candidateNumber} is held by more than one learner.`,
            studentProfileId: learner.id,
          });
        }
        if (!ref.centreNumber) {
          findings.push({ code: 'NO_CENTRE_NUMBER', severity: 'blocking', detail: 'No centre number recorded.', studentProfileId: learner.id });
        }
      }

      const mine = marksByStudent.get(learner.id) ?? [];
      const bySubject = new Map<string, typeof marks>();
      for (const m of mine) {
        const subjectId = m.assessment?.subjectId ?? m.assessment?.courseOffering?.subjectId;
        if (!subjectId) continue;
        const bucket = bySubject.get(subjectId) ?? [];
        bucket.push(m);
        bySubject.set(subjectId, bucket);
      }

      const subjectRows: CaSubjectRow[] = [...bySubject.entries()].map(([subjectId, entries]) => {
        const subject = subjectById.get(subjectId);
        if (!subject?.code) {
          findings.push({
            code: 'NO_SUBJECT_CODE',
            severity: 'warning',
            detail: `${subject?.name ?? 'A subject'} has no code; the board file needs one.`,
            studentProfileId: learner.id,
            subjectId,
          });
        }

        const achievement = this.meanPercent(entries.filter((e) => !['project', 'activity_of_integration'].includes(e.assessment?.kind ?? '')));
        const aoi = this.meanPercent(entries.filter((e) => e.assessment?.kind === 'activity_of_integration'));
        const project = this.meanPercent(entries.filter((e) => e.assessment?.kind === 'project'));

        const approvedCount = entries.filter((e) => e.approvalStatus === 'approved').length;
        const pendingCount = entries.length - approvedCount;

        if (achievement == null) {
          findings.push({
            code: 'NO_SUBJECT_ACHIEVEMENT',
            severity: 'blocking',
            detail: `No approved classroom score for ${subject?.name ?? subjectId}.`,
            studentProfileId: learner.id,
            subjectId,
          });
        }
        if (requiresAoi && aoi == null) {
          findings.push({
            code: 'NO_ACTIVITY_OF_INTEGRATION',
            severity: 'blocking',
            detail: `No approved Activity of Integration for ${subject?.name ?? subjectId}.`,
            studentProfileId: learner.id,
            subjectId,
          });
        }
        if (requiresProject && project == null) {
          findings.push({
            code: 'NO_PROJECT_WORK',
            severity: 'warning',
            detail: `No approved project score for ${subject?.name ?? subjectId}.`,
            studentProfileId: learner.id,
            subjectId,
          });
        }
        if (pendingCount > 0) {
          findings.push({
            code: 'MARKS_NOT_APPROVED',
            severity: 'blocking',
            detail: `${pendingCount} mark(s) in ${subject?.name ?? subjectId} are entered but not approved.`,
            studentProfileId: learner.id,
            subjectId,
          });
        }
        for (const e of entries) {
          if (e.effectiveScore == null && e.participation === 'present' && e.approvalStatus === 'approved') {
            findings.push({
              code: 'NO_PARTICIPATION',
              severity: 'blocking',
              detail: `An approved row in ${subject?.name ?? subjectId} has neither a mark nor a terminal participation.`,
              studentProfileId: learner.id,
              subjectId,
              assessmentId: e.assessment?.id,
            });
          }
          if (e.effectiveScore != null && Number(e.effectiveScore) > Number(e.maxScore)) {
            findings.push({
              code: 'SCORE_OUT_OF_RANGE',
              severity: 'blocking',
              detail: `A mark in ${subject?.name ?? subjectId} exceeds its maximum.`,
              studentProfileId: learner.id,
              subjectId,
              assessmentId: e.assessment?.id,
            });
          }
        }

        const parts = [achievement, aoi, project].filter((v): v is number => v != null);
        const caTotal = parts.length ? round2(parts.reduce((a, b) => a + b, 0)) : null;
        const caPercent = parts.length ? round2(parts.reduce((a, b) => a + b, 0) / parts.length) : null;

        return {
          subjectId,
          subjectCode: subject?.code ?? null,
          subjectName: subject?.name ?? 'Unknown subject',
          subjectAchievement: achievement,
          activityOfIntegration: aoi,
          projectScore: project,
          caTotal,
          caPercent,
          assessmentCount: entries.length,
          approvedCount,
          pendingCount,
        };
      });

      if (subjectRows.length === 0) {
        findings.push({
          code: 'NO_SUBJECT_ACHIEVEMENT',
          severity: 'blocking',
          detail: 'This candidate has no classroom assessment in the selected term.',
          studentProfileId: learner.id,
        });
      }

      return {
        studentProfileId: learner.id,
        name: learner.partner?.name ?? null,
        admissionNo: learner.admissionNo,
        sex: normaliseSex(learner.gender),
        dateOfBirth: learner.dateOfBirth,
        className: learner.currentClass?.name ?? null,
        streamName: learner.currentStream?.name ?? null,
        centreNumber: ref?.centreNumber ?? null,
        candidateNumber: ref?.candidateNumber ?? null,
        indexNumber: ref?.indexNumber ?? null,
        referenceStatus: ref?.status ?? null,
        subjects: subjectRows.sort((a, b) => a.subjectName.localeCompare(b.subjectName)),
        findings,
        ready: findings.every((f) => f.severity !== 'blocking'),
      };
    });

    const blocking = rows.flatMap((r) => r.findings.filter((f) => f.severity === 'blocking'));
    const warnings = rows.flatMap((r) => r.findings.filter((f) => f.severity === 'warning'));

    return {
      term: { id: term.id, name: term.name, academicYear: term.academicYear?.name ?? null },
      level: query.level,
      registrationYear,
      requires: { activitiesOfIntegration: requiresAoi, projectWork: requiresProject },
      summary: {
        candidates: rows.length,
        ready: rows.filter((r) => r.ready).length,
        blocked: rows.filter((r) => !r.ready).length,
        blockingFindings: blocking.length,
        warningFindings: warnings.length,
        byCode: tally([...blocking, ...warnings].map((f) => f.code)),
      },
      candidates: rows.sort((a, b) => (a.candidateNumber ?? 'zz').localeCompare(b.candidateNumber ?? 'zz')),
    };
  }

  /**
   * The flat rows a `uneb_ca` export renders — one per candidate per subject.
   *
   * Blocked candidates are still returned, marked, so the export service can
   * refuse the file and name them rather than silently producing a short one.
   */
  async caRows(query: { termId: string; level: string; registrationYear?: number; classIds?: string[] }) {
    const board = await this.readiness(query);
    if (!('candidates' in board)) return { rows: [], board };

    const rows = board.candidates.flatMap((c) =>
      c.subjects.map((s) => ({
        studentProfileId: c.studentProfileId,
        ready: c.ready,
        centreNumber: c.centreNumber,
        candidateNumber: c.candidateNumber,
        indexNumber: c.indexNumber,
        studentName: c.name,
        surname: splitName(c.name).surname,
        otherNames: splitName(c.name).otherNames,
        sex: c.sex,
        dateOfBirth: c.dateOfBirth,
        className: c.className,
        streamName: c.streamName,
        subjectCode: s.subjectCode,
        subjectName: s.subjectName,
        subjectAchievement: s.subjectAchievement,
        activityOfIntegration: s.activityOfIntegration,
        projectScore: s.projectScore,
        caTotal: s.caTotal,
        caPercent: s.caPercent,
        assessmentCount: s.assessmentCount,
        termName: board.term.name,
        academicYear: board.term.academicYear,
      })),
    );
    return { rows, board };
  }

  /** Mean of the released percentages in a bucket, or null when nothing counts. */
  private meanPercent(entries: Array<{ effectiveScore: unknown; maxScore: unknown; percentage: unknown; participation: string; approvalStatus: string }>): number | null {
    const counted = entries.filter(
      (e) =>
        e.approvalStatus === 'approved' &&
        // Exempt work is excluded from aggregation; blank is not zero.
        e.participation !== 'exempt' &&
        e.participation !== 'not_enrolled' &&
        e.effectiveScore != null,
    );
    if (counted.length === 0) return null;
    const percents = counted.map((e) => {
      if (e.percentage != null) return Number(e.percentage);
      const max = Number(e.maxScore);
      return max > 0 ? (Number(e.effectiveScore) / max) * 100 : 0;
    });
    return round2(percents.reduce((a, b) => a + b, 0) / percents.length);
  }

  private emptyBoard(
    term: { id: string; name: string; academicYear: { name: string } | null },
    level: string,
    registrationYear: number,
    note: string,
  ) {
    return {
      term: { id: term.id, name: term.name, academicYear: term.academicYear?.name ?? null },
      level,
      registrationYear,
      requires: { activitiesOfIntegration: false, projectWork: false },
      summary: { candidates: 0, ready: 0, blocked: 0, blockingFindings: 0, warningFindings: 0, byCode: {} as Record<string, number> },
      candidates: [] as CaCandidateRow[],
      note,
    };
  }
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

const tally = (codes: string[]): Record<string, number> =>
  codes.reduce<Record<string, number>>((acc, code) => ({ ...acc, [code]: (acc[code] ?? 0) + 1 }), {});

/**
 * Uganda records a learner's name surname-first on school registers, and that is
 * the order a board file expects. Splitting on the first token matches the
 * convention without inventing a second name field on the profile.
 *
 * Two forms occur in real registers and both must give the same answer:
 *
 *   "Nakato Ada Grace"    → Nakato / Ada Grace
 *   "Nakato, Ada Grace"   → Nakato / Ada Grace
 *
 * The comma form is why this is not a bare `split(/\s+/)`: that leaves the
 * surname as "Nakato," — a trailing comma that then has to be quoted in the
 * file, and that a board's parser has been known to reject outright.
 */
export const splitName = (full: string | null): { surname: string; otherNames: string } => {
  if (!full) return { surname: '', otherNames: '' };
  const trimmed = full.trim();
  const comma = trimmed.indexOf(',');
  if (comma > 0) {
    return {
      surname: trimmed.slice(0, comma).trim(),
      otherNames: trimmed.slice(comma + 1).trim().replace(/\s+/g, ' '),
    };
  }
  const parts = trimmed.split(/\s+/);
  return { surname: parts[0] ?? '', otherNames: parts.slice(1).join(' ') };
};

const normaliseSex = (gender: string | null): string | null => {
  if (!gender) return null;
  const g = gender.trim().toUpperCase();
  if (g.startsWith('M')) return 'M';
  if (g.startsWith('F')) return 'F';
  return null;
};
