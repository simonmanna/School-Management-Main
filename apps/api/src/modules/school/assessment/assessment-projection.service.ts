import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { computeEffective } from './assessment-math';

/**
 * GradeEntry → assessment-spine adapter.
 *
 * Exam marks keep flowing through the existing GradeEntry endpoints, but each
 * write is also projected into the new spine (Assessment → StudentAssessment →
 * MarkEntry) so downstream consumers can read one model. This runs INSIDE the
 * caller's transaction, so the legacy row and its projection are atomic — they
 * cannot diverge. It is idempotent: the Assessment is keyed by
 * (org, exam_session, examScheduleId) and marks upsert by round.
 *
 * `GradeEntry` remains the write surface through A1–A3 and is retired in A4;
 * new code reads the spine, never GradeEntry.
 */
@Injectable()
export class AssessmentProjectionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
  ) {}

  /**
   * Project every GradeEntry of one exam schedule into the spine. Call after
   * writing marks (bulk upsert). Reads GradeEntry as the single source so the
   * projection can never disagree with the legacy rows.
   */
  async projectExamSchedule(tx: any, examScheduleId: string): Promise<string | null> {
    const organizationId = this.tenant.organizationId;
    const schedule = await tx.examSchedule.findFirst({
      where: { id: examScheduleId },
      include: { exam: true, subject: true },
    });
    if (!schedule) return null;

    const gradeEntries = await tx.gradeEntry.findMany({ where: { examScheduleId } });
    if (gradeEntries.length === 0) return null;

    const assessment = await this.ensureAssessment(tx, organizationId, schedule);

    for (const ge of gradeEntries) {
      const sa = await tx.studentAssessment.upsert({
        where: {
          assessmentId_studentProfileId: { assessmentId: assessment.id, studentProfileId: ge.studentProfileId },
        },
        create: {
          organizationId,
          assessmentId: assessment.id,
          studentProfileId: ge.studentProfileId,
          classId: schedule.classId,
          termId: schedule.exam.termId,
          maxScore: ge.maxMarks,
          status: 'graded',
          participation: 'present',
          approvalStatus: ge.status,
          enteredById: ge.enteredById ?? null,
          approvedById: ge.approvedById ?? null,
        },
        update: {
          maxScore: ge.maxMarks,
          approvalStatus: ge.status,
          enteredById: ge.enteredById ?? null,
          approvedById: ge.approvedById ?? null,
        },
      });

      if (ge.marksObtained !== null && ge.marksObtained !== undefined) {
        await tx.markEntry.upsert({
          where: { studentAssessmentId_round: { studentAssessmentId: sa.id, round: 'first' } },
          create: {
            organizationId,
            studentAssessmentId: sa.id,
            markerId: ge.enteredById ?? null,
            round: 'first',
            score: ge.marksObtained,
          },
          update: { score: ge.marksObtained, markerId: ge.enteredById ?? null },
        });
      }

      // Recompute derived scores from the projected marks.
      const [entries, adjustments] = await Promise.all([
        tx.markEntry.findMany({ where: { studentAssessmentId: sa.id } }),
        tx.markAdjustment.findMany({ where: { studentAssessmentId: sa.id } }),
      ]);
      const { originalScore, effectiveScore, percentage } = computeEffective(
        entries.map((e: any) => ({ round: e.round, score: e.score })),
        adjustments.map((a: any) => ({ sequence: a.sequence, delta: a.delta, replacementScore: a.replacementScore })),
        ge.maxMarks,
      );
      await tx.studentAssessment.updateMany({
        where: { id: sa.id },
        data: { originalScore, effectiveScore, percentage },
      });
    }

    return assessment.id;
  }

  /**
   * Mirror an approval-status change (submit/approve/reject) onto the projected
   * StudentAssessments, cheaply, without re-projecting marks.
   */
  async mirrorApprovalStatus(tx: any, examScheduleId: string, status: string, approvedById?: string | null): Promise<void> {
    const organizationId = this.tenant.organizationId;
    const assessment = await tx.assessment.findFirst({
      where: { organizationId, sourceType: 'exam_session', sourceRef: examScheduleId },
    });
    if (!assessment) return;
    await tx.studentAssessment.updateMany({
      where: { assessmentId: assessment.id },
      data: { approvalStatus: status, ...(approvedById !== undefined ? { approvedById } : {}) },
    });
  }

  private async ensureAssessment(tx: any, organizationId: string, schedule: any) {
    const existing = await tx.assessment.findFirst({
      where: { organizationId, sourceType: 'exam_session', sourceRef: schedule.id },
    });
    if (existing) return existing;
    // Attach to a component bridged to this exam's ExamType, if one exists.
    const component = schedule.exam.examTypeId
      ? await tx.assessmentComponent.findFirst({ where: { examTypeId: schedule.exam.examTypeId } })
      : null;
    return tx.assessment.create({
      data: {
        organizationId,
        componentId: component?.id ?? null,
        subjectId: schedule.subjectId,
        classId: schedule.classId,
        termId: schedule.exam.termId,
        title: `${schedule.subject?.name ?? 'Exam'} — ${schedule.exam.name}`,
        maxScore: schedule.maxMarks,
        sourceType: 'exam_session',
        sourceRef: schedule.id,
        status: 'grading',
      },
    });
  }
}
