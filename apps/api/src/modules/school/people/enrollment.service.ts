import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Enrollment } from '@prisma/client';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { AuditService } from '../../../kernel/audit/audit.service';
import { EventBus } from '../../../kernel/events/event-bus';
import { SequenceService } from '../../../kernel/sequence/sequence.service';
import { EVENTS } from '@erp/shared';

/** Enrollment lifecycle FSM: enrolled → (transferred_out | withdrawn | completed). */
const ENROLLMENT_TRANSITIONS: Record<string, ReadonlyArray<string>> = {
  enrolled: ['transferred_out', 'withdrawn', 'completed'],
  transferred_out: ['enrolled'],
  withdrawn: ['enrolled'],
  completed: [],
};

export class EnrollStudentDto {
  studentProfileId!: string;
  classId!: string;
  sectionId?: string;
  streamId?: string;
  termId!: string;
  rollNumber!: string;
  applicationId?: string;
  effectiveDate?: Date | string;
}

export class EndEnrollmentDto {
  reason!: string;
  endedAt?: Date | string;
}

export class GuardianInput {
  guardianContactId!: string;
  relationship!: string;
  isPrimary?: boolean;
  canPickup?: boolean;
  receivesStatements?: boolean;
}

/** Canonical new-student enrollment (used by AdmissionsService.enrollApplication). */
export class EnrollNewStudentInput {
  organizationId!: string;
  applicationId?: string | null;
  name!: string;
  email?: string | null;
  phone?: string | null;
  dateOfBirth?: string | null;
  gender?: string | null;
  nationality?: string | null;
  religion?: string | null;
  house?: string | null;
  residenceType?: string | null;
  admissionNo?: string | null;
  classId!: string;
  sectionId?: string | null;
  streamId?: string | null;
  termId!: string;
  rollNumber!: string;
  guardians?: GuardianInput[];
  customFields?: Record<string, unknown>;
}

