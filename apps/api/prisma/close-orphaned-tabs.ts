/**
 * POS cutover helper — "move all sales onto Invoice; drop Document from POS".
 *
 * Context: the dine-in open tab used to live on a legacy draft `Document`
 * (linked via `PosTableOrder.documentId`). It now lives on an `Order`
 * (`PosTableOrder.orderId`, nullable). The schema swap (db push / migration)
 * preserves historical occupancy rows but leaves the handful of *currently open*
 * tabs with `orderId = NULL` (their draft Documents are orphaned).
 *
 * This script is the safe post-migration cleanup: it closes any open
 * `PosTableOrder` that has no linked Order and frees its table so the floor plan
 * doesn't show phantom occupancy. Idempotent — safe to run repeatedly.
 *
 * Recommended cutover order (prod):
 *   1. Pick a low-traffic window and settle/close as many open tabs as possible.
 *   2. Apply the schema (`npx prisma migrate deploy`  or  `db push`).
 *   3. Run this script:  `npx ts-node prisma/close-orphaned-tabs.ts`
 *   4. Re-ring any abandoned tabs (their unpaid draft Documents were never posted,
 *      so no GL/stock was affected).
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // Open tab links with no Order attached = orphaned by the Document→Order cutover.
  const orphaned = await prisma.posTableOrder.findMany({
    where: { closedAt: null, orderId: null },
    select: { id: true, tableId: true },
  });

  if (orphaned.length === 0) {
    console.log('No orphaned open tabs — nothing to close.');
    return;
  }

  const now = new Date();
  await prisma.posTableOrder.updateMany({
    where: { id: { in: orphaned.map((o) => o.id) } },
    data: { closedAt: now, notes: 'Closed by Document→Order cutover (orphaned open tab)' },
  });

  // Free every affected table that has no other open tab.
  const tableIds = [...new Set(orphaned.map((o) => o.tableId))];
  let freed = 0;
  for (const tableId of tableIds) {
    const stillOpen = await prisma.posTableOrder.count({ where: { tableId, closedAt: null } });
    if (stillOpen > 0) continue;
    const table = await prisma.posTable.findFirst({ where: { id: tableId }, select: { status: true } });
    if (table && table.status !== 'out_of_service') {
      await prisma.posTable.update({ where: { id: tableId }, data: { status: 'available' } });
      freed++;
    }
  }

  console.log(`Closed ${orphaned.length} orphaned tab link(s); freed ${freed} table(s).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
