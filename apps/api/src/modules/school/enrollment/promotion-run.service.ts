import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { releasedResultSetWhere } from '../assessment/result-status';
import { EVENTS } from '@erp/shared';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { EventBus } from '../../../kernel/events/event-bus';
import { StudentEnrollmentService } from './student-enrollment.service';
import { PLACEMENT_HOLDING_STATUSES, PROGRESSABLE_STATUSES } from './enrollment-fsm';
import type { PromoteStudentDto, PromotionOutcome, PromotionRolloverDto } from './enrollment.dto';

type PlanOutcome = PromotionOutcome | 'skipped';

export interface PromotionPlanRow {
  studentProfileId: string;
  enrollmentId: string | null;
  admissionNo: string;
  outcome: PlanOutcome;
  toClassId: string | null;
  toSectionId: string | null;
  /** The stream carried forward, e.g. "North" — shown in the dry run. */
  subdivision?: string | null;
  reason?: string;
}

/**
 * Student-facing promotion commands (`/school/promotion`) on the canonical
 * enrollment + placement model.
 *
 * Every write delegates to StudentEnrollmentService, so the invariants live in
 * one place: the previous year's enrollment is COMPLETED and its placement is
 * end-dated, never rewritten; the next year gets a NEW enrollment; capacity,
 * closed-year and grouping rules apply exactly as they do to a manual enrollment.
 */
