import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { dec } from '../../kernel/common/money';
import { PrismaService } from '../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../kernel/tenancy/tenant-context.service';
import { SequenceService } from '../../kernel/sequence/sequence.service';
import { CreateProductionRequestDto, RejectProductionRequestDto } from './dto/request.dto';

/** A demand line raised programmatically (Phase 3: wholesale order, min-stock). */
export interface RaisedRequestLine {
  productId: string;
  variantId?: string | null;
  quantity: number;
  uomId?: string | null;
  bomId?: string | null;
  neededBy?: Date | null;
  notes?: string | null;
}

/**
 * ProductionRequest — a demand to make something. Mirrors PurchaseRequest so a
 * common request framework can later be extracted. A planner consolidates
 * approved requests into orders; requests never make stock or GL themselves.
 */
@Injectable()
export class ProductionRequestService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly seq: SequenceService,
  ) {}

  private get org(): string {
    return this.tenant.organizationId;
  }

  async create(dto: CreateProductionRequestDto) {
    const requestNumber = await this.seq.next('production_request', { prefix: 'PRQ-', padding: 5 });
    return this.prisma.client.productionRequest.create({
      data: {
        organizationId: this.org,
        requestNumber,
        requestedById: this.tenant.userId ?? null,
        sourceType: 'manual',
        neededBy: dto.neededBy ? new Date(dto.neededBy) : null,
        status: 'draft',
        notes: dto.notes ?? null,
        createdBy: this.tenant.userId ?? null,
        lines: {
          create: dto.lines.map((l, i) => ({
            organizationId: this.org,
            productId: l.productId,
            variantId: l.variantId ?? null,
            quantity: dec(l.quantity),
            uomId: l.uomId ?? null,
            bomId: l.bomId ?? null,
            neededBy: l.neededBy ? new Date(l.neededBy) : null,
            notes: l.notes ?? null,
            lineNumber: i,
          })),
        },
      },
      include: { lines: true },
    });
  }

  /** Programmatic entry point for demand sources (Phase 3). Creates a `submitted`
   *  request tagged with its origin so demand is traceable. */
  async raiseRequest(params: {
    sourceType: string;
    sourceId: string;
    neededBy?: Date | null;
    notes?: string | null;
    lines: RaisedRequestLine[];
  }) {
    if (params.lines.length === 0) return null;
    const requestNumber = await this.seq.next('production_request', { prefix: 'PRQ-', padding: 5 });
    return this.prisma.client.productionRequest.create({
      data: {
        organizationId: this.org,
        requestNumber,
        requestedById: this.tenant.userId ?? null,
        sourceType: params.sourceType,
        sourceId: params.sourceId,
        neededBy: params.neededBy ?? null,
        status: 'submitted',
        notes: params.notes ?? null,
        createdBy: this.tenant.userId ?? null,
        lines: {
          create: params.lines.map((l, i) => ({
            organizationId: this.org,
            productId: l.productId,
            variantId: l.variantId ?? null,
            quantity: dec(l.quantity),
            uomId: l.uomId ?? null,
            bomId: l.bomId ?? null,
            neededBy: l.neededBy ?? null,
            notes: l.notes ?? null,
            lineNumber: i,
          })),
        },
      },
      include: { lines: true },
    });
  }

  private transition(id: string, from: string[], to: string, extra: Record<string, unknown> = {}) {
    return this.prisma.client.$transaction(async (tx: any) => {
      const req = await tx.productionRequest.findFirst({ where: { id } });
      if (!req) throw new NotFoundException('Request not found');
      if (!from.includes(req.status)) {
        throw new BadRequestException(`Cannot move a ${req.status} request to ${to}.`);
      }
      return tx.productionRequest.update({
        where: { id },
        data: { status: to as any, updatedBy: this.tenant.userId ?? null, ...extra },
        include: { lines: true },
      });
    });
  }

  submit(id: string) {
    return this.transition(id, ['draft'], 'submitted');
  }

  approve(id: string) {
    return this.transition(id, ['submitted'], 'approved', {
      approvedById: this.tenant.userId ?? null,
      approvedAt: new Date(),
    });
  }

  reject(id: string, dto: RejectProductionRequestDto = {}) {
    return this.transition(id, ['draft', 'submitted'], 'rejected', { rejectedReason: dto.reason ?? null });
  }

  cancel(id: string) {
    return this.transition(id, ['draft', 'submitted', 'approved'], 'cancelled');
  }

  list(params: { status?: string } = {}) {
    return this.prisma.client.productionRequest.findMany({
      where: { status: params.status ? (params.status as any) : undefined },
      orderBy: { createdAt: 'desc' },
      include: { lines: true },
    });
  }

  async get(id: string) {
    const req = await this.prisma.client.productionRequest.findFirst({ where: { id }, include: { lines: true } });
    if (!req) throw new NotFoundException('Request not found');
    return req;
  }
}
