import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../../../kernel/tenancy/tenant-context.service';
import { PortalIdentityService } from '../../../../../kernel/auth/portal-identity.service';
import { ViewEnvelopeService } from '../course/view-envelope.service';

export interface CalendarEvent {
  id: string;
  kind: 'due' | 'lesson' | 'quiz_close';
  title: string;
  at: string;
  courseOfferingId: string | null;
  courseName: string | null;
  activityType: string | null;
  /** Where clicking it should go. */
  href: string | null;
}

/**
 * The LMS calendar (L5.2).
 *
 * A pure read model. Deadlines live on `CourseModule.dueAt`, timetabled lessons on
 * `ScheduledLesson`; nothing is copied into a calendar table, so a date changed on
 * an activity is immediately correct here. Introducing an events table would create
 * a second truth that drifts the moment a teacher moves a deadline.
 */
@Injectable()
export class LmsCalendarService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly portalIdentity: PortalIdentityService,
    private readonly envelope: ViewEnvelopeService,
  ) {}

  private get org() {
    return this.tenant.organizationId;
  }

  /**
   * Events between two dates, scoped to what the caller may actually see.
   *
   * A pupil (or a guardian's chosen child) sees only their enrolled courses; staff
   * see the courses they teach unless they ask for a specific one.
   */
  async range(opts: { from: Date; to: Date; asStudent?: string; courseOfferingId?: string }): Promise<CalendarEvent[]> {
    const principal = this.portalIdentity.principal();
    let courseIds: string[] | undefined;

    if (principal.kind !== 'staff' || opts.asStudent) {
      const studentProfileId =
        principal.kind === 'student' ? principal.studentProfileId
        : opts.asStudent && (await this.portalIdentity.canAccessStudent(opts.asStudent)) ? opts.asStudent
        : null;
      if (!studentProfileId) return [];
      const enrolments = await this.prisma.client.courseEnrolment.findMany({
        where: { organizationId: this.org, studentProfileId, status: 'active' },
        select: { courseOfferingId: true },
      });
      courseIds = enrolments.map((e) => e.courseOfferingId);
      if (courseIds.length === 0) return [];
    } else if (opts.courseOfferingId) {
      courseIds = [opts.courseOfferingId];
    }

    const modules = await this.prisma.client.courseModule.findMany({
      where: {
        organizationId: this.org, deletedAt: null, visible: true,
        dueAt: { gte: opts.from, lte: opts.to },
        ...(courseIds ? { courseOfferingId: { in: courseIds } } : {}),
      },
      orderBy: { dueAt: 'asc' },
      take: 500,
    });

    const lessons = await this.prisma.client.scheduledLesson.findMany({
      where: {
        organizationId: this.org,
        plannedDate: { gte: opts.from, lte: opts.to },
        ...(courseIds ? { courseOfferingId: { in: courseIds } } : {}),
      },
      orderBy: { plannedDate: 'asc' },
      include: { lessonPlan: { select: { title: true } } },
      take: 500,
    });

    const offeringIds = [...new Set([
      ...modules.map((m) => m.courseOfferingId),
      ...lessons.map((l: any) => l.courseOfferingId).filter(Boolean),
    ])];
    const offerings = offeringIds.length
      ? await this.prisma.client.courseOffering.findMany({ where: { id: { in: offeringIds } } })
      : [];
    const headers = new Map(
      await Promise.all(offerings.map(async (o) => [o.id, await this.envelope.courseHeader(o)] as const)),
    );

    const views = await this.envelope.moduleViews(modules, { showGrades: false });
    const byModule = new Map(modules.map((m) => [m.id, m]));

    const events: CalendarEvent[] = views.map((v) => {
      const cm = byModule.get(v.id)!;
      return {
        id: `due:${v.id}`,
        kind: v.activityType === 'quiz' ? 'quiz_close' : 'due',
        title: v.name,
        at: v.dueAt!,
        courseOfferingId: cm.courseOfferingId,
        courseName: headers.get(cm.courseOfferingId)?.name ?? null,
        activityType: v.activityType,
        href: `/school/lms/modules/${v.id}`,
      };
    });

    for (const l of lessons as any[]) {
      events.push({
        id: `lesson:${l.id}`,
        kind: 'lesson',
        // The lesson's own title lives on its plan; fall back rather than
        // showing a bare id when a slot has no plan attached yet.
        title: l.lessonPlan?.title ?? 'Lesson',
        at: new Date(l.plannedDate).toISOString(),
        courseOfferingId: l.courseOfferingId ?? null,
        courseName: l.courseOfferingId ? headers.get(l.courseOfferingId)?.name ?? null : null,
        activityType: null,
        href: '/school/lms/scheduled-lessons',
      });
    }

    return events.sort((a, b) => a.at.localeCompare(b.at));
  }
}
