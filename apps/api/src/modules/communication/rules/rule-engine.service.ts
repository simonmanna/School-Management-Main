import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { EVENT_SUBJECT, type DomainEventName } from '@erp/shared';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { NotificationsService } from '../../../kernel/notifications/notifications.service';
import { ConversationService } from '../conversation.service';
import { MessageService } from '../message.service';
import { TemplateRenderService } from './template-render.service';
import { RecipientResolverService } from './recipient-resolver.service';
import { matchesCondition, type Condition } from './condition';

/**
 * The event-driven messaging engine. Generalises the single hardcoded
 * approvals→notification subscriber into config: an event fires, matching
 * `CommunicationRule` rows select a template + recipients + channel, and the
 * result is either an in-app notification (system alert) or a durable message
 * (human-visible, deliverable over any provider).
 *
 * Idempotency: domain events are at-least-once, so before acting on a
 * (rule, event-instance) the engine claims a `CommunicationDispatch` row on a
 * unique `dedupeKey`. A duplicate event finds the row already there and skips —
 * a dedicated indexed dedupe, not a JSON-path scan.
 *
 * Every method assumes the caller has established the tenant scope
 * (`tenant.run({ organizationId })`) — see CommunicationSubscriber.
 */
@Injectable()
export class RuleEngineService {
  private readonly logger = new Logger('RuleEngine');

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly conversations: ConversationService,
    private readonly messages: MessageService,
    private readonly templates: TemplateRenderService,
    private readonly recipients: RecipientResolverService,
  ) {}

  async dispatch(eventName: DomainEventName, payload: Record<string, unknown>): Promise<void> {
    const organizationId = typeof payload.organizationId === 'string' ? payload.organizationId : '';
    if (!organizationId) return;

    const rules = await this.prisma.raw.communicationRule.findMany({
      where: { organizationId, eventName, enabled: true },
    });
    if (rules.length === 0) return;

    const entityId = this.entityId(eventName, payload);

    for (const rule of rules) {
      try {
        if (!matchesCondition((rule.condition ?? {}) as Condition, payload)) continue;

        // Claim the dedupe key. A unique violation ⇒ another delivery of the same
        // event already handled this rule; skip silently.
        const dedupeKey = `${rule.id}:${eventName}:${entityId}`;
        const claimed = await this.claim(organizationId, rule.id, dedupeKey);
        if (!claimed) continue;

        const template = await this.prisma.raw.messageTemplate.findFirst({
          where: { organizationId, key: rule.templateKey, active: true },
          orderBy: { version: 'desc' },
        });
        if (!template) {
          this.logger.warn(`rule ${rule.id}: template '${rule.templateKey}' not found/active`);
          continue;
        }
        const body = this.templates.render(template.body, payload);
        const subject = template.subject ? this.templates.render(template.subject, payload) : undefined;

        const recipients = await this.recipients.resolve(organizationId, rule.recipientResolver, payload);
        if (recipients.length === 0) continue;

        if (rule.channelSelector === 'internal') {
          await this.fanNotifications(organizationId, recipients, subject ?? template.key, body, dedupeKey);
        } else {
          await this.fanExternalMessage(organizationId, rule.channelSelector, recipients, body, payload);
        }
      } catch (err) {
        this.logger.warn(`rule ${rule.id} failed: ${String(err)}`);
      }
    }
  }

  /** In-app system alerts — the bell. Reuses the kernel NotificationsService. */
  private async fanNotifications(
    organizationId: string,
    recipients: Array<{ kind: string; userId?: string }>,
    title: string,
    body: string,
    dedupeKey: string,
  ): Promise<void> {
    for (const r of recipients) {
      if (r.kind !== 'user' || !r.userId) continue;
      await this.notifications
        .send({
          organizationId,
          userId: r.userId,
          channel: 'in_app',
          category: 'communication',
          title,
          body,
          payload: { dedupeKey: `${dedupeKey}:${r.userId}`, href: '/communication' },
        })
        .catch((e) => this.logger.warn(`notify ${r.userId} failed: ${String(e)}`));
    }
  }

  /**
   * Human-visible message to a customer over an external transport. Best-effort in
   * Phase 2: it delivers only when the partner has an ExternalIdentity for the
   * provider AND that provider's channel is attached to the partner's
   * conversation. When Phase 3/4 wire inbound identity + channels this lights up
   * automatically; until then it logs and skips rather than creating dead rows.
   */
  private async fanExternalMessage(
    organizationId: string,
    providerId: string,
    recipients: Array<{ kind: string; partnerId?: string }>,
    body: string,
    _payload: Record<string, unknown>,
  ): Promise<void> {
    for (const r of recipients) {
      if (r.kind !== 'partner' || !r.partnerId) continue;
      const identity = await this.prisma.raw.externalIdentity.findFirst({
        where: { organizationId, providerId, partnerId: r.partnerId },
        select: { id: true },
      });
      if (!identity) {
        this.logger.debug(`no ${providerId} identity for partner ${r.partnerId}; skipping external message`);
        continue;
      }
      const conv = await this.conversations.getOrCreateForContext('Partner', r.partnerId);
      await this.messages
        .postSystemMessage({ conversationId: conv.id, body, providerFilter: providerId })
        .catch((e) => this.logger.warn(`external message to partner ${r.partnerId} failed: ${String(e)}`));
    }
  }

  /** Insert the dedupe row; false if it already existed (P2002). */
  private async claim(organizationId: string, ruleId: string, dedupeKey: string): Promise<boolean> {
    try {
      await this.prisma.raw.communicationDispatch.create({ data: { organizationId, ruleId, dedupeKey } });
      return true;
    } catch (err) {
      if (typeof err === 'object' && err && (err as { code?: string }).code === 'P2002') return false;
      throw err;
    }
  }

  /** A stable id for the event-instance: the declared subject id, else a payload hash. */
  private entityId(eventName: DomainEventName, payload: Record<string, unknown>): string {
    const subject = EVENT_SUBJECT[eventName];
    if (subject) {
      const v = payload[subject.idField];
      if (typeof v === 'string' && v) return v;
    }
    return createHash('sha256').update(JSON.stringify(payload)).digest('hex').slice(0, 32);
  }
}
