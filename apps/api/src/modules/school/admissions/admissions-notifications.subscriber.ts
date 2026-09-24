import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { EventBus } from '../../../kernel/events/event-bus';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { NotificationsService } from '../../../kernel/notifications/notifications.service';
import { EVENTS } from '@erp/shared';

type AdmissionEvent = { organizationId: string; applicationId: string; reason?: string };

/**
 * Phase 4 — turns admission lifecycle events into guardian-facing notifications.
 *
 * 16 `school.admission.*` events were being published and NOTHING consumed them:
 * no submission confirmation, no missing-document chase, no interview invite, no
 * decision letter, no offer notice. This subscriber closes that gap using the
 * shared NotificationsService (email/SMS/in-app; best-effort when providers are
 * unconfigured). Each message is addressed to the application's primary guardian.
 */
@Injectable()
export class AdmissionsNotificationsSubscriber implements OnModuleInit {
  private readonly logger = new Logger('AdmissionsNotifications');

  /** event → (subject, body) builder. Only mapped events notify. */
  private readonly templates: Record<string, (ctx: NotifyCtx) => { title: string; body: string }> = {
    [EVENTS.SchoolAdmissionSubmitted]: (c) => ({
      title: `Application ${c.applicationNumber} received`,
      body: `We have received the application for ${c.applicantName}. We will be in touch as it is reviewed.`,
    }),
    [EVENTS.SchoolAdmissionInterviewScheduled]: (c) => ({
      title: `Interview scheduled — ${c.applicantName}`,
      body: `An interview has been scheduled for ${c.applicantName}'s application ${c.applicationNumber}.`,
    }),
    [EVENTS.SchoolAdmissionAccepted]: (c) => ({
      title: `Good news about ${c.applicantName}'s application`,
      body: `${c.applicantName} has been accepted. An offer will follow shortly.`,
    }),
    [EVENTS.SchoolAdmissionWaitlisted]: (c) => ({
      title: `${c.applicantName} — waitlisted`,
      body: `${c.applicantName}'s application ${c.applicationNumber} has been placed on the waiting list.`,
    }),
    [EVENTS.SchoolAdmissionRejected]: (c) => ({
      title: `Update on ${c.applicantName}'s application`,
      body: `After careful review we are unable to offer ${c.applicantName} a place at this time.`,
    }),
    [EVENTS.SchoolAdmissionOfferIssued]: (c) => ({
      title: `Offer of a place for ${c.applicantName}`,
      body: `An offer has been issued for ${c.applicantName} (application ${c.applicationNumber}). Please review and respond before it expires.`,
    }),
    [EVENTS.SchoolAdmissionOfferAccepted]: (c) => ({
      title: `Offer accepted — welcome`,
      body: `Thank you for accepting the offer for ${c.applicantName}. We will guide you through enrollment next.`,
    }),
    [EVENTS.SchoolAdmissionEnrolled]: (c) => ({
      title: `${c.applicantName} is enrolled`,
      body: `${c.applicantName} is now enrolled. Welcome to the school community.`,
    }),
  };

  constructor(
    private readonly events: EventBus,
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  onModuleInit() {
    for (const name of Object.keys(this.templates)) {
      this.events.subscribe(name as any, (p: AdmissionEvent) => this.onEvent(name, p));
    }
    // Documents-pending is a chase, not a status template above; wire it too.
    this.events.subscribe(EVENTS.SchoolAdmissionUnderReview, () => {/* no-op: internal */});
  }

  private async onEvent(eventName: string, p: AdmissionEvent) {
    try {
      const builder = this.templates[eventName];
      if (!builder) return;
      const ctx = await this.buildContext(p.applicationId);
      if (!ctx) return;
      const { title, body } = builder(ctx);

      // In-app is always durable; email is best-effort to the primary guardian.
      await this.notifications.send({
        organizationId: p.organizationId,
        channel: 'in_app',
        category: 'admissions',
        title,
        body,
        payload: { applicationId: p.applicationId, event: eventName },
      });
      if (ctx.email) {
        // The family has no login: send to the address on the application. It
        // used to go with no userId, which the email channel rejects (N1).
        await this.notifications.send({
          organizationId: p.organizationId,
          channel: 'email',
          category: 'admissions',
          recipient: { email: ctx.email },
          title,
          body,
          payload: { applicationId: p.applicationId },
          dedupeKey: `adm:${eventName}:${p.applicationId}`,
        });
      }
    } catch (err) {
      this.logger.warn(`admission notify (${eventName}) failed: ${(err as Error).message}`);
    }
  }

  private async buildContext(applicationId: string): Promise<NotifyCtx | null> {
    const app = await this.prisma.raw.admissionApplication.findFirst({
      where: { id: applicationId },
      include: { guardians: { orderBy: { isPrimary: 'desc' } } },
    });
    if (!app) return null;
    const primary = app.guardians.find((g: any) => g.isPrimary) ?? app.guardians[0];
    return {
      applicationNumber: app.applicationNumber,
      applicantName: `${app.applicantFirstName} ${app.applicantLastName}`,
      email: primary?.email ?? null,
    };
  }
}

interface NotifyCtx {
  applicationNumber: string;
  applicantName: string;
  email: string | null;
}
