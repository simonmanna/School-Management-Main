import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Assignment } from '@prisma/client';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { AuditService } from '../../../kernel/audit/audit.service';
import { EventBus } from '../../../kernel/events/event-bus';
import { EVENTS } from '@erp/shared';
import { MarkingService } from './marking.service';
import { latePenalty, rollupRubricFraction } from './assessment-math';
import type { CreateAssignmentDto, GradeAssignmentDto, SubmitAssignmentDto } from './dto.types';

/**
 * Assignment lifecycle over the assessment spine.
 *
 *  create  → makes an Assessment (sourceType='assignment') + the Assignment.
 *  publish → fans a FROZEN roster out into `assigned` StudentAssessment rows, so
 *            "no row" can never be confused with "not assigned". Requires a
 *            frozen roster.
 *  submit  → records an AssignmentSubmission attempt, with late detection.
 *  grade   → points / rubric / complete_incomplete → a first-round MarkEntry on
 *            the StudentAssessment (which recomputes its effective score), with
 *            the late penalty applied. Rubric scores are written to the
 *            canonical AssessmentRubricScore rows.
 */
@Injectable()
export class AssignmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly audit: AuditService,
    private readonly events: EventBus,
    private readonly marking: MarkingService,
  ) {}

  async create(dto: CreateAssignmentDto): Promise<Assignment> {
    const organizationId = this.tenant.organizationId;
    return this.prisma.client.$transaction(async (tx: any) => {
      if (dto.rosterId) {
        const roster = await tx.academicRoster.findFirst({ where: { id: dto.rosterId } });
        if (!roster) throw new NotFoundException(`Roster ${dto.rosterId} not found`);
      }
      let rubricVersion: number | null = null;
      if (dto.rubricId) {
        const rubric = await tx.rubric.findFirst({ where: { id: dto.rubricId } });
        if (!rubric) throw new NotFoundException(`Rubric ${dto.rubricId} not found`);
        rubricVersion = rubric.version;
      }

      const assessment = await tx.assessment.create({
        data: {
          organizationId,
          subjectId: dto.subjectId,
          classId: dto.classId,
          termId: dto.termId,
          title: dto.title,
          maxScore: dto.maxScore ?? 100,
          sourceType: 'assignment',
          status: 'draft',
          dueAt: dto.dueAt ? new Date(dto.dueAt) : null,
          createdBy: this.tenant.userId ?? null,
        },
      });
      const assignment = await tx.assignment.create({
        data: {
          organizationId,
          assessmentId: assessment.id,
          rosterId: dto.rosterId ?? null,
          instructions: dto.instructions ?? null,
          allowLate: dto.allowLate ?? false,
          latePenaltyPercent: dto.latePenaltyPercent ?? 0,
          lateCutoffAt: dto.lateCutoffAt ? new Date(dto.lateCutoffAt) : null,
          maxAttempts: dto.maxAttempts ?? 1,
          gradingMode: dto.gradingMode ?? 'points',
          rubricId: dto.rubricId ?? null,
          rubricVersion,
          attachments: (dto.attachments as any) ?? [],
        },
      });
      await this.audit.recordInTx(tx, {
        entity: 'Assignment',
        entityId: assignment.id,
        action: 'create',
        newValues: { assessmentId: assessment.id, title: dto.title, gradingMode: assignment.gradingMode },
      });
      return tx.assignment.findFirst({ where: { id: assignment.id }, include: { assessment: true } });
    });
  }

  /** Publish: fan the frozen roster out into `assigned` StudentAssessment rows. */
  async publish(assignmentId: string): Promise<{ assignmentId: string; fannedOut: number }> {
    const organizationId = this.tenant.organizationId;
    return this.prisma.client.$transaction(async (tx: any) => {
      const assignment = await tx.assignment.findFirst({ where: { id: assignmentId }, include: { assessment: true } });
      if (!assignment) throw new NotFoundException(`Assignment ${assignmentId} not found`);
      if (!assignment.rosterId) throw new BadRequestException('Assignment has no roster to fan out over');

      const roster = await tx.academicRoster.findFirst({ where: { id: assignment.rosterId }, include: { members: true } });
      if (!roster) throw new NotFoundException(`Roster ${assignment.rosterId} not found`);
      if (!roster.frozenAt) throw new BadRequestException('Roster must be frozen before an assignment can be published to it');

      let fannedOut = 0;
      for (const m of roster.members) {
        const existing = await tx.studentAssessment.findFirst({
          where: { assessmentId: assignment.assessmentId, studentProfileId: m.studentProfileId },
        });
        if (existing) continue;
        await tx.studentAssessment.create({
          data: {
            organizationId,
            assessmentId: assignment.assessmentId,
            studentProfileId: m.studentProfileId,
            classId: m.classId,
            sectionId: m.sectionId,
            gradeLevelId: m.gradeLevelId,
            termId: roster.termId,
            maxScore: assignment.assessment.maxScore,
            status: 'assigned',
            participation: 'present',
          },
        });
        fannedOut += 1;
      }

      // Move the assessment into its open/published state.
      await tx.assessment.updateMany({
        where: { id: assignment.assessmentId, status: { in: ['draft', 'scheduled'] } },
        data: { status: 'published', version: { increment: 1 } },
      });
      await this.audit.recordInTx(tx, {
        entity: 'Assignment',
        entityId: assignmentId,
        action: 'update',
        newValues: { action: 'publish', fannedOut },
      });
      this.events.publish(EVENTS.SchoolAssignmentPublished, {
        organizationId,
        assignmentId,
        assessmentId: assignment.assessmentId,
        fannedOut,
      });
      return { assignmentId, fannedOut };
    });
  }

  /** Student submits an attempt. Late is derived from the cutoff/due date. */
  async submit(dto: SubmitAssignmentDto) {
    const organizationId = this.tenant.organizationId;
    return this.prisma.client.$transaction(async (tx: any) => {
      const assignment = await tx.assignment.findFirst({ where: { id: dto.assignmentId }, include: { assessment: true } });
      if (!assignment) throw new NotFoundException(`Assignment ${dto.assignmentId} not found`);

      const sa = await tx.studentAssessment.findFirst({
        where: { assessmentId: assignment.assessmentId, studentProfileId: dto.studentProfileId },
      });
      if (!sa) throw new BadRequestException('Student is not on this assignment (roster not fanned out to them)');

      const priorCount = await tx.assignmentSubmission.count({
        where: { assignmentId: dto.assignmentId, studentAssessmentId: sa.id },
      });
      if (priorCount >= assignment.maxAttempts) {
        throw new BadRequestException(`Maximum ${assignment.maxAttempts} attempt(s) reached`);
      }
      const attemptNo = priorCount + 1;

      const due: Date | null = assignment.lateCutoffAt ?? assignment.assessment.dueAt ?? null;
      const isLate = !!due && new Date() > due;
      if (isLate && !assignment.allowLate) {
        throw new BadRequestException('Past due date; late submissions are not allowed for this assignment');
      }

      await tx.assignmentSubmission.create({
        data: {
          organizationId,
          assignmentId: dto.assignmentId,
          studentAssessmentId: sa.id,
          attemptNo,
          submittedAt: new Date(),
          isLate,
          content: dto.content ?? null,
          attachments: (dto.attachments as any) ?? [],
        },
      });
      await tx.studentAssessment.updateMany({
        where: { id: sa.id },
        data: { status: attemptNo > 1 ? 'resubmitted' : 'submitted', version: { increment: 1 } },
      });
      this.events.publish(EVENTS.SchoolAssignmentSubmitted, {
        organizationId,
        assignmentId: dto.assignmentId,
        studentProfileId: dto.studentProfileId,
        attemptNo,
        isLate,
      });
      return tx.assignmentSubmission.findFirst({
        where: { assignmentId: dto.assignmentId, studentAssessmentId: sa.id, attemptNo },
      });
    });
  }

  /** Grade the latest submission. Score source depends on the grading mode. */
  async grade(dto: GradeAssignmentDto) {
    const organizationId = this.tenant.organizationId;
    return this.prisma.client.$transaction(async (tx: any) => {
      const assignment = await tx.assignment.findFirst({ where: { id: dto.assignmentId }, include: { assessment: true } });
      if (!assignment) throw new NotFoundException(`Assignment ${dto.assignmentId} not found`);

      const sa = await tx.studentAssessment.findFirst({
        where: { assessmentId: assignment.assessmentId, studentProfileId: dto.studentProfileId },
      });
      if (!sa) throw new NotFoundException('No student assessment to grade (was the assignment published?)');
      if (sa.approvalStatus === 'approved') {
        throw new BadRequestException('Marks are approved; reject them before re-grading');
      }
      const submission = await tx.assignmentSubmission.findFirst({
        where: { assignmentId: dto.assignmentId, studentAssessmentId: sa.id },
        orderBy: { attemptNo: 'desc' },
      });

      const maxScore = new Prisma.Decimal(assignment.assessment.maxScore);
      let rawScore: Prisma.Decimal;
      let rubricSnapshot: unknown = null;

      if (assignment.gradingMode === 'rubric') {
        if (!dto.rubricScores || dto.rubricScores.length === 0) {
          throw new BadRequestException('Rubric grading requires rubricScores');
        }
        // Write canonical rubric scores, then roll up to a fraction of maxScore.
        const items: Array<{ score: number; maxScore: number; weight: number }> = [];
        for (const rs of dto.rubricScores) {
          const criterion = await tx.rubricCriterion.findFirst({ where: { id: rs.criterionId } });
          if (!criterion) throw new NotFoundException(`RubricCriterion ${rs.criterionId} not found`);
          await tx.assessmentRubricScore.upsert({
            where: { studentAssessmentId_criterionId: { studentAssessmentId: sa.id, criterionId: rs.criterionId } },
            create: {
              organizationId,
              studentAssessmentId: sa.id,
              criterionId: rs.criterionId,
              levelId: rs.levelId ?? null,
              score: rs.score,
              comment: rs.comment ?? null,
            },
            update: { levelId: rs.levelId ?? null, score: rs.score, comment: rs.comment ?? null },
          });
          items.push({ score: rs.score, maxScore: Number(criterion.maxScore), weight: Number(criterion.weight) });
        }
        const fraction = rollupRubricFraction(items);
        rawScore = fraction.mul(maxScore);
        rubricSnapshot = dto.rubricScores;
      } else if (assignment.gradingMode === 'complete_incomplete') {
        rawScore = dto.complete ? maxScore : new Prisma.Decimal(0);
      } else {
        // points
        if (dto.rawScore === undefined || dto.rawScore === null) {
          throw new BadRequestException('Points grading requires rawScore');
        }
        rawScore = new Prisma.Decimal(dto.rawScore);
        if (rawScore.lessThan(0) || rawScore.greaterThan(maxScore)) {
          throw new BadRequestException(`rawScore ${dto.rawScore} out of range [0, ${maxScore.toString()}]`);
        }
      }

      // Late penalty (only when lateness is allowed-and-penalised).
      const penalty = submission?.isLate && assignment.allowLate
        ? latePenalty(rawScore, assignment.latePenaltyPercent)
        : new Prisma.Decimal(0);
      const finalScore = Prisma.Decimal.max(new Prisma.Decimal(0), rawScore.minus(penalty));

      if (submission) {
        await tx.assignmentSubmission.updateMany({
          where: { id: submission.id },
          data: {
            rawScore,
            penaltyApplied: penalty,
            rubricSnapshot: rubricSnapshot as any,
            version: { increment: 1 },
          },
        });
      }

      // Record the mark through the one write path, which owns the ledger, the
      // lock check and the recompute.
      await this.marking.postMark(tx, {
        studentAssessmentId: sa.id,
        score: finalScore,
        source: 'assignment',
      });

      await this.audit.recordInTx(tx, {
        entity: 'AssignmentSubmission',
        entityId: sa.id,
        action: 'update',
        newValues: { action: 'grade', rawScore: rawScore.toString(), penalty: penalty.toString(), finalScore: finalScore.toString() },
      });
      this.events.publish(EVENTS.SchoolAssignmentGraded, {
        organizationId,
        assignmentId: dto.assignmentId,
        studentProfileId: dto.studentProfileId,
        score: finalScore.toString(),
      });
      return tx.studentAssessment.findFirst({ where: { id: sa.id }, include: { rubricScores: true } });
    });
  }

  async byId(id: string) {
    return this.prisma.client.assignment.findFirst({
      where: { id },
      include: { assessment: true, submissions: true },
    });
  }

  async byClassTerm(classId: string, termId: string) {
    return this.prisma.client.assignment.findMany({
      where: { assessment: { classId, termId } },
      include: { assessment: true },
      orderBy: { createdAt: 'desc' },
    });
  }
}
