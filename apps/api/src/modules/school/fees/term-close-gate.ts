import { BadRequestException } from '@nestjs/common';

/**
 * The financial-close gate at the point of mutation (audit 2026-09-27 F05,
 * invariant I-021).
 *
 * Checking "is the term open?" before a transaction is not a gate: a billing
 * run queued while the term was open posted its invoice after the bursar had
 * closed and reconciled it. The rule is:
 *
 *   Every transaction that creates or changes a term's financial truth calls
 *   `lockTermsOpen(tx, …)` INSIDE that transaction, before it writes.
 *
 * It takes a SHARED transaction-scoped advisory lock per term, then reads the
 * close row. `closeTerm` takes the same lock EXCLUSIVELY and computes its
 * snapshot while holding it. So the two serialize: a posting that got the lock
 * first commits before the close snapshots it; a close that got it first is
 * committed before the posting reads "closed" and refuses. Postings of one term
 * never block each other.
 */
function lockKey(organizationId: string, termId: string): string {
  return `term-close:${organizationId}:${termId}`;
}

export async function lockTermsOpen(
  tx: any,
  organizationId: string,
  termIds: Array<string | null | undefined>,
  what = 'post fee transactions',
): Promise<void> {
  // Sorted, so two transactions touching the same terms lock in one order.
  const ids = [...new Set(termIds.filter((t): t is string => !!t))].sort();
  if (ids.length === 0) return;
  for (const termId of ids) {
    await tx.$queryRawUnsafe(
      'SELECT 1 AS ok FROM pg_advisory_xact_lock_shared(hashtextextended($1, 0))',
      lockKey(organizationId, termId),
    );
  }
  const closed = await tx.termFinancialClose.findMany({
    where: { organizationId, termId: { in: ids }, status: 'closed' },
    select: { termId: true },
  });
  if (closed.length > 0) {
    const terms = await tx.term.findMany({ where: { id: { in: closed.map((c: any) => c.termId) } }, select: { id: true, name: true } });
    const nameOf = new Map<string, string>(terms.map((t: any) => [t.id, t.name]));
    const names = closed.map((c: any) => nameOf.get(c.termId) ?? c.termId).join(', ');
    throw new BadRequestException(
      `${names} ${closed.length === 1 ? 'is' : 'are'} financially closed, so you cannot ${what}. ` +
        'Reopen the term (maker-checker, with a reason) first.',
    );
  }
}

/** The exclusive side, held by close and reopen for the rest of their transaction. */
export async function lockTermExclusive(tx: any, organizationId: string, termId: string): Promise<void> {
  await tx.$queryRawUnsafe(
    'SELECT 1 AS ok FROM pg_advisory_xact_lock(hashtextextended($1, 0))',
    lockKey(organizationId, termId),
  );
}
