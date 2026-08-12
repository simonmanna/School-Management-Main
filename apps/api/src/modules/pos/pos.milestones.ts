import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { EVENTS } from '@erp/shared';
import { MilestoneRegistry } from '../../kernel/milestones/milestone.registry';
import type { MilestoneDefinition } from '../../kernel/milestones/milestone.types';

/**
 * Order milestones (Phase B) — a business-friendly projection over the facts the
 * order workflow and the kitchen emit into `DomainEventLog`. The Order state
 * machine stays small and generic; the operational detail lives here as a view,
 * so a new milestone is a registration, not a migration or a new column.
 *
 * Kitchen milestones are POS-specific and modelled as fulfillment facts
 * discriminated by `payload.strategy`, so a future Delivery strategy adds its
 * own "Dispatched"/"Delivered" milestones without touching these.
 */
@Injectable()
export class PosMilestonesInitializer implements OnModuleInit {
  private readonly logger = new Logger('PosMilestones');
  constructor(private readonly registry: MilestoneRegistry) {}

  onModuleInit(): void {
    const isKitchen = (p: Record<string, unknown>) => p.strategy === 'kitchen';

    const defs: MilestoneDefinition[] = [
      { key: 'confirmed', label: 'Order Confirmed', entityType: 'order', fromEvent: EVENTS.OrderConfirmed, sequence: 10 },
      // First-pass timing: `occurrence: 'first'` (the default) is what survives a
      // KDS recall, where the denormalized `KitchenTicket.readyAt` column is nulled.
      { key: 'kitchen_started', label: 'Kitchen Started', entityType: 'order', fromEvent: EVENTS.FulfillmentStarted, match: isKitchen, occurrence: 'first', sequence: 20 },
      { key: 'kitchen_ready', label: 'Kitchen Ready', entityType: 'order', fromEvent: EVENTS.FulfillmentCompleted, match: isKitchen, occurrence: 'first', sequence: 30 },
      { key: 'billed', label: 'Billed', entityType: 'order', fromEvent: EVENTS.OrderCompleted, sequence: 40 },
      { key: 'closed', label: 'Settled & Closed', entityType: 'order', fromEvent: EVENTS.OrderClosed, sequence: 50 },
    ];

    this.registry.registerAll(defs);
    this.logger.log(`Registered ${defs.length} order milestones`);
  }
}
