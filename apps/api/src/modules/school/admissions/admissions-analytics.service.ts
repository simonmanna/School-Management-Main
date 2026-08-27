import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { AdmissionsWorkflowService } from './admissions-workflow.service';
import { STAGE_DEFS } from './admission-workflow.schema';

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
    private readonly workflow: AdmissionsWorkflowService,
  ) {}

  private scope(academicYearId?: string) {
    return { ...(academicYearId ? { academicYearId } : {}), deletedAt: null };
  }

  /**
   * Per-stage coverage across every application's own workflow snapshot.
   *
   * Three states that must never be conflated in a report:
   *   completed — the stage is part of this application's process and it happened
   *   pending   — part of the process, not done yet
   *   skipped   — not part of this school's process at all
   *
   * Without this split, "Offer: 75" is unreadable: is the remainder waiting, or did
   * those schools not run an offer round?
   *
   * Cost note: unlike the groupBy aggregates above, this needs each application's own
   * snapshot, so it reads one narrow row per application in scope. Scoped by academic
   * year and limited to the columns the completion predicates read. If this ever
   * becomes hot, denormalise the resolved preset onto the application and group on it.
   */
  async stageCoverage(academicYearId?: string) {
    const apps = await this.prisma.client.admissionApplication.findMany({
      where: { ...this.scope(academicYearId), status: { not: 'draft' } },
      select: {
        status: true,
        workflowSnapshot: true,
        screenedAt: true,
        interviewedAt: true,
        scoredAt: true,
        acceptedAt: true,
        offerAcceptedAt: true,
        enrolledAt: true,
        decision: { select: { id: true } },
        offerLetter: { select: { status: true, expiresAt: true } },
      },
    });

    const empty = () => ({ required: 0, optional: 0, completed: 0, pending: 0, skipped: 0 });
    const out: Record<string, ReturnType<typeof empty>> = {};
    for (const def of STAGE_DEFS) out[def.stage] = empty();

    for (const app of apps) {
      const stages = this.workflow.stagesFor(app as any);
      for (const cfg of stages) {
        const bucket = out[cfg.stage];
        const complete = this.workflow.isStageComplete(app as any, cfg);
        if (cfg.mode === 'skip') {
          bucket.skipped += 1;
          continue;
        }
        if (cfg.mode === 'required') bucket.required += 1;
        else bucket.optional += 1;
        if (complete) bucket.completed += 1;
        else bucket.pending += 1;
      }
    }
    return out;
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
    const stageCoverage = await this.stageCoverage(academicYearId);
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
      /**
       * Per-stage required/completed/pending/skipped. Read this ALONGSIDE `stages`.
       *
       * `stages` sums statuses, so a school running `Application → Enrollment` shows
       * `offered: 0` — which means "the offer stage is not part of that process", NOT
       * "nobody received an offer". Conversion rates below share that caveat: their
       * denominators only describe applications whose workflow includes the stage.
       */
      stageCoverage,
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
