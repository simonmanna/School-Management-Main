import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../kernel/prisma/prisma.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

const ZERO = new Prisma.Decimal(0);
const TOLERANCE = new Prisma.Decimal(0.01);

/**
 * AR/AP tie-out service (D3). Reconciles the GL control-account balance
 * (AR / AP) against the sum of open invoice / bill residuals. A variance
 * greater than $0.01 indicates that the sub-ledger and the GL have drifted
 * — usually because of a missed allocation, a manual journal entry, or a
 * data migration script.
 *
 * The job runs nightly alongside the snapshot rebuild and stores the result
 * in `ReportTieoutSnapshot`. Operators query `GET /reports/tieout` (added by
 * D3-2) to inspect.
 */
@Injectable()
export class TieOutService {
  private readonly logger = new Logger('TieOutService');

  constructor(private readonly prisma: PrismaService) {}

  /** Run tie-out for every organization, store snapshots. */
  async runAll(asOf: Date = new Date()): Promise<{ orgs: number }> {
    const orgs = await this.prisma.raw.organization.findMany({ select: { id: true } });
    for (const org of orgs) {
      try {
        await this.run(org.id, asOf);
      } catch (err) {
        this.logger.error(`Tie-out failed for org ${org.id}: ${String(err)}`);
      }
    }
    return { orgs: orgs.length };
  }

  /** Run tie-out for one organization. */
  async run(organizationId: string, asOf: Date = new Date()): Promise<{
    arBalanced: boolean;
    arVariance: string;
    apBalanced: boolean;
    apVariance: string;
  }> {
    await this.prisma.client.reportTieoutSnapshot.deleteMany({ where: { organizationId, asOf } });

    // 1) Find AR and AP control accounts.
    const arMapping = await this.prisma.client.accountMapping.findFirst({
      where: { key: 'accounts_receivable' },
    });
    const apMapping = await this.prisma.client.accountMapping.findFirst({
      where: { key: 'accounts_payable' },
    });
    if (!arMapping || !apMapping) {
      this.logger.warn(`Org ${organizationId} missing AR/AP account mapping; skipping tie-out`);
      return { arBalanced: true, arVariance: '0', apBalanced: true, apVariance: '0' };
    }

    // 2) Sum GL AR/AP balances (debit-normal AR, credit-normal AP → absolute).
    const arLines = await this.prisma.client.journalLine.groupBy({
      by: ['accountId'],
      where: {
        accountId: arMapping.accountId,
        entry: { status: 'posted', postingDate: { lte: asOf } },
      },
      _sum: { baseDebit: true, baseCredit: true },
    });
    const apLines = await this.prisma.client.journalLine.groupBy({
      by: ['accountId'],
      where: {
        accountId: apMapping.accountId,
        entry: { status: 'posted', postingDate: { lte: asOf } },
      },
      _sum: { baseDebit: true, baseCredit: true },
    });
    const arGl = (arLines as any[]).reduce(
      (acc, g) => acc.plus(g._sum.baseDebit ?? 0).minus(g._sum.baseCredit ?? 0),
      ZERO,
    );
    const apGl = (apLines as any[]).reduce(
      (acc, g) => acc.plus(g._sum.baseCredit ?? 0).minus(g._sum.baseDebit ?? 0),
      ZERO,
    );

    // 3) Sum open invoice / bill residuals.
    const openInvoices = await this.prisma.client.document.findMany({
      where: { documentType: 'sales_invoice', status: { in: ['posted', 'paid'] } },
      select: { amountResidual: true },
    });
    const arSub = (openInvoices as any[]).reduce(
      (acc, d) => acc.plus(d.amountResidual),
      ZERO,
    );
    const openBills = await this.prisma.client.document.findMany({
      where: { documentType: 'vendor_bill', status: { in: ['posted', 'paid'] } },
      select: { amountResidual: true },
    });
    const apSub = (openBills as any[]).reduce(
      (acc, d) => acc.plus(d.amountResidual),
      ZERO,
    );

    const arVariance = arGl.minus(arSub);
    const apVariance = apGl.minus(apSub);
    const arBalanced = arVariance.abs().lessThanOrEqualTo(TOLERANCE);
    const apBalanced = apVariance.abs().lessThanOrEqualTo(TOLERANCE);

    await this.prisma.client.reportTieoutSnapshot.create({
      data: {
        organizationId,
        asOf,
        arBalanced,
        arVariance,
        apBalanced,
        apVariance,
        arDetails: { glBalance: arGl.toString(), subLedgerBalance: arSub.toString() } as any,
        apDetails: { glBalance: apGl.toString(), subLedgerBalance: apSub.toString() } as any,
      },
    });

    if (!arBalanced || !apBalanced) {
      this.logger.warn(
        `Org ${organizationId} tie-out imbalanced: AR variance ${arVariance.toString()}, AP variance ${apVariance.toString()}`,
      );
    }

    return {
      arBalanced,
      arVariance: arVariance.toString(),
      apBalanced,
      apVariance: apVariance.toString(),
    };
  }

  /** Read the latest tie-out snapshot for the current tenant. */
  async latest(asOf?: string): Promise<{
    asOf: Date;
    arBalanced: boolean;
    arVariance: string;
    apBalanced: boolean;
    apVariance: string;
    arDetails: any;
    apDetails: any;
  } | null> {
    const where: any = {};
    if (asOf) where.asOf = new Date(asOf);
    const row = await this.prisma.client.reportTieoutSnapshot.findFirst({
      where,
      orderBy: { asOf: 'desc' },
    });
    if (!row) return null;
    return {
      asOf: row.asOf,
      arBalanced: row.arBalanced,
      arVariance: row.arVariance.toString(),
      apBalanced: row.apBalanced,
      apVariance: row.apVariance.toString(),
      arDetails: row.arDetails,
      apDetails: row.apDetails,
    };
  }
}