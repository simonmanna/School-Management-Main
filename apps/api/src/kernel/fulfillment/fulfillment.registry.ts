import { Injectable, Logger } from '@nestjs/common';
import type { FulfillmentStrategy } from './fulfillment.types';

/**
 * In-memory registry of fulfillment strategies (Phase E), mirroring
 * `WorkflowRegistry` / `MilestoneRegistry`. Modules register their strategy at
 * startup; consumers (the inventory posting subscriber today, the Order
 * `complete` guard later) ask a strategy whether an order's work is done rather
 * than hardcoding each vertical's document check.
 */
@Injectable()
export class FulfillmentRegistry {
  private readonly logger = new Logger('FulfillmentRegistry');
  private readonly byCode = new Map<string, FulfillmentStrategy>();

  register(strategy: FulfillmentStrategy): void {
    if (this.byCode.has(strategy.code)) {
      throw new Error(`Fulfillment strategy '${strategy.code}' is already registered`);
    }
    this.byCode.set(strategy.code, strategy);
    this.logger.log(`Registered fulfillment strategy '${strategy.code}'`);
  }

  get(code: string): FulfillmentStrategy | undefined {
    return this.byCode.get(code);
  }

  list(): FulfillmentStrategy[] {
    return [...this.byCode.values()];
  }
}
