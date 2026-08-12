import { Injectable, OnModuleInit } from '@nestjs/common';
import { FulfillmentRegistry } from '../../kernel/fulfillment/fulfillment.registry';

/** Kitchen ticket states that count as "no longer working". */
const TERMINAL_KDS = ['ready', 'served', 'cancelled'];

/**
 * Registers POS fulfillment strategies (Phase E). Kitchen is the first: an
 * order's kitchen work is complete when every `KitchenTicket` for it is
 * terminal — DERIVED from the tickets (indexed by `orderId`), no link table.
 *
 * When Delivery lands it registers here as a second strategy answering the same
 * `isComplete` question; nothing consuming the registry changes.
 */
@Injectable()
export class PosFulfillmentInitializer implements OnModuleInit {
  constructor(private readonly registry: FulfillmentRegistry) {}

  onModuleInit(): void {
    this.registry.register({
      code: 'kitchen',
      label: 'Kitchen',
      isComplete: async (orderId, db) => {
        const open = await db.kitchenTicket.count({
          where: { orderId, status: { notIn: TERMINAL_KDS } },
        });
        // No tickets at all also counts as "nothing outstanding".
        return open === 0;
      },
    });
  }
}
