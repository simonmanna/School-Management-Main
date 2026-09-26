import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PERMISSIONS } from '@erp/shared';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { AuditService } from '../../../kernel/audit/audit.service';
import { PaymentAllocationReversalService } from './allocation-reversal.service';
import { AdvancedFinanceService } from './advanced.service';

/** ApprovalRequest.entityType for a fee correction awaiting its second person. */
export const FEE_CORRECTION_ENTITY = 'school_fee_correction';

export type FeeCorrection =
  | { kind: 'reverse_allocation'; allocationId: string; reason: string }
  | { kind: 'reallocate'; paymentId: string; allocations: Array<{ documentId: string; amount: number }>; reason: string }
  | { kind: 'reverse_payment'; paymentId: string; reason: string }
  | {
      kind: 'credit';
      studentProfileId: string;
      amount: number;
      source: 'overpayment' | 'approved_adjustment' | 'opening_balance';
      sourcePaymentId?: string;
      sourceDocumentId?: string;
      expiresAt?: string;
      reason?: string;
    };

/**
 * Who may ASK for a correction and who may RELEASE it. A credit mints value, so
 * its checker is the credit approver; every other correction changes what a
 * family owes, so its checker is the refund approver (the permission these
 * routes were gated on before).
 */
function makerOf(kind: FeeCorrection['kind']): string {
  return kind === 'credit' ? PERMISSIONS.school.manageFees : PERMISSIONS.school.refundFees;
}
function checkerOf(kind: FeeCorrection['kind']): string {
  return kind === 'credit' ? PERMISSIONS.school.approveCredits : PERMISSIONS.school.approveRefunds;
}

/**
 * Fee corrections as maker-checker (re-audit #3, owner decision D4, 2026-09-25).
 *
 * Reversing an allocation or a payment, reallocating a receipt and minting a
 * manual fee credit each change what a family owes. They were gated on a single
 * approver permission, so a Head Teacher could do any of them alone — a manual
 * credit was a waiver with no second person.
 *
 * Now the Bursar requests and a different person releases, exactly as refunds
 * work (RefundRequestService). A caller who holds BOTH permissions — an
 * Administrator — still acts in one step; that is recorded as an override in
 * the audit trail so it is visible afterwards.
 */
