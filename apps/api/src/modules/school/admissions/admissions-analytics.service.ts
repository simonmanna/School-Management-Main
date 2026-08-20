import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';

/**
 * Admissions analytics (Phase 5). Every aggregate is computed in the database
 * with groupBy/count — never by loading the whole application table into memory
 * and counting in JS, which is how the old pipelineMetrics worked and would not
 * survive 100k applications.
 */
@Injectable()
export class AdmissionsAnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
  ) {}

  private scope(academicYearId?: string) {
    return { ...(academicYearId ? { academicYearId } : {}), deletedAt: null };
  }

  /** Count of applications in each status, for one academic year or all. */
  async statusBreakdown(academicYearId?: string) {
    const grouped = await this.prisma.client.admissionApplication.groupBy({
      by: ['status'],
      where: this.scope(academicYearId),
      _count: { _all: true },
    });
    const byStatus: Record<string, number> = {};
    for (const g of grouped) byStatus[g.status] = g._count._all;
    return byStatus;
  }

  /**
   * The admissions funnel + conversion rates. Draft applications are excluded
   * from "total" because they are not yet in the pipeline.
   */
  async funnel(academicYearId?: string) {
    const byStatus = await this.statusBreakdown(academicYearId);
    const sum = (keys: string[]) => keys.reduce((n, k) => n + (byStatus[k] ?? 0), 0);

    const drafts = byStatus['draft'] ?? 0;
    const total = Object.values(byStatus).reduce((a, b) => a + b, 0) - drafts;
    // "reached" counts everything at or beyond a stage (terminal states included).
    const submitted = total;
    const reviewed = sum(['under_review', 'documents_pending', 'screening', 'interview_scheduled', 'interviewed', 'exam_scheduled', 'scored', 'accepted', 'waitlisted', 'offer_issued', 'offer_accepted', 'offer_declined', 'offer_expired', 'enrolled', 'rejected']);
    const accepted = sum(['accepted', 'offer_issued', 'offer_accepted', 'offer_declined', 'offer_expired', 'enrolled']);
    const offered = sum(['offer_issued', 'offer_accepted', 'offer_declined', 'offer_expired', 'enrolled']);
    const offerAccepted = sum(['offer_accepted', 'enrolled']);
    const enrolled = byStatus['enrolled'] ?? 0;
    const rejected = byStatus['rejected'] ?? 0;
    const waitlisted = byStatus['waitlisted'] ?? 0;

    const pct = (num: number, den: number) => (den > 0 ? Math.round((num / den) * 1000) / 10 : 0);

    return {
      drafts,
      total,
      stages: { submitted, reviewed, accepted, offered, offerAccepted, enrolled },
      buckets: { waitlisted, rejected },
      conversion: {
        acceptanceRate: pct(accepted, submitted),
        offerAcceptanceRate: pct(offerAccepted, offered),
        enrollmentRate: pct(enrolled, offerAccepted),
        overallYield: pct(enrolled, submitted),
      },
      byStatus,
    };
  }

  /** Applications grouped by their enquiry source (referral/website/…). */
  async bySource(academicYearId?: string) {
    const grouped = await this.prisma.client.admissionApplication.groupBy({
      by: ['sourceOfEnquiry'],
      where: this.scope(academicYearId),
      _count: { _all: true },
    });
    return grouped.map((g) => ({ source: g.sourceOfEnquiry ?? 'unknown', count: g._count._all }));
  }

  /** Applications grouped by the class applied for. */
  async byClass(academicYearId?: string) {
    const grouped = await this.prisma.client.admissionApplication.groupBy({
      by: ['applyingForClassId'],
      where: this.scope(academicYearId),
      _count: { _all: true },
    });
    const classIds = grouped.map((g) => g.applyingForClassId).filter(Boolean) as string[];
    const classes = classIds.length
      ? await this.prisma.client.schoolClass.findMany({ where: { id: { in: classIds } }, select: { id: true, name: true } })
      : [];
    const nameById = Object.fromEntries(classes.map((c) => [c.id, c.name]));
    return grouped.map((g) => ({
      classId: g.applyingForClassId,
      className: g.applyingForClassId ? nameById[g.applyingForClassId] ?? 'Unknown' : 'Unassigned',
      count: g._count._all,
    }));
  }

  /**
   * Average processing time (submission → enrollment) in days, computed over
   * enrolled applications that carry both timestamps.
   */
  async processingTime(academicYearId?: string) {
    const rows = await this.prisma.client.admissionApplication.findMany({
      where: { ...this.scope(academicYearId), status: 'enrolled', enrolledAt: { not: null } },
      select: { submittedAt: true, enrolledAt: true },
      take: 5000,
    });
    const deltas = rows
      .filter((r) => r.submittedAt && r.enrolledAt)
      .map((r) => (r.enrolledAt!.getTime() - r.submittedAt!.getTime()) / 86_400_000);
    const avg = deltas.length ? Math.round((deltas.reduce((a, b) => a + b, 0) / deltas.length) * 10) / 10 : null;
    return { count: deltas.length, averageDays: avg };
  }
}
