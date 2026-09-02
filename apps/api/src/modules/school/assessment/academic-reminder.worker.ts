import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { NotificationsService } from '../../../kernel/notifications/notifications.service';

/** One rung of the ladder: how far from the deadline, and what it is called. */
interface Rung {
  milestone: string;
  /** Days relative to the deadline. Negative is before, 0 is on the day. */
  offsetDays: number;
}

const ASSESSMENT_RUNGS: Rung[] = [
  { milestone: 't-3', offsetDays: -3 },
  { milestone: 't-0', offsetDays: 0 },
  { milestone: 'overdue', offsetDays: 3 },
];

/**
 * Academic deadline reminders (Phase 6).
 *
 * The failure this exists to prevent is mundane and expensive: a term ends with
 * three teachers' marks unentered, the results office discovers it on
 * publication day, and the report cards go out a week late or short a subject.
 * Nothing in the system was going to say so beforehand — the readiness gate
 * only speaks when someone asks it to compute.
 *
 * Three ladders, all of them about work that is late rather than work that
 * exists:
 *
 *   assessment_due    the class has work due and no marks entered yet
 *   marks_entry_due   marking has closed and marks are still in draft
 *   results_pending   an approved result set is sitting unpublished
 *
 * Properties that matter more than the schedule:
 *
 *  - **One notice per (kind, subject, rung, person), ever.** `AcademicReminderLog`
 *    is the idempotency key, so a restart, an overlapping tick or a second
 *    instance cannot re-send. A teacher who is nagged twice stops reading.
 *  - **Nobody is told about work that is done.** Each rung re-reads the current
 *    state, so a teacher who entered the marks an hour ago is not chased.
 *  - **In-app by default.** SMS costs money in Uganda and the school pays; the
 *    channel is configurable but the default reaches the person who is already
 *    looking at the screen.
 *  - **Off unless switched on.** A pilot school should choose when the system
 *    starts contacting its staff.
 *
 *   ACADEMIC_REMINDERS_ENABLED=true      turn it on
 *   ACADEMIC_REMINDER_INTERVAL_HOURS=12  how often the sweep runs
 *   ACADEMIC_REMINDER_CHANNEL=in_app     in_app | email | sms
 */
