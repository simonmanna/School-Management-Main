import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../../../kernel/tenancy/tenant-context.service';

/** Reports (ADR-014 §3.8) — everything reads the LmsEvent standard log; no extra tables. */
@Injectable()
export class LmsReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
  ) {}

  private get org() {
    return this.tenant.organizationId;
  }

  async logs(courseOfferingId: string, filter: { from?: string; to?: string; action?: string; userId?: string } = {}) {
    return this.prisma.client.lmsEvent.findMany({
      where: {
        organizationId: this.org, courseOfferingId,
        ...(filter.action ? { action: filter.action } : {}),
        ...(filter.userId ? { userId: filter.userId } : {}),
        ...(filter.from || filter.to ? { createdAt: { ...(filter.from ? { gte: new Date(filter.from) } : {}), ...(filter.to ? { lte: new Date(filter.to) } : {}) } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
  }

  /** Per-activity event counts by action — powers the activity report. */
  async activityReport(courseOfferingId: string) {
    const grouped = await this.prisma.client.lmsEvent.groupBy({
      by: ['courseModuleId', 'action'],
      where: { organizationId: this.org, courseOfferingId, courseModuleId: { not: null } },
      _count: { _all: true },
    });
    return grouped;
  }

  /** Who did what — views/posts per student. */
  async participation(courseOfferingId: string, opts: { action?: string } = {}) {
    return this.prisma.client.lmsEvent.groupBy({
      by: ['studentProfileId', 'action'],
      where: { organizationId: this.org, courseOfferingId, studentProfileId: { not: null }, ...(opts.action ? { action: opts.action } : {}) },
      _count: { _all: true },
    });
  }

  /** Students who have NOT viewed a given module. */
  async notViewed(courseOfferingId: string, courseModuleId: string) {
    const enrolled = await this.prisma.client.courseEnrolment.findMany({
      where: { organizationId: this.org, courseOfferingId, status: 'active', studentProfileId: { not: null } },
      select: { studentProfileId: true },
    });
    const viewers = await this.prisma.client.lmsEvent.findMany({
      where: { organizationId: this.org, courseModuleId, action: 'viewed', studentProfileId: { not: null } },
      select: { studentProfileId: true },
      distinct: ['studentProfileId'],
    });
    const seen = new Set(viewers.map((v) => v.studentProfileId));
    return enrolled.filter((e) => !seen.has(e.studentProfileId)).map((e) => e.studentProfileId);
  }

  /** Course outline: last activity timestamp per module. */
  async outline(courseOfferingId: string) {
    const modules = await this.prisma.client.courseModule.findMany({
      where: { organizationId: this.org, courseOfferingId, deletedAt: null },
      select: { id: true, activityType: true, sectionId: true },
    });
    const events = await this.prisma.client.lmsEvent.groupBy({
      by: ['courseModuleId'],
      where: { organizationId: this.org, courseOfferingId, courseModuleId: { in: modules.map((m) => m.id) } },
      _count: { _all: true },
      _max: { createdAt: true },
    });
    return modules.map((m) => ({ ...m, activity: events.find((e) => e.courseModuleId === m.id) ?? null }));
  }
}
