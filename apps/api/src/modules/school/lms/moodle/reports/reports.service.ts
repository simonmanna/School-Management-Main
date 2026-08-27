import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../../../kernel/tenancy/tenant-context.service';
import { ViewEnvelopeService } from '../course/view-envelope.service';

/** Reports (ADR-014 §3.8) — everything reads the LmsEvent standard log; no extra tables. */
@Injectable()
export class LmsReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly envelope: ViewEnvelopeService,
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
    // Names, so the report is readable. Grouping keys are ids; the report is for
    // a human deciding which activity nobody has opened.
    const modules = await this.prisma.client.courseModule.findMany({
      where: { organizationId: this.org, courseOfferingId, deletedAt: null },
    });
    const views = await this.envelope.moduleViews(modules, { showGrades: false });
    const byId = new Map(views.map((v) => [v.id, v]));
    const rows = new Map<string, { courseModuleId: string; name: string; activityType: string; icon: string; counts: Record<string, number>; total: number }>();
    for (const g of grouped) {
      const id = g.courseModuleId!;
      const v = byId.get(id);
      const row = rows.get(id) ?? {
        courseModuleId: id,
        name: v?.name ?? 'Removed activity',
        activityType: v?.activityType ?? 'unknown',
        icon: v?.icon ?? 'File',
        counts: {}, total: 0,
      };
      row.counts[g.action] = g._count._all;
      row.total += g._count._all;
      rows.set(id, row);
    }
    return Array.from(rows.values()).sort((a, b) => b.total - a.total);
  }

  /**
   * Engagement per pupil: events, distinct activities touched, last seen.
   *
   * The question a head of year actually asks is "who has stopped working?", which
   * needs a last-access column, not a raw event dump.
   */
  async engagement(courseOfferingId: string) {
    const enrolled = await this.prisma.client.courseEnrolment.findMany({
      where: { organizationId: this.org, courseOfferingId, status: 'active', studentProfileId: { not: null } },
      select: { studentProfileId: true },
    });
    const ids = enrolled.map((e) => e.studentProfileId!).filter(Boolean);
    if (ids.length === 0) return [];

    const [grouped, names] = await Promise.all([
      this.prisma.client.lmsEvent.groupBy({
        by: ['studentProfileId'],
        where: { organizationId: this.org, courseOfferingId, studentProfileId: { in: ids } },
        _count: { _all: true },
        _max: { createdAt: true },
      }),
      this.envelope.studentNames(ids),
    ]);
    const byStudent = new Map(grouped.map((g) => [g.studentProfileId!, g]));

    return ids
      .map((id) => {
        const g = byStudent.get(id);
        return {
          studentProfileId: id,
          studentName: names.get(id)?.name ?? 'Unknown student',
          admissionNo: names.get(id)?.admissionNo ?? null,
          events: g?._count._all ?? 0,
          // Null means never opened the course at all — the row that matters most.
          lastSeen: g?._max.createdAt?.toISOString() ?? null,
        };
      })
      .sort((a, b) => (a.lastSeen ?? '').localeCompare(b.lastSeen ?? ''));
  }

  /** Who did what — views/posts per student. */
  async participation(courseOfferingId: string, opts: { action?: string } = {}) {
    return this.prisma.client.lmsEvent.groupBy({
      by: ['studentProfileId', 'action'],
      where: { organizationId: this.org, courseOfferingId, studentProfileId: { not: null }, ...(opts.action ? { action: opts.action } : {}) },
      _count: { _all: true },
    });
  }

  /** Students who have NOT viewed a given module, by name. */
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
    const missing = enrolled
      .filter((e) => !seen.has(e.studentProfileId))
      .map((e) => e.studentProfileId!)
      .filter(Boolean);
    const names = await this.envelope.studentNames(missing);
    return missing.map((id) => ({
      studentProfileId: id,
      studentName: names.get(id)?.name ?? 'Unknown student',
      admissionNo: names.get(id)?.admissionNo ?? null,
    }));
  }

  /** Course outline: last activity timestamp per module. */
  async outline(courseOfferingId: string) {
    const full = await this.prisma.client.courseModule.findMany({
      where: { organizationId: this.org, courseOfferingId, deletedAt: null },
    });
    const named = await this.envelope.moduleViews(full, { showGrades: false });
    const modules = named.map((v) => ({ id: v.id, activityType: v.activityType, name: v.name, sectionId: v.sectionId }));
    const events = await this.prisma.client.lmsEvent.groupBy({
      by: ['courseModuleId'],
      where: { organizationId: this.org, courseOfferingId, courseModuleId: { in: modules.map((m) => m.id) } },
      _count: { _all: true },
      _max: { createdAt: true },
    });
    return modules.map((m) => ({ ...m, activity: events.find((e) => e.courseModuleId === m.id) ?? null }));
  }
}