@Injectable()
export class EnrollmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly audit: AuditService,
    private readonly events: EventBus,
    private readonly sequence: SequenceService,
  ) {}

  /**
   * Canonical new-student enrollment engine. Creates Partner + StudentProfile +
   * Enrollment + optional guardians + StudentStatusHistory atomically, then links
   * the application and returns the entities. Idempotent per (applicationId, termId).
   */
  async enrollNewStudent(
    input: EnrollNewStudentInput,
    outerTx?: any,
  ): Promise<{ partner: any; profile: any; enrollment: Enrollment }> {
    // Accepts an existing transaction client so a caller that must also mutate its
    // own aggregate (AdmissionsService.enroll marks the application enrolled) can
    // do the whole thing in one atomic unit. Prisma cannot nest interactive
    // transactions, so the caller passes its tx rather than us opening a second.
    const run = async (tx: any) => {
      const organizationId = input.organizationId;

      // Idempotency: one active enrollment per application + term.
      if (input.applicationId) {
        const prior = await tx.enrollment.findFirst({
          where: { organizationId, applicationId: input.applicationId, termId: input.termId, status: 'enrolled' },
        });
        if (prior) {
          const profile = await tx.studentProfile.findFirst({ where: { id: prior.studentProfileId } });
          return { partner: null, profile, enrollment: prior };
        }
      }

      const code = await this.sequence.next(`student:${new Date().getUTCFullYear()}`, { prefix: 'STU-', padding: 6 }, tx);
      const partner = await tx.partner.create({
        data: {
          organizationId,
          code,
          name: input.name,
          isCompany: false,
          isCustomer: true,
          email: input.email ?? null,
          phone: input.phone ?? null,
          customFields: {
            dateOfBirth: input.dateOfBirth ?? null,
            gender: input.gender ?? null,
            nationality: input.nationality ?? null,
            religion: input.religion ?? null,
            house: input.house ?? null,
          },
        },
      });
      const profile = await tx.studentProfile.create({
        data: {
          organizationId,
          partnerId: partner.id,
          admissionNo: input.admissionNo ?? code,
          currentClassId: input.classId,
          currentSectionId: input.sectionId ?? null,
          currentStreamId: input.streamId ?? null,
          enrollmentDate: new Date(),
          dateOfBirth: input.dateOfBirth ? new Date(input.dateOfBirth) : null,
          gender: input.gender ?? null,
          nationality: input.nationality ?? null,
          religion: input.religion ?? null,
          residenceType: input.residenceType ?? 'day',
          house: input.house ?? null,
          status: 'active',
          customFields: input.customFields ?? {},
        },
      });
      const enrollment = await tx.enrollment.create({
        data: {
          organizationId,
          applicationId: input.applicationId ?? null,
          studentProfileId: profile.id,
          classId: input.classId,
          sectionId: input.sectionId ?? null,
          streamId: input.streamId ?? null,
          termId: input.termId,
          rollNumber: input.rollNumber,
          status: 'enrolled',
        },
      });

      // Student lifecycle history (gap: enrollment previously did not record it).
      await tx.studentStatusHistory.create({
        data: {
          organizationId,
          studentProfileId: profile.id,
          fromStatus: 'applicant',
          toStatus: 'active',
          reason: 'Enrollment',
          changedById: this.tenant.userId ?? null,
        },
      });

      // Guardian linking inside the same transaction (atomic).
      if (input.guardians?.length) {
        for (const g of input.guardians) {
          await tx.studentGuardian.create({
            data: {
              organizationId,
              studentProfileId: profile.id,
              guardianContactId: g.guardianContactId,
              relationship: g.relationship,
              isPrimary: g.isPrimary ?? false,
              canPickup: g.canPickup ?? true,
              receivesStatements: g.receivesStatements ?? true,
            },
          });
        }
      }

      await tx.enrollmentHistory.create({
        data: { organizationId, enrollmentId: enrollment.id, toStatus: 'enrolled', reason: 'Initial enrollment', changedById: this.tenant.userId ?? null },
      });

      await this.audit.recordInTx(tx, { entity: 'StudentProfile', entityId: profile.id, action: 'create', newValues: { partner, profile, enrollment } });
      this.events.publish(EVENTS.SchoolStudentCreated, { organizationId, studentProfileId: profile.id, partnerId: partner.id, admissionNo: profile.admissionNo });
      this.events.publish(EVENTS.SchoolEnrollmentCreated, { organizationId, enrollmentId: enrollment.id, studentProfileId: profile.id });
      return { partner, profile, enrollment };
    };
    return outerTx ? run(outerTx) : this.prisma.client.$transaction(run);
  }

  /** Enroll an existing student profile into a class/section/stream for a term. One active enrollment per student+term. */
  async enrollExistingStudent(dto: EnrollStudentDto): Promise<Enrollment> {
    return this.prisma.client.$transaction(async (tx: any) => {
      const organizationId = this.tenant.organizationId;

      // Concurrency: no overlapping active enrollment for the same student + term.
      const existing = await tx.enrollment.findFirst({
        where: { organizationId, studentProfileId: dto.studentProfileId, termId: dto.termId, status: 'enrolled' },
      });
      if (existing) {
        throw new BadRequestException(
          `Student ${dto.studentProfileId} already has an active enrollment for term ${dto.termId}.`,
        );
      }

      const enrollment = await tx.enrollment.create({
        data: {
          organizationId,
          studentProfileId: dto.studentProfileId,
          classId: dto.classId,
          sectionId: dto.sectionId ?? null,
          streamId: dto.streamId ?? null,
          termId: dto.termId,
          rollNumber: dto.rollNumber,
          applicationId: dto.applicationId ?? null,
          effectiveDate: dto.effectiveDate ? new Date(dto.effectiveDate) : new Date(),
          status: 'enrolled',
        },
      });

      await tx.enrollmentHistory.create({
        data: {
          organizationId,
          enrollmentId: enrollment.id,
          toStatus: 'enrolled',
          reason: 'Initial enrollment',
          changedById: this.tenant.userId ?? null,
        },
      });

      // Keep the student profile's current placement in sync.
      await tx.studentProfile.updateMany({
        where: { id: dto.studentProfileId },
        data: {
          status: 'active',
          currentClassId: dto.classId,
          currentSectionId: dto.sectionId ?? null,
          currentStreamId: dto.streamId ?? null,
        },
      });

      await this.audit.recordInTx(tx, {
        entity: 'Enrollment', entityId: enrollment.id, action: 'create',
        newValues: { status: 'enrolled', studentProfileId: dto.studentProfileId, termId: dto.termId },
      });
      this.events.publish(EVENTS.SchoolEnrollmentCreated, { organizationId, enrollmentId: enrollment.id, studentProfileId: dto.studentProfileId });
      return enrollment;
    });
  }

  /** @deprecated compatibility wrapper — delegates to enrollExistingStudent. Migrate callers. */
  async enroll(dto: EnrollStudentDto): Promise<Enrollment> {
    return this.enrollExistingStudent(dto);
  }

  /** End an enrollment with a reason (transfer / withdraw). Appends an immutable history row. */
  private async endEnrollment(id: string, toStatus: 'transferred_out' | 'withdrawn', dto: EndEnrollmentDto) {
    return this.prisma.client.$transaction(async (tx: any) => {
      const organizationId = this.tenant.organizationId;
      const enrollment = await tx.enrollment.findFirst({ where: { id, organizationId } });
      if (!enrollment) throw new NotFoundException(`Enrollment ${id} not found`);
      if (!ENROLLMENT_TRANSITIONS[enrollment.status]?.includes(toStatus)) {
        throw new BadRequestException(
          `Cannot move enrollment from '${enrollment.status}' to '${toStatus}'. Allowed: [${ENROLLMENT_TRANSITIONS[enrollment.status]?.join(', ') || 'none'}].`,
        );
      }

      await tx.enrollment.updateMany({
        where: { id },
        data: { status: toStatus, endedAt: dto.endedAt ? new Date(dto.endedAt) : new Date(), endReason: dto.reason },
      });
      await tx.enrollmentHistory.create({
        data: { organizationId, enrollmentId: id, fromStatus: enrollment.status, toStatus, reason: dto.reason, changedById: this.tenant.userId ?? null },
      });
      await tx.studentProfile.updateMany({
        where: { id: enrollment.studentProfileId },
        data: { status: toStatus === 'withdrawn' ? 'withdrawn' : 'transferred' },
      });

      await this.releaseAdmissionSeat(tx, organizationId, enrollment);

      await this.audit.recordInTx(tx, { entity: 'Enrollment', entityId: id, action: 'update', oldValues: { status: enrollment.status }, newValues: { status: toStatus } });
      this.events.publish(EVENTS.SchoolEnrollmentEnded, { organizationId, enrollmentId: id, toStatus, reason: dto.reason });
      return tx.enrollment.findFirst({ where: { id } });
    });
  }

  /**
   * Give the admission seat back when an enrollment ends.
   *
   * `AdmissionCapacity.claimedSeats` is the seat ledger: enrol claims one, ending the
   * enrollment must return it, or a class silently shrinks by one seat every time a
   * student leaves and eventually refuses admissions it has room for.
   *
   * This lives here, not in the admissions FSM, because ending an enrollment is the
   * only path that actually happens: `enrolled` is a TERMINAL admission status, so the
   * release that used to hang off `applyReview('withdraw')` could never fire.
   *
   * Best-effort and idempotent-ish: no capacity row configured means the class is
   * unconstrained, and the `claimedSeats > 0` guard stops it going negative. Keyed with
   * the same `'__none__'` sentinel `resolveCapacity` uses for an absent section/stream,
   * so the seat returns to exactly the row it was taken from.
   */
  private async releaseAdmissionSeat(tx: any, organizationId: string, enrollment: any) {
    const key = await this.admissionCapacityFor(tx, organizationId, enrollment);
    if (!key) return;
    await tx.admissionCapacity.updateMany({
      where: { ...key, claimedSeats: { gt: 0 } },
      data: { claimedSeats: { decrement: 1 } },
    });
  }

  /** Resolve the capacity row an enrollment's seat belongs to, or null if unconstrained. */
  private async admissionCapacityFor(tx: any, organizationId: string, enrollment: any) {
    if (!enrollment.applicationId) return null;
    const application = await tx.admissionApplication.findFirst({
      where: { id: enrollment.applicationId },
      select: { admissionCycleId: true },
    });
    if (!application?.admissionCycleId) return null;
    const SENT = '__none__';
    return {
      organizationId,
      admissionCycleId: application.admissionCycleId,
      classId: enrollment.classId,
      sectionId: enrollment.sectionId ?? SENT,
      streamId: enrollment.streamId ?? SENT,
    };
  }

  /** Take the seat back when a student returns. Refuses to exceed capacity. */
  private async reclaimAdmissionSeat(tx: any, organizationId: string, enrollment: any) {
    const key = await this.admissionCapacityFor(tx, organizationId, enrollment);
    if (!key) return;
    const row = await tx.admissionCapacity.findFirst({ where: key });
    if (!row) return;
    const claimed = await tx.admissionCapacity.updateMany({
      where: { id: row.id, claimedSeats: { lt: row.capacity - row.reservedCapacity } },
      data: { claimedSeats: { increment: 1 } },
    });
    if (claimed.count === 0) {
      throw new BadRequestException(
        `No seat available to re-enroll into this class (capacity ${row.capacity}, reserved ${row.reservedCapacity}, claimed ${row.claimedSeats}).`,
      );
    }
  }

  transferOut(id: string, dto: EndEnrollmentDto) { return this.endEnrollment(id, 'transferred_out', dto); }
  withdraw(id: string, dto: EndEnrollmentDto) { return this.endEnrollment(id, 'withdrawn', dto); }

  /** Re-enroll a previously ended enrollment: reopen as a new active enrollment. */
  async reEnroll(id: string, dto: EndEnrollmentDto) {
    return this.prisma.client.$transaction(async (tx: any) => {
      const organizationId = this.tenant.organizationId;
      const enrollment = await tx.enrollment.findFirst({ where: { id, organizationId } });
      if (!enrollment) throw new NotFoundException(`Enrollment ${id} not found`);
      if (enrollment.status === 'enrolled') {
        throw new BadRequestException(`Enrollment ${id} is already active.`);
      }
      await tx.enrollment.updateMany({ where: { id }, data: { status: 'enrolled', endedAt: null, endReason: null } });
      await tx.enrollmentHistory.create({
        data: { organizationId, enrollmentId: id, fromStatus: enrollment.status, toStatus: 'enrolled', reason: dto.reason ?? 'Re-enrolled', changedById: this.tenant.userId ?? null },
      });
      await tx.studentProfile.updateMany({
        where: { id: enrollment.studentProfileId },
        data: { status: 'active', currentClassId: enrollment.classId, currentSectionId: enrollment.sectionId, currentStreamId: enrollment.streamId },
      });

      // Re-opening an enrollment occupies a seat again, so re-claim it. Conditional on
      // there being room, exactly like the original claim in enroll(): a class that
      // filled up while the student was away must not be pushed over capacity.
      await this.reclaimAdmissionSeat(tx, organizationId, enrollment);

      await this.audit.recordInTx(tx, { entity: 'Enrollment', entityId: id, action: 'update', oldValues: { status: enrollment.status }, newValues: { status: 'enrolled' } });
      this.events.publish(EVENTS.SchoolEnrollmentReEnrolled, { organizationId, enrollmentId: id });
      return tx.enrollment.findFirst({ where: { id } });
    });
  }

  async history(enrollmentId: string) {
    return this.prisma.client.enrollmentHistory.findMany({
      where: { enrollmentId },
      orderBy: { changedAt: 'asc' },
    });
  }

  /** Org-scoped list of enrollments (paginated via simple take/skip). */
  async list(organizationId: string, opts: { studentProfileId?: string; termId?: string; status?: string } = {}) {
    return this.prisma.client.enrollment.findMany({
      where: {
        organizationId,
        ...(opts.studentProfileId ? { studentProfileId: opts.studentProfileId } : {}),
        ...(opts.termId ? { termId: opts.termId } : {}),
        ...(opts.status ? { status: opts.status } : {}),
      },
      orderBy: { enrolledAt: 'desc' },
      include: { student: true, schoolClass: true, section: true, stream: true, term: true },
    });
  }
}
