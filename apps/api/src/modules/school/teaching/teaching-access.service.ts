import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PERMISSIONS } from '@erp/shared';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { EmployeeIdentityService } from '../../../kernel/auth/employee-identity.service';

/**
 * Who may act on a teaching context.
 *
 * `school:lessonplans:write` is the departmental grant — a head of department
 * holding it works across the offerings they oversee. A classroom teacher holds
 * only `school:lessonplans:own`, which means nothing unless something checks
 * whether they actually teach the offering, so this does. Allocation is read
 * from `CourseOfferingTeacher`: a substitute whose allocation has been
 * end-dated stops being able to write, without anybody editing a role.
 */
@Injectable()
export class TeachingAccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly identity: EmployeeIdentityService,
  ) {}

  private get org() {
    return this.tenant.organizationId;
  }

  private get perms(): string[] {
    return this.tenant.store?.permissions ?? [];
  }

  private get departmental(): boolean {
    return this.perms.includes(PERMISSIONS.school.manageLessonPlans) || this.perms.includes('*');
  }

  /** The offering with the context a teaching screen needs, or 404. */
  async offering(courseOfferingId: string) {
    const offering = await this.prisma.client.courseOffering.findFirst({
      where: { id: courseOfferingId, organizationId: this.org },
      include: {
        term: true,
        academicYear: true,
        subject: true,
        section: true,
        stream: true,
        classCohort: { include: { schoolClass: true } },
        curriculum: { select: { id: true, name: true, version: true, status: true } },
        teachers: { include: { teacher: { include: { partner: true } } } },
      },
    });
    if (!offering) throw new NotFoundException(`Course offering ${courseOfferingId} not found`);
    return offering;
  }

  /** True when the caller holds an open allocation on this offering. */
  async teachesOffering(courseOfferingId: string): Promise<boolean> {
    const mine = await this.identity.staffProfileIdForCaller();
    if (!mine) return false;
    const allocation = await this.prisma.client.courseOfferingTeacher.findFirst({
      where: { courseOfferingId, teacherPartnerId: mine, effectiveTo: null },
      select: { id: true },
    });
    return !!allocation;
  }

  /** Reading someone else's course is a departmental act, not a teacher's. */
  async assertMayView(courseOfferingId: string): Promise<void> {
    if (this.departmental) return;
    if (await this.teachesOffering(courseOfferingId)) return;
    throw new ForbiddenException('You do not teach this course');
  }

  /** Writing plans, schemes, deliveries and follow-ups for this offering. */
  async assertMayTeach(courseOfferingId: string): Promise<void> {
    if (this.departmental) return;
    if (await this.teachesOffering(courseOfferingId)) return;
    throw new ForbiddenException('You may only work on courses you teach');
  }

  /**
   * Offerings the caller teaches. An admin/HOD may look at another teacher's
   * list by id; a classroom teacher always gets their own, whatever they ask
   * for — the id in a query string is a request, not an identity.
   */
  async offeringsForTeacher(teacherPartnerId?: string, termId?: string) {
    const mine = await this.identity.staffProfileIdForCaller();
    const target = this.departmental ? teacherPartnerId ?? mine : mine;
    if (!target) return [];
    return this.prisma.client.courseOffering.findMany({
      where: {
        organizationId: this.org,
        ...(termId ? { termId } : {}),
        status: { notIn: ['ARCHIVED'] },
        teachers: { some: { teacherPartnerId: target, effectiveTo: null } },
      },
      include: {
        term: true,
        subject: true,
        section: true,
        stream: true,
        classCohort: { include: { schoolClass: true } },
        _count: { select: { courseEnrollments: true, lessonPlans: true } },
      },
      orderBy: [{ status: 'asc' }, { name: 'asc' }],
    });
  }
}
