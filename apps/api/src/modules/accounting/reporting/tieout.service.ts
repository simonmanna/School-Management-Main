import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { dec } from '../../../kernel/common/money';
import { BALANCE_AFFECTING_STATUSES } from '../posting/posting.types';

/* eslint-disable @typescript-eslint/no-explicit-any */

const ZERO = new Prisma.Decimal(0);
const TOLERANCE = new Prisma.Decimal(0.01);
/** A run "as of" more than this long ago is historical (see run()). */
const HISTORY_GRACE_MS = 60 * 60 * 1000;

export interface TieOutResult {
  /** `ran`: both sides computed. `not_run`: see `reason`; never read as balanced. */
  status: 'ran' | 'not_run';
  reason: string | null;
  arBalanced: boolean;
  arVariance: string;
  apBalanced: boolean;
  apVariance: string;
}

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

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
  ) {}

  /**
   * Run tie-out for every organization, store snapshots. Each organization runs
   * inside its own tenant context — the tenant-scoped client refuses to run
   * without one, so the nightly job used to fail for every org and only log it.
   */
  async runAll(asOf: Date = new Date()): Promise<{ orgs: number; failed: number }> {
    const orgs = await this.prisma.raw.organization.findMany({ where: { status: 'active' }, select: { id: true } });
    let failed = 0;
    for (const org of orgs) {
      try {
        await this.tenant.run({ organizationId: org.id }, () => this.run(org.id, asOf));
      } catch (err) {
        failed++;
        this.logger.error(`Tie-out failed for org ${org.id}: ${String(err)}`);
      }
    }
    return { orgs: orgs.length, failed };
  }

  /**
   * Run tie-out for one organization (call inside its tenant context).
   *
   * Wave 18: a tie-out that could not be computed is recorded as `not_run`
   * with the reason and both sides NOT balanced — a missing control-account
   * mapping used to report a green "balanced" result for a check that never ran.
   */
  async run(organizationId: string, asOf: Date = new Date()): Promise<TieOutResult> {
    if (this.tenant.optionalOrganizationId !== organizationId) {
      return this.tenant.run({ organizationId }, () => this.run(organizationId, asOf));
    }
    const client = this.prisma.client;

    // The sub-ledger side is the documents' CURRENT open balance; comparing it
    // with a past GL date would report drift that is only the passage of time.
    if (asOf.getTime() < Date.now() - HISTORY_GRACE_MS) {
      return this.store(organizationId, asOf, {
        status: 'not_run',
        reason: 'Tie-out compares the ledger with current open balances; run it as of today',
      });
    }

    const [arMapping, apMapping] = await Promise.all([
      client.accountMapping.findFirst({ where: { key: 'accounts_receivable' } }),
      client.accountMapping.findFirst({ where: { key: 'accounts_payable' } }),
    ]);
    const missing = [!arMapping && 'accounts_receivable', !apMapping && 'accounts_payable'].filter(Boolean);
    if (missing.length) {
      this.logger.warn(`Org ${organizationId} missing ${missing.join(', ')} mapping; tie-out not run`);
      return this.store(organizationId, asOf, {
        status: 'not_run',
        reason: `Map ${missing.join(' and ')} under Accounting > Account Mappings, then run the tie-out again`,
      });
    }

    // Control accounts = the mapped account plus every per-partner override the
    // posting engine may have used (AccountDeterminationService.receivableAccount).
    const [arOverrides, apOverrides] = await Promise.all([
      client.partner.findMany({
        where: { receivableAccountId: { not: null } },
        select: { receivableAccountId: true },
        distinct: ['receivableAccountId'],
      }),
      client.partner.findMany({
        where: { payableAccountId: { not: null } },
        select: { payableAccountId: true },
        distinct: ['payableAccountId'],
      }),
    ]);
    const arAccounts = [...new Set([arMapping!.accountId, ...arOverrides.map((p: any) => p.receivableAccountId)])];
    const apAccounts = [...new Set([apMapping!.accountId, ...apOverrides.map((p: any) => p.payableAccountId)])];

    const glSum = (accountIds: string[]) =>
      client.journalLine.aggregate({
        where: {
          accountId: { in: accountIds },
          entry: { status: { in: [...BALANCE_AFFECTING_STATUSES] }, postingDate: { lte: asOf } },
        },
        _sum: { baseDebit: true, baseCredit: true },
      });
    const [arAgg, apAgg] = await Promise.all([glSum(arAccounts), glSum(apAccounts)]);
    const arGl = dec(arAgg._sum.baseDebit ?? 0).minus(dec(arAgg._sum.baseCredit ?? 0));
    const apGl = dec(apAgg._sum.baseCredit ?? 0).minus(dec(apAgg._sum.baseDebit ?? 0));

    // Sub-ledger: open invoice / bill residuals (school fee invoices are
    // `sales_invoice` Documents; POS invoices live in `Invoice`).
    const [docAr, posAr, docAp] = await Promise.all([
      client.document.aggregate({
        where: { documentType: 'sales_invoice', status: { in: ['posted', 'paid'] } },
        _sum: { amountResidual: true },
      }),
      client.invoice.aggregate({ where: { status: { in: ['posted', 'paid'] } }, _sum: { amountResidual: true } }),
      client.document.aggregate({
        where: { documentType: 'vendor_bill', status: { in: ['posted', 'paid'] } },
        _sum: { amountResidual: true },
      }),
    ]);
    const arSub = dec(docAr._sum.amountResidual ?? 0).plus(dec(posAr._sum.amountResidual ?? 0));
    const apSub = dec(docAp._sum.amountResidual ?? 0);

    const arVariance = arGl.minus(arSub);
    const apVariance = apGl.minus(apSub);
    const arBalanced = arVariance.abs().lessThanOrEqualTo(TOLERANCE);
    const apBalanced = apVariance.abs().lessThanOrEqualTo(TOLERANCE);
    if (!arBalanced || !apBalanced) {
      this.logger.warn(
        `Org ${organizationId} tie-out imbalanced: AR variance ${arVariance.toString()}, AP variance ${apVariance.toString()}`,
      );
    }
    return this.store(organizationId, asOf, {
      status: 'ran',
      arBalanced,
      arVariance,
      apBalanced,
      apVariance,
      arDetails: { glBalance: arGl.toString(), subLedgerBalance: arSub.toString(), controlAccounts: arAccounts },
      apDetails: { glBalance: apGl.toString(), subLedgerBalance: apSub.toString(), controlAccounts: apAccounts },
    });
  }

  private async store(
    organizationId: string,
    asOf: Date,
    r: {
      status: 'ran' | 'not_run';
      reason?: string;
      arBalanced?: boolean;
      arVariance?: Prisma.Decimal;
      apBalanced?: boolean;
      apVariance?: Prisma.Decimal;
      arDetails?: Record<string, unknown>;
      apDetails?: Record<string, unknown>;
    },
  ): Promise<TieOutResult> {
    const row = {
      status: r.status,
      reason: r.reason ?? null,
      arBalanced: r.arBalanced ?? false,
      arVariance: r.arVariance ?? ZERO,
      apBalanced: r.apBalanced ?? false,
      apVariance: r.apVariance ?? ZERO,
      arDetails: (r.arDetails ?? {}) as any,
      apDetails: (r.apDetails ?? {}) as any,
    };
    await this.prisma.client.$transaction(async (tx: any) => {
      await tx.reportTieoutSnapshot.deleteMany({ where: { organizationId, asOf } });
      await tx.reportTieoutSnapshot.create({ data: { organizationId, asOf, ...row } });
    });
    return {
      status: row.status,
      reason: row.reason,
      arBalanced: row.arBalanced,
      arVariance: row.arVariance.toString(),
      apBalanced: row.apBalanced,
      apVariance: row.apVariance.toString(),
    };
  }

  /** Read the latest tie-out snapshot for the current tenant. */
  async latest(asOf?: string): Promise<{
    asOf: Date;
    status: string;
    reason: string | null;
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
      status: row.status,
      reason: row.reason,
      arBalanced: row.arBalanced,
      arVariance: row.arVariance.toString(),
      apBalanced: row.apBalanced,
      apVariance: row.apVariance.toString(),
      arDetails: row.arDetails,
      apDetails: row.apDetails,
    };
  }
}