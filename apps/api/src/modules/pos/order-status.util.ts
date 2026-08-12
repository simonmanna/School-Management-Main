/**
 * Order-status wire compatibility (P1).
 *
 * `OrderStatus` moved from restaurant-shaped values to a domain-neutral
 * lifecycle:
 *
 *   open      -> confirmed
 *   preparing -> in_progress
 *   served    -> completed     (this was written at INVOICE GENERATION, i.e. it
 *                               always meant "billed", never "served")
 *   ready     -> in_progress   (never written by any code path)
 *
 * Android POS devices in the field run APKs that still send and expect the old
 * strings, and they will not all update the moment the API does. For one
 * release the API therefore:
 *
 *   - ACCEPTS either spelling wherever a status is an input (filters), via
 *     {@link toCanonicalOrderStatus};
 *   - EMITS the canonical value as `status` AND the old value as `legacyStatus`,
 *     via {@link toLegacyOrderStatus}, so old and new clients can each read the
 *     field they understand.
 *
 * Delete this module together with the legacy enum values in the cleanup
 * migration, once no deployed client reads `legacyStatus`.
 */

/** Canonical lifecycle states. Mirrors the `OrderStatus` enum minus legacy. */
export const CANONICAL_ORDER_STATUSES = [
  'draft',
  'confirmed',
  'in_progress',
  'completed',
  'closed',
  'cancelled',
] as const;
export type CanonicalOrderStatus = (typeof CANONICAL_ORDER_STATUSES)[number];

/** Legacy wire values still accepted on input. */
export const LEGACY_ORDER_STATUSES = ['open', 'preparing', 'ready', 'served'] as const;

/** Every value the API accepts on input during the compat window. */
export const ACCEPTED_ORDER_STATUSES = [
  ...CANONICAL_ORDER_STATUSES,
  ...LEGACY_ORDER_STATUSES,
] as const;

const LEGACY_TO_CANONICAL: Record<string, CanonicalOrderStatus> = {
  open: 'confirmed',
  preparing: 'in_progress',
  ready: 'in_progress',
  served: 'completed',
};

const CANONICAL_TO_LEGACY: Record<string, string> = {
  confirmed: 'open',
  in_progress: 'preparing',
  completed: 'served',
  // draft / closed / cancelled are unchanged in both directions.
};

/**
 * Normalize a status coming from a client to its canonical value. Unknown
 * values pass through untouched so validation — not this helper — owns
 * rejecting them.
 */
export function toCanonicalOrderStatus<T extends string | null | undefined>(status: T): T {
  if (!status) return status;
  return (LEGACY_TO_CANONICAL[status] ?? status) as T;
}

/**
 * The value an old client expects to see for a given canonical status. Emit
 * alongside — never instead of — the canonical `status`.
 */
export function toLegacyOrderStatus<T extends string | null | undefined>(status: T): T {
  if (!status) return status;
  return (CANONICAL_TO_LEGACY[status] ?? status) as T;
}

/**
 * Spread into any order payload returned to a client:
 * `{ ...o, ...withLegacyOrderStatus(o.status) }`.
 */
export function withLegacyOrderStatus(status: string | null | undefined): {
  status: string | null | undefined;
  legacyStatus: string | null | undefined;
} {
  return { status, legacyStatus: toLegacyOrderStatus(status) };
}
