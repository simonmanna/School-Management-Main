import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { EVENTS } from '@erp/shared';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { AuditService } from '../../../kernel/audit/audit.service';
import { EventBus } from '../../../kernel/events/event-bus';
import { PlacementService } from '../enrollment/placement.service';
import type { ApplyPromotionDto, DecidePromotionDto, ProposePromotionsDto } from './promotion-decision.dto';

/**
 * Phase 5 — promotion as a decision, not a side effect.
 *
 * `StudentTermResult.promotionRecommendation` is what the calculation says. A
 * `PromotionDecision` is what the school decided, by whom, on what evidence —
 * and applying it is a third, separate act that writes the next placement
 * through the Phase 1 spine. A recommendation alone never moves a child.
 */
@Injectable()
export class PromotionDecisionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly audit: AuditService,
    private readonly events: EventBus,
    private readonly placements: PlacementService,
  ) {}

  private get db(): any { return this.prisma.client; }
  private get org(): string { return this.tenant.organizationId; }

  // ── proposal ───────────────────────────────────────────────────────────────

  /**
   * Draw up the promotion list from a published result set.
   *
   * Only a published set: proposing from a draft calculation means the numbers
   * the decision was taken on can still change. Existing decisions are left
   * alone — a re-run refreshes the untouched proposals and never overwrites a
   * decision somebody has already taken.
   */
  async propose(dto: ProposePromotionsDto) {
    const rs = await this.db.resultSet.findFirst({ where: { id: dto.resultSetId } });
    if (!rs) throw new NotFoundException(`ResultSet ${dto.resultSetId} not found`);
    if (!['published', 'locked'].includes(rs.status)) {
      throw new BadRequestException('Promotions are proposed from a published result set. Publish the results first.');
    }

    const term = await this.db.term.findFirst({ where: { id: rs.termId } });
    const results = await this.db.studentTermResult.findMany({ where: { resultSetId: rs.id } });
    if (!results.length) throw new BadRequestException('That result set covers no learners');

    const subjectCounts: any[] = await this.db.studentSubjectResult
      .groupBy({ by: ['studentProfileId'], where: { resultSetId: rs.id }, _count: { _all: true } })
      .catch(() => [] as any[]);
    const subjectCount = new Map<string, number>(subjectCounts.map((r: any) => [r.studentProfileId, Number(r._count._all)]));

    let proposed = 0;
    let refreshed = 0;
    let untouched = 0;

    await this.db.$transaction(async (tx: any) => {
      for (const r of results) {
        const basis = {
          meanPercent: r.meanPercent != null ? Number(r.meanPercent) : null,
          gpa: r.gpa != null ? Number(r.gpa) : null,
          aggregate: r.aggregate,
          division: r.division,
          classRank: r.classRank,
          subjectsCount: subjectCount.get(r.studentProfileId) ?? r.subjectsCount,
          eligible: r.eligible,
          incompleteReason: r.incompleteReason,
          resultSetRevision: rs.revision,
          outputChecksum: rs.outputChecksum,
        };
        const existing = await tx.promotionDecision.findFirst({
          where: { resultSetId: rs.id, studentProfileId: r.studentProfileId },
        });
        if (existing && existing.status !== 'proposed') { untouched += 1; continue; }
        if (existing) {
          await tx.promotionDecision.updateMany({
            where: { id: existing.id },
            data: { recommendation: r.promotionRecommendation, basis: basis as any, fromClassId: r.classId, fromGradeLevelId: r.gradeLevelId },
          });
          refreshed += 1;
          continue;
        }
        await tx.promotionDecision.create({
          data: {
            organizationId: this.org,
            studentProfileId: r.studentProfileId,
            resultSetId: rs.id,
            termId: rs.termId,
            academicYearId: term?.academicYearId ?? null,
            fromGradeLevelId: r.gradeLevelId,
            fromClassId: r.classId,
            recommendation: r.promotionRecommendation,
            basis: basis as any,
            proposedById: this.tenant.userId ?? null,
          },
        });
        proposed += 1;
      }
      await this.audit.recordInTx(tx, {
        entity: 'PromotionDecision', entityId: rs.id, action: 'create',
        newValues: { resultSetId: rs.id, proposed, refreshed, untouched },
      });
      await this.events.publishInTx(tx, EVENTS.SchoolPromotionProposed, {
        organizationId: this.org, resultSetId: rs.id, termId: rs.termId, proposed, refreshed,
      });
    });

    return { resultSetId: rs.id, proposed, refreshed, untouched, total: results.length };
  }

  // ── decision ───────────────────────────────────────────────────────────────

  /**
   * Record the school's decision on one or more learners. The decision may
   * differ from the recommendation — that is the point of a decision — but a
   * departure has to carry a reason.
   */
  async decide(dto: DecidePromotionDto) {
    if (!dto.rows.length) throw new BadRequestException('Nothing to decide');
    return this.db.$transaction(async (tx: any) => {
      const decided: any[] = [];
      for (const row of [...dto.rows].sort((a, b) => a.id.localeCompare(b.id))) {
        const d = await tx.promotionDecision.findFirst({ where: { id: row.id } });
        if (!d) throw new NotFoundException(`PromotionDecision ${row.id} not found`);
        if (d.status === 'applied') throw new BadRequestException('A decision that has already been applied cannot be changed');
        if (row.status === 'rejected' && !row.reason?.trim()) {
          throw new BadRequestException('Refusing a promotion needs a reason');
        }
        if (row.decision && row.decision !== d.recommendation && !row.reason?.trim()) {
          throw new BadRequestException('Departing from the recommendation needs a reason');
        }
        const decision = row.decision ?? d.recommendation;
        if (row.status === 'approved' && ['promote', 'repeat'].includes(decision) && !row.toClassId) {
          throw new BadRequestException('Approving a promotion or repeat needs the class the learner moves into');
        }
        await tx.promotionDecision.updateMany({
          where: { id: row.id },
          data: {
            status: row.status,
            decision,
            toClassId: row.toClassId ?? d.toClassId ?? null,
            toGradeLevelId: row.toGradeLevelId ?? d.toGradeLevelId ?? null,
            toSectionId: row.toSectionId ?? d.toSectionId ?? null,
            toStreamId: row.toStreamId ?? d.toStreamId ?? null,
            reason: row.reason ?? d.reason ?? null,
            decidedById: this.tenant.userId ?? null,
            decidedAt: new Date(),
          },
        });
        decided.push({ id: row.id, status: row.status, decision });
      }
      await this.audit.recordInTx(tx, {
        entity: 'PromotionDecision', entityId: decided[0]?.id ?? 'batch',
        action: dto.rows.every((r) => r.status === 'rejected') ? 'reject' : 'approve',
        newValues: { count: decided.length, decisions: decided },
      });
      await this.events.publishInTx(tx, EVENTS.SchoolPromotionDecided, {
        organizationId: this.org, count: decided.length,
      });
      return { decided: decided.length, rows: decided };
    });
  }

  // ── application ────────────────────────────────────────────────────────────

  /**
   * Apply approved decisions: write the next placement on the canonical spine.
   *
   * The learner's history is appended to, never rewritten — `appendPlacement`
   * closes the open placement and opens a new one with `PROMOTION` or `REPEAT`
   * as the reason. A graduation writes no new placement; it completes the
   * enrollment, which is what "no seat next year" actually means.
   */
  async apply(dto: ApplyPromotionDto) {
    const decisions = await this.db.promotionDecision.findMany({
      where: {
        resultSetId: dto.resultSetId,
        status: 'approved',
        ...(dto.decisionIds?.length ? { id: { in: dto.decisionIds } } : {}),
      },
    });
    if (!decisions.length) throw new BadRequestException('No approved decisions are waiting to be applied');

    const applied: Array<{ id: string; studentProfileId: string; placementId: string | null; outcome: string }> = [];
    const skipped: Array<{ id: string; studentProfileId: string; reason: string }> = [];

    // One learner per transaction: one blocked placement must not roll back the
    // whole year group.
    for (const d of decisions) {
      try {
        const out = await this.db.$transaction(async (tx: any) => this.applyOne(tx, d, dto));
        applied.push(out);
      } catch (err: unknown) {
        skipped.push({
          id: d.id,
          studentProfileId: d.studentProfileId,
          reason: err instanceof Error ? err.message : 'could not be applied',
        });
      }
    }

    this.events.publish(EVENTS.SchoolPromotionApplied, {
      organizationId: this.org, resultSetId: dto.resultSetId, applied: applied.length, skipped: skipped.length,
    });
    return { resultSetId: dto.resultSetId, applied: applied.length, skipped, rows: applied };
  }

  private async applyOne(tx: any, d: any, dto: ApplyPromotionDto) {
    const fresh = await tx.promotionDecision.findFirst({ where: { id: d.id } });
    if (!fresh || fresh.status !== 'approved') throw new BadRequestException('This decision is no longer approved');

    const outcome = fresh.decision ?? fresh.recommendation;
    const now = dto.effectiveFrom ? new Date(dto.effectiveFrom) : new Date();

    // The learner's canonical enrollment for the year the results belong to.
    const enrollment = await tx.studentEnrollment.findFirst({
      where: { studentProfileId: fresh.studentProfileId, status: { in: ['ACTIVE', 'SUSPENDED'] } },
      orderBy: { admissionDate: 'desc' },
      include: { placements: { where: { effectiveTo: null }, orderBy: { effectiveFrom: 'desc' }, take: 1 } },
    });
    if (!enrollment) {
      throw new BadRequestException('This learner has no active enrollment on the canonical spine');
    }

    let placementId: string | null = null;
    if (outcome === 'promote' || outcome === 'repeat') {
      if (!dto.toTermId) throw new BadRequestException('Applying a promotion needs the term the learners move into');
      const result = await this.placements.appendPlacement(
        tx,
        enrollment,
        {
          termId: dto.toTermId,
          classId: fresh.toClassId ?? undefined,
          sectionId: fresh.toSectionId ?? undefined,
          streamId: fresh.toStreamId ?? undefined,
          effectiveFrom: now.toISOString(),
          movementReason: outcome === 'promote' ? 'PROMOTION' : 'REPEAT',
          notes: fresh.reason ?? `Applied from result set ${fresh.resultSetId}`,
        } as any,
        { closeReason: outcome === 'promote' ? 'PROMOTION' : 'REPEAT', fallbackTermId: dto.toTermId },
      );
      placementId = result.placement.id;
    } else if (outcome === 'graduate') {
      await tx.studentEnrollment.updateMany({
        where: { id: enrollment.id },
        data: { status: 'COMPLETED', completionDate: now },
      });
      const open = enrollment.placements?.[0];
      if (open) {
        await this.placements.closeOpen(tx, enrollment.id, now, 'COMPLETION');
        await this.placements.syncProjection(tx, fresh.studentProfileId);
      }
    } else {
      throw new BadRequestException(`'${outcome}' is a review outcome, not something that can be applied. Decide promote, repeat or graduate first.`);
    }

    await tx.promotionDecision.updateMany({
      where: { id: fresh.id },
      data: { status: 'applied', appliedAt: now, appliedById: this.tenant.userId ?? null, enrollmentPlacementId: placementId },
    });
    await this.audit.recordInTx(tx, {
      entity: 'PromotionDecision', entityId: fresh.id, action: 'post',
      newValues: { action: 'apply', outcome, toTermId: dto.toTermId ?? null, placementId },
    });
    return { id: fresh.id, studentProfileId: fresh.studentProfileId, placementId, outcome };
  }

  // ── reads ──────────────────────────────────────────────────────────────────

  async board(resultSetId: string) {
    const rs = await this.db.resultSet.findFirst({ where: { id: resultSetId } });
    if (!rs) throw new NotFoundException(`ResultSet ${resultSetId} not found`);
    const rows = await this.db.promotionDecision.findMany({
      where: { resultSetId },
      orderBy: [{ status: 'asc' }, { createdAt: 'asc' }],
    });
    const ids = [...new Set(rows.map((r: any) => r.studentProfileId))] as string[];
    const [students, classes, sections, streams] = await Promise.all([
      ids.length
        ? this.db.studentProfile.findMany({
            where: { id: { in: ids } },
            select: { id: true, admissionNo: true, partner: { select: { name: true } } },
          })
        : [],
      this.db.schoolClass.findMany({ where: { deletedAt: null }, select: { id: true, name: true, gradeLevelId: true, gradeLevel: { select: { order: true, name: true } } } }),
      this.db.section.findMany({ where: { deletedAt: null }, select: { id: true, classId: true, name: true } }),
      this.db.stream.findMany({ where: { deletedAt: null }, select: { id: true, classId: true, sectionId: true, name: true } }),
    ]);
    const byId = new Map<string, any>((students as any[]).map((s: any) => [s.id, s]));
    const classById = new Map<string, any>((classes as any[]).map((c: any) => [c.id, c]));

    const counts: Record<string, number> = {};
    for (const r of rows as any[]) counts[r.status] = (counts[r.status] ?? 0) + 1;
    return {
      resultSet: { id: rs.id, termId: rs.termId, revision: rs.revision, status: rs.status, scopeId: rs.scopeId },
      counts,
      classes: (classes as any[])
        .map((c: any) => ({ id: c.id, name: c.name, gradeLevelId: c.gradeLevelId, order: c.gradeLevel?.order ?? null }))
        .sort((a: any, b: any) => (a.order ?? 0) - (b.order ?? 0)),
      // The subdivisions of each class, so a decision names the exact grouping
      // rather than leaving the placement to guess between two sections.
      sections: (sections as any[]).map((s: any) => ({ id: s.id, classId: s.classId, name: s.name })),
      streams: (streams as any[]).map((s: any) => ({ id: s.id, classId: s.classId, sectionId: s.sectionId, name: s.name })),
      rows: rows.map((r: any) => ({
        ...r,
        studentName: byId.get(r.studentProfileId)?.partner?.name ?? null,
        admissionNo: byId.get(r.studentProfileId)?.admissionNo ?? null,
        fromClassName: r.fromClassId ? classById.get(r.fromClassId)?.name ?? null : null,
        toClassName: r.toClassId ? classById.get(r.toClassId)?.name ?? null : null,
        toSectionName: r.toSectionId ? (sections as any[]).find((s: any) => s.id === r.toSectionId)?.name ?? null : null,
      })),
    };
  }
}
