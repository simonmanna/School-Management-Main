import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../kernel/tenancy/tenant-context.service';

/**
 * RentalScoreService — per-partner rental trust score (0–100).
 *
 * Materialized on RentalCustomerScore, recomputed on agreement close and by the
 * nightly cron. `manualHold` blocks future checkouts regardless of score.
 * Score bands: 80+ good · 50–79 caution · <50 blocked (unless manualHold
 * overrides in the other direction via an explicit allow).
 */
@Injectable()
export class RentalScoreService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
  ) {}

  async getScore(partnerId: string) {
    const orgId = this.tenant.organizationId;
    const row = await this.prisma.client.rentalCustomerScore.findUnique({
      where: { organizationId_partnerId: { organizationId: orgId, partnerId } },
    });
    if (!row) return { partnerId, score: 100, band: 'good', manualHold: false };
    return row;
  }

  /** Can this partner check out a new agreement? */
  async canCheckout(partnerId: string): Promise<{ allowed: boolean; reason?: string; score: number; band: string }> {
    const orgId = this.tenant.organizationId;
    const row = await this.prisma.client.rentalCustomerScore.findUnique({
      where: { organizationId_partnerId: { organizationId: orgId, partnerId } },
    });
    if (!row) return { allowed: true, score: 100, band: 'good' };
    if (row.manualHold) {
      return { allowed: false, reason: 'manual_hold', score: row.score, band: row.band };
    }
    if (row.score < 50) {
      return { allowed: false, reason: 'low_score', score: row.score, band: row.band };
    }
    return { allowed: true, score: row.score, band: row.band };
  }

  /**
   * Recompute the score from raw history. Called at agreement close and by the
   * nightly cron. Upserts the materialized row.
   */
  async recompute(partnerId: string, tx?: any): Promise<any> {
    const orgId = this.tenant.organizationId;
    const db = tx ?? this.prisma.client;

    // Resolve the partner's agreement ids once (agreementLine links are loose
    // refs, not Prisma relations — filter through the header id instead).
    const agreements = await db.rentalAgreement.findMany({
      where: { organizationId: orgId, partnerId },
      select: { id: true },
    });
    const agreementIds = agreements.map((a: any) => a.id);

    const [returnLines, damages, cancelled, unpaid, completed] = await Promise.all([
      db.rentalReturnLine.findMany({
        where: { organizationId: orgId, agreementLineId: { in: agreementIds.length ? await this.lineIds(db, orgId, agreementIds) : [] } },
        select: { id: true, lateDays: true, isMissing: true, returnId: true },
      }),
      agreementIds.length
        ? db.rentalDamage.findMany({
            where: { organizationId: orgId, returnLine: { return: { agreementId: { in: agreementIds } } } },
            select: { id: true },
          })
        : Promise.resolve([]),
      db.rentalReservation.count({
        where: { organizationId: orgId, partnerId, status: 'cancelled' },
      }),
      db.invoice.aggregate({
        where: { organizationId: orgId, partnerId, status: 'open' },
        _sum: { totalAmount: true },
      }),
      db.rentalAgreement.count({
        where: { organizationId: orgId, partnerId, status: 'closed' },
      }),
    ]);

    const lateReturns = returnLines.filter((l: any) => l.lateDays > 0).length;
    const lostItems = returnLines.filter((l: any) => l.isMissing).length;
    const damageEvents = damages.length;
    const unpaidBalance = Number(unpaid._sum.totalAmount ?? 0);
    let score = 100;
    score -= Math.min(lateReturns * 5, 30);
    score -= Math.min(damageEvents * 15, 30);
    score -= lostItems * 20;
    score -= Math.min(cancelled * 2, 10);
    if (unpaidBalance > 0) score -= Math.min(Math.ceil(unpaidBalance / 100_000) * 2, 10);
    score = Math.max(0, Math.min(100, score));
    const band = score >= 80 ? 'good' : score >= 50 ? 'caution' : 'blocked';

    return db.rentalCustomerScore.upsert({
      where: { organizationId_partnerId: { organizationId: orgId, partnerId } },
      update: {
        lateReturns,
        damageEvents,
        lostItems,
        unpaidBalance,
        cancelledReservations: cancelled,
        completedRentals: completed,
        score,
        band,
        computedAt: new Date(),
      },
      create: {
        organizationId: orgId,
        partnerId,
        lateReturns,
        damageEvents,
        lostItems,
        unpaidBalance,
        cancelledReservations: cancelled,
        completedRentals: completed,
        score,
        band,
      },
    });
  }

  async setManualHold(partnerId: string, manualHold: boolean): Promise<any> {
    const orgId = this.tenant.organizationId;
    return this.prisma.client.rentalCustomerScore.upsert({
      where: { organizationId_partnerId: { organizationId: orgId, partnerId } },
      update: { manualHold },
      create: { organizationId: orgId, partnerId, manualHold, score: 50, band: 'caution' },
    });
  }

  /** Agreement-line ids for a set of agreements (loose-ref bridge). */
  private async lineIds(db: any, orgId: string, agreementIds: string[]): Promise<string[]> {
    const lines = await db.rentalAgreementLine.findMany({
      where: { organizationId: orgId, agreementId: { in: agreementIds } },
      select: { id: true },
    });
    return lines.map((l: any) => l.id);
  }
}
