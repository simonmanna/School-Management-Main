/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Order statuses that "hold" a dine-in table (an order in one of these states,
 * with at least one active item, keeps the table OCCUPIED). `completed` is the
 * billed-but-unpaid state — the customer has the bill but hasn't paid, so the
 * table stays held until the invoice settles and the order goes `closed`.
 * `closed` / `cancelled` release the table.
 *
 * The legacy tail (`open`/`preparing`/`ready`/`served`) is retained ONLY for the
 * Android wire-compat window: a device that pushed an order while running an old
 * APK can still have written a legacy status, and such a table must not silently
 * read as available. Drop the tail together with the enum values in the cleanup
 * migration.
 *
 * This is the single source of truth — import it rather than re-listing the
 * statuses inline.
 */
export const TABLE_HELD_ORDER_STATUSES = [
  'draft',
  'confirmed',
  'in_progress',
  'completed',
  // legacy, compat window only
  'open',
  'preparing',
  'ready',
  'served',
] as const;

/** True when `status` keeps a dine-in table held. Accepts legacy values. */
export function isTableHeldOrderStatus(status: string | null | undefined): boolean {
  return !!status && (TABLE_HELD_ORDER_STATUSES as readonly string[]).includes(status);
}

/**
 * Single source of truth for dine-in table status.
 *
 * A table is OCCUPIED iff it currently has ≥1 active (non-cancelled) order item
 * on an un-settled (held) order; otherwise AVAILABLE. Status is DERIVED from the
 * items, never set imperatively — so it can never drift no matter which
 * operation (create / save / add / delete / move / merge / split / settle)
 * touched the items.
 *
 * `reserved` and `out_of_service` are admin/booking overrides and are never
 * auto-flipped.
 *
 * MUST be called on the same `tx` as the order/item mutation that preceded it,
 * so the recompute commits or rolls back atomically with that change.
 *
 * @param tx       a Prisma client or interactive-transaction client
 * @param tableId  the table to recompute (no-op when null/undefined)
 * @returns the resulting status, or `null` when there is no table to update
 */
export async function recomputeTableStatus(
  tx: any,
  tableId?: string | null,
): Promise<'available' | 'occupied' | 'reserved' | 'out_of_service' | 'cleaning' | null> {
  if (!tableId) return null;

  const table = await tx.posTable.findFirst({ where: { id: tableId } });
  if (!table) return null;
  // Overrides win — these statuses are not driven by item count.
  if (table.status === 'out_of_service' || table.status === 'reserved' || table.status === 'cleaning') {
    return table.status;
  }

  const activeItems = await tx.orderItem.count({
    where: {
      cancelled: false,
      order: {
        tableId,
        status: { in: TABLE_HELD_ORDER_STATUSES as unknown as string[] },
      },
    },
  });

  const next = activeItems > 0 ? 'occupied' : 'available';
  if (table.status !== next) {
    await tx.posTable.update({ where: { id: tableId }, data: { status: next as any } });
  }
  return next;
}
