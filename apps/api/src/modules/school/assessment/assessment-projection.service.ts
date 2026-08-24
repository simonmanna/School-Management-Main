import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { MarkingService } from './marking.service';
import { AssessmentMintService } from './assessment-mint.service';

/**
 * `GradeEntry` has no participation column — the legacy row records a
 * non-scoring outcome in free-text `remarks`. These are the values that mean
 * "resolved, but no numeric mark", and they must survive into the spine or
 * `countsAbsentAsZero` can never fire for an exam mark.
 */
const NON_SCORING = new Set(['absent', 'exempt', 'excused', 'malpractice', 'special_consideration']);

function participationOf(remarks?: string | null): string {
  const r = remarks?.trim().toLowerCase();
  return r && NON_SCORING.has(r) ? r : 'present';
}

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
    private readonly marking: MarkingService,
    private readonly mint: AssessmentMintService,
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
      const participation = participationOf(ge.remarks);
      const scored = ge.marksObtained !== null && ge.marksObtained !== undefined;

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
          status: scored ? 'graded' : 'assigned',
          participation,
          approvalStatus: ge.status,
          enteredById: ge.enteredById ?? null,
          approvedById: ge.approvedById ?? null,
        },
        update: {
          maxScore: ge.maxMarks,
          // Participation used to be written once, as a hardcoded 'present',
          // and never updated — so an absence recorded on the legacy row never
          // reached the spine and `countsAbsentAsZero` never fired for an exam
          // mark. It is re-derived on every projection now.
          participation,
          approvalStatus: ge.status,
          enteredById: ge.enteredById ?? null,
          approvedById: ge.approvedById ?? null,
        },
      });

      // GradeEntry is the source here, so the projection re-posts marks that are
      // already approved — the one caller allowed to. This block used to carry
      // its own copy of the recompute arithmetic; `postMark` owns it now, so
      // there is a single place where a mark becomes a score.
      //
      // A CLEARED legacy row must clear the spine too. Skipping the null case
      // left the previous score standing forever, so clearing a cell — or
      // marking a student absent — looked applied on the marksheet while the
      // gradebook, the result run and the report card all still counted the old
      // mark.
      await this.marking.postMark(tx, {
        studentAssessmentId: sa.id,
        score: scored ? ge.marksObtained : null,
        source: 'exam',
        markerId: ge.enteredById ?? null,
        allowWhenApproved: true,
        writeHistory: false, // GradeEntry already carries its own audit trail
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

  /**
   * Minting moved to `AssessmentMintService` so a paper gets its gradebook
   * column when the office APPLIES it, not when someone first types a mark into
   * it. This wrapper stays because the projection still needs the row to exist
   * for legacy papers that were never applied through the new path.
   */
  private async ensureAssessment(tx: any, _organizationId: string, schedule: any) {
    return this.mint.forExamSchedule(tx, schedule.id);
  }
}
