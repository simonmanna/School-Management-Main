/**
 * POS — house-account (credit) status for a customer.
 *
 * One resolver shared by everything that cares about a customer's credit, so
 * the guard that blocks a sale and the numbers the cashier is shown can never
 * disagree:
 *   - PosInvoiceService.assertCreditAllowed  (hard guard, inside the settle tx)
 *   - GET /pos/customers/:partnerId/credit   (Charge dialog)
 *   - GET /pos/customers/:partnerId/statement
 *
 * The limit lives in two places for historical reasons: `Partner.creditLimit`
 * (AR credit control, the back-office field) and `CustomerTab.creditLimit` (the
 * older POS tab). Partner wins when set; the tab is the fallback so existing
 * POS-configured limits keep working. 0 means "no limit" in both.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

export interface CreditStatus {
  /** 0 = unlimited. */
  creditLimit: number;
  /** Sum of amountResidual across the customer's open credit invoices. */
  outstanding: number;
  /** Headroom left, or null when the customer has no limit. */
  available: number | null;
  /** Manual block on new credit sales (Partner.creditHold). */
  creditHold: boolean;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Resolve a customer's credit standing.
 *
 * `lock` takes a `FOR UPDATE` on the customer-tab row (D3) so two terminals
 * issuing credit for the same partner are serialised rather than both passing
 * a check-then-act limit test. Only the settle path needs it; read endpoints
 * pass a plain client.
 */
export async function resolveCreditStatus(
  db: any,
  orgId: string,
  partnerId: string,
  opts: { lock?: boolean } = {},
): Promise<CreditStatus> {
  if (opts.lock && typeof db.$queryRawUnsafe === 'function') {
    await db.$queryRawUnsafe(
      `SELECT id FROM "CustomerTab" WHERE "organizationId" = $1 AND "partnerId" = $2 FOR UPDATE`,
      orgId,
      partnerId,
    );
  }

  const [partner, tab, open] = await Promise.all([
    db.partner.findFirst({
      where: { id: partnerId, organizationId: orgId },
      select: { creditLimit: true, creditHold: true },
    }),
    db.customerTab.findFirst({ where: { organizationId: orgId, partnerId } }),
    db.invoice.aggregate({
      where: {
        organizationId: orgId,
        partnerId,
        paymentMode: 'credit',
        settlementStatus: { in: ['unsettled', 'partially_settled'] },
      },
      _sum: { amountResidual: true },
    }),
  ]);

  const partnerLimit = Number(partner?.creditLimit ?? 0);
  const creditLimit = partnerLimit > 0 ? partnerLimit : Number(tab?.creditLimit ?? 0);
  const outstanding = round2(Number(open?._sum?.amountResidual ?? 0));

  return {
    creditLimit,
    outstanding,
    available: creditLimit > 0 ? round2(Math.max(0, creditLimit - outstanding)) : null,
    creditHold: partner?.creditHold === true,
  };
}