@Injectable()
export class AcademicReminderWorker implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(AcademicReminderWorker.name);
  private readonly intervalHours = Number(process.env.ACADEMIC_REMINDER_INTERVAL_HOURS ?? '12');
  private readonly channel = (process.env.ACADEMIC_REMINDER_CHANNEL ?? 'in_app') as 'in_app' | 'email' | 'sms';
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly notifications: NotificationsService,
  ) {}

  onApplicationBootstrap(): void {
    if (process.env.ACADEMIC_REMINDERS_ENABLED !== 'true') {
      this.logger.log('Academic deadline reminders disabled (set ACADEMIC_REMINDERS_ENABLED=true to enable)');
      return;
    }
    const intervalMs = Math.max(1, this.intervalHours) * 60 * 60 * 1000;
    this.timer = setInterval(() => void this.runGuarded(), intervalMs);
    this.timer.unref();
    this.logger.log(`Academic deadline reminders registered: every ${this.intervalHours}h over ${this.channel}`);
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Single-flight: a slow sweep must not overlap the next tick. */
  private async runGuarded(): Promise<void> {
    if (this.running) {
      this.logger.warn('Academic reminder tick skipped — previous sweep still in flight');
      return;
    }
    this.running = true;
    try {
      await this.sweepAllOrganizations();
    } catch (err) {
      this.logger.error(`Academic reminder sweep failed: ${(err as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  async sweepAllOrganizations(): Promise<{ organizations: number; sent: number }> {
    const orgs = await this.prisma.raw.organization.findMany({ select: { id: true, name: true } });
    let sent = 0;
    let swept = 0;
    for (const org of orgs) {
      try {
        // The sweep runs outside any request, so the tenant is established
        // explicitly — otherwise the tenancy extension has nothing to scope by
        // and one school's teacher could be told about another's marking.
        const result = await this.tenant.run({ organizationId: org.id }, () => this.sweepOrganization(org.id));
        sent += result.sent;
        swept += 1;
        if (result.sent > 0) this.logger.log(`${org.name}: ${result.sent} academic reminder(s) sent`);
      } catch (err) {
        this.logger.error(`${org.name}: academic reminders failed — ${(err as Error).message}`);
      }
    }
    return { organizations: swept, sent };
  }

  async sweepOrganization(organizationId: string): Promise<{ sent: number }> {
    let sent = 0;
    sent += await this.remindAssessmentsDue(organizationId);
    sent += await this.remindMarksOutstanding(organizationId);
    sent += await this.remindResultsPending(organizationId);
    return { sent };
  }

  /** Work whose due date is near and whose marksheet is still empty. */
  private async remindAssessmentsDue(organizationId: string): Promise<number> {
    const now = new Date();
    let sent = 0;

    for (const rung of ASSESSMENT_RUNGS) {
      const target = addDays(now, -rung.offsetDays);
      const assessments = await this.prisma.client.assessment.findMany({
        where: {
          deletedAt: null,
          status: { in: ['published', 'open', 'closed'] },
          dueAt: { gte: startOfDay(target), lte: endOfDay(target) },
        },
        select: {
          id: true, title: true, dueAt: true, teacherPartnerId: true,
          courseOffering: { select: { name: true, subject: { select: { name: true } } } },
        },
        take: 500,
      });

      for (const assessment of assessments) {
        if (!assessment.teacherPartnerId) continue;
        const entered = await this.prisma.client.studentAssessment.count({
          where: { assessmentId: assessment.id, deletedAt: null, effectiveScore: { not: null } },
        });
        if (entered > 0 && rung.milestone !== 'overdue') continue;
        const outstanding = await this.prisma.client.studentAssessment.count({
          where: { assessmentId: assessment.id, deletedAt: null, effectiveScore: null, participation: 'present' },
        });
        if (outstanding === 0) continue;

        const userId = await this.userForStaffProfile(assessment.teacherPartnerId);
        if (!userId) continue;

        const subject = assessment.courseOffering?.subject?.name ?? assessment.courseOffering?.name ?? 'your class';
        const posted = await this.sendOnce({
          organizationId,
          kind: 'assessment_due',
          subjectId: assessment.id,
          milestone: rung.milestone,
          userId,
          category: 'academic_deadline',
          title:
            rung.milestone === 'overdue'
              ? `Marks overdue: ${assessment.title}`
              : `Marks due: ${assessment.title}`,
          body:
            rung.milestone === 'overdue'
              ? `${outstanding} learner(s) in ${subject} still have no mark for "${assessment.title}", which was due on ${formatDate(assessment.dueAt)}.`
              : `"${assessment.title}" (${subject}) is due ${rung.milestone === 't-0' ? 'today' : `on ${formatDate(assessment.dueAt)}`}. ${outstanding} learner(s) have no mark yet.`,
          payload: { assessmentId: assessment.id, outstanding },
        });
        if (posted) sent += 1;
      }
    }
    return sent;
  }

  /** Marking that has closed with marks still sitting in draft. */
  private async remindMarksOutstanding(organizationId: string): Promise<number> {
    const now = new Date();
    let sent = 0;

    const assessments = await this.prisma.client.assessment.findMany({
      where: {
        deletedAt: null,
        status: { in: ['closed', 'grading'] },
        closeAt: { not: null, lt: addDays(now, -1) },
      },
      select: { id: true, title: true, closeAt: true, teacherPartnerId: true, courseOffering: { select: { name: true } } },
      take: 500,
    });

    for (const assessment of assessments) {
      if (!assessment.teacherPartnerId) continue;
      const draft = await this.prisma.client.studentAssessment.count({
        where: { assessmentId: assessment.id, deletedAt: null, approvalStatus: 'draft', effectiveScore: { not: null } },
      });
      if (draft === 0) continue;
      const userId = await this.userForStaffProfile(assessment.teacherPartnerId);
      if (!userId) continue;

      const posted = await this.sendOnce({
        organizationId,
        kind: 'marks_entry_due',
        subjectId: assessment.id,
        milestone: 'unsubmitted',
        userId,
        category: 'academic_deadline',
        title: `Marks not submitted: ${assessment.title}`,
        body: `${draft} mark(s) for "${assessment.title}" are entered but never submitted for approval. Marking closed on ${formatDate(assessment.closeAt)}.`,
        payload: { assessmentId: assessment.id, draft },
      });
      if (posted) sent += 1;
    }
    return sent;
  }

  /**
   * Approved result sets nobody has published.
   *
   * Addressed to the organisation rather than a person: whoever holds
   * `results:publish` is a role the worker has no business resolving, and an
   * org-wide in-app notice reaches the results office without guessing.
   */
  private async remindResultsPending(organizationId: string): Promise<number> {
    const stale = await this.prisma.client.resultSet.findMany({
      where: { status: 'approved', deletedAt: null, updatedAt: { lt: addDays(new Date(), -2) } },
      select: { id: true, termId: true, revision: true, studentCount: true },
      take: 50,
    });
    let sent = 0;
    for (const set of stale) {
      const posted = await this.sendOnce({
        organizationId,
        kind: 'results_pending',
        subjectId: set.id,
        milestone: 'approved-unpublished',
        userId: null,
        category: 'academic_deadline',
        title: 'Approved results are waiting to be published',
        body: `A result set covering ${set.studentCount} learner(s) was approved more than two days ago and has not been published. Families cannot see it until it is.`,
        payload: { resultSetId: set.id, revision: set.revision },
      });
      if (posted) sent += 1;
    }
    return sent;
  }

  /**
   * Send, unless this exact notice already went out.
   *
   * The ledger row is written FIRST and its unique index is what makes this
   * safe: two instances racing the same rung both attempt the insert, one
   * fails, and only one notice is sent. Writing it after the send would let
   * both through.
   */
  private async sendOnce(input: {
    organizationId: string;
    kind: string;
    subjectId: string;
    milestone: string;
    userId: string | null;
    category: string;
    title: string;
    body: string;
    payload?: Record<string, unknown>;
  }): Promise<boolean> {
    try {
      await this.prisma.client.academicReminderLog.create({
        data: {
          organizationId: input.organizationId,
          kind: input.kind,
          subjectId: input.subjectId,
          milestone: input.milestone,
          userId: input.userId,
        },
      });
    } catch {
      // Unique violation — this rung has already been sent.
      return false;
    }

    await this.notifications.send({
      organizationId: input.organizationId,
      userId: input.userId,
      channel: this.channel,
      category: input.category,
      title: input.title,
      body: input.body,
      payload: input.payload,
    });
    return true;
  }

  /** StaffProfile → Partner → HrEmployee → User. Null when the teacher has no login. */
  private async userForStaffProfile(staffProfileId: string): Promise<string | null> {
    const profile = await this.prisma.client.staffProfile.findFirst({
      where: { id: staffProfileId, deletedAt: null },
      select: { partnerId: true },
    });
    if (!profile?.partnerId) return null;
    const employee = await this.prisma.client.hrEmployee.findFirst({
      where: { partnerId: profile.partnerId, deletedAt: null },
      select: { userId: true },
    });
    return employee?.userId ?? null;
  }
}

const addDays = (d: Date, days: number): Date => new Date(d.getTime() + days * 86_400_000);
const startOfDay = (d: Date): Date => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0));
const endOfDay = (d: Date): Date => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59, 999));
const formatDate = (d: Date | null): string => (d ? d.toISOString().slice(0, 10) : 'an unrecorded date');
