import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { EVENTS, PERMISSIONS } from '@erp/shared';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { AuditService } from '../../../kernel/audit/audit.service';
import { EventBus } from '../../../kernel/events/event-bus';
import { PlacementService } from './placement.service';
import { ClassCohortService } from './class-cohort.service';
import { ProgrammeService } from './programme.service';
import { assertYearWritable } from '../foundation/academic-year-guard';
import {
  canTransition,
  closeReasonFor,
  CREATABLE_STATUSES,
  holdsPlacement,
  isReactivation,
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
  SuspendEnrollmentDto,
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
    private readonly programmes: ProgrammeService,
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
          programme: { select: { id: true, code: true, name: true, stage: true } },
          gradeLevel: { select: { id: true, name: true, order: true } },
          placements: {
            where: { effectiveTo: null },
            include: {
              term: { select: { id: true, name: true } },
              classCohort: { include: { schoolClass: { select: { id: true, name: true } } } },
              section: { select: { id: true, name: true } },
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
      if (['deceased', 'archived'].includes(student.status)) {
        throw new BadRequestException(`This learner's record is ${student.status}; they cannot be enrolled.`);
      }
      const status = (dto.status ?? 'ACTIVE') as EnrollmentStatusValue;
      if (!CREATABLE_STATUSES.includes(status)) {
        throw new BadRequestException(
          `An enrollment is created PENDING or ACTIVE. '${status}' is reached through a status change, ` +
            'which records the reason and ends the class seat.',
        );
      }
      // Closed/archived years take no new members; locks the year row FOR SHARE
      // so the year cannot close underneath this transaction.
      await assertYearWritable(tx, organizationId, dto.academicYearId, 'create');
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
          status,
          enrollmentType: dto.enrollmentType ?? 'NEW',
          admissionApplicationId: dto.admissionApplicationId ?? null,
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

      await this.syncProfileStatus(tx, dto.studentProfileId, 'Enrolled');

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

      // A closed year's memberships may only be completed (promotion / graduation
      // run after closure); nothing else about them changes.
      await assertYearWritable(tx, enrollment.organizationId, enrollment.academicYearId, to === 'COMPLETED' ? 'complete' : 'modify');

      if (isReactivation(from, to)) {
        const held = this.tenant.permissions ?? [];
        if (!held.includes(PERMISSIONS.school.reactivateEnrollment) && !held.includes('*')) {
          throw new ForbiddenException(
            `Returning a ${from.toLowerCase()} learner to a class roll requires the ` +
              `${PERMISSIONS.school.reactivateEnrollment} permission.`,
          );
        }
      }

      const at = dto.effectiveAt ? new Date(dto.effectiveAt) : new Date();
      let suspendedUntil: Date | null = null;
      if (to === 'SUSPENDED' && dto.suspendedUntil) {
        suspendedUntil = new Date(dto.suspendedUntil);
        if (suspendedUntil <= at) {
          throw new BadRequestException('A suspension must end after it starts.');
        }
      } else if (dto.suspendedUntil) {
        throw new BadRequestException('suspendedUntil applies only to a suspension.');
      }

      // Compare-and-set on the status we validated. Two clerks acting on the same
      // learner at once: exactly one transition wins; the other is told, rather
      // than both "succeeding" and the second silently overwriting the first.
      const changed = await tx.studentEnrollment.updateMany({
        where: { id, status: from },
        data: {
          status: to,
          ...(to === 'COMPLETED' ? { completionDate: at } : {}),
          suspendedUntil: to === 'SUSPENDED' ? suspendedUntil : null,
          updatedBy: this.tenant.userId ?? null,
        },
      });
      if (changed.count === 0) {
        throw new ConflictException('This enrollment was changed by someone else just now. Reload and try again.');
      }

      // Losing membership ends the class seat; regaining it needs a new one.
      // The placement rows themselves are never deleted — a withdrawn learner
      // stays visible in the roster that produced last term's results.
      if (holdsPlacement(from) && !holdsPlacement(to)) {
        const closed = await this.placements.closeOpen(tx, id, at, closeReasonFor(to) ?? 'CORRECTION');
        if (closed) await this.adjustAdmissionSeat(tx, enrollment, closed, -1);
      } else if (!holdsPlacement(from) && holdsPlacement(to)) {
        if (!dto.placement) {
          throw new BadRequestException(
            'Reinstating a learner needs a placement: say which class and stream they are coming back to.',
          );
        }
        const { placement } = await this.placements.appendPlacement(tx, enrollment, {
          ...dto.placement,
          movementReason: dto.placement.movementReason ?? 'RE_ENTRY',
          effectiveFrom: dto.placement.effectiveFrom ?? at.toISOString(),
        } as PlacementInputDto & { movementReason: MovementReasonValue });
        await this.adjustAdmissionSeat(tx, enrollment, placement, +1);
      }

      await this.syncProfileStatus(tx, enrollment.studentProfileId, dto.reason);

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

  /**
   * Keep the admission seat ledger (`AdmissionCapacity.claimedSeats`) true when
   * a learner admitted through an application leaves or returns. Admission
   * claims a seat; ending the enrollment must give it back, or a class silently
   * shrinks by one seat each time a pupil leaves. Returning re-claims it, and is
   * refused if the class filled up meanwhile. No capacity row configured means
   * the class is unconstrained for admissions, so there is nothing to do.
   */
  private async adjustAdmissionSeat(tx: any, enrollment: any, placement: any, delta: 1 | -1) {
    if (!enrollment.admissionApplicationId || !placement) return;
    const application = await tx.admissionApplication.findFirst({
      where: { id: enrollment.admissionApplicationId },
      select: { admissionCycleId: true },
    });
    if (!application?.admissionCycleId) return;
    const cohort = await tx.classCohort.findFirst({ where: { id: placement.classCohortId }, select: { classId: true } });
    if (!cohort) return;
    let row = await tx.admissionCapacity.findFirst({
      where: {
        admissionCycleId: application.admissionCycleId,
        classId: cohort.classId,
        sectionId: placement.sectionId ?? '__none__',
      },
    });
    // A section seat with no section-level ledger was claimed against the
    // class-level row (see AdmissionsService.resolveCapacity); release it there.
    if (!row && placement.sectionId) {
      row = await tx.admissionCapacity.findFirst({
        where: { admissionCycleId: application.admissionCycleId, classId: cohort?.classId, sectionId: '__none__' },
      });
    }
    if (!row) return;
    if (delta < 0) {
      await tx.admissionCapacity.updateMany({
        where: { id: row.id, claimedSeats: { gt: 0 } },
        data: { claimedSeats: { decrement: 1 } },
      });
      return;
    }
    const claimed = await tx.admissionCapacity.updateMany({
      where: { id: row.id, claimedSeats: { lt: row.capacity - row.reservedCapacity } },
      data: { claimedSeats: { increment: 1 } },
    });
    if (claimed.count === 0) {
      throw new BadRequestException(
        `No admission seat is free in this class (capacity ${row.capacity}, reserved ${row.reservedCapacity}, ` +
          `claimed ${row.claimedSeats}).`,
      );
    }
  }

  withdraw(id: string, dto: WithdrawEnrollmentDto) {
    return this.changeStatus(id, { toStatus: 'WITHDRAWN', reason: dto.reason, effectiveAt: dto.effectiveAt });
  }

  transferOut(id: string, dto: WithdrawEnrollmentDto) {
    return this.changeStatus(id, { toStatus: 'TRANSFERRED', reason: dto.reason, effectiveAt: dto.effectiveAt });
  }

  suspend(id: string, dto: SuspendEnrollmentDto) {
    return this.changeStatus(id, {
      toStatus: 'SUSPENDED',
      reason: dto.reason,
      effectiveAt: dto.effectiveAt,
      suspendedUntil: dto.suspendedUntil,
    });
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
    return this.prisma.client.$transaction(async (tx: any) => this.repeatInTx(tx, id, dto));
  }

  /** Transaction-bound repeat, for bulk promotion runs and decision boards. */
  async repeatInTx(tx: any, id: string, dto: RepeatGradeDto) {
    const current = await tx.studentEnrollment.findFirst({ where: { id } });
    if (!current) throw new NotFoundException(`Enrollment ${id} not found`);
    if (current.academicYearId === dto.toAcademicYearId) {
      throw new BadRequestException('A repeat places the learner in the NEXT academic year, not the current one.');
    }
    const closeAt = await this.yearTransitionDate(tx, current.academicYearId, dto.toAcademicYearId);

    const openPlacement = await tx.enrollmentPlacement.findFirst({
      where: { enrollmentId: id },
      orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }],
      include: { classCohort: { select: { classId: true } } },
    });
    const classId = dto.classId ?? openPlacement?.classCohort?.classId ?? null;
    if (!classId) {
      throw new BadRequestException('No class to repeat into — supply classId.');
    }

    {
      if (current.status === 'ACTIVE' || current.status === 'SUSPENDED') {
        await this.changeStatusInTx(tx, id, { toStatus: 'COMPLETED', reason: `Repeating: ${dto.reason}`, effectiveAt: closeAt.toISOString() });
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
          sectionId: dto.sectionId !== undefined ? dto.sectionId : (openPlacement?.sectionId ?? null),
          overrideCapacity: dto.overrideCapacity,
          overrideReason: dto.overrideReason,
          rollNumber: openPlacement?.rollNumber ?? undefined,
          effectiveFrom: dto.effectiveFrom,
          movementReason: 'REPEAT',
          notes: dto.reason,
        },
      });
    }
  }

  /**
   * Promote into the next grade in the next academic year (brief §13-14).
   *
   * The destination is CONFIGURED, never inferred: `GradeLevel.nextGradeLevelId`
   * names the grade a learner moves into, and a grade marked terminal (P7) ends
   * the ladder — the learner is COMPLETED and their seat closes as GRADUATION.
   * This replaces picking "the next grade by `order`, then the alphabetically
   * first class in it", which guessed.
   *
   * The previous year's enrollment and placements are closed, never modified:
   * "2025 → P3 North" stays exactly as it was when "2026 → P4 North" is created.
   *
   * With no stream given, the learner keeps their stream across the move when
   * the next class has one with the same CODE — "P3 North → P4 North" — matched
   * on code rather than name so a renamed stream still carries over.
   */
  async promote(id: string, dto: PromoteEnrollmentDto) {
    return this.prisma.client.$transaction(async (tx: any) => this.promoteInTx(tx, id, dto));
  }

  /** Transaction-bound promotion, for bulk promotion runs and decision boards. */
  async promoteInTx(tx: any, id: string, dto: PromoteEnrollmentDto) {
    const current = await tx.studentEnrollment.findFirst({
      where: { id },
      include: { gradeLevel: true },
    });
    if (!current) throw new NotFoundException(`Enrollment ${id} not found`);
    if (current.academicYearId === dto.toAcademicYearId) {
      throw new BadRequestException('Promotion places the learner in the NEXT academic year, not the current one.');
    }
    const closeAt = await this.yearTransitionDate(tx, current.academicYearId, dto.toAcademicYearId);

    const open = await tx.enrollmentPlacement.findFirst({
      where: { enrollmentId: id },
      orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }],
      include: {
        classCohort: { select: { classId: true, schoolClass: { select: { campusId: true } } } },
        section: { select: { code: true } },
      },
    });

    let targetClassId = dto.toClassId ?? null;
    if (!targetClassId) {
      const next = await this.nextStep(tx, current.gradeLevel, open?.classCohort?.schoolClass?.campusId ?? null);
      if (next.kind === 'graduate') {
        const completed = await this.graduateInTx(tx, id, dto.reason ?? `Completed ${current.gradeLevel.name}`);
        return { graduated: true, enrollment: completed, placement: null, warnings: [] as string[] };
      }
      targetClassId = next.classId;
    }

    const targetClass = await tx.schoolClass.findFirst({
      where: { id: targetClassId },
      select: { id: true, gradeLevelId: true, isActive: true, name: true },
    });
    if (!targetClass) throw new NotFoundException(`Class ${targetClassId} not found`);
    if (!targetClass.isActive) {
      throw new BadRequestException(`"${targetClass.name}" has been deactivated and cannot receive new learners.`);
    }

    let sectionId: string | null | undefined = dto.sectionId;
    if (sectionId === undefined && open?.section?.code) {
      const sameCode = await tx.section.findFirst({
        where: { classId: targetClass.id, code: open.section.code, isActive: true },
        select: { id: true },
      });
      sectionId = sameCode?.id ?? null;
    }

    const created = await (async () => {
      if (current.status === 'ACTIVE' || current.status === 'SUSPENDED') {
        await this.changeStatusInTx(tx, id, {
          toStatus: 'COMPLETED',
          reason: dto.reason ?? 'Promoted to the next class',
          effectiveAt: closeAt.toISOString(),
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
          classId: targetClass.id,
          sectionId: sectionId ?? null,
          overrideCapacity: dto.overrideCapacity,
          overrideReason: dto.overrideReason,
          rollNumber: dto.rollNumber,
          effectiveFrom: dto.effectiveFrom,
          movementReason: 'PROMOTION',
          notes: dto.reason,
        } as any,
      });
    })();
    return { graduated: false, ...created };
  }

  /**
   * Where the ladder goes next from `grade`.
   *
   * Terminal → graduate. A configured next grade with exactly one active class →
   * that class. Several classes in the next grade (S3 East / S3 West) → the one on
   * the learner's campus if that settles it; otherwise refuse and ask, because
   * choosing between two classes is a placement decision, not a default. An
   * unconfigured ladder is refused rather than guessed.
   */
  async nextStep(
    client: any,
    grade: { id: string; name: string; nextGradeLevelId: string | null; isTerminal: boolean },
    campusId: string | null,
  ): Promise<{ kind: 'graduate' } | { kind: 'class'; classId: string }> {
    if (!grade.nextGradeLevelId) {
      if (grade.isTerminal) return { kind: 'graduate' };
      throw new BadRequestException(
        `The progression for "${grade.name}" is not configured. Set the grade it promotes into ` +
          '(or mark it as the end of the ladder), or choose the destination class explicitly.',
      );
    }
    const classes = await client.schoolClass.findMany({
      where: { gradeLevelId: grade.nextGradeLevelId, isActive: true },
      select: { id: true, name: true, campusId: true },
      orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }],
    });
    if (classes.length === 0) {
      const next = await client.gradeLevel.findFirst({
        where: { id: grade.nextGradeLevelId },
        select: { name: true },
      });
      throw new BadRequestException(`"${next?.name ?? 'The next grade'}" has no active class to promote into.`);
    }
    if (classes.length === 1) return { kind: 'class', classId: classes[0].id };
    const onCampus = classes.filter((c: any) => c.campusId && c.campusId === campusId);
    if (onCampus.length === 1) return { kind: 'class', classId: onCampus[0].id };
    throw new BadRequestException(
      `The next grade has ${classes.length} classes (${classes.map((c: any) => c.name).join(', ')}). ` +
        'Choose the destination class.',
    );
  }

  /**
   * Finish the ladder: COMPLETED, with the seat closed as GRADUATION rather than
   * a generic COMPLETION, so "left because they finished P7" is distinguishable
   * from any other completed enrollment. No next-year enrollment is created.
   */
  async graduateInTx(tx: any, id: string, reason: string, at: Date = new Date()) {
    const enrollment = await tx.studentEnrollment.findFirst({ where: { id } });
    if (!enrollment) throw new NotFoundException(`Enrollment ${id} not found`);
    await this.placements.closeOpen(tx, id, at, 'GRADUATION');
    return this.changeStatusInTx(tx, id, { toStatus: 'COMPLETED', reason, effectiveAt: at.toISOString() });
  }

  /* ────────────────────────────── Helpers ─────────────────────────────── */

  /**
   * Work out the grade level and programme for a new enrollment. Either may be
   * given explicitly; otherwise the grade comes from the placement class and the
   * programme from the grade level's academic level.
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
      // ADR-028: grade → academic level → default programme.
      programmeId = (await this.programmes.programmeForGradeLevel(gradeLevelId as string, tx))?.id ?? null;
    }
    if (!programmeId) {
      const grade = await tx.gradeLevel.findFirst({ where: { id: gradeLevelId }, select: { name: true } });
      throw new BadRequestException(
        `No academic programme covers grade level "${grade?.name ?? gradeLevelId}". ` +
          'Give its academic level a default programme before enrolling.',
      );
    }

    const programme = await tx.academicProgramme.findFirst({ where: { id: programmeId } });
    if (!programme) throw new NotFoundException(`Programme ${programmeId} not found`);
    if (!programme.isActive) throw new BadRequestException(`Programme "${programme.name}" is not active.`);

    return { gradeLevelId: gradeLevelId as string, programmeId: programmeId as string };
  }

  /**
   * The moment a learner leaves one year for the next: the end of the old year,
   * or now if that is earlier (a mid-year correction). Refuses a "next" year that
   * does not actually come after the current one.
   */
  private async yearTransitionDate(tx: any, fromYearId: string, toYearId: string): Promise<Date> {
    const [from, to] = await Promise.all([
      tx.academicYear.findFirst({ where: { id: fromYearId }, select: { name: true, startDate: true, endDate: true } }),
      tx.academicYear.findFirst({ where: { id: toYearId }, select: { name: true, startDate: true } }),
    ]);
    if (!from || !to) throw new NotFoundException('Academic year not found');
    if (to.startDate <= from.startDate) {
      throw new BadRequestException(`"${to.name}" does not come after "${from.name}". Promotion and repeat only move forward.`);
    }
    const now = new Date();
    return from.endDate < now ? from.endDate : now;
  }

  /**
   * `StudentProfile.status` is a projection of the learner's LATEST-year
   * membership. Withdrawing an old year's enrollment must not mark a learner who
   * is active this year as withdrawn, so the projection is always recomputed
   * from the most recent year rather than from whichever row changed last.
   * Every change is written to StudentStatusHistory.
   */
  async syncProfileStatus(tx: any, studentProfileId: string, reason?: string) {
    const rows = await tx.studentEnrollment.findMany({
      where: { studentProfileId },
      select: { status: true, academicYear: { select: { startDate: true } } },
    });
    if (rows.length === 0) return;
    rows.sort((a: any, b: any) => b.academicYear.startDate.getTime() - a.academicYear.startDate.getTime());
    const next = profileStatusFor(rows[0].status as EnrollmentStatusValue);
    if (!next) return;
    const profile = await tx.studentProfile.findFirst({ where: { id: studentProfileId }, select: { status: true, organizationId: true } });
    if (!profile || profile.status === next) return;
    await tx.studentProfile.updateMany({ where: { id: studentProfileId }, data: { status: next } });
    await tx.studentStatusHistory.create({
      data: {
        organizationId: profile.organizationId,
        studentProfileId,
        fromStatus: profile.status,
        toStatus: next,
        reason: reason ?? 'Enrollment status changed',
        changedById: this.tenant.userId ?? null,
      },
    });
  }

  /** Reinstate learners whose suspension end date has passed (called by the scheduler, per org). */
  async liftExpiredSuspensions(now: Date = new Date()): Promise<number> {
    const due = await this.prisma.client.studentEnrollment.findMany({
      where: { status: 'SUSPENDED', suspendedUntil: { lte: now } },
      select: { id: true },
    });
    let lifted = 0;
    for (const e of due) {
      try {
        await this.changeStatus(e.id, { toStatus: 'ACTIVE', reason: 'Suspension period ended' });
        lifted++;
      } catch {
        // A closed year or a concurrent change: leave it for a human.
      }
    }
    return lifted;
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
