/**
 * The `inventory.stockPostingTiming` policy values (Phase C) — kept in a neutral
 * file so both `PosInvoiceService` (which resolves and honours the policy) and
 * `InventoryPostingSubscriber` (which reacts to events under it) can import the
 * type without a circular dependency.
 */
export type StockPostingTiming =
  | 'at_confirmation'
  | 'at_fulfillment_start'
  | 'at_fulfillment_complete'
  | 'at_invoice'
  | 'at_payment'
  | 'manual';
