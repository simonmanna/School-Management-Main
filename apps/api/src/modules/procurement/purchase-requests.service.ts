import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../kernel/tenancy/tenant-context.service';
import { SequenceService } from '../../kernel/sequence/sequence.service';
import { EventBus } from '../../kernel/events/event-bus';
import { AuditService } from '../../kernel/audit/audit.service';

export interface CreatePRInput {
  partnerId?: string;
  branchId?: string;
  description?: string;
  neededBy?: string;
  lines: Array<{
    productId?: string;
    description: string;
    quantity: number;
    unitOfMeasureId?: string;
    estimatedUnitPrice?: number;
    notes?: string;
  }>;
}

@Injectable()
export class PurchaseRequestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly sequence: SequenceService,
    private readonly events: EventBus,
    private readonly audit: AuditService,
  ) {}

  async create(input: CreatePRInput) {
    const orgId = this.tenant.organizationId;
    if (!input.lines?.length) throw new BadRequestException('At least one line is required');
    const year = new Date().getUTCFullYear();
    const requestNumber = await this.sequence.next(`pr:${year}`, { prefix: `PR-${year}-`, padding: 5 });

    const request = await this.prisma.client.purchaseRequest.create({
      data: {
        organizationId: orgId,
        requestNumber,
        requestedById: this.tenant.userId ?? null,
        partnerId: input.partnerId,
        branchId: input.branchId,
        description: input.description,
        neededBy: input.neededBy ? new Date(input.neededBy) : null,
        status: 'draft',
        createdBy: this.tenant.userId ?? null,
        lines: {
          create: input.lines.map((ln, idx) => ({
            organizationId: orgId,
            productId: ln.productId ?? null,
            description: ln.description,
            quantity: ln.quantity,
            unitOfMeasureId: ln.unitOfMeasureId ?? null,
            estimatedUnitPrice: ln.estimatedUnitPrice ?? null,
            notes: ln.notes ?? null,
            lineNumber: idx + 1,
          })),
        },
      },
      include: { lines: true },
    });
    await this.audit.record({
      entity: 'PurchaseRequest',
      entityId: request.id,
      action: 'create',
      newValues: { requestNumber },
    });
    this.events.publish('purchase_request.created' as any, {
      organizationId: orgId,
      requestId: request.id,
      requestNumber,
    });
    return request;
  }

  list(status?: string) {
    const where: any = { organizationId: this.tenant.organizationId };
    if (status) where.status = status;
    return this.prisma.client.purchaseRequest.findMany({
      where,
      include: { lines: true, _count: { select: { orders: true } } },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }

  findOne(id: string) {
    return this.prisma.client.purchaseRequest.findFirst({
      where: { id, organizationId: this.tenant.organizationId },
      include: { lines: true, orders: true },
    });
  }

  async submit(id: string) {
    const pr = await this.requireOwned(id);
    if (pr.status !== 'draft') throw new BadRequestException(`Cannot submit PR in status ${pr.status}`);
    const updated = await this.prisma.client.purchaseRequest.update({
      where: { id },
      data: { status: 'submitted' },
    });
    await this.audit.record({
      entity: 'PurchaseRequest',
      entityId: id,
      action: 'update',
      newValues: { status: 'submitted' },
    });
    this.events.publish('purchase_request.submitted' as any, {
      organizationId: this.tenant.organizationId,
      requestId: id,
    });
    return updated;
  }

  async approve(id: string) {
    const pr = await this.requireOwned(id);
    if (pr.status !== 'submitted') throw new BadRequestException(`Cannot approve PR in status ${pr.status}`);
    const updated = await this.prisma.client.purchaseRequest.update({
      where: { id },
      data: { status: 'approved', approvedAt: new Date(), approvedById: this.tenant.userId ?? null },
    });
    await this.audit.record({
      entity: 'PurchaseRequest',
      entityId: id,
      action: 'approve',
      newValues: { status: 'approved' },
    });
    this.events.publish('purchase_request.approved' as any, {
      organizationId: this.tenant.organizationId,
      requestId: id,
      approverId: this.tenant.userId,
    });
    return updated;
  }

  async reject(id: string, reason: string) {
    const pr = await this.requireOwned(id);
    if (!['submitted', 'draft'].includes(pr.status)) {
      throw new BadRequestException(`Cannot reject PR in status ${pr.status}`);
    }
    const updated = await this.prisma.client.purchaseRequest.update({
      where: { id },
      data: { status: 'rejected', rejectedReason: reason },
    });
    this.events.publish('purchase_request.rejected' as any, {
      organizationId: this.tenant.organizationId,
      requestId: id,
      reason,
    });
    return updated;
  }

  async remove(id: string) {
    const pr = await this.requireOwned(id);
    if (pr.status !== 'draft') throw new BadRequestException('Only drafts can be deleted');
    await this.prisma.client.purchaseRequest.delete({ where: { id } });
    return { ok: true };
  }

  /** Convert an approved PR to one or more POs (helper for the PO service). */
  async consumeForOrder(requestId: string, tx: any): Promise<{ id: string; lines: any[] } | null> {
    const pr = await tx.purchaseRequest.findFirst({
      where: { id: requestId, organizationId: this.tenant.organizationId },
      include: { lines: true },
    });
    if (!pr) return null;
    return { id: pr.id, lines: pr.lines };
  }

  /** Mark a PR as converted after a child PO is created. */
  async markConverted(requestId: string, tx: any): Promise<void> {
    await tx.purchaseRequest.update({
      where: { id: requestId },
      data: { status: 'converted' },
    });
  }

  private async requireOwned(id: string) {
    const pr = await this.prisma.client.purchaseRequest.findFirst({
      where: { id, organizationId: this.tenant.organizationId },
    });
    if (!pr) throw new NotFoundException('Purchase request not found');
    return pr;
  }
}
