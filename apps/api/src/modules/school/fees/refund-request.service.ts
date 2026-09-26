import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PERMISSIONS } from '@erp/shared';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { AuditService } from '../../../kernel/audit/audit.service';
import { SchoolPaymentService } from './billing.service';
import type { RefundFeeDto } from './dto.types';

/** ApprovalRequest.entityType for a fee refund awaiting its second person. */
export const FEE_REFUND_ENTITY = 'school_fee_refund';

/**
 * Fee refunds as maker-checker (E2E audit P1, handover Wave 2.3).
 *
 * `POST /school/payments/refund` used to require BOTH `school:fees:refund` and
 * `school:fees:refund:approve`. The permission guard ANDs its list, and by
 * design (SoD) no preset holds both — so only an Administrator could ever
 * refund, and when one did, nobody checked them.
 *
 * Now the Bursar REQUESTS (refund permission) and a different person APPROVES
 * (approve permission), which is the moment the money goes out. A caller who
 * holds both — an Administrator — still refunds in one step, as before.
 *
 * Requests are ApprovalRequest rows so they sit in the unified approval ledger
 * and audit trail. They are decided here, not on the generic approvals page:
 * approving is what pays out, so it must run the refund, and the generic
 * decide path only flips a status (ApprovalsService refuses this entity type).
 */
@Injectable()
export class RefundRequestService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly audit: AuditService,
    private readonly payments: SchoolPaymentService,
  ) {}

  /** Refund now when the caller may approve it; otherwise file it for approval. */
  async submit(dto: RefundFeeDto) {
    const perms = this.tenant.permissions ?? [];
    if (perms.includes(PERMISSIONS.school.approveRefunds)) {
      const res = await this.payments.refundFee(dto);
      return { status: 'refunded' as const, ...res };
    }

    const student = await this.prisma.client.studentProfile.findFirst({
      where: { id: dto.studentProfileId },
      include: { partner: { select: { name: true } } },
    });
    if (!student) throw new NotFoundException(`Student ${dto.studentProfileId} not found`);

    const req = await this.prisma.client.$transaction(async (tx: any) => {
      const created = await tx.approvalRequest.create({
        data: {
          organizationId: this.tenant.organizationId,
          entityType: FEE_REFUND_ENTITY,
          entityId: randomUUID(),
          snapshot: {
            amount: dto.amount,
            studentName: student.partner?.name ?? null,
            admissionNo: student.admissionNo,
            dto: { ...dto },
          } as any,
          currentStep: 1,
          requiredCount: 1,
          createdById: this.tenant.userId ?? null,
        },
      });
      await this.audit.recordInTx(tx, {
        entity: 'ApprovalRequest',
        entityId: created.id,
        action: 'create',
        newValues: { entityType: FEE_REFUND_ENTITY, amount: dto.amount, studentProfileId: dto.studentProfileId },
      });
      return created;
    });
    return { status: 'pending_approval' as const, requestId: req.id };
  }

  async list(status: 'pending' | 'approved' | 'rejected' = 'pending') {
    return this.prisma.client.approvalRequest.findMany({
      where: { entityType: FEE_REFUND_ENTITY, status },
      include: { decisions: true },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }

  /**
   * Approve = pay out, in ONE transaction with claiming the request. The claim
   * (compare-and-set pending → approved) comes first: a concurrent approve or
   * reject that loses it pays nothing. Paying first and closing after let a
   * reject win the close while the money had already gone (re-audit #6).
   */
  async approve(requestId: string, comment?: string) {
    const req = await this.pending(requestId);
    const dto = (req.snapshot as any)?.dto as RefundFeeDto;
    if (!dto?.studentProfileId) throw new BadRequestException('This refund request is malformed.');

    const res = await this.prisma.client.$transaction(async (tx: any) => {
      await this.claim(tx, req.id, 'approved');
      const paid = await this.payments.refundFee(
        { ...dto, externalReference: dto.externalReference ?? `refund-request:${req.id}` },
        { tx, approvedRequest: true },
      );
      await this.record(tx, req.id, 'approved', comment, { paymentId: (paid as any)?.payment?.id ?? null });
      return paid;
    });
    return { status: 'refunded' as const, requestId: req.id, ...res };
  }

  async reject(requestId: string, reason: string) {
    if (!reason?.trim()) throw new BadRequestException('Say why the refund is refused — the bursar sees it.');
    const req = await this.pending(requestId);
    await this.prisma.client.$transaction(async (tx: any) => {
      await this.claim(tx, req.id, 'rejected');
      await this.record(tx, req.id, 'rejected', reason.trim());
    });
    return { status: 'rejected' as const, requestId: req.id };
  }

  private async pending(requestId: string) {
    const req = await this.prisma.client.approvalRequest.findFirst({
      where: { id: requestId, entityType: FEE_REFUND_ENTITY },
    });
    if (!req) throw new NotFoundException(`Refund request ${requestId} not found`);
    if (req.status !== 'pending') throw new ConflictException(`This refund request was already ${req.status}.`);
    // The person who asked for the money cannot be the one who releases it.
    if (req.createdById && req.createdById === this.tenant.userId) {
      throw new ForbiddenException('You cannot approve or reject a refund you requested.');
    }
    return req;
  }

  /** Compare-and-set pending → decided. Losing it means someone else decided first. */
  private async claim(tx: any, requestId: string, status: 'approved' | 'rejected') {
    const cas = await tx.approvalRequest.updateMany({
      where: { id: requestId, status: 'pending' },
      data: { status, decidedAt: new Date() },
    });
    if (cas.count === 0) throw new ConflictException('This refund request was decided by someone else a moment ago.');
  }

  private async record(tx: any, requestId: string, status: 'approved' | 'rejected', comment?: string, extra: Record<string, unknown> = {}) {
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
      newValues: { status, comment: comment ?? null, ...extra },
    });
  }
}
