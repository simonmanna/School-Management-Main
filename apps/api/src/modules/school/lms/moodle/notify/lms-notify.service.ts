import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../../../kernel/tenancy/tenant-context.service';
import { NotificationsService } from '../../../../../kernel/notifications/notifications.service';

/**
 * LMS notifications (L5.1).
 *
 * The LMS previously emitted none at all — a pupil learned an assignment was due
 * only by opening the course. Everything here is derived from state that already
 * exists (`CourseModule.dueAt`, `CourseModuleCompletion`, `StudentAssessment`), so
 * no new truth is introduced.
 *
 * Two rules shape the whole file:
 *
 *  1. **Never nag about work already done.** A reminder that fires after a pupil
 *     has submitted teaches them to ignore reminders.
 *  2. **Never reveal an unreleased mark.** A "your work was graded" notice may say
 *     that marking happened; it may not carry the score unless moderation has
 *     approved it, or the notification becomes a side channel around the gate the
 *     gradebook enforces.
 */
@Injectable()
export class LmsNotifyService {
  private readonly logger = new Logger('LmsNotify');

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly notifications: NotificationsService,
  ) {}

  private get org() {
    return this.tenant.organizationId;
  }

  /**
   * Remind pupils about work due in the next 24 hours.
   *
   * Idempotent per (module, student, day): the `LmsEvent` log doubles as the
   * "already told them" record, so a restart or a second scheduler instance does
   * not double-send.
   */
  async remindDueSoon(organizationId: string, withinHours = 24): Promise<{ sent: number }> {
    const now = new Date();
    const horizon = new Date(now.getTime() + withinHours * 3600_000);

    const due = await this.prisma.raw.courseModule.findMany({
      where: {
        organizationId, deletedAt: null, visible: true,
        dueAt: { gt: now, lte: horizon },
      },
      select: { id: true, courseOfferingId: true, dueAt: true, activityType: true, assessmentId: true },
    });
    if (due.length === 0) return { sent: 0 };

    let sent = 0;
    for (const cm of due) {
      const enrolments = await this.prisma.raw.courseEnrolment.findMany({
        where: { organizationId, courseOfferingId: cm.courseOfferingId, status: 'active' },
        select: { studentProfileId: true },
      });
      const studentIds = enrolments.map((e) => e.studentProfileId).filter((x): x is string => Boolean(x));
      if (studentIds.length === 0) continue;

      // Rule 1: drop anyone who has already finished it.
      const done = await this.prisma.raw.courseModuleCompletion.findMany({
        where: { organizationId, courseModuleId: cm.id, studentProfileId: { in: studentIds }, state: { not: 'incomplete' } },
        select: { studentProfileId: true },
      });
      const submitted = await this.prisma.raw.modAssignSubmission.findMany({
        where: { organizationId, courseModuleId: cm.id, studentProfileId: { in: studentIds }, status: { in: ['submitted', 'graded'] } },
        select: { studentProfileId: true },
      });
      const finished = new Set([
        ...done.map((d) => d.studentProfileId),
        ...submitted.map((x) => x.studentProfileId),
      ]);

      // Already-notified, from the log.
      const dayKey = cm.dueAt!.toISOString().slice(0, 10);
      const alreadyTold = await this.prisma.raw.lmsEvent.findMany({
        where: {
          organizationId, courseModuleId: cm.id, eventName: 'core_reminder.due_soon',
          createdAt: { gte: new Date(now.getTime() - withinHours * 3600_000) },
        },
        select: { studentProfileId: true },
      });
      const told = new Set(alreadyTold.map((t) => t.studentProfileId));

      const targets = studentIds.filter((id) => !finished.has(id) && !told.has(id));
      for (const studentProfileId of targets) {
        const userId = await this.portalUserFor(organizationId, studentProfileId);
        if (!userId) continue; // no portal account yet — nothing to notify
        await this.notifications
          .send({
            organizationId,
            userId,
            channel: 'in_app',
            category: 'lms_due_soon',
            title: 'Work due soon',
            body: `An activity is due on ${cm.dueAt!.toLocaleString()}.`,
            payload: { courseModuleId: cm.id, courseOfferingId: cm.courseOfferingId, dueAt: cm.dueAt },
          })
          .catch(() => undefined);
        await this.prisma.raw.lmsEvent.create({
          data: {
            organizationId, eventName: 'core_reminder.due_soon', component: 'core_reminder',
            action: 'created', target: 'course_module', courseModuleId: cm.id,
            courseOfferingId: cm.courseOfferingId, studentProfileId,
            other: { dayKey } as any,
          },
        }).catch(() => undefined);
        sent += 1;
      }
    }
    return { sent };
  }

  /**
   * Tell a pupil their work has been marked.
   *
   * Rule 2: the score travels only when `approvalStatus === 'approved'`. Otherwise
   * the message says marking has happened and nothing more.
   */
  async notifyGraded(studentProfileId: string, courseModuleId: string): Promise<void> {
    const cm = await this.prisma.client.courseModule.findFirst({
      where: { id: courseModuleId, organizationId: this.org },
      select: { assessmentId: true, courseOfferingId: true },
    });
    if (!cm?.assessmentId) return;
    const [assessment, mark] = await Promise.all([
      this.prisma.client.assessment.findFirst({
        where: { id: cm.assessmentId }, select: { title: true, maxScore: true, hiddenFromStudents: true, marksReleaseAt: true },
      }),
      this.prisma.client.studentAssessment.findFirst({
        where: { assessmentId: cm.assessmentId, studentProfileId },
        select: { effectiveScore: true, approvalStatus: true },
      }),
    ]);
    if (!assessment || assessment.hiddenFromStudents) return;

    const userId = await this.portalUserFor(this.org, studentProfileId);
    if (!userId) return;

    const released = mark?.approvalStatus === 'approved' && !!assessment.marksReleaseAt && assessment.marksReleaseAt <= new Date();
    await this.notifications
      .send({
        organizationId: this.org,
        userId,
        channel: 'in_app',
        category: 'lms_graded',
        title: released ? 'Your work has been marked' : 'Your work has been reviewed',
        body: released && mark?.effectiveScore != null
          ? `${assessment.title}: ${Number(mark.effectiveScore)} out of ${Number(assessment.maxScore)}.`
          // No score here on purpose — moderation has not released it yet.
          : `${assessment.title} has been marked. Your result will appear once it is released.`,
        payload: { courseModuleId, courseOfferingId: cm.courseOfferingId },
      })
      .catch(() => undefined);
  }

  /** Tell participants about a new forum post, excluding its author. */
  async notifyForumReply(courseOfferingId: string, discussionTitle: string, excludeStudentProfileId?: string): Promise<void> {
    const enrolments = await this.prisma.client.courseEnrolment.findMany({
      where: { organizationId: this.org, courseOfferingId, status: 'active' },
      select: { studentProfileId: true },
    });
    for (const e of enrolments) {
      if (!e.studentProfileId || e.studentProfileId === excludeStudentProfileId) continue;
      const userId = await this.portalUserFor(this.org, e.studentProfileId);
      if (!userId) continue;
      await this.notifications
        .send({
          organizationId: this.org, userId, channel: 'in_app', category: 'lms_forum',
          title: 'New forum post', body: `Someone posted in "${discussionTitle}".`,
          payload: { courseOfferingId },
        })
        .catch(() => undefined);
    }
  }

  /** Nightly sweep across tenants. */
  @Cron(CronExpression.EVERY_DAY_AT_7AM, { name: 'lms-due-reminders' })
  async dailyReminders(): Promise<void> {
    try {
      const orgs: Array<{ organizationId: string }> = await this.prisma.raw.courseModule.findMany({
        where: { deletedAt: null, dueAt: { not: null } },
        select: { organizationId: true },
        distinct: ['organizationId'],
      });
      let total = 0;
      for (const { organizationId } of orgs) {
        const { sent } = await this.tenant.run({ organizationId }, () => this.remindDueSoon(organizationId));
        total += sent;
      }
      if (total > 0) this.logger.log(`Sent ${total} due-soon reminder(s)`);
    } catch (err) {
      // A reminder sweep must never take the API down.
      this.logger.error(`Due reminders failed: ${String(err)}`);
    }
  }

  /**
   * The login account that speaks for a pupil, if one exists.
   *
   * A school that has not yet invited its pupils has no accounts to notify, which
   * is a normal state rather than an error — the send is simply skipped.
   */
  private async portalUserFor(organizationId: string, studentProfileId: string): Promise<string | null> {
    const identity = await this.prisma.raw.portalIdentity.findFirst({
      where: { organizationId, studentProfileId, subjectType: 'student', revokedAt: null },
      select: { userId: true },
    });
    return identity?.userId ?? null;
  }
}
