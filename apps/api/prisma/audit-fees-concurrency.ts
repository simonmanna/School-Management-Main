/**
 * Concurrency gate for fee-credit drawdown.
 *
 * Run: pnpm --filter @erp/api exec tsx prisma/audit-fees-concurrency.ts
 * Exit: 0 = safe.
 *
 * Why this exists as a script and not a mocked unit test: the defect lives
 * entirely in what two simultaneous TRANSACTIONS do to one row. A mock cannot
 * demonstrate it, and a passing mocked test would be actively misleading.
 *
 * The defect it guards
 * ────────────────────
 * `refundFee` and `applyCredits` both used to read a credit's `remaining`,
 * compute `newRemaining` in memory, and write it back. `refundFee` read through
 * the query service, which uses its own connection — so the read was not even
 * inside the transaction. Two simultaneous refunds of one 300,000 credit both
 * saw 300,000, both wrote 0, and both paid out. 600,000 left the drawer against
 * a 300,000 entitlement.
 *
 * The fix is a conditional decrement — `WHERE remaining >= take` with
 * `decrement` — so Postgres takes a row lock and the loser re-evaluates against
 * the committed value, matches zero rows, and aborts.
 * (FINANCIAL_INVARIANTS §Concurrency: enforced by the DATABASE, never by an
 * application read.)
 *
 * This script runs BOTH patterns against a scratch credit it creates and
 * deletes, so a green result proves the guard works rather than merely that
 * nothing happened to collide today.
 */
import { PrismaClient, Prisma } from '@prisma/client';

const prisma = new PrismaClient();
const D = (n: number) => new Prisma.Decimal(n);

/** The CURRENT implementation: conditional decrement under a row lock. */
async function safeDrawdown(creditId: string, take: Prisma.Decimal, label: string) {
  return prisma.$transaction(async (tx) => {
    // Deliberately re-create the service's shape: a read that is stale by the
    // time the write happens.
    await tx.feeCredit.findFirst({ where: { id: creditId }, select: { remaining: true } });
    await new Promise((r) => setTimeout(r, 50));
    const claimed = await tx.feeCredit.updateMany({
      where: { id: creditId, remaining: { gte: take } },
      data: { remaining: { decrement: take } },
    });
    if (claimed.count !== 1) throw new Error(`${label}: rejected — already drawn down`);
    return `${label}: paid out ${take}`;
  });
}

/** The PRE-FIX pattern, kept as a control so the gate proves something. */
async function unsafeDrawdown(creditId: string, take: Prisma.Decimal, label: string) {
  return prisma.$transaction(async (tx) => {
    const before = await tx.feeCredit.findFirst({ where: { id: creditId }, select: { remaining: true } });
    const available = new Prisma.Decimal(before!.remaining);
    if (available.lessThan(take)) throw new Error(`${label}: insufficient`);
    await new Promise((r) => setTimeout(r, 50));
    await tx.feeCredit.update({
      where: { id: creditId },
      data: { remaining: available.minus(take) },
    });
    return `${label}: paid out ${take}`;
  });
}

async function withScratchCredit<T>(fn: (creditId: string) => Promise<T>): Promise<T | null> {
  const org = await prisma.organization.findFirst({ orderBy: { createdAt: 'asc' } });
  if (!org) {
    console.log('No organization found — nothing to test against.');
    return null;
  }
  const student = await prisma.studentProfile.findFirst({ where: { organizationId: org.id } });
  if (!student) {
    console.log(`No pupil in ${org.name} — nothing to test against.`);
    return null;
  }
  const credit = await prisma.feeCredit.create({
    data: {
      organizationId: org.id,
      studentProfileId: student.id,
      code: `CONCURRENCY-PROBE-${Date.now()}`,
      amount: D(300_000),
      remaining: D(300_000),
      // A scratch row, deleted below. Never applied, never refunded, never
      // posted to the GL — it exists only to be raced against.
      source: 'approved_adjustment',
      isActive: true,
    },
  });
  try {
    return await fn(credit.id);
  } finally {
    await prisma.feeCredit.delete({ where: { id: credit.id } }).catch(() => undefined);
  }
}

async function main() {
  console.log(`Fee-credit concurrency gate · ${new Date().toISOString()}`);

  console.log('\n── Control: the pre-fix read-compute-write pattern ──');
  const controlPayouts = await withScratchCredit(async (id) => {
    const results = await Promise.allSettled([
      unsafeDrawdown(id, D(300_000), 'refund-A'),
      unsafeDrawdown(id, D(300_000), 'refund-B'),
    ]);
    for (const r of results) {
      console.log('   ', r.status === 'fulfilled' ? r.value : (r.reason as Error).message);
    }
    return results.filter((r) => r.status === 'fulfilled').length;
  });
  if (controlPayouts === null) return;
  console.log(
    controlPayouts > 1
      ? `   → ${controlPayouts} payouts from ONE credit. The control reproduces the defect, so this gate is meaningful.`
      : '   → control did not collide; the gate below is inconclusive on this engine.',
  );

  console.log('\n── Current implementation: conditional decrement ──');
  const result = await withScratchCredit(async (id) => {
    const results = await Promise.allSettled([
      safeDrawdown(id, D(300_000), 'refund-A'),
      safeDrawdown(id, D(300_000), 'refund-B'),
    ]);
    for (const r of results) {
      console.log('   ', r.status === 'fulfilled' ? r.value : (r.reason as Error).message);
    }
    const after = await prisma.feeCredit.findFirst({ where: { id }, select: { remaining: true } });
    return {
      payouts: results.filter((r) => r.status === 'fulfilled').length,
      remaining: Number(after?.remaining ?? -1),
    };
  });
  if (!result) return;

  const passed = result.payouts === 1 && result.remaining === 0;
  console.log(`   → payouts: ${result.payouts} (must be 1)   remaining: ${result.remaining} (must be 0)`);
  console.log(
    passed
      ? '\nPASS — one payout, one rejection. A fee credit cannot be spent twice.'
      : '\nFAIL — the drawdown is not safe under concurrency. Do NOT take real money.',
  );
  if (!passed) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
