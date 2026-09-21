import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { EventBus } from '../../../kernel/events/event-bus';
import { BillingService } from './billing.service';
import { FinanceControlsService } from './finance-controls.service';
import { PlacementLookupService } from '../enrollment/placement-lookup.service';

/**
 * Phase 1.5 — billing as a resumable, auditable job (P1-10).
 *
 * `start` creates a BillingRun plus one BillingRunItem per active student, then
 * `process` walks the pending items, billing each in its own atomic transaction
 * via BillingService.billSingleStudent. A failure records the item and moves on
 * — the run tolerates partial failure (1,000 POSTED / 1 FAILED / 999 PENDING)
 * and can be resumed by calling `process` again (posted/skipped items are not
 * re-touched).
 *
 * The synchronous BillingController path stays for small schools; this is the
 * path a 2,000-student school uses so the work never rides an HTTP request.
 */
@Injectable()
export class BillingRunService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly events: EventBus,
    private readonly billing: BillingService,
    private readonly controls: FinanceControlsService,
    private readonly placements: PlacementLookupService,
  ) {}

  /** Create the run + one pending item per targeted active student. */
  async start(termId: string, classId?: string) {
    const organizationId = this.tenant.organizationId;
    await this.controls.assertTermOpen(termId);
    const where: any = { organizationId, status: 'active' };
    // Placement history rather than the StudentProfile projection (ADR-027).
    // Compat: a learner not yet backfilled still matches on their projection.
    if (classId) Object.assign(where, this.placements.studentWhere({ classIds: [classId] }));
    const students = await this.prisma.client.studentProfile.findMany({ where, select: { id: true } });
    if (students.length === 0) throw new BadRequestException('No active students found for billing');

    const run = await this.prisma.client.billingRun.create({
      data: {
        organizationId,
        termId,
        classId: classId ?? null,
        status: 'queued',
        totalStudents: students.length,
        startedById: this.tenant.userId ?? null,
      },
    });
    // Bulk-create items. skipDuplicates keeps `start` idempotent if re-invoked.
    await this.prisma.client.billingRunItem.createMany({
      data: students.map((s) => ({
        organizationId,
        billingRunId: run.id,
        studentProfileId: s.id,
        status: 'pending',
      })),
      skipDuplicates: true,
    });
    return run;
  }

  /**
   * Process pending items for a run. Each item is billed atomically; the item
   * row records the outcome so the run is resumable and auditable. `limit`
   * bounds one processing pass (a scheduler can call repeatedly).
   */
  async process(runId: string, limit = 500) {
    const organizationId = this.tenant.organizationId;
    const run = await this.prisma.client.billingRun.findFirst({ where: { id: runId, organizationId } });
    if (!run) throw new NotFoundException(`BillingRun ${runId} not found`);

    await this.prisma.client.billingRun.update({
      where: { id: run.id },
      data: { status: 'running', startedAt: run.startedAt ?? new Date() },
    });

    const items = await this.prisma.client.billingRunItem.findMany({
      where: { organizationId, billingRunId: run.id, status: { in: ['pending', 'failed'] } },
      take: limit,
    });

    let posted = 0, failed = 0, skipped = 0;
    for (const item of items) {
      await this.prisma.client.billingRunItem.update({
        where: { id: item.id },
        data: { status: 'processing' },
      });
      try {
        const res = await this.billing.billSingleStudent(item.studentProfileId, run.termId);
        if (res.status === 'posted') posted++;
        else skipped++;
        await this.prisma.client.billingRunItem.update({
          where: { id: item.id },
          data: {
            status: res.status,
            documentId: res.documentId ?? null,
            schoolFeeInvoiceId: res.schoolFeeInvoiceId ?? null,
            amount: res.amount ? Number(res.amount) : null,
            error: null,
            processedAt: new Date(),
          },
        });
      } catch (err: any) {
        failed++;
        await this.prisma.client.billingRunItem.update({
          where: { id: item.id },
          data: { status: 'failed', error: err?.message ?? String(err), retryCount: { increment: 1 }, processedAt: new Date() },
        });
      }
    }

    // Recompute run tallies from the item rows (authoritative, resumable).
    const [postedTotal, failedTotal, skippedTotal, pendingTotal] = await Promise.all([
      this.prisma.client.billingRunItem.count({ where: { organizationId, billingRunId: run.id, status: 'posted' } }),
      this.prisma.client.billingRunItem.count({ where: { organizationId, billingRunId: run.id, status: 'failed' } }),
      this.prisma.client.billingRunItem.count({ where: { organizationId, billingRunId: run.id, status: 'skipped' } }),
      this.prisma.client.billingRunItem.count({ where: { organizationId, billingRunId: run.id, status: { in: ['pending', 'processing'] } } }),
    ]);
    const status = pendingTotal > 0 ? 'running' : failedTotal > 0 ? 'completed_with_failures' : 'completed';
    const updated = await this.prisma.client.billingRun.update({
      where: { id: run.id },
      data: {
        status,
        postedCount: postedTotal,
        failedCount: failedTotal,
        skippedCount: skippedTotal,
        completedAt: pendingTotal > 0 ? null : new Date(),
      },
    });

    if (pendingTotal === 0) {
      this.events.publish('school.fee.billing.completed', {
        organizationId,
        billingRunId: run.id,
        postedCount: postedTotal,
        failedCount: failedTotal,
      });
    }

    return { run: updated, processed: items.length, posted, failed, skipped, pending: pendingTotal };
  }

  list() {
    const organizationId = this.tenant.organizationId;
    return this.prisma.client.billingRun.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  async get(runId: string) {
    const organizationId = this.tenant.organizationId;
    const run = await this.prisma.client.billingRun.findFirst({ where: { id: runId, organizationId } });
    if (!run) throw new NotFoundException(`BillingRun ${runId} not found`);
    const items = await this.prisma.client.billingRunItem.findMany({
      where: { organizationId, billingRunId: runId },
      orderBy: { createdAt: 'asc' },
      take: 2000,
    });
    return { run, items };
  }
}
