import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { AuditService } from '../../../kernel/audit/audit.service';
import { EventBus } from '../../../kernel/events/event-bus';
import { EVENTS } from '@erp/shared';
import type { PromoteStudentDto, PromotionOutcome, RolloverDto } from './promotion.dto';

/**
 * PromotionService (P5c/P5d) — student promotion + academic-year rollover.
 *
 * The one invariant: NEVER mutate a historical enrollment. Promoting a student
 * marks their current-term enrollment `completed` and CREATES a fresh
 * enrollment for the next term — academic history is immutable, exactly like a
 * posted journal entry. Graduation (reaching the final grade) writes no new
 * enrollment and moves the student to `alumni`.
 */
@Injectable()
export class PromotionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly audit: AuditService,
    private readonly events: EventBus,
  ) {}

  /** Promote a single student. Explicit, transactional, idempotent per term. */
  async promote(dto: PromoteStudentDto) {
    return this.prisma.client.$transaction((tx: any) => this.promoteOne(tx, dto));
  }

  /**
   * Academic-year rollover: advance every active student one grade.
   *
   * Dry-run by default — returns the plan (promote / graduate / skip buckets)
   * so it can be reviewed before committing. Execution runs one transaction PER
   * student, so a batch that fails partway can simply be re-run: an already-
   * promoted student is detected (enrolled in the target term) and skipped.
   */
  async rolloverTerm(dto: RolloverDto) {
    const dryRun = dto.dryRun ?? true;
    const client = this.prisma.client;

    // Grade ladder: order → the class to promote INTO for that order.
    const classes = await client.schoolClass.findMany({
      where: { deletedAt: null },
      include: { gradeLevel: true },
    });
    const maxOrder = classes.reduce((m: number, c: any) => Math.max(m, c.gradeLevel?.order ?? 0), 0);
    const classByOrder = new Map<number, any[]>();
    for (const c of classes) {
      const o = c.gradeLevel?.order ?? -1;
      if (o < 0) continue;
      const bucket = classByOrder.get(o) ?? [];
      bucket.push(c);
      classByOrder.set(o, bucket);
    }
    // Prefer a target class on the same campus as the student's current class.
    const pickClass = (order: number, campusId: string | null) => {
      const cands = classByOrder.get(order) ?? [];
      if (cands.length === 0) return null;
      return cands.find((c: any) => c.campusId === campusId) ?? cands[0];
    };

    const students = await client.studentProfile.findMany({
      where: { status: 'active' },
      include: { currentClass: { include: { gradeLevel: true } } },
    });

    type PlanRow = { studentProfileId: string; admissionNo: string; outcome: PromotionOutcome | 'skipped'; toClassId: string | null; reason?: string };
    const promote: PlanRow[] = [];
    const repeat: PlanRow[] = [];
    const graduate: PlanRow[] = [];
    const skip: PlanRow[] = [];

    for (const s of students) {
      const base = { studentProfileId: s.id, admissionNo: s.admissionNo };
      const cur = s.currentClass;
      if (!cur || !cur.gradeLevel) {
        skip.push({ ...base, outcome: 'skipped', toClassId: null, reason: 'no current class/grade' });
        continue;
      }
      // Resumable: already enrolled in the target term → leave alone.
      const existing = await client.enrollment.findFirst({
        where: { studentProfileId: s.id, termId: dto.toTermId },
        select: { id: true },
      });
      if (existing) {
        skip.push({ ...base, outcome: 'skipped', toClassId: null, reason: 'already enrolled in target term' });
        continue;
      }
      const order = cur.gradeLevel.order;
      if (order >= maxOrder) {
        graduate.push({ ...base, outcome: 'graduated', toClassId: null });
        continue;
      }
      // A8: consult the published result spine for the term being closed. A
      // 'repeat' recommendation (or ineligible result) holds the student in the
      // SAME class instead of promoting. No result → fall back to order-based
      // promotion (no academic gate available for that student).
      const rec = await this.latestRecommendation(client, s.id, dto.fromTermId);
      if (rec === 'repeat') {
        repeat.push({ ...base, outcome: 'repeated', toClassId: cur.id, reason: 'result: repeat recommended' });
        continue;
      }

      const target = pickClass(order + 1, cur.campusId ?? null);
      if (!target) {
        skip.push({ ...base, outcome: 'skipped', toClassId: null, reason: `no class for grade order ${order + 1}` });
        continue;
      }
      promote.push({ ...base, outcome: 'promoted', toClassId: target.id, reason: rec ? `result: ${rec}` : 'order-based (no result)' });
    }

    const plan = {
      fromTermId: dto.fromTermId,
      toTermId: dto.toTermId,
      dryRun,
      counts: { promoted: promote.length, repeated: repeat.length, graduated: graduate.length, skipped: skip.length, total: students.length },
      promote,
      repeat,
      graduate,
      skip,
    };
    if (dryRun) return plan;

    // Execute — one tx per student so a mid-batch failure is resumable.
    const executed: Array<{ studentProfileId: string; outcome: string; enrollmentId: string | null; error?: string }> = [];
    for (const row of [...promote, ...repeat, ...graduate]) {
      try {
        const res = await this.prisma.client.$transaction((tx: any) =>
          this.promoteOne(tx, {
            studentProfileId: row.studentProfileId,
            toTermId: dto.toTermId,
            toClassId: row.toClassId ?? undefined,
            outcome: row.outcome as PromotionOutcome,
            reason: 'academic-year rollover',
          }),
        );
        executed.push({ studentProfileId: row.studentProfileId, outcome: res.outcome, enrollmentId: res.enrollmentId });
      } catch (err) {
        executed.push({ studentProfileId: row.studentProfileId, outcome: 'error', enrollmentId: null, error: String((err as Error)?.message ?? err) });
      }
    }
    return { ...plan, executed };
  }

  /**
   * The promotion recommendation from the latest PUBLISHED result set for a
   * student in a term (A3 computes it). Null when no published result exists.
   */
  private async latestRecommendation(client: any, studentProfileId: string, termId: string): Promise<string | null> {
    const t = await client.studentTermResult.findFirst({
      where: { studentProfileId, termId, resultSet: { status: 'published' } },
      include: { resultSet: true },
      orderBy: { resultSet: { revision: 'desc' } },
    });
    return t?.promotionRecommendation ?? null;
  }

  /**
   * Core promotion applied inside a caller-provided transaction. Shared by the
   * single-student endpoint and the batch rollover.
   */
  private async promoteOne(
    tx: any,
    dto: PromoteStudentDto,
  ): Promise<{ studentProfileId: string; outcome: PromotionOutcome; enrollmentId: string | null }> {
    const organizationId = this.tenant.organizationId;
    const student = await tx.studentProfile.findFirst({
      where: { id: dto.studentProfileId },
      include: { currentClass: true },
    });
    if (!student) throw new NotFoundException(`Student ${dto.studentProfileId} not found`);

    const outcome: PromotionOutcome = dto.outcome ?? (dto.toClassId ? 'promoted' : 'graduated');
    const needsClass = outcome === 'promoted' || outcome === 'repeated';
    if (needsClass && !dto.toClassId) {
      throw new BadRequestException(`Outcome '${outcome}' requires toClassId.`);
    }

    // Guard the per-term uniqueness (org, student, term) before writing so we
    // return a clean 400 instead of a Prisma unique-constraint 500.
    if (needsClass) {
      const dupe = await tx.enrollment.findFirst({
        where: { studentProfileId: student.id, termId: dto.toTermId },
        select: { id: true },
      });
      if (dupe) throw new BadRequestException(`Student already has an enrollment for term ${dto.toTermId}.`);
    }

    // Close every still-open enrollment BEFORE creating the new one (so the new
    // row is not swept into 'completed').
    await tx.enrollment.updateMany({
      where: { studentProfileId: student.id, status: 'enrolled' },
      data: { status: 'completed' },
    });

    let enrollmentId: string | null = null;
    if (needsClass) {
      const enrollment = await tx.enrollment.create({
        data: {
          organizationId,
          studentProfileId: student.id,
          classId: dto.toClassId!,
          sectionId: dto.toSectionId ?? null,
          termId: dto.toTermId,
          rollNumber: dto.rollNumber ?? student.admissionNo,
          status: 'enrolled',
        },
      });
      enrollmentId = enrollment.id;
      await tx.studentProfile.update({
        where: { id: student.id },
        data: { currentClassId: dto.toClassId!, currentSectionId: dto.toSectionId ?? null },
      });
    }

    // Graduation moves the lifecycle to alumni (FSM: active → alumni is legal).
    if (outcome === 'graduated' && student.status !== 'alumni') {
      await tx.studentStatusHistory.create({
        data: {
          organizationId,
          studentProfileId: student.id,
          fromStatus: student.status,
          toStatus: 'alumni',
          reason: dto.reason ?? 'graduated',
          changedById: this.tenant.userId ?? null,
        },
      });
      await tx.studentProfile.update({ where: { id: student.id }, data: { status: 'alumni' } });
      this.events.publish(EVENTS.SchoolStudentStatusChanged, {
        organizationId,
        studentProfileId: student.id,
        fromStatus: student.status,
        toStatus: 'alumni',
      });
    }

    await this.audit.recordInTx(tx, {
      entity: 'StudentProfile',
      entityId: student.id,
      action: 'update',
      newValues: { action: 'promote', outcome, toClassId: dto.toClassId ?? null, toTermId: dto.toTermId, enrollmentId },
    });

    this.events.publish(EVENTS.SchoolStudentPromoted, {
      organizationId,
      studentProfileId: student.id,
      outcome,
      fromClassId: student.currentClassId ?? null,
      toClassId: dto.toClassId ?? null,
      fromTermId: null,
      toTermId: dto.toTermId,
      enrollmentId,
    });

    return { studentProfileId: student.id, outcome, enrollmentId };
  }
}
