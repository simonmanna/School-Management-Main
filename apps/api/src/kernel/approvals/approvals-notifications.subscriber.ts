import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { EventBus } from '../events/event-bus';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

/**
 * F.5b — Wires approval events to in-app notifications.
 *
 *  - approval.requested / approval.step_advanced → notify every user in the org
 *    who holds any of the CURRENT step's approver permissions.
 *  - approval.decided (resolved) → notify the requester.
 *
 * In-app only. Uses `prisma.raw` (runs in the OutboxWorker, outside a tenant
 * context) and filters by the organizationId carried on each event payload.
 * Delivery is at-least-once, so each notification carries a `dedupeKey` that is
 * checked before creating a duplicate row.
 */
type RequestedPayload = {
  organizationId: string;
  requestId: string;
  entityType: string;
  entityId: string;
  stepOrder: number;
};
type DecidedPayload = {
  organizationId: string;
  requestId: string;
  entityType: string;
  entityId: string;
  status: 'approved' | 'rejected' | 'cancelled';
};

@Injectable()
export class ApprovalsNotificationsSubscriber implements OnModuleInit {
  private readonly logger = new Logger('ApprovalsNotifications');

  constructor(
    private readonly events: EventBus,
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  onModuleInit(): void {
    this.events.subscribe('approval.requested' as any, (p: any) => this.onPending(p));
    this.events.subscribe('approval.step_advanced' as any, (p: any) => this.onPending(p));
    this.events.subscribe('approval.decided' as any, (p: any) => this.onDecided(p));
  }

  /** Notify the approvers eligible for the request's current step. */
  private async onPending(payload: RequestedPayload): Promise<void> {
    try {
      const req = await this.prisma.raw.approvalRequest.findFirst({
        where: { id: payload.requestId, organizationId: payload.organizationId },
        include: { workflow: { include: { steps: true } } },
      });
      if (!req || req.status !== 'pending') return;
      const step = req.workflow?.steps.find((s) => s.stepOrder === req.currentStep);
      const perms = step?.approverPermissions ?? [];
      if (!perms.length) return;

      const approvers = await this.prisma.raw.user.findMany({
        where: {
          organizationId: payload.organizationId,
          roles: { some: { permissions: { hasSome: perms } } },
        },
        select: { id: true },
      });
      for (const u of approvers) {
        // Don't ask the requester to approve their own request.
        if (u.id === req.createdById) continue;
        const dedupeKey = `approval.pending:${req.id}:${req.currentStep}:${u.id}`;
        if (await this.alreadyNotified(payload.organizationId, dedupeKey)) continue;
        await this.notifications.send({
          organizationId: payload.organizationId,
          userId: u.id,
          channel: 'in_app',
          category: 'approval',
          title: `Approval needed: ${humanize(payload.entityType)}`,
          body: `A ${humanize(payload.entityType)} is awaiting your approval (step ${req.currentStep}${step?.name ? ` — ${step.name}` : ''}).`,
          payload: { dedupeKey, requestId: req.id, stepOrder: req.currentStep, href: '/approvals' },
        });
      }
    } catch (err) {
      this.logger.warn(`onPending failed for ${payload.requestId}: ${String(err)}`);
    }
  }

  /** Notify the requester once the request is fully resolved. */
  private async onDecided(payload: DecidedPayload): Promise<void> {
    try {
      const req = await this.prisma.raw.approvalRequest.findFirst({
        where: { id: payload.requestId, organizationId: payload.organizationId },
        select: { createdById: true },
      });
      if (!req?.createdById) return;
      const dedupeKey = `approval.decided:${payload.requestId}:${payload.status}`;
      if (await this.alreadyNotified(payload.organizationId, dedupeKey)) return;
      await this.notifications.send({
        organizationId: payload.organizationId,
        userId: req.createdById,
        channel: 'in_app',
        category: 'approval',
        title: `Approval ${payload.status}: ${humanize(payload.entityType)}`,
        body: `Your ${humanize(payload.entityType)} request was ${payload.status}.`,
        payload: { dedupeKey, requestId: payload.requestId, href: '/approvals' },
      });
    } catch (err) {
      this.logger.warn(`onDecided failed for ${payload.requestId}: ${String(err)}`);
    }
  }

  private async alreadyNotified(organizationId: string, dedupeKey: string): Promise<boolean> {
    const existing = await this.prisma.raw.notification.findFirst({
      where: { organizationId, payload: { path: ['dedupeKey'], equals: dedupeKey } },
      select: { id: true },
    });
    return !!existing;
  }
}

function humanize(entityType: string): string {
  return entityType.replace(/_/g, ' ');
}
