import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { MarkingService } from './marking.service';

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

    const sourceRef = `quiz:${paperId}:${studentProfileId}`;
    const assessment = await tx.assessment.upsert({
      where: { organizationId_sourceType_sourceRef: { organizationId, sourceType: 'quiz', sourceRef } },
      create: {
        organizationId,
        subjectId,
        classId,
        termId,
        title: `CBT ${paperId.slice(0, 8)}`,
        maxScore,
        sourceType: 'quiz',
        sourceRef,
        status: 'graded',
      },
      update: { maxScore, status: 'graded' },
    });

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
      },
      update: { maxScore, approvalStatus: 'approved', status: 'graded' },
    });

    await tx.markEntry.upsert({
      where: { studentAssessmentId_round: { studentAssessmentId: sa.id, round: 'first' } },
      create: { organizationId, studentAssessmentId: sa.id, round: 'first', score: autoScore },
      update: { score: autoScore },
    });
    await this.marking.recompute(tx, sa.id);
  }
}
