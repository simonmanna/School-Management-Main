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
    const roster = await this.prisma.client.courseEnrollment.findMany({
      where: { organizationId: this.org, courseOfferingId, status: 'ENROLLED' },
      select: { studentEnrollment: { select: { studentProfileId: true } } },
    });
    let n = 0;
    for (const r of roster) {
      await this.prisma.client.courseEnrolment.upsert({
        where: { courseOfferingId_studentProfileId_userId: { courseOfferingId, studentProfileId: r.studentEnrollment.studentProfileId, userId: null } as any },
        create: { organizationId: this.org, courseOfferingId, methodId: method.id, studentProfileId: r.studentEnrollment.studentProfileId, status: 'active', startedAt: new Date() },
        update: { status: 'active' },
      });
      await this.roles.assignAtCourse({ courseOfferingId, roleShortname: 'student', studentProfileId: r.studentEnrollment.studentProfileId, sourceComponent: 'enrol_roster' });
      n++;
    }
    // Team teachers become editingteacher automatically.
    //
    // `LmsRoleAssignment.userId` must be a platform `User.id` — that is what
    // the capability guard builds its principal from. This previously passed
    // `CourseOfferingTeacher.teacherPartnerId`, which is a `StaffProfile.id`,
    // so every auto-granted teacher role pointed at an id no principal could
    // ever match. Teachers were silently locked out of their own courses and
    // only got in via the coarse-permission fallback in
    // `CapabilityService.fromPermissions()`.
    //
    // Resolve StaffProfile → Partner → HrEmployee → User. A teacher whose login
    // is not linked yet is skipped rather than assigned a broken role; the HR
    // reconciliation screen is where that gets fixed.
    const teachers = await this.prisma.client.courseOfferingTeacher.findMany({ where: { organizationId: this.org, courseOfferingId } });
    for (const t of teachers) {
      const userId = await this.resolveTeacherUserId(t.teacherPartnerId);
      if (!userId) continue;
      await this.roles.assignAtCourse({ courseOfferingId, roleShortname: 'editingteacher', userId, sourceComponent: 'enrol_roster' });
    }
    await this.events.log({ eventName: 'core_enrol.roster_synced', component: 'core_enrol', action: 'updated', target: 'course', courseOfferingId, other: { enrolled: n } });
    return { enrolled: n };
  }

  /**
   * `StaffProfile.id` → the platform `User.id` for that person, via the
   * Partner bridge. Returns null when the staff member has no HR record or no
   * linked login.
   */
  private async resolveTeacherUserId(staffProfileId: string): Promise<string | null> {
    const profile = await this.prisma.client.staffProfile.findFirst({
      where: { id: staffProfileId, organizationId: this.org, deletedAt: null },
      select: { partnerId: true },
    });
    if (!profile?.partnerId) return null;
    const employee = await this.prisma.client.hrEmployee.findFirst({
      where: { organizationId: this.org, partnerId: profile.partnerId, deletedAt: null },
      select: { userId: true },
    });
    return employee?.userId ?? null;
  }
}
