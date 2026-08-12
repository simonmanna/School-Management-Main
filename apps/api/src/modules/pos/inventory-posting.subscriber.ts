import { Injectable, OnModuleInit } from '@nestjs/common';
import { EVENTS, type FulfillmentEventPayload, type OrderLifecycleEventPayload } from '@erp/shared';
import { EventBus } from '../../kernel/events/event-bus';
import { PrismaService } from '../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../kernel/tenancy/tenant-context.service';
import { FulfillmentRegistry } from '../../kernel/fulfillment/fulfillment.registry';
import { PosInvoiceService } from './billing/pos-invoice.service';
import type { StockPostingTiming } from './inventory-posting.types';

/**
 * Reacts to business events and enqueues a `StockPostingJob` when the org's
 * configured `inventory.stockPostingTiming` policy says stock should leave.
 * Inventory is a SUBSCRIBER here, not the driver: order completion stays the
 * workflow engine's decision, and stock posting is an independent reaction to
 * the same facts.
 *
 * `at_invoice` is handled directly in `PosInvoiceService.generateInvoice` (kept
 * atomic with the invoice), so this subscriber only owns the other policies. The
 * shared idempotency key means even if both fired, no double post happens.
 *
 * The outbox worker dispatches handlers WITHOUT a tenant scope, so every handler
 * derives `organizationId` from the payload and runs inside `tenant.run`.
 */
@Injectable()
export class InventoryPostingSubscriber implements OnModuleInit {
  constructor(
    private readonly events: EventBus,
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly billing: PosInvoiceService,
    private readonly fulfillment: FulfillmentRegistry,
  ) {}

  onModuleInit(): void {
    this.events.subscribe(EVENTS.OrderConfirmed, (p) => this.onOrderConfirmed(p as OrderLifecycleEventPayload));
    this.events.subscribe(EVENTS.FulfillmentCompleted, (p) => this.onFulfillmentCompleted(p as FulfillmentEventPayload));
    this.events.subscribe(EVENTS.OrderClosed, (p) => this.onOrderClosed(p as OrderLifecycleEventPayload));
  }

  private run<T>(organizationId: string, fn: () => Promise<T>): Promise<T> {
    return this.tenant.run({ organizationId }, fn);
  }

  private async onOrderConfirmed(p: OrderLifecycleEventPayload): Promise<void> {
    await this.run(p.organizationId, async () => {
      if ((await this.billing.stockPostingTiming()) !== 'at_confirmation') return;
      await this.billing.enqueueStockPosting({ orderId: p.orderId, trigger: 'at_confirmation' });
    });
  }

  private async onOrderClosed(p: OrderLifecycleEventPayload): Promise<void> {
    await this.run(p.organizationId, async () => {
      // `at_payment` = deduct when the invoice settles, which closes the order.
      if ((await this.billing.stockPostingTiming()) !== 'at_payment') return;
      await this.billing.enqueueStockPosting({ orderId: p.orderId, trigger: 'at_payment' });
    });
  }

  private async onFulfillmentCompleted(p: FulfillmentEventPayload): Promise<void> {
    await this.run(p.organizationId, async () => {
      if ((await this.billing.stockPostingTiming()) !== 'at_fulfillment_complete') return;
      // Ask the registered strategy whether the order's work under it is done —
      // completion is DERIVED from the concrete documents, no link table. An
      // unregistered strategy is treated as complete (nothing to wait on).
      const strategy = this.fulfillment.get(p.strategy);
      if (strategy && !(await strategy.isComplete(p.orderId, this.prisma.client))) return;
      await this.billing.enqueueStockPosting({ orderId: p.orderId, trigger: 'at_fulfillment_complete' });
    });
  }
}
