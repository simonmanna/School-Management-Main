import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../kernel/tenancy/tenant-context.service';
import { SequenceService } from '../../kernel/sequence/sequence.service';
import { LifecycleRegistry } from '../../kernel/lifecycle/lifecycle.registry';

/**
 * RepairDiagnosisService — technician findings (diagnosis) and the quotation
 * document (labour + parts lines) that turns a diagnosis into a billable
 * estimate. Approving a quotation moves the order to `approved`; rejecting
 * returns it to `diagnosis` for a revised quote.
 */
@Injectable()
export class RepairDiagnosisService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly seq: SequenceService,
    private readonly lifecycles: LifecycleRegistry,
  ) {}

  // ── Diagnosis ─────────────────────────────────────────────────────────────

  async createDiagnosis(orderId: string, dto: any) {
    const orgId = this.tenant.organizationId;
    const order = await this.prisma.client.repairOrder.findFirst({ where: { id: orderId, organizationId: orgId } });
    if (!order) throw new NotFoundException('Repair order not found');
    if (order.status === 'cancelled' || order.status === 'closed')
      throw new BadRequestException('Order is closed/cancelled — no new diagnosis');

    const diagnosis = await this.prisma.client.$transaction(async (tx: any) => {
      const created = await tx.repairDiagnosis.create({
        data: {
          organizationId: orgId,
          repairOrderId: orderId,
          symptoms: dto.symptoms ?? null,
          rootCause: dto.rootCause ?? null,
          faults: dto.faults ?? [],
          estimatedCost: dto.estimatedCost ?? null,
          estimatedHours: dto.estimatedHours ?? null,
          recommendedParts: dto.recommendedParts ?? [],
          riskNotes: dto.riskNotes ?? null,
          diagnosedBy: this.tenant.userId,
        },
      });
      await tx.repairOrder.update({
        where: { id: orderId },
        data: { diagnosisId: created.id, updatedBy: this.tenant.userId },
      });
      return created;
    });
    return diagnosis;
  }

  async updateDiagnosis(id: string, dto: any) {
    const orgId = this.tenant.organizationId;
    await this.ensureExists('repairDiagnosis', id, orgId);
    return this.prisma.client.repairDiagnosis.update({ where: { id }, data: dto });
  }

  // ── Quotations ────────────────────────────────────────────────────────────

  async listQuotations(query: any = {}) {
    const orgId = this.tenant.organizationId;
    const where: any = { organizationId: orgId };
    if (query.status) where.status = query.status;
    if (query.repairOrderId) where.repairOrderId = query.repairOrderId;
    return this.prisma.client.repairQuotation.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }],
      include: { lines: { orderBy: { lineNumber: 'asc' } } },
      take: Math.min(Number(query.take ?? 50), 200),
      skip: Number(query.skip ?? 0),
    });
  }

  async getQuotation(id: string) {
    const orgId = this.tenant.organizationId;
    const q = await this.prisma.client.repairQuotation.findFirst({
      where: { id, organizationId: orgId },
      include: { lines: { orderBy: { lineNumber: 'asc' } } },
    });
    if (!q) throw new NotFoundException('Quotation not found');
    return q;
  }

  async createQuotation(orderId: string, dto: any) {
    const orgId = this.tenant.organizationId;
    const order = await this.prisma.client.repairOrder.findFirst({ where: { id: orderId, organizationId: orgId } });
    if (!order) throw new NotFoundException('Repair order not found');
    const lines = await this.buildLines(orgId, dto.lines ?? []);
    const totals = this.totals(lines);
    const quotationNumber = await this.seq.next('repair_quotation', { prefix: 'QT-', padding: 6 });

    const quotation = await this.prisma.client.$transaction(async (tx: any) => {
      const created = await tx.repairQuotation.create({
        data: {
          organizationId: orgId,
          repairOrderId: orderId,
          quotationNumber,
          status: 'draft',
          revision: dto.revision ?? 1,
          ...totals,
          validUntil: dto.validUntil ? new Date(dto.validUntil) : null,
          notes: dto.notes ?? null,
          createdBy: this.tenant.userId,
          lines: {
            create: lines.map((l, idx) => ({
              organizationId: orgId,
              kind: l.kind,
              description: l.description,
              labourTypeId: l.labourTypeId ?? null,
              productId: l.productId ?? null,
              quantity: l.quantity,
              unitPrice: l.unitPrice,
              taxId: l.taxId ?? null,
              amount: l.amount,
              lineNumber: idx,
            })),
          },
        },
        include: { lines: true },
      });
      await tx.repairOrder.update({
        where: { id: orderId },
        data: { quotationId: created.id, quotedAt: new Date(), updatedBy: this.tenant.userId },
      });
      return created;
    });
    return quotation;
  }

  /** Submit a draft → pending (customer review). */
  async submitQuotation(id: string) {
    const orgId = this.tenant.organizationId;
    await this.ensureExists('repairQuotation', id, orgId);
    return this.prisma.client.repairQuotation.update({
      where: { id },
      data: { status: 'pending' },
    });
  }

  /** Approve → order moves to `approved` (billing can proceed). */
  async approveQuotation(id: string, dto: any = {}) {
    const orgId = this.tenant.organizationId;
    const q = await this.prisma.client.repairQuotation.findFirst({ where: { id, organizationId: orgId } });
    if (!q) throw new NotFoundException('Quotation not found');
    if (q.status !== 'pending' && q.status !== 'draft')
      throw new BadRequestException(`Quotation is ${q.status} — only pending/draft can be approved`);

    return this.prisma.client.$transaction(async (tx: any) => {
      const updated = await tx.repairQuotation.update({
        where: { id },
        data: {
          status: 'approved',
          approvedAt: new Date(),
          approvedBy: this.tenant.userId,
        },
      });
      const order = await tx.repairOrder.findFirst({ where: { id: q.repairOrderId, organizationId: orgId } });
      if (order && order.status === 'waiting_approval') {
        this.lifecycles.assertTransition('repair.order', order.status, 'approved', 'approve');
        await tx.repairOrder.update({
          where: { id: order.id },
          data: { status: 'approved', approvedAt: new Date(), updatedBy: this.tenant.userId },
        });
        await tx.repairStatusHistory.create({
          data: {
            organizationId: orgId,
            repairOrderId: order.id,
            fromStatus: order.status,
            toStatus: 'approved',
            action: 'approve',
            note: `Quotation ${q.quotationNumber} approved`,
            changedBy: this.tenant.userId,
          },
        });
      }
      return updated;
    });
  }

  /** Reject → order back to `diagnosis` for a revised quote. */
  async rejectQuotation(id: string, dto: { reason?: string }) {
    const orgId = this.tenant.organizationId;
    const q = await this.prisma.client.repairQuotation.findFirst({ where: { id, organizationId: orgId } });
    if (!q) throw new NotFoundException('Quotation not found');

    return this.prisma.client.$transaction(async (tx: any) => {
      const updated = await tx.repairQuotation.update({
        where: { id },
        data: { status: 'rejected', rejectedAt: new Date(), rejectedReason: dto.reason ?? null },
      });
      const order = await tx.repairOrder.findFirst({ where: { id: q.repairOrderId, organizationId: orgId } });
      if (order && order.status === 'waiting_approval') {
        this.lifecycles.assertTransition('repair.order', order.status, 'diagnosis', 'revision');
        await tx.repairOrder.update({
          where: { id: order.id },
          data: { status: 'diagnosis', updatedBy: this.tenant.userId },
        });
        await tx.repairStatusHistory.create({
          data: {
            organizationId: orgId,
            repairOrderId: order.id,
            fromStatus: order.status,
            toStatus: 'diagnosis',
            action: 'revision',
            note: `Quotation ${q.quotationNumber} rejected — ${dto.reason ?? 'revise'}`,
            changedBy: this.tenant.userId,
          },
        });
      }
      return updated;
    });
  }

  /** Revised quotation = new draft quoting the same order (revision +1). */
  async reviseQuotation(id: string, dto: any) {
    const orgId = this.tenant.organizationId;
    const prev = await this.prisma.client.repairQuotation.findFirst({
      where: { id, organizationId: orgId },
      include: { lines: true },
    });
    if (!prev) throw new NotFoundException('Quotation not found');
    return this.createQuotation(prev.repairOrderId, {
      ...dto,
      revision: (prev.revision ?? 1) + 1,
      lines: dto.lines ?? prev.lines.map((l) => ({
        kind: l.kind,
        description: l.description,
        labourTypeId: l.labourTypeId,
        productId: l.productId,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        taxId: l.taxId,
      })),
    });
  }

  async deleteQuotation(id: string) {
    const orgId = this.tenant.organizationId;
    const q = await this.prisma.client.repairQuotation.findFirst({ where: { id, organizationId: orgId } });
    if (!q) throw new NotFoundException('Quotation not found');
    if (q.status === 'approved') throw new BadRequestException('Approved quotation cannot be deleted');
    return this.prisma.client.repairQuotation.update({ where: { id }, data: { status: 'cancelled' } });
  }

  // ── Line building / totals ────────────────────────────────────────────────

  /**
   * Resolve raw lines ({kind, description, quantity, unitPrice, labourTypeId,
   * productId, taxId}) into priced lines with snapshot descriptions:
   *  - labour → description from the labour type, unitPrice = price (or override)
   *  - part   → description from the product, unitPrice = sale price (or override)
   */
  private async buildLines(orgId: string, raw: any[]) {
    const out: any[] = [];
    for (const [idx, r] of raw.entries()) {
      const kind = r.kind === 'part' ? 'part' : 'labour';
      let description = r.description;
      let unitPrice = Number(r.unitPrice ?? 0);
      if (kind === 'labour' && r.labourTypeId) {
        const lt = await this.prisma.client.repairLabourType.findFirst({
          where: { id: r.labourTypeId, organizationId: orgId },
        });
        if (lt) {
          description = description ?? lt.name;
          if (r.unitPrice === undefined || r.unitPrice === null) unitPrice = Number(lt.price) || 0;
        }
      }
      if (kind === 'part' && r.productId) {
        const p = await this.prisma.client.product.findFirst({ where: { id: r.productId, organizationId: orgId } });
        if (p) {
          description = description ?? p.name;
          if (r.unitPrice === undefined || r.unitPrice === null) unitPrice = Number(p.salesPrice ?? 0) || 0;
        }
      }
      const quantity = Number(r.quantity ?? 1);
      if (!(quantity > 0)) throw new BadRequestException(`Line ${idx + 1}: quantity must be positive`);
      out.push({
        kind,
        description: description ?? `Line ${idx + 1}`,
        labourTypeId: r.labourTypeId ?? null,
        productId: r.productId ?? null,
        taxId: r.taxId ?? null,
        quantity,
        unitPrice,
        amount: Math.round(quantity * unitPrice * 100) / 100,
      });
    }
    return out;
  }

  private totals(lines: any[]) {
    const labourTotal = lines.filter((l) => l.kind === 'labour').reduce((s, l) => s + l.amount, 0);
    const partsTotal = lines.filter((l) => l.kind === 'part').reduce((s, l) => s + l.amount, 0);
    const totalAmount = lines.reduce((s, l) => s + l.amount, 0);
    return {
      labourTotal,
      partsTotal,
      taxTotal: 0,
      totalAmount,
    };
  }

  private async ensureExists(model: 'repairDiagnosis' | 'repairQuotation', id: string, orgId: string) {
    const row = await (this.prisma.client as any)[model].findFirst({ where: { id, organizationId: orgId } });
    if (!row) throw new NotFoundException('Record not found');
    return row;
  }
}
