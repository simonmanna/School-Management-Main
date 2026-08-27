import { Injectable, NotFoundException } from '@nestjs/common';
import type { CourseOffering } from '@prisma/client';
import { PrismaService } from '../../../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../../../kernel/tenancy/tenant-context.service';
import { LmsRolesService } from '../context/roles.service';
import { LmsEventService } from '../lms-event.service';
import { ViewEnvelopeService } from '../course/view-envelope.service';

/**
 * Enrolment (ADR-014 §3.3). Separates HOW someone joins (roster sync / manual / self)
 * from WHAT role they hold. The default for every offering is roster_sync from the
 * class register, so a normal subject needs no configuration.
 */
@Injectable()
export class EnrolmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly roles: LmsRolesService,
    private readonly events: LmsEventService,
    private readonly envelope: ViewEnvelopeService,
  ) {}

  private get org() {
    return this.tenant.organizationId;
  }

  private async offering(id: string): Promise<CourseOffering> {
    const o = await this.prisma.client.courseOffering.findFirst({ where: { id, organizationId: this.org } });
    if (!o) throw new NotFoundException(`Course ${id} not found`);
    return o;
  }

  /** Ensure a course has at least the roster_sync method enabled. */
  async ensureDefaultMethods(courseOfferingId: string) {
    await this.prisma.client.courseEnrolmentMethod.upsert({
      where: { courseOfferingId_method: { courseOfferingId, method: 'roster_sync' } },
      create: { organizationId: this.org, courseOfferingId, method: 'roster_sync', enabled: true },
      update: {},
    });
  }

  async listMethods(courseOfferingId: string) {
    await this.ensureDefaultMethods(courseOfferingId);
    return this.prisma.client.courseEnrolmentMethod.findMany({ where: { organizationId: this.org, courseOfferingId }, orderBy: { sortOrder: 'asc' } });
  }

  async listEnrolments(courseOfferingId: string, filter: { status?: 'active' | 'suspended' } = {}) {
    const rows = await this.prisma.client.courseEnrolment.findMany({
      where: { organizationId: this.org, courseOfferingId, ...(filter.status ? { status: filter.status } : {}) },
      orderBy: { createdAt: 'asc' },
    });
    // A participants list of uuid fragments is unusable; resolve the names here
    // so every caller gets them rather than each page re-deriving them.
    const names = await this.envelope.studentNames(
      rows.map((r) => r.studentProfileId).filter((x): x is string => Boolean(x)),
    );
    return rows.map((r) => ({
      ...r,
      studentName: r.studentProfileId ? names.get(r.studentProfileId)?.name ?? null : null,
      admissionNo: r.studentProfileId ? names.get(r.studentProfileId)?.admissionNo ?? null : null,
    }));
  }

  /** Manual single enrolment + role assignment. */
  async enrol(courseOfferingId: string, dto: { studentProfileId?: string; userId?: string; roleShortname?: string }) {
    await this.offering(courseOfferingId);
    const method = await this.prisma.client.courseEnrolmentMethod.upsert({
      where: { courseOfferingId_method: { courseOfferingId, method: 'manual' } },
      create: { organizationId: this.org, courseOfferingId, method: 'manual', enabled: true },
      update: {},
    });
    // Prisma 6 requires every column of a compound-unique constraint to be present
    // and non-null in an upsert `where`; pad a null nullable FK with a sentinel for
    // the lookup key (the real value is still written in `create`).
    const NONE = '__none__';
    const whereKey = {
      courseOfferingId,
      studentProfileId: dto.studentProfileId ?? NONE,
      userId: dto.userId ?? NONE,
    };
    const enrolment = await this.prisma.client.courseEnrolment.upsert({
      where: { courseOfferingId_studentProfileId_userId: whereKey as any },
      create: { organizationId: this.org, courseOfferingId, methodId: method.id, studentProfileId: dto.studentProfileId, userId: dto.userId, status: 'active', startedAt: new Date() },
      update: { status: 'active' },
    });
    await this.roles.assignAtCourse({
      courseOfferingId,
      roleShortname: dto.roleShortname ?? (dto.studentProfileId ? 'student' : 'editingteacher'),
      studentProfileId: dto.studentProfileId,
      userId: dto.userId,
      sourceComponent: 'manual',
    });
    await this.events.log({ eventName: 'core_enrol.user_enrolled', component: 'core_enrol', action: 'created', target: 'enrolment', courseOfferingId, objectId: enrolment.id, studentProfileId: dto.studentProfileId });
    return enrolment;
  }

  async setStatus(enrolmentId: string, status: 'active' | 'suspended') {
    const e = await this.prisma.client.courseEnrolment.findFirst({ where: { id: enrolmentId, organizationId: this.org } });
    if (!e) throw new NotFoundException('Enrolment not found');
    return this.prisma.client.courseEnrolment.update({ where: { id: enrolmentId }, data: { status } });
  }

  /**
   * Sync the class register into the course as `student` enrolments. Idempotent:
   * adds new students, reactivates returning ones. (Removal is left manual to avoid
   * yanking a student mid-term on a transient roster edit.)
   */
  async syncRoster(courseOfferingId: string): Promise<{ enrolled: number }> {
    const offering = await this.offering(courseOfferingId);
    const method = await this.prisma.client.courseEnrolmentMethod.upsert({
      where: { courseOfferingId_method: { courseOfferingId, method: 'roster_sync' } },
      create: { organizationId: this.org, courseOfferingId, method: 'roster_sync', enabled: true },
      update: { enabled: true },
    });
    const roster = await this.prisma.client.enrollment.findMany({
      where: {
        organizationId: this.org,
        classId: offering.classId,
        status: 'enrolled',
        ...(offering.sectionId ? { sectionId: offering.sectionId } : {}),
      },
      select: { studentProfileId: true },
    });
    let n = 0;
    for (const r of roster) {
      await this.prisma.client.courseEnrolment.upsert({
        where: { courseOfferingId_studentProfileId_userId: { courseOfferingId, studentProfileId: r.studentProfileId, userId: null } as any },
        create: { organizationId: this.org, courseOfferingId, methodId: method.id, studentProfileId: r.studentProfileId, status: 'active', startedAt: new Date() },
        update: { status: 'active' },
      });
      await this.roles.assignAtCourse({ courseOfferingId, roleShortname: 'student', studentProfileId: r.studentProfileId, sourceComponent: 'enrol_roster' });
      n++;
    }
    // Team teachers become editingteacher automatically.
    const teachers = await this.prisma.client.courseOfferingTeacher.findMany({ where: { organizationId: this.org, courseOfferingId } });
    for (const t of teachers) {
      await this.roles.assignAtCourse({ courseOfferingId, roleShortname: 'editingteacher', userId: t.teacherPartnerId, sourceComponent: 'enrol_roster' });
    }
    await this.events.log({ eventName: 'core_enrol.roster_synced', component: 'core_enrol', action: 'updated', target: 'course', courseOfferingId, other: { enrolled: n } });
    return { enrolled: n };
  }
}
