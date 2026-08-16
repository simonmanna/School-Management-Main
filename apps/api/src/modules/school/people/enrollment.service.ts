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
import { EVENTS } from '@erp/shared';

/** Enrollment lifecycle FSM: enroll → (transferred_out | withdrawn | completed). */
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

@Injectable()
export class EnrollmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly audit: AuditService,
    private readonly events: EventBus,
  ) {}

  /** Enroll a student into a class/section/stream for a term. One active enrollment per student+term. */
  async enroll(dto: EnrollStudentDto): Promise<Enrollment> {
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

      await this.audit.recordInTx(tx, { entity: 'Enrollment', entityId: id, action: 'update', oldValues: { status: enrollment.status }, newValues: { status: toStatus } });
      this.events.publish(EVENTS.SchoolEnrollmentEnded, { organizationId, enrollmentId: id, toStatus, reason: dto.reason });
      return tx.enrollment.findFirst({ where: { id } });
    });
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
