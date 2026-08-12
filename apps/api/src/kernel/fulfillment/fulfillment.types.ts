/**
 * A fulfillment strategy (Phase E) — how a module carries out the physical side
 * of an order (kitchen prep, delivery, rental hand-over, repair, production).
 *
 * The strategy is a THIN adapter over a concrete document the module already
 * owns (`KitchenTicket`, `RentalAgreement`, …). There is deliberately no
 * `OrderFulfillment` link table: completion is DERIVED by asking the strategy,
 * exactly as table occupancy is derived from order items
 * (`table-status.util.ts`). A pointer table would be a second copy of truth kept
 * in sync by dual-write; the concrete documents are already indexed by `orderId`.
 */
export interface FulfillmentStrategy {
  /** Stable code, e.g. `kitchen`, `delivery`, `rental`. Matches the `strategy`
   *  field on the `fulfillment.*` business events. */
  code: string;
  /** Human label for reporting/UI. */
  label: string;
  /**
   * Is the order's work under THIS strategy finished? Derived from the concrete
   * documents — e.g. kitchen = every `KitchenTicket` for the order is terminal.
   * Runs on the caller's tx/client so it composes inside a transaction.
   */
  isComplete: (orderId: string, db: any) => Promise<boolean>;
}
