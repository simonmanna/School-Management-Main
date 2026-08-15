import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { StudentAssessment } from '@prisma/client';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { AuditService } from '../../../kernel/audit/audit.service';
import { EventBus } from '../../../kernel/events/event-bus';
import { EVENTS } from '@erp/shared';
import { computeEffective } from './assessment-math';
import type { AppendAdjustmentDto, MarkingApprovalDto, RecordMarkDto, SetParticipationDto } from './dto.types';

/**
 * StudentAssessment + the two mark-producing ledgers (MarkEntry rounds and the
 * append-only MarkAdjustment ledger). The canonical `originalScore` /
 * `effectiveScore` / `percentage` on a StudentAssessment are always DERIVED —
 * never written directly — by `recompute`, which runs the pure kernel over the
 * current marks and adjustments. Any write that can change the score calls it.
 */
@Injectable()
export class MarkingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly audit: AuditService,
    private readonly events: EventBus,
  ) {}

  /**
   * Recompute a StudentAssessment's derived scores from its marks + adjustments.
   * MUST be called inside the same transaction as any mark/adjustment write so
   * the derived fields never lag the ledgers. Bumps `version`.
   */
  async recompute(tx: any, studentAssessmentId: string): Promise<void> {
    const sa = await tx.studentAssessment.findFirst({ where: { id: studentAssessmentId } });
    if (!sa) throw new NotFoundException(`StudentAssessment ${studentAssessmentId} not found`);
    const [entries, adjustments] = await Promise.all([
      tx.markEntry.findMany({ where: { studentAssessmentId } }),
      tx.markAdjustment.findMany({ where: { studentAssessmentId } }),
    ]);
    const { originalScore, effectiveScore, percentage } = computeEffective(
      entries.map((e: any) => ({ round: e.round, score: e.score })),
      adjustments.map((a: any) => ({ sequence: a.sequence, delta: a.delta, replacementScore: a.replacementScore })),
      sa.maxScore,
    );
    await tx.studentAssessment.updateMany({
      where: { id: studentAssessmentId },
      data: { originalScore, effectiveScore, percentage, version: { increment: 1 } },
    });
  }

  /** Ensure a StudentAssessment row exists for (assessment, student); returns it. */
  private async ensureRow(tx: any, assessmentId: string, studentProfileId: string, snapshot: Partial<StudentAssessment> = {}) {
    const assessment = await tx.assessment.findFirst({ where: { id: assessmentId } });
    if (!assessment) throw new NotFoundException(`Assessment ${assessmentId} not found`);
    const existing = await tx.studentAssessment.findFirst({ where: { assessmentId, studentProfileId } });
    if (existing) return existing;
    return tx.studentAssessment.create({
      data: {
        organizationId: this.tenant.organizationId,
        assessmentId,
        studentProfileId,
        maxScore: assessment.maxScore,
        classId: snapshot.classId ?? assessment.classId,
        termId: snapshot.termId ?? assessment.termId,
        sectionId: snapshot.sectionId ?? null,
        gradeLevelId: snapshot.gradeLevelId ?? null,
      },
    });
  }

  /** Set a student's participation (present/absent/exempt/…) on an assessment. */
  async setParticipation(dto: SetParticipationDto) {
    return this.prisma.client.$transaction(async (tx: any) => {
      const row = await this.ensureRow(tx, dto.assessmentId, dto.studentProfileId, {
        classId: dto.classId,
        sectionId: dto.sectionId,
        gradeLevelId: dto.gradeLevelId,
        termId: dto.termId,
      });
      await tx.studentAssessment.updateMany({
        where: { id: row.id },
        data: { participation: dto.participation, version: { increment: 1 } },
      });
      await this.audit.recordInTx(tx, {
        entity: 'StudentAssessment',
        entityId: row.id,
        action: 'update',
        newValues: { participation: dto.participation },
      });
      return tx.studentAssessment.findFirst({ where: { id: row.id } });
    });
  }

  /**
   * Record one marker round. Upserts on (studentAssessment, round) so a marker
   * can revise their own round, then recomputes the derived scores.
   */
  async recordMark(dto: RecordMarkDto) {
    return this.prisma.client.$transaction(async (tx: any) => {
      const sa = await tx.studentAssessment.findFirst({ where: { id: dto.studentAssessmentId } });
      if (!sa) throw new NotFoundException(`StudentAssessment ${dto.studentAssessmentId} not found`);
      if (sa.approvalStatus === 'approved') {
        throw new BadRequestException('Marks are approved; reject them before recording new marks');
      }
      const max = new Prisma.Decimal(sa.maxScore);
      if (new Prisma.Decimal(dto.score).lessThan(0) || new Prisma.Decimal(dto.score).greaterThan(max)) {
        throw new BadRequestException(`Score ${dto.score} out of range [0, ${max.toString()}]`);
      }
      const round = dto.round ?? 'first';
      await tx.markEntry.upsert({
        where: { studentAssessmentId_round: { studentAssessmentId: dto.studentAssessmentId, round } },
        create: {
          organizationId: this.tenant.organizationId,
          studentAssessmentId: dto.studentAssessmentId,
          markerId: this.tenant.userId ?? null,
          round,
          score: dto.score,
          comment: dto.comment ?? null,
        },
        update: { score: dto.score, comment: dto.comment ?? null, markerId: this.tenant.userId ?? null },
      });
      await this.recompute(tx, dto.studentAssessmentId);
      await this.audit.recordInTx(tx, {
        entity: 'StudentAssessment',
        entityId: dto.studentAssessmentId,
        action: 'update',
        newValues: { round, score: dto.score, action: 'record_mark' },
      });
      return tx.studentAssessment.findFirst({ where: { id: dto.studentAssessmentId } });
    });
  }

  /**
   * Append an adjustment to the immutable ledger (moderation, scaling, penalty,
   * correction), assign the next sequence, and recompute. The DB trigger blocks
   * any later edit/delete of the row.
   */
  async appendAdjustment(dto: AppendAdjustmentDto) {
    const organizationId = this.tenant.organizationId;
    const hasDelta = dto.delta !== undefined && dto.delta !== null;
    const hasReplacement = dto.replacementScore !== undefined && dto.replacementScore !== null;
    if (hasDelta === hasReplacement) {
      throw new BadRequestException('Provide exactly one of delta or replacementScore');
    }
    return this.prisma.client.$transaction(async (tx: any) => {
      const sa = await tx.studentAssessment.findFirst({ where: { id: dto.studentAssessmentId } });
      if (!sa) throw new NotFoundException(`StudentAssessment ${dto.studentAssessmentId} not found`);

      const last = await tx.markAdjustment.findFirst({
        where: { studentAssessmentId: dto.studentAssessmentId },
        orderBy: { sequence: 'desc' },
      });
      const sequence = (last?.sequence ?? 0) + 1;

      await tx.markAdjustment.create({
        data: {
          organizationId,
          studentAssessmentId: dto.studentAssessmentId,
          sequence,
          kind: dto.kind,
          delta: hasDelta ? dto.delta : null,
          replacementScore: hasReplacement ? dto.replacementScore : null,
          reason: dto.reason,
          requestedById: this.tenant.userId ?? null,
        },
      });
      await this.recompute(tx, dto.studentAssessmentId);
      await this.audit.recordInTx(tx, {
        entity: 'MarkAdjustment',
        entityId: dto.studentAssessmentId,
        action: 'adjust',
        newValues: { sequence, kind: dto.kind, reason: dto.reason },
      });
      this.events.publish(EVENTS.SchoolMarksModerated, {
        organizationId,
        studentAssessmentId: dto.studentAssessmentId,
        kind: dto.kind,
        sequence,
      });
      return tx.studentAssessment.findFirst({ where: { id: dto.studentAssessmentId } });
    });
  }

  /**
   * Marking-approval workflow for a whole assessment's StudentAssessments,
   * mirroring the GradeEntry FSM with the same segregation of duty: the person
   * who entered a mark cannot approve it.
   */
  async markingApproval(dto: MarkingApprovalDto) {
    const organizationId = this.tenant.organizationId;
    const actorId = this.tenant.userId ?? null;
    return this.prisma.client.$transaction(async (tx: any) => {
      const rows = await tx.studentAssessment.findMany({ where: { assessmentId: dto.assessmentId } });
      if (rows.length === 0) throw new NotFoundException(`No student assessments for assessment ${dto.assessmentId}`);

      if (dto.action === 'submit') {
        const res = await tx.studentAssessment.updateMany({
          where: { assessmentId: dto.assessmentId, approvalStatus: 'draft' },
          data: { approvalStatus: 'submitted', enteredById: actorId },
        });
        await this.audit.recordInTx(tx, { entity: 'StudentAssessment', entityId: dto.assessmentId, action: 'update', newValues: { action: 'submit', count: res.count } });
        return { updated: res.count };
      }

      if (dto.action === 'approve') {
        const submitted = rows.filter((r: any) => r.approvalStatus === 'submitted');
        if (submitted.some((r: any) => r.enteredById && r.enteredById === actorId)) {
          throw new BadRequestException('You entered one or more of these marks and cannot approve them (segregation of duty).');
        }
        const res = await tx.studentAssessment.updateMany({
          where: { assessmentId: dto.assessmentId, approvalStatus: 'submitted' },
          data: { approvalStatus: 'approved', approvedById: actorId },
        });
        await this.audit.recordInTx(tx, { entity: 'StudentAssessment', entityId: dto.assessmentId, action: 'approve', newValues: { count: res.count } });
        this.events.publish(EVENTS.SchoolMarksApproved, { organizationId, assessmentId: dto.assessmentId, approvedById: actorId ?? '', count: res.count });
        return { updated: res.count };
      }

      // reject
      const res = await tx.studentAssessment.updateMany({
        where: { assessmentId: dto.assessmentId, approvalStatus: 'submitted' },
        data: { approvalStatus: 'rejected' },
      });
      await this.audit.recordInTx(tx, { entity: 'StudentAssessment', entityId: dto.assessmentId, action: 'reject', newValues: { reason: dto.reason ?? null, count: res.count } });
      return { updated: res.count };
    });
  }

  async byAssessment(assessmentId: string) {
    return this.prisma.client.studentAssessment.findMany({
      where: { assessmentId },
      include: { markEntries: true, adjustments: { orderBy: { sequence: 'asc' } } },
      orderBy: { studentProfileId: 'asc' },
    });
  }

  async byStudent(studentProfileId: string, termId?: string) {
    return this.prisma.client.studentAssessment.findMany({
      where: { studentProfileId, ...(termId ? { termId } : {}) },
      include: { assessment: true },
      orderBy: { createdAt: 'desc' },
    });
  }
}
