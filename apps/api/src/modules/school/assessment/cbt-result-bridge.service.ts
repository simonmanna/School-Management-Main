import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { MarkingService } from './marking.service';

/**
 * Approver of record for machine-marked CBT attempts. A sentinel rather than a
 * real user id: no person approved it, and the audit trail should say so
 * plainly rather than borrowing whoever happened to trigger the sync.
 */
export const CBT_AUTOMARK_ACTOR = 'system:cbt-automark';

/**
 * P1-A bridge: posts an auto-marked CBT/quiz attempt into the assessment spine
 * so that quiz marks are treated exactly like any other assessment when the
 * result spine computes term aggregates (no double entry, no orphan scores).
 *
 * A quiz maps to one `Assessment` (sourceType `quiz`, sourceRef `<paperId>:<studentProfileId>`)
 * plus one `StudentAssessment` per attempt. We resolve the student's class + term
 * from their active roster membership (falling back to the term on the paper's
 * subject if no active roster is found). The spine's recompute keeps
 * effectiveScore / percentage current.
 */
@Injectable()
export class CbtResultBridgeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly marking: MarkingService,
  ) {}

  /** Called from CbtAttemptService.finalize once a quiz is fully auto-marked. */
  async postAttempt(
    tx: any,
    args: {
      organizationId: string;
      quizAttemptId: string;
      paperId: string;
      studentProfileId: string;
      autoScore: number;
      maxScore: number;
      subjectId?: string | null;
      classId?: string | null;
      termId?: string | null;
    },
  ): Promise<void> {
    const { organizationId, quizAttemptId, paperId, studentProfileId, autoScore, maxScore } = args;

    // If this paper is sat as an LMS quiz activity, that activity's Assessment
    // is the grade item the course already displays — post into it rather than
    // minting a parallel quiz-sourced one. `CbtAttemptService.start` links new
    // attempts up front; this covers attempts started before that landed.
    const lmsStudentAssessmentId = await this.resolveLmsStudentAssessment(tx, paperId, studentProfileId);
    if (lmsStudentAssessmentId) {
      await this.marking.postMark(tx, {
        studentAssessmentId: lmsStudentAssessmentId,
        score: autoScore,
        source: 'quiz',
        comment: `cbt:${quizAttemptId}`,
        onOutOfRange: 'clamp',
      });
      return;
    }

    // Resolve subject/class/term when not supplied.
    let subjectId = args.subjectId ?? null;
    let classId = args.classId ?? null;
    let termId = args.termId ?? null;
    if (!subjectId || !classId || !termId) {
      const paper = await tx.paper.findFirst({
        where: { id: paperId },
      });
      subjectId = subjectId ?? paper?.subjectId ?? null;
      // Prefer the student's active roster for class/term.
      const roster = await tx.academicRosterMember.findFirst({
        where: { studentProfileId, roster: { organizationId } },
        include: { roster: true },
        orderBy: { roster: { capturedAt: 'desc' } },
      });
      if (roster) {
        classId = classId ?? roster.classId ?? null;
        termId = termId ?? roster.roster.termId ?? null;
      }
      termId = termId ?? roster?.roster.termId ?? null;
    }
    if (!subjectId || !classId || !termId) return; // cannot place into spine

    // Per-PAPER, not per-student. Every other producer keys its assessment to
    // the activity, and one assessment per student meant a quiz could never
    // carry a weight, a lock, or a gradebook column of its own.
    const sourceRef = `quiz:${paperId}`;
    const assessment = await tx.assessment.upsert({
      where: { organizationId_sourceType_sourceRef: { organizationId, sourceType: 'quiz', sourceRef } },
      create: {
        organizationId,
        subjectId,
        classId,
        termId,
        title: `CBT ${paperId.slice(0, 8)}`,
        maxScore,
        // A quiz is continuous assessment. Saying so beats leaving `kind` null
        // and relying on the legacy read-time guess, which happens to land on
        // `cat` for a quiz today but does so by accident, not by intent.
        kind: 'cat',
        sourceType: 'quiz',
        sourceRef,
        status: 'graded',
      },
      update: { maxScore, status: 'graded' },
    });

    // P0-7: a machine-marked quiz is auto-approved, but it must still name its
    // approver. Leaving `approvedById` null meant the row satisfied the publish
    // gate twice over — `MARKS_NOT_APPROVED` passed because the status said
    // approved, and `SOD_VIOLATION` passed because the `approvedById &&
    // enteredById` guard short-circuits on a null — so a mark nobody signed off
    // sailed through a gate whose whole job is to prove somebody did.
    //
    // The attempt is graded by the engine, so the engine is the approver of
    // record; there is no human to attribute it to and pretending otherwise
    // would be worse.
    const approvedAt = new Date();
    const sa = await tx.studentAssessment.upsert({
      where: { assessmentId_studentProfileId: { assessmentId: assessment.id, studentProfileId } },
      create: {
        organizationId,
        assessmentId: assessment.id,
        studentProfileId,
        classId,
        termId,
        maxScore,
        status: 'graded',
        participation: 'present',
        approvalStatus: 'approved',
        approvedById: CBT_AUTOMARK_ACTOR,
        approvedAt,
      },
      update: {
        maxScore,
        approvalStatus: 'approved',
        status: 'graded',
        approvedById: CBT_AUTOMARK_ACTOR,
        approvedAt,
      },
    });

    await this.marking.postMark(tx, {
      studentAssessmentId: sa.id,
      score: autoScore,
      source: 'quiz',
      comment: `cbt:${quizAttemptId}`,
      onOutOfRange: 'clamp',
      allowWhenApproved: true,
    });
  }

  /** The `lms_activity` StudentAssessment for this paper's student, if the paper backs a mod_quiz. */
  private async resolveLmsStudentAssessment(tx: any, paperId: string, studentProfileId: string): Promise<string | null> {
    const modQuiz = await tx.modQuiz.findFirst({ where: { questionPaperId: paperId }, select: { id: true } });
    if (!modQuiz) return null;
    const cm = await tx.courseModule.findFirst({
      where: { activityType: 'quiz', instanceId: modQuiz.id, assessmentId: { not: null }, deletedAt: null },
      select: { assessmentId: true },
    });
    if (!cm?.assessmentId) return null;
    const sa = await tx.studentAssessment.findFirst({
      where: { assessmentId: cm.assessmentId, studentProfileId },
      select: { id: true },
    });
    return sa?.id ?? null;
  }
}