@Injectable()
export class FinanceCorrectionRequestService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly audit: AuditService,
    private readonly reversals: PaymentAllocationReversalService,
    private readonly finance: AdvancedFinanceService,
  ) {}

  /** Do it now when the caller holds both sides; otherwise file it for approval. */
  async submit(correction: FeeCorrection) {
    this.assertWellFormed(correction);
    const perms = this.tenant.permissions ?? [];
    const maker = perms.includes(makerOf(correction.kind));
    const checker = perms.includes(checkerOf(correction.kind));
    if (!maker && !checker) {
      throw new ForbiddenException('You cannot request this fee correction.');
    }

    if (maker && checker) {
      const res = await this.prisma.client.$transaction(async (tx: any) => {
        const out = await this.execute(tx, correction);
        await this.audit.recordInTx(tx, {
          entity: 'FeeCorrection',
          entityId: randomUUID(),
          action: 'approve', // single-step: the caller holds both sides (override)
          newValues: { ...correction, singleStep: true, reason: 'caller holds both request and approval permissions' },
        });
        return out;
      });
      return { status: 'applied' as const, ...res };
    }

    const req = await this.prisma.client.$transaction(async (tx: any) => {
      const created = await tx.approvalRequest.create({
        data: {
          organizationId: this.tenant.organizationId,
          entityType: FEE_CORRECTION_ENTITY,
          entityId: randomUUID(),
          snapshot: { kind: correction.kind, amount: (correction as any).amount ?? null, correction } as any,
          currentStep: 1,
          requiredCount: 1,
          createdById: this.tenant.userId ?? null,
        },
      });
      await this.audit.recordInTx(tx, {
        entity: 'ApprovalRequest',
        entityId: created.id,
        action: 'create',
        newValues: { entityType: FEE_CORRECTION_ENTITY, ...correction },
      });
      return created;
    });
    return { status: 'pending_approval' as const, requestId: req.id };
  }

  async list(status: 'pending' | 'approved' | 'rejected' = 'pending') {
    return this.prisma.client.approvalRequest.findMany({
      where: { entityType: FEE_CORRECTION_ENTITY, status },
      include: { decisions: true },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }

  /** Approve = apply, in ONE transaction with claiming the request. */
  async approve(requestId: string, comment?: string) {
    const req = await this.pending(requestId);
    const correction = (req.snapshot as any)?.correction as FeeCorrection | undefined;
    if (!correction?.kind) throw new BadRequestException('This correction request is malformed.');
    this.assertChecker(correction.kind);

    const res = await this.prisma.client.$transaction(async (tx: any) => {
      await this.claim(tx, req.id, 'approved');
      const out = await this.execute(tx, correction);
      await this.record(tx, req.id, 'approved', comment);
      return out;
    });
    return { status: 'applied' as const, requestId: req.id, ...res };
  }

  async reject(requestId: string, reason: string) {
    if (!reason?.trim()) throw new BadRequestException('Say why the correction is refused — the bursar sees it.');
    const req = await this.pending(requestId);
    const correction = (req.snapshot as any)?.correction as FeeCorrection | undefined;
    if (correction?.kind) this.assertChecker(correction.kind);
    await this.prisma.client.$transaction(async (tx: any) => {
      await this.claim(tx, req.id, 'rejected');
      await this.record(tx, req.id, 'rejected', reason.trim());
    });
    return { status: 'rejected' as const, requestId: req.id };
  }

  private async execute(tx: any, c: FeeCorrection): Promise<Record<string, unknown>> {
    switch (c.kind) {
      case 'reverse_allocation':
        return { result: await this.reversals.reverseAllocation(c.allocationId, c.reason, tx) };
      case 'reallocate':
        return { result: await this.reversals.reallocate(c.paymentId, c.allocations, c.reason, tx) };
      case 'reverse_payment':
        return { result: await this.reversals.reversePayment(c.paymentId, c.reason, tx) };
      case 'credit':
        return {
          result: await this.finance.createCreditFromRequest(
            {
              studentProfileId: c.studentProfileId,
              amount: c.amount,
              source: c.source,
              sourcePaymentId: c.sourcePaymentId,
              sourceDocumentId: c.sourceDocumentId,
              expiresAt: c.expiresAt,
            },
            tx,
          ),
        };
    }
  }

  private assertWellFormed(c: FeeCorrection) {
    if (c.kind !== 'credit' && !c.reason?.trim()) {
      throw new BadRequestException('A fee correction must carry a reason — it is the audit trail.');
    }
  }

  private assertChecker(kind: FeeCorrection['kind']) {
    if (!(this.tenant.permissions ?? []).includes(checkerOf(kind))) {
      throw new ForbiddenException('You cannot decide this fee correction.');
    }
  }

  private async pending(requestId: string) {
    const req = await this.prisma.client.approvalRequest.findFirst({
      where: { id: requestId, entityType: FEE_CORRECTION_ENTITY },
    });
    if (!req) throw new NotFoundException(`Correction request ${requestId} not found`);
    if (req.status !== 'pending') throw new ConflictException(`This correction request was already ${req.status}.`);
    if (req.createdById && req.createdById === this.tenant.userId) {
      throw new ForbiddenException('You cannot approve or reject a correction you requested.');
    }
    return req;
  }

  private async claim(tx: any, requestId: string, status: 'approved' | 'rejected') {
    const cas = await tx.approvalRequest.updateMany({
      where: { id: requestId, status: 'pending' },
      data: { status, decidedAt: new Date() },
    });
    if (cas.count === 0) throw new ConflictException('This correction request was decided by someone else a moment ago.');
  }

  private async record(tx: any, requestId: string, status: 'approved' | 'rejected', comment?: string) {
    await tx.approvalDecision.create({
      data: {
        organizationId: this.tenant.organizationId,
        requestId,
        approverId: this.tenant.userId!,
        stepOrder: 1,
        status,
        comment: comment ?? null,
      },
    });
    await this.audit.recordInTx(tx, {
      entity: 'ApprovalRequest',
      entityId: requestId,
      action: status === 'approved' ? 'approve' : 'reject',
      newValues: { status, comment: comment ?? null },
    });
  }
}
