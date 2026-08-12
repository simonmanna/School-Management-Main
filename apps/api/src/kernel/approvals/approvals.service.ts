import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from '../tenancy/tenant-context.service';
import { EventBus } from '../events/event-bus';
import { AuditService } from '../audit/audit.service';

/** Minimal shapes the step engine needs (avoids Prisma payload-type wrangling). */
type StepRow = {
  stepOrder: number;
  requiredCount: number;
  approverPermissions: string[];
  minAmount: unknown;
  maxAmount: unknown;
};
type WorkflowRow = {
  id: string;
  minAmount: unknown;
  enforceDistinctApprovers: boolean;
  steps: StepRow[];
};

/**
 * F.5 / F.5b — Generic multi-step approval runner.
 *
 * Decoupled from any specific document type. An {@link ApprovalWorkflow} for an
 * entityType defines an ordered list of {@link ApprovalStep}s. A request must
 * clear **every step whose `[minAmount, maxAmount)` band contains the document
 * amount**, in `stepOrder` order — steps whose band excludes the amount are
 * skipped. Each step needs `requiredCount` distinct approvers holding any of the
 * step's `approverPermissions`. This unifies tiered routing (one step per band)
 * and sequential chains (several bandless steps).
 *
 * No workflow for an entityType ⇒ auto-approve (the action proceeds). Consumers
 * gate via {@link checkOrRequestApproval} (block-and-retry): the request stays
 * `pending` until the last applicable step clears, then flips to `approved` and
 * the caller re-runs its post.
 */