@Injectable()
export class PromotionRunService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly events: EventBus,
    private readonly enrollments: StudentEnrollmentService,
  ) {}

  /** Promote, repeat or graduate one learner. */
  async promote(dto: PromoteStudentDto) {
    return this.prisma.client.$transaction((tx: any) => this.promoteOne(tx, dto));
  }

  /**
   * Year-end rollover from a term of year N into a term of year N+1.
   *
   * Dry-run by default. Execution runs one transaction per learner, so a run
   * that fails part-way is resumable: a learner already enrolled in the target
   * year is reported as skipped rather than enrolled twice.
   */
  async rollover(dto: PromotionRolloverDto) {
    const dryRun = dto.dryRun ?? true;
    const client = this.prisma.client;

    const [fromTerm, toTerm] = await Promise.all([
      client.term.findFirst({ where: { id: dto.fromTermId } }),
      client.term.findFirst({ where: { id: dto.toTermId } }),
    ]);
    if (!fromTerm) throw new NotFoundException(`Term ${dto.fromTermId} not found`);
    if (!toTerm) throw new NotFoundException(`Term ${dto.toTermId} not found`);
    if (fromTerm.academicYearId === toTerm.academicYearId) {
      throw new BadRequestException(
        'Both terms are in the same academic year. Moving learners between terms of one year is a term rollover ' +
          '(POST /school/placements/term-rollover), not a promotion.',
      );
    }
    await this.assertLaterYear(client, fromTerm.academicYearId, toTerm.academicYearId);

    // Everyone who was on a class roll in the source term and still holds a
    // seat, PLUS learners whose year was already marked complete: "Mark the year
    // complete, then promote" closes the seat (COMPLETION), and those learners
    // used to vanish from the rollover without even a skip row (re-audit #3
    // P1-11). A graduation closes with GRADUATION and stays out.
    const open = await client.enrollmentPlacement.findMany({
      where: {
        termId: dto.fromTermId,
        OR: [
          { effectiveTo: null, enrollment: { status: { in: [...PLACEMENT_HOLDING_STATUSES] } } },
          { endReason: 'COMPLETION', enrollment: { status: 'COMPLETED' } },
        ],
      },
      include: {
        enrollment: { include: { gradeLevel: true, student: { select: { id: true, admissionNo: true } } } },
        classCohort: { select: { classId: true, schoolClass: { select: { campusId: true } } } },
        section: { select: { code: true, name: true } },
      },
    });

    const promote: PromotionPlanRow[] = [];
    const repeat: PromotionPlanRow[] = [];
    const graduate: PromotionPlanRow[] = [];
    const skip: PromotionPlanRow[] = [];

    for (const p of open) {
      const e = p.enrollment;
      const base = {
        studentProfileId: e.studentProfileId,
        enrollmentId: e.id,
        admissionNo: e.student?.admissionNo ?? '',
      };
      const already = await client.studentEnrollment.findFirst({
        where: { studentProfileId: e.studentProfileId, academicYearId: toTerm.academicYearId },
        select: { id: true },
      });
      if (already) {
        skip.push({ ...base, outcome: 'skipped', toClassId: null, toSectionId: null, reason: 'already enrolled in the target year' });
        continue;
      }
      // A PENDING learner never started the year, so there is nothing to move
      // on from (PROGRESSABLE_STATUSES). Say so in the plan rather than letting
      // execution fail the row.
      if (e.status === 'PENDING') {
        skip.push({ ...base, outcome: 'skipped', toClassId: null, toSectionId: null, reason: 'enrollment still pending — activate it first' });
        continue;
      }

      const rec = await this.latestRecommendation(client, e.studentProfileId, dto.fromTermId);
      if (rec === 'review') {
        skip.push({ ...base, outcome: 'skipped', toClassId: null, toSectionId: null, reason: 'result marked for review' });
        continue;
      }
      if (rec === 'repeat') {
        repeat.push({
          ...base,
          outcome: 'repeated',
          toClassId: p.classCohort.classId,
          toSectionId: p.sectionId ?? null,
          subdivision: p.section?.name ?? null,
          reason: 'result: repeat recommended',
        });
        continue;
      }

      let step: { kind: 'graduate' } | { kind: 'class'; classId: string };
      try {
        step = await this.enrollments.nextStep(client, e.gradeLevel, p.classCohort.schoolClass?.campusId ?? null);
      } catch (err) {
        skip.push({ ...base, outcome: 'skipped', toClassId: null, toSectionId: null, reason: (err as Error).message });
        continue;
      }
      if (step.kind === 'graduate') {
        graduate.push({ ...base, outcome: 'graduated', toClassId: null, toSectionId: null, reason: rec ? `result: ${rec}` : 'end of ladder' });
        continue;
      }

      // Keep the stream across the move when the next class has one with the same code.
      let toSectionId: string | null = null;
      let lost: string | null = null;
      if (p.section?.code) {
        const same = await client.section.findFirst({
          where: { classId: step.classId, code: p.section.code, isActive: true },
          select: { id: true },
        });
        toSectionId = same?.id ?? null;
        if (!same) lost = `stream "${p.section.name}" not defined in target class`;
      }
      const why = rec ? `result: ${rec}` : 'grade ladder (no published result)';
      promote.push({
        ...base,
        outcome: 'promoted',
        toClassId: step.classId,
        toSectionId,
        subdivision: p.section?.name ?? null,
        reason: lost ? `${why} — ${lost}` : why,
      });
    }

    const plan = {
      fromTermId: dto.fromTermId,
      toTermId: dto.toTermId,
      dryRun,
      committed: false,
      counts: {
        promoted: promote.length,
        repeated: repeat.length,
        graduated: graduate.length,
        skipped: skip.length,
        total: open.length,
      },
      promote,
      repeat,
      graduate,
      skip,
    };
    if (dryRun) return plan;

    const executed: Array<{ studentProfileId: string; outcome: string; enrollmentId: string | null; error?: string }> = [];
    for (const row of [...promote, ...repeat, ...graduate]) {
      try {
        const res = await this.prisma.client.$transaction((tx: any) =>
          this.promoteOne(tx, {
            studentProfileId: row.studentProfileId,
            toTermId: dto.toTermId,
            toClassId: row.toClassId ?? undefined,
            toSectionId: row.toSectionId ?? undefined,
            outcome: row.outcome as PromotionOutcome,
            reason: dto.reason ?? 'Academic-year rollover',
          }),
        );
        executed.push({ studentProfileId: row.studentProfileId, outcome: res.outcome, enrollmentId: res.enrollmentId });
      } catch (err) {
        executed.push({
          studentProfileId: row.studentProfileId,
          outcome: 'error',
          enrollmentId: null,
          error: String((err as Error)?.message ?? err),
        });
      }
    }
    return { ...plan, committed: true, executed };
  }

  /** The learner's enrollment that currently holds a class seat (latest year first). */
  private async currentEnrollment(tx: any, studentProfileId: string) {
    const rows = await tx.studentEnrollment.findMany({
      // PROGRESSABLE, not placement-holding: a learner whose year was marked
      // complete has no open seat but is exactly who promotion is for
      // (re-audit #3 P1-11). Latest year first, so an already-promoted learner
      // resolves to the new year and is refused as "already enrolled".
      where: { studentProfileId, status: { in: [...PROGRESSABLE_STATUSES] } },
      include: { academicYear: { select: { startDate: true } } },
    });
    if (rows.length === 0) return null;
    rows.sort((a: any, b: any) => b.academicYear.startDate.getTime() - a.academicYear.startDate.getTime());
    return rows[0];
  }

  private async assertLaterYear(client: any, fromYearId: string, toYearId: string) {
    const [from, to] = await Promise.all([
      client.academicYear.findFirst({ where: { id: fromYearId }, select: { startDate: true, name: true } }),
      client.academicYear.findFirst({ where: { id: toYearId }, select: { startDate: true, name: true } }),
    ]);
    if (!from || !to) throw new NotFoundException('Academic year not found');
    if (to.startDate <= from.startDate) {
      throw new BadRequestException(`"${to.name}" does not come after "${from.name}". Promotion only moves forward in time.`);
    }
  }

  private async promoteOne(
    tx: any,
    dto: PromoteStudentDto,
  ): Promise<{ studentProfileId: string; outcome: PromotionOutcome; enrollmentId: string | null }> {
    const current = await this.currentEnrollment(tx, dto.studentProfileId);
    if (!current) {
      throw new BadRequestException('This learner has no active enrollment to promote from.');
    }
    const toTerm = await tx.term.findFirst({ where: { id: dto.toTermId } });
    if (!toTerm) throw new NotFoundException(`Term ${dto.toTermId} not found`);
    if (toTerm.academicYearId === current.academicYearId) {
      throw new BadRequestException('The target term is in the learner\'s current academic year. Use a placement move instead.');
    }
    await this.assertLaterYear(tx, current.academicYearId, toTerm.academicYearId);

    const effectiveFrom = toTerm.startDate.toISOString();
    const outcome: PromotionOutcome = dto.outcome ?? 'promoted';
    const reason = dto.reason ?? (outcome === 'repeated' ? 'Repeating the grade' : 'Promoted to the next class');
    let enrollmentId: string | null = null;

    if (outcome === 'graduated') {
      await this.enrollments.graduateInTx(tx, current.id, reason);
    } else if (outcome === 'repeated') {
      const res = await this.enrollments.repeatInTx(tx, current.id, {
        toAcademicYearId: toTerm.academicYearId,
        toTermId: toTerm.id,
        classId: dto.toClassId,
        sectionId: dto.toSectionId,
        reason,
        effectiveFrom,
      });
      enrollmentId = res.enrollment.id;
    } else {
      const res: any = await this.enrollments.promoteInTx(tx, current.id, {
        toAcademicYearId: toTerm.academicYearId,
        toTermId: toTerm.id,
        toClassId: dto.toClassId,
        sectionId: dto.toSectionId,
        rollNumber: dto.rollNumber,
        reason,
        effectiveFrom,
      });
      enrollmentId = res.enrollment?.id ?? null;
      if (res.graduated) {
        await this.publish(tx, dto.studentProfileId, 'graduated', current.id, null, toTerm.id);
        return { studentProfileId: dto.studentProfileId, outcome: 'graduated', enrollmentId: null };
      }
    }

    await this.publish(tx, dto.studentProfileId, outcome, current.id, enrollmentId, toTerm.id);
    return { studentProfileId: dto.studentProfileId, outcome, enrollmentId };
  }

  private async publish(
    tx: any,
    studentProfileId: string,
    outcome: PromotionOutcome,
    fromEnrollmentId: string,
    enrollmentId: string | null,
    toTermId: string,
  ) {
    const [from, to] = await Promise.all([
      this.lastPlacement(tx, fromEnrollmentId),
      enrollmentId ? this.lastPlacement(tx, enrollmentId) : Promise.resolve(null),
    ]);
    await this.events.publishInTx(tx, EVENTS.SchoolStudentPromoted, {
      organizationId: this.tenant.organizationId,
      studentProfileId,
      outcome,
      fromClassId: from?.classCohort?.classId ?? null,
      toClassId: to?.classCohort?.classId ?? null,
      fromTermId: from?.termId ?? null,
      toTermId,
      enrollmentId,
    });
  }

  private lastPlacement(tx: any, enrollmentId: string) {
    return tx.enrollmentPlacement.findFirst({
      where: { enrollmentId },
      orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }],
      select: { termId: true, classCohort: { select: { classId: true } } },
    });
  }

  /** The recommendation on the latest PUBLISHED result set for the term, if any. */
  private async latestRecommendation(client: any, studentProfileId: string, termId: string): Promise<string | null> {
    const t = await client.studentTermResult.findFirst({
      where: { studentProfileId, termId, resultSet: releasedResultSetWhere() },
      orderBy: { resultSet: { revision: 'desc' } },
      select: { promotionRecommendation: true },
    });
    return t?.promotionRecommendation ?? null;
  }
}
