import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { EVENTS } from '@erp/shared';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { AuditService } from '../../../kernel/audit/audit.service';
import { EventBus } from '../../../kernel/events/event-bus';
import { PlacementService } from './placement.service';
import { ClassCohortService } from './class-cohort.service';
import {
  canTransition,
  closeReasonFor,
  holdsPlacement,
  profileStatusFor,
  transitionError,
  type EnrollmentStatusValue,
  type MovementReasonValue,
} from './enrollment-fsm';
import type {
  ChangeEnrollmentStatusDto,
  CreateStudentEnrollmentDto,
  PlacementInputDto,
  PromoteEnrollmentDto,
  RepeatGradeDto,
  WithdrawEnrollmentDto,
} from './enrollment.dto';

/**
 * StudentEnrollment — official school membership (ADR-018).
 *
 * One row per learner per academic year. Membership is NOT placement: a pupil
 * keeps one enrollment across all three terms and moves class via appended
 * `EnrollmentPlacement` rows. Promotion, repeating and re-entry into a new year
 * each create the NEXT year's enrollment rather than editing this one, which is
 * what keeps a repeater's two P5 years distinguishable.
 */
@Injectable()
export class StudentEnrollmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly audit: AuditService,
    private readonly events: EventBus,
    private readonly placements: PlacementService,
    private readonly cohorts: ClassCohortService,
  ) {}

  /* ─────────────────────────────── Reads ──────────────────────────────── */

  async list(opts: {
    academicYearId?: string;
    programmeId?: string;
    status?: EnrollmentStatusValue;
    studentProfileId?: string;
    classCohortId?: string;
    search?: string;
    page?: number;
    pageSize?: number;
  } = {}) {
    const page = Math.max(1, Number(opts.page) || 1);
    const pageSize = Math.min(500, Math.max(1, Number(opts.pageSize) || 50));
    const where: any = {
      ...(opts.academicYearId ? { academicYearId: opts.academicYearId } : {}),
      ...(opts.programmeId ? { programmeId: opts.programmeId } : {}),
      ...(opts.status ? { status: opts.status } : {}),
      ...(opts.studentProfileId ? { studentProfileId: opts.studentProfileId } : {}),
      ...(opts.classCohortId ? { placements: { some: { classCohortId: opts.classCohortId, effectiveTo: null } } } : {}),
      ...(opts.search
        ? {
            OR: [
              { student: { admissionNo: { contains: opts.search, mode: 'insensitive' } } },
              { student: { partner: { name: { contains: opts.search, mode: 'insensitive' } } } },
            ],
          }
        : {}),
    };

    const [total, rows] = await Promise.all([
      this.prisma.client.studentEnrollment.count({ where }),
      this.prisma.client.studentEnrollment.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          student: { include: { partner: { select: { id: true, name: true, phone: true } } } },
          academicYear: { select: { id: true, name: true } },
          programme: { select: { id: true, code: true, name: true, stage: true, groupingMode: true } },
          gradeLevel: { select: { id: true, name: true, order: true } },
          placements: {
            where: { effectiveTo: null },
            include: {
              term: { select: { id: true, name: true } },
              classCohort: { include: { schoolClass: { select: { id: true, name: true } } } },
              section: { select: { id: true, name: true } },
              stream: { select: { id: true, name: true } },
            },
          },
        },
      }),
    ]);

    return {
      data: rows.map((r: any) => ({ ...r, currentPlacement: r.placements[0] ?? null })),
      meta: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
    };
  }

  async get(id: string) {
    const row = await this.prisma.client.studentEnrollment.findFirst({
      where: { id },
      include: {
        student: { include: { partner: { select: { id: true, name: true, phone: true, email: true } } } },
        academicYear: { select: { id: true, name: true } },
        programme: true,
        gradeLevel: { select: { id: true, name: true, order: true } },
        events: { orderBy: { changedAt: 'asc' } },
      },
    });
    if (!row) throw new NotFoundException(`Enrollment ${id} not found`);
    const placements = await this.placements.history(id);
    return { ...row, placements, currentPlacement: placements.find((p: any) => p.effectiveTo === null) ?? null };
  }

  /** Every enrollment a learner has ever held, newest year first. */
  async forStudent(studentProfileId: string) {
    const rows = await this.prisma.client.studentEnrollment.findMany({
      where: { studentProfileId },
      orderBy: { admissionDate: 'desc' },
      include: {
        academicYear: { select: { id: true, name: true, startDate: true } },
        programme: { select: { id: true, code: true, name: true } },
        gradeLevel: { select: { id: true, name: true, order: true } },
      },
    });
    const withPlacements = [];
    for (const r of rows) {
      withPlacements.push({ ...r, placements: await this.placements.history(r.id) });
    }
    return withPlacements;
  }

  /* ────────────────────────────── Commands ────────────────────────────── */

  async create(dto: CreateStudentEnrollmentDto) {
    return this.prisma.client.$transaction(async (tx: any) => this.createInTx(tx, dto));
  }

  /**
   * Transaction-bound create. Exposed separately so promotion and repeat can do
   * "complete the old year + open the next one" in ONE transaction — Prisma
   * cannot nest interactive transactions, and a half-applied promotion would
   * leave a learner completed with nowhere to sit.
   */
  async createInTx(tx: any, dto: CreateStudentEnrollmentDto) {
    const organizationId = this.tenant.organizationId;
    {
      const student = await tx.studentProfile.findFirst({ where: { id: dto.studentProfileId } });
      if (!student) throw new NotFoundException(`Student ${dto.studentProfileId} not found`);
      const year = await tx.academicYear.findFirst({ where: { id: dto.academicYearId } });
      if (!year) throw new NotFoundException(`Academic year ${dto.academicYearId} not found`);

      const duplicate = await tx.studentEnrollment.findFirst({
        where: { studentProfileId: dto.studentProfileId, academicYearId: dto.academicYearId },
      });
      if (duplicate) {
        throw new BadRequestException(
          `This learner already has a ${year.name} enrollment (${duplicate.status}). ` +
            'Move, reinstate or withdraw that one — a second membership for the same year would split their history.',
        );
      }

      const { gradeLevelId, programmeId } = await this.resolveGradeAndProgramme(tx, dto);

      const enrollment = await tx.studentEnrollment.create({
        data: {
          organizationId,
          studentProfileId: dto.studentProfileId,
          academicYearId: dto.academicYearId,
          programmeId,
          gradeLevelId,
          admissionDate: dto.admissionDate ? new Date(dto.admissionDate) : new Date(),
          status: dto.status ?? 'ACTIVE',
          enrollmentType: dto.enrollmentType ?? 'NEW',
          notes: dto.notes ?? null,
          createdBy: this.tenant.userId ?? null,
        },
      });

      await this.recordEvent(tx, enrollment, null, enrollment.status, 'Enrollment created');

      let placement = null;
      let warnings: string[] = [];
      if (dto.placement) {
        const reason: MovementReasonValue =
          dto.placement.movementReason ??
          (dto.enrollmentType === 'TRANSFER_IN'
            ? 'TRANSFER_IN'
            : dto.enrollmentType === 'REPEAT'
              ? 'REPEAT'
              : 'INITIAL_PLACEMENT');
        const result = await this.placements.appendPlacement(tx, enrollment, {
          ...dto.placement,
          movementReason: reason,
          effectiveFrom: dto.placement.effectiveFrom ?? enrollment.admissionDate.toISOString(),
        } as PlacementInputDto & { movementReason: MovementReasonValue });
        placement = result.placement;
        warnings = result.warnings;
      }

      const profileStatus = profileStatusFor(enrollment.status as EnrollmentStatusValue);
      if (profileStatus) {
        await tx.studentProfile.updateMany({ where: { id: dto.studentProfileId }, data: { status: profileStatus } });
      }

      await this.audit.recordInTx(tx, {
        entity: 'StudentEnrollment',
        entityId: enrollment.id,
        action: 'create',
        newValues: {
          studentProfileId: dto.studentProfileId,
          academicYearId: dto.academicYearId,
          programmeId,
          gradeLevelId,
          status: enrollment.status,
          enrollmentType: enrollment.enrollmentType,
        },
      });
      await this.events.publishInTx(tx, EVENTS.SchoolStudentEnrollmentCreated, {
        organizationId,
        enrollmentId: enrollment.id,
        studentProfileId: dto.studentProfileId,
        academicYearId: dto.academicYearId,
        programmeId,
        gradeLevelId,
        actorId: this.tenant.userId ?? null,
        requestId: this.tenant.requestId ?? null,
      });

      return { enrollment, placement, warnings };
    }
  }

  /**
   * A late admission is an ordinary enrollment with an explicit admission date
   * partway through the year. It is a named command because it is a distinct
   * school event, and because dating the placement from the admission date —
   * not from "now" — is what keeps earlier assessment rosters correct.
   */
  async lateAdmission(dto: CreateStudentEnrollmentDto) {
    if (!dto.admissionDate) {
      throw new BadRequestException('A late admission needs the date the learner actually joined.');
    }
    return this.create({
      ...dto,
      enrollmentType: dto.enrollmentType ?? 'NEW',
      placement: dto.placement
        ? { ...dto.placement, movementReason: 'LATE_ADMISSION', effectiveFrom: dto.placement.effectiveFrom ?? dto.admissionDate }
        : undefined,
    });
  }

  /** Generic guarded status transition. Every other command routes through it. */
  async changeStatus(id: string, dto: ChangeEnrollmentStatusDto) {
    return this.prisma.client.$transaction(async (tx: any) => this.changeStatusInTx(tx, id, dto));
  }

  /** Transaction-bound status change — see `createInTx` for why this is split. */
  async changeStatusInTx(tx: any, id: string, dto: ChangeEnrollmentStatusDto) {
    {
      const enrollment = await tx.studentEnrollment.findFirst({ where: { id } });
      if (!enrollment) throw new NotFoundException(`Enrollment ${id} not found`);
      const from = enrollment.status as EnrollmentStatusValue;
      const to = dto.toStatus;
      if (from === to) throw new BadRequestException(`Enrollment is already '${from}'.`);
      if (!canTransition(from, to)) throw new BadRequestException(transitionError(from, to));

      const at = dto.effectiveAt ? new Date(dto.effectiveAt) : new Date();

      await tx.studentEnrollment.updateMany({
        where: { id },
        data: {
          status: to,
          ...(to === 'COMPLETED' ? { completionDate: at } : {}),
          updatedBy: this.tenant.userId ?? null,
        },
      });

      // Losing membership ends the class seat; regaining it needs a new one.
      // The placement rows themselves are never deleted — a withdrawn learner
      // stays visible in the roster that produced last term's results.
      if (holdsPlacement(from) && !holdsPlacement(to)) {
        await this.placements.closeOpen(tx, id, at, closeReasonFor(to) ?? 'CORRECTION');
        await this.placements.syncProjection(tx, enrollment.studentProfileId);
      } else if (!holdsPlacement(from) && holdsPlacement(to)) {
        if (!dto.placement) {
          throw new BadRequestException(
            'Reinstating a learner needs a placement: say which class, section and stream they are coming back to.',
          );
        }
        await this.placements.appendPlacement(tx, enrollment, {
          ...dto.placement,
          movementReason: dto.placement.movementReason ?? 'RE_ENTRY',
          effectiveFrom: dto.placement.effectiveFrom ?? at.toISOString(),
        } as PlacementInputDto & { movementReason: MovementReasonValue });
      }

      const profileStatus = profileStatusFor(to);
      if (profileStatus) {
        await tx.studentProfile.updateMany({ where: { id: enrollment.studentProfileId }, data: { status: profileStatus } });
      }

      await this.recordEvent(tx, enrollment, from, to, dto.reason);
      await this.audit.recordInTx(tx, {
        entity: 'StudentEnrollment',
        entityId: id,
        action: 'update',
        oldValues: { status: from },
        newValues: { status: to, reason: dto.reason },
      });
      await this.events.publishInTx(tx, EVENTS.SchoolStudentEnrollmentStatusChanged, {
        organizationId: enrollment.organizationId,
        enrollmentId: id,
        studentProfileId: enrollment.studentProfileId,
        fromStatus: from,
        toStatus: to,
        reason: dto.reason,
        effectiveAt: at,
        actorId: this.tenant.userId ?? null,
        requestId: this.tenant.requestId ?? null,
      });

      return tx.studentEnrollment.findFirst({ where: { id } });
    }
  }

  withdraw(id: string, dto: WithdrawEnrollmentDto) {
    return this.changeStatus(id, { toStatus: 'WITHDRAWN', reason: dto.reason, effectiveAt: dto.effectiveAt });
  }

  transferOut(id: string, dto: WithdrawEnrollmentDto) {
    return this.changeStatus(id, { toStatus: 'TRANSFERRED', reason: dto.reason, effectiveAt: dto.effectiveAt });
  }

  suspend(id: string, dto: WithdrawEnrollmentDto) {
    return this.changeStatus(id, { toStatus: 'SUSPENDED', reason: dto.reason, effectiveAt: dto.effectiveAt });
  }

  complete(id: string, dto: WithdrawEnrollmentDto) {
    return this.changeStatus(id, { toStatus: 'COMPLETED', reason: dto.reason, effectiveAt: dto.effectiveAt });
  }

  /**
   * Repeat the grade: a NEW enrollment in the next academic year, same grade
   * level, `enrollmentType: REPEAT`. The previous year's enrollment is completed
   * so both years stay separately reportable.
   */
  async repeat(id: string, dto: RepeatGradeDto) {
    const current = await this.prisma.client.studentEnrollment.findFirst({ where: { id } });
    if (!current) throw new NotFoundException(`Enrollment ${id} not found`);
    if (current.academicYearId === dto.toAcademicYearId) {
      throw new BadRequestException('A repeat places the learner in the NEXT academic year, not the current one.');
    }

    const openPlacement = await this.placements.openPlacementOf(this.prisma.client, id);
    const classId =
      dto.classId ??
      (openPlacement
        ? (await this.prisma.client.classCohort.findFirst({ where: { id: openPlacement.classCohortId } }))?.classId
        : null);
    if (!classId) {
      throw new BadRequestException('No class to repeat into — supply classId.');
    }

    return this.prisma.client.$transaction(async (tx: any) => {
      if (current.status === 'ACTIVE' || current.status === 'SUSPENDED') {
        await this.changeStatusInTx(tx, id, { toStatus: 'COMPLETED', reason: `Repeating: ${dto.reason}` });
      }
      return this.createInTx(tx, {
        studentProfileId: current.studentProfileId,
        academicYearId: dto.toAcademicYearId,
        programmeId: current.programmeId,
        gradeLevelId: current.gradeLevelId,
        admissionDate: dto.effectiveFrom,
        enrollmentType: 'REPEAT',
        status: 'ACTIVE',
        notes: dto.reason,
        placement: {
          termId: dto.toTermId,
          classId,
          sectionId: dto.sectionId ?? null,
          streamId: dto.streamId ?? null,
          rollNumber: openPlacement?.rollNumber ?? undefined,
          effectiveFrom: dto.effectiveFrom,
          movementReason: 'REPEAT',
          notes: dto.reason,
        },
      });
    });
  }

  /**
   * Promote into the next grade in the next academic year. With no target class
   * the grade-level ladder picks the next one; a learner at the top grade is
   * COMPLETED instead of being promoted into nothing.
   */
  async promote(id: string, dto: PromoteEnrollmentDto) {
    const current = await this.prisma.client.studentEnrollment.findFirst({
      where: { id },
      include: { gradeLevel: true },
    });
    if (!current) throw new NotFoundException(`Enrollment ${id} not found`);
    if (current.academicYearId === dto.toAcademicYearId) {
      throw new BadRequestException('Promotion places the learner in the NEXT academic year, not the current one.');
    }

    const targetClassId = dto.toClassId ?? (await this.nextClassId(current.gradeLevel.order));
    if (!targetClassId) {
      const completed = await this.changeStatus(id, {
        toStatus: 'COMPLETED',
        reason: dto.reason ?? 'Completed the highest grade offered',
      });
      return { graduated: true, enrollment: completed, placement: null, warnings: [] as string[] };
    }

    const targetClass = await this.prisma.client.schoolClass.findFirst({
      where: { id: targetClassId },
      select: { id: true, gradeLevelId: true },
    });
    if (!targetClass) throw new NotFoundException(`Class ${targetClassId} not found`);

    const created = await this.prisma.client.$transaction(async (tx: any) => {
      if (current.status === 'ACTIVE' || current.status === 'SUSPENDED') {
        await this.changeStatusInTx(tx, id, {
          toStatus: 'COMPLETED',
          reason: dto.reason ?? 'Promoted to the next class',
        });
      }
      return this.createInTx(tx, {
        studentProfileId: current.studentProfileId,
        academicYearId: dto.toAcademicYearId,
        gradeLevelId: targetClass.gradeLevelId,
        admissionDate: dto.effectiveFrom,
        enrollmentType: 'CONTINUING',
        status: 'ACTIVE',
        notes: dto.reason,
        placement: {
          termId: dto.toTermId,
          classId: targetClassId,
          sectionId: dto.sectionId ?? null,
          streamId: dto.streamId ?? null,
          rollNumber: dto.rollNumber,
          effectiveFrom: dto.effectiveFrom,
          movementReason: 'PROMOTION',
          notes: dto.reason,
        },
      });
    });
    return { graduated: false, ...created };
  }

  /* ────────────────────────────── Helpers ─────────────────────────────── */

  /** The first class one rung up the grade ladder, or null at the top. */
  private async nextClassId(currentOrder: number): Promise<string | null> {
    const next = await this.prisma.client.gradeLevel.findFirst({
      where: { order: { gt: currentOrder } },
      orderBy: { order: 'asc' },
      select: { id: true },
    });
    if (!next) return null;
    const cls = await this.prisma.client.schoolClass.findFirst({
      where: { gradeLevelId: next.id },
      orderBy: { name: 'asc' },
      select: { id: true },
    });
    return cls?.id ?? null;
  }

  /**
   * Work out the grade level and programme for a new enrollment. Either may be
   * given explicitly; otherwise the grade comes from the placement class and the
   * programme from the grade level's programme link.
   */
  private async resolveGradeAndProgramme(tx: any, dto: CreateStudentEnrollmentDto) {
    let gradeLevelId = dto.gradeLevelId ?? null;

    if (!gradeLevelId) {
      const classId =
        dto.placement?.classId ??
        (dto.placement?.classCohortId
          ? (await tx.classCohort.findFirst({ where: { id: dto.placement.classCohortId }, select: { classId: true } }))?.classId
          : null);
      if (!classId) {
        throw new BadRequestException('Supply a gradeLevelId, or a placement whose class implies one.');
      }
      const cls = await tx.schoolClass.findFirst({ where: { id: classId }, select: { gradeLevelId: true } });
      if (!cls) throw new NotFoundException(`Class ${classId} not found`);
      gradeLevelId = cls.gradeLevelId;
    }

    let programmeId = dto.programmeId ?? null;
    if (!programmeId) {
      const link = await tx.programmeGradeLevel.findFirst({ where: { gradeLevelId }, select: { programmeId: true } });
      programmeId = link?.programmeId ?? null;
    }
    if (!programmeId) {
      const grade = await tx.gradeLevel.findFirst({ where: { id: gradeLevelId }, select: { name: true } });
      throw new BadRequestException(
        `No academic programme covers grade level "${grade?.name ?? gradeLevelId}". ` +
          'Create the programme (or run the Uganda templates) and link the grade level before enrolling.',
      );
    }

    const programme = await tx.academicProgramme.findFirst({ where: { id: programmeId } });
    if (!programme) throw new NotFoundException(`Programme ${programmeId} not found`);
    if (!programme.isActive) throw new BadRequestException(`Programme "${programme.name}" is not active.`);

    return { gradeLevelId: gradeLevelId as string, programmeId: programmeId as string };
  }

  private async recordEvent(
    tx: any,
    enrollment: { id: string; organizationId: string },
    fromStatus: EnrollmentStatusValue | null,
    toStatus: string,
    reason?: string,
  ) {
    await tx.studentEnrollmentEvent.create({
      data: {
        organizationId: enrollment.organizationId,
        enrollmentId: enrollment.id,
        fromStatus,
        toStatus: toStatus as any,
        reason: reason ?? null,
        changedById: this.tenant.userId ?? null,
        requestId: this.tenant.requestId ?? null,
      },
    });
  }
}
