import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type { DomainEventName } from '@erp/shared';
import { EventBus } from '../../kernel/events/event-bus';
import { TenantContextService } from '../../kernel/tenancy/tenant-context.service';
import { RuleEngineService } from './rules/rule-engine.service';

/**
 * Bridges domain events to the communication rule engine.
 *
 * We subscribe to a FIXED catalog rather than dynamically per-rule: the EventBus
 * has no unsubscribe, and the outbox dispatches by exact event name (no
 * wildcard), so a dynamic set would leak handlers and a rule created at runtime
 * for an unsubscribed event would silently never fire. A fixed, reviewed catalog
 * makes "which events can drive comms" explicit; `CommunicationRule.eventName`
 * is validated against it on write. Extend the list to add a trigger.
 *
 * Each handler fires in the outbox worker with NO tenant context, so it
 * re-establishes one from the payload's organizationId before touching the DB —
 * the same trap the DMS and approvals subscribers handle.
 */
export const RULE_EVENTABLE: readonly DomainEventName[] = [
  // POS / sales
  'pos.sale.completed',
  'pos.order.created',
  'pos.order.invoiced',
  'pos.order.closed',
  'pos.invoice.settled',
  'pos.invoice.credited',
  // Orders lifecycle
  'order.confirmed',
  'order.completed',
  'order.cancelled',
  'fulfillment.completed',
  // Invoicing / payments
  'invoice.created',
  'invoice.posted',
  'invoice.paid',
  'payment.received',
  // Inventory
  'stock.received',
  'stock.issued',
  'stock.adjusted',
  // Cash
  'cash.session.opened',
  'cash.session.closed',
  // Procurement
  'purchase_order.approved',
  'goods_receipt.posted',
] as const;

@Injectable()
export class CommunicationSubscriber implements OnModuleInit {
  private readonly logger = new Logger('CommunicationSubscriber');

  constructor(
    private readonly events: EventBus,
    private readonly tenant: TenantContextService,
    private readonly ruleEngine: RuleEngineService,
  ) {}

  onModuleInit(): void {
    for (const eventName of RULE_EVENTABLE) {
      this.events.subscribe(eventName, (payload) => this.handle(eventName, payload as Record<string, unknown>));
    }
    this.logger.log(`subscribed to ${RULE_EVENTABLE.length} rule-eventable events`);
  }

  private async handle(eventName: DomainEventName, payload: Record<string, unknown>): Promise<void> {
    const organizationId = typeof payload.organizationId === 'string' ? payload.organizationId : '';
    if (!organizationId) return;
    try {
      await this.tenant.run({ organizationId }, () => this.ruleEngine.dispatch(eventName, payload));
    } catch (err) {
      this.logger.warn(`handling ${eventName} failed: ${String(err)}`);
    }
  }
}