@Injectable()
export class ApprovalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly events: EventBus,
    private readonly audit: AuditService,
  ) {}

  // ---------------------------------------------------------------------------
  // Workflow / step resolution
  // ---------------------------------------------------------------------------

  /** Most-specific active workflow for (entityType, amount), or null. */
  private async resolveWorkflow(entityType: string, amount: number): Promise<WorkflowRow | null> {
    const wfs = await this.prisma.client.approvalWorkflow.findMany({
      where: { organizationId: this.tenant.organizationId, entityType, isActive: true },
      include: { steps: { orderBy: { stepOrder: 'asc' } } },
      // Highest threshold (most specific) first; a null-threshold catch-all sorts
      // LAST so a specific band that the amount clears wins over "any amount".
      orderBy: { minAmount: { sort: 'desc', nulls: 'last' } },
    });
    const match = wfs.find((w) => w.minAmount == null || amount >= Number(w.minAmount));
    return (match as unknown as WorkflowRow) ?? null;
  }

  /** Steps whose amount band contains `amount`, in stepOrder order. */
  private applicableSteps(wf: WorkflowRow, amount: number): StepRow[] {
    return wf.steps.filter(
      (s) =>
        (s.minAmount == null || amount >= Number(s.minAmount)) &&
        (s.maxAmount == null || amount < Number(s.maxAmount)),
    );
  }

  private amountOf(snapshot: Record<string, unknown> | null | undefined): number {
    return Number((snapshot?.amount as string | number | undefined) ?? 0);
  }

  // ---------------------------------------------------------------------------
  // Public API (signatures stable — do not change; 15+ call sites depend on it)
  // ---------------------------------------------------------------------------

  /** Create a request. Resolves the matching workflow + first applicable step. */
  async requestApproval(params: {
    entityType: string;
    entityId: string;
    snapshot: Record<string, unknown>;
    policyId?: string;
  }) {
    const orgId = this.tenant.organizationId;
    const amount = this.amountOf(params.snapshot);
    const wf = await this.resolveWorkflow(params.entityType, amount);
    if (!wf) return null; // no workflow → no approval required. Caller proceeds.
    const steps = this.applicableSteps(wf, amount);
    if (steps.length === 0) return null; // workflow matched but no step's band applies.
    const first = steps[0];
    const req = await this.prisma.client.approvalRequest.create({
      data: {
        organizationId: orgId,
        entityType: params.entityType,
        entityId: params.entityId,
        snapshot: params.snapshot as any,
        workflowId: wf.id,
        currentStep: first.stepOrder,
        requiredCount: first.requiredCount,
        createdById: this.tenant.userId ?? null,
      },
    });
    await this.audit.record({
      entity: 'ApprovalRequest',
      entityId: req.id,
      action: 'create',
      newValues: { entityType: req.entityType, entityId: req.entityId, stepOrder: first.stepOrder },
    });
    this.events.publish('approval.requested' as any, {
      organizationId: orgId,
      requestId: req.id,
      entityType: req.entityType,
      entityId: req.entityId,
      stepOrder: first.stepOrder,
    });
    return req;
  }

  /** Approver decides the request's current step. Idempotent per (request, step, approver). */
  async decide(params: { requestId: string; status: 'approved' | 'rejected'; comment?: string }) {
    const userId = this.tenant.userId;
    if (!userId) throw new BadRequestException('Not authenticated');
    const orgId = this.tenant.organizationId;
    return this.prisma.client.$transaction(async (tx) => {
      const req = await tx.approvalRequest.findFirst({
        where: { id: params.requestId, organizationId: orgId },
        include: {
          workflow: { include: { steps: { orderBy: { stepOrder: 'asc' } } } },
          policy: true,
          decisions: true,
        },
      });
      if (!req) throw new NotFoundException('Approval request not found');
      if (req.status !== 'pending') throw new BadRequestException('Already resolved');

      const wf = (req.workflow as unknown as WorkflowRow | null) ?? null;
      const amount = this.amountOf(req.snapshot as any);
      // Active step config: from the workflow if present, else a single implicit
      // step from the request/policy (legacy pre-F.5b requests).
      const step: Pick<StepRow, 'approverPermissions' | 'requiredCount'> = wf
        ? wf.steps.find((s) => s.stepOrder === req.currentStep) ?? {
            approverPermissions: [],
            requiredCount: req.requiredCount,
          }
        : {
            approverPermissions: req.policy?.approverPermissions ?? [],
            requiredCount: req.requiredCount,
          };

      // Permission: user must hold any of the current step's approver permissions.
      const perms = this.tenant.permissions ?? [];
      if (step.approverPermissions.length && !step.approverPermissions.some((p) => perms.includes(p))) {
        throw new BadRequestException('You are not allowed to decide on this step');
      }
      // Self-approval forbidden.
      if (req.createdById && req.createdById === userId && step.approverPermissions.length) {
        throw new BadRequestException('You cannot approve a request you created');
      }
      // Segregation of duties: block an approver who cleared an earlier step.
      if (
        wf?.enforceDistinctApprovers &&
        req.decisions.some((d) => d.approverId === userId && d.stepOrder < req.currentStep)
      ) {
        throw new BadRequestException('You already approved an earlier step (segregation of duties)');
      }
      // One decision per approver per step.
      if (req.decisions.some((d) => d.approverId === userId && d.stepOrder === req.currentStep)) {
        throw new BadRequestException('You already decided on this step');
      }

      await tx.approvalDecision.create({
        data: {
          organizationId: orgId,
          requestId: req.id,
          approverId: userId,
          stepOrder: req.currentStep,
          status: params.status,
          comment: params.comment ?? null,
        },
      });

      // Tally decisions for the current step only.
      const stepDecisions = await tx.approvalDecision.findMany({
        where: { requestId: req.id, stepOrder: req.currentStep },
      });
      const approvals = stepDecisions.filter((d) => d.status === 'approved').length;
      const rejections = stepDecisions.filter((d) => d.status === 'rejected').length;

      let nextStatus: 'pending' | 'approved' | 'rejected' | 'cancelled' = 'pending';
      let nextStep = req.currentStep;
      let nextRequired = step.requiredCount;
      let decidedAt: Date | null = null;
      let advancedTo: number | null = null;

      if (rejections > 0) {
        nextStatus = 'rejected';
        decidedAt = new Date();
      } else if (approvals >= step.requiredCount) {
        const remaining = wf
          ? this.applicableSteps(wf, amount).filter((s) => s.stepOrder > req.currentStep)
          : [];
        if (remaining.length) {
          nextStep = remaining[0].stepOrder;
          nextRequired = remaining[0].requiredCount;
          advancedTo = nextStep;
        } else {
          nextStatus = 'approved';
          decidedAt = new Date();
        }
      }

      const updated = await tx.approvalRequest.update({
        where: { id: req.id },
        data: {
          status: nextStatus,
          currentStep: nextStep,
          requiredCount: nextRequired,
          ...(decidedAt ? { decidedAt } : {}),
        },
      });

      if (advancedTo != null) {
        this.events.publish('approval.step_advanced' as any, {
          organizationId: orgId,
          requestId: req.id,
          entityType: req.entityType,
          entityId: req.entityId,
          stepOrder: advancedTo,
        });
      }
      if (nextStatus !== 'pending') {
        this.events.publish('approval.decided' as any, {
          organizationId: orgId,
          requestId: req.id,
          entityType: req.entityType,
          entityId: req.entityId,
          status: nextStatus,
        });
      }
      await this.audit.recordInTx(tx, {
        entity: 'ApprovalRequest',
        entityId: req.id,
        action: params.status === 'approved' ? 'approve' : 'reject',
        newValues: { status: nextStatus, stepOrder: req.currentStep, comment: params.comment ?? null },
      });
      return updated;
    });
  }

  /**
   * Check if there's a pending or approved request for (entityType, entityId).
   * Used by action gates (doc-wrapper approve, invoice cancel, expense pay…).
   *
   * Returns:
   *   { needsApproval: true, requestId }  — pending request exists (gate the action)
   *   { needsApproval: false }            — already approved, proceed
   *   null                                — no workflow, auto-approve, proceed
   */
  async checkOrRequestApproval(params: {
    entityType: string;
    entityId: string;
    snapshot: Record<string, unknown>;
  }): Promise<{ needsApproval: boolean; requestId?: string } | null> {
    const orgId = this.tenant.organizationId;
    const existing = await this.prisma.client.approvalRequest.findFirst({
      where: {
        organizationId: orgId,
        entityType: params.entityType,
        entityId: params.entityId,
        status: { in: ['pending', 'approved'] },
      },
    });
    if (existing) {
      if (existing.status === 'approved') return { needsApproval: false };
      return { needsApproval: true, requestId: existing.id };
    }
    const req = await this.requestApproval(params);
    if (req) return { needsApproval: true, requestId: req.id };
    return null; // no workflow = auto-approve
  }

  /**
   * F.5b — Record a manager override that was authorized *synchronously* (e.g. a
   * POS manager-PIN at the till). Creates an already-`approved` request + a
   * matching decision by the overriding manager so the override lands in the
   * unified approval ledger and honors centrally-configured thresholds — without
   * blocking the flow. Does not emit `approval.requested` (nothing to notify).
   */
  async recordSynchronousOverride(params: {
    entityType: string;
    entityId: string;
    approverId: string;
    snapshot: Record<string, unknown>;
    comment?: string;
  }) {
    const orgId = this.tenant.organizationId;
    const amount = this.amountOf(params.snapshot);
    const wf = await this.resolveWorkflow(params.entityType, amount);
    const steps = wf ? this.applicableSteps(wf, amount) : [];
    const lastStep = steps.length ? steps[steps.length - 1].stepOrder : 1;
    return this.prisma.client.$transaction(async (tx) => {
      const req = await tx.approvalRequest.create({
        data: {
          organizationId: orgId,
          entityType: params.entityType,
          entityId: params.entityId,
          snapshot: params.snapshot as any,
          workflowId: wf?.id ?? null,
          currentStep: lastStep,
          requiredCount: 1,
          status: 'approved',
          decidedAt: new Date(),
          createdById: this.tenant.userId ?? null,
        },
      });
      await tx.approvalDecision.create({
        data: {
          organizationId: orgId,
          requestId: req.id,
          approverId: params.approverId,
          stepOrder: lastStep,
          status: 'approved',
          comment: params.comment ?? 'Synchronous manager override',
        },
      });
      await this.audit.recordInTx(tx, {
        entity: 'ApprovalRequest',
        entityId: req.id,
        action: 'approve',
        newValues: { entityType: params.entityType, synchronous: true, approverId: params.approverId },
      });
      return req;
    });
  }

  async list(query: { status?: 'pending' | 'approved' | 'rejected' | 'cancelled'; entityType?: string }) {
    const where: any = { organizationId: this.tenant.organizationId };
    if (query.status) where.status = query.status;
    if (query.entityType) where.entityType = query.entityType;
    return this.prisma.client.approvalRequest.findMany({
      where,
      include: {
        decisions: true,
        policy: true,
        workflow: { include: { steps: { orderBy: { stepOrder: 'asc' } } } },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  findOne(id: string) {
    return this.prisma.client.approvalRequest.findFirst({
      where: { id, organizationId: this.tenant.organizationId },
      include: {
        decisions: true,
        policy: true,
        workflow: { include: { steps: { orderBy: { stepOrder: 'asc' } } } },
      },
    });
  }
}
