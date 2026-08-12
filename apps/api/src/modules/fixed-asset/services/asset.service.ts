import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { EventBus } from '../../../kernel/events/event-bus';
import { SequenceService } from '../../../kernel/sequence/sequence.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { ApprovalsService } from '../../../kernel/approvals/approvals.service';
import type { CreateAssetDto } from '../dto/create-asset.dto';
import type { UpdateAssetDto } from '../dto/update-asset.dto';
import type { AssetQueryDto } from '../dto/asset-query.dto';
import { DEFAULT_PAGE, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, type PaginatedResult } from '@erp/shared';

@Injectable()
export class AssetService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventBus,
    private readonly seq: SequenceService,
    private readonly tenant: TenantContextService,
    private readonly approvals: ApprovalsService,
  ) {}

  private get delegate() { return this.prisma.client.asset; }

  async list(query: AssetQueryDto): Promise<PaginatedResult<any>> {
    const page = Math.max(1, Number(query.page) || DEFAULT_PAGE);
    const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(query.pageSize) || DEFAULT_PAGE_SIZE));
    const where: Record<string, unknown> = {};
    if (query.search) where.OR = [
      { name: { contains: query.search, mode: 'insensitive' } },
      { assetCode: { contains: query.search, mode: 'insensitive' } },
      { serialNumber: { contains: query.search, mode: 'insensitive' } },
      { barcode: { contains: query.search, mode: 'insensitive' } },
    ];
    if (query.categoryId) where.categoryId = query.categoryId;
    if (query.status) where.status = query.status;
    if (query.branchId) where.branchId = query.branchId;
    if (query.department) where.department = { contains: query.department, mode: 'insensitive' };
    if (query.supplierId) where.supplierId = query.supplierId;
    if (query.location) where.location = { contains: query.location, mode: 'insensitive' };

    const orderBy: any = query.sortBy ? { [query.sortBy]: query.sortOrder ?? 'asc' as const } : { createdAt: 'desc' as const };

    const [data, total] = await Promise.all([
      this.delegate.findMany({ where, orderBy, skip: (page - 1) * pageSize, take: pageSize }),
      this.delegate.count({ where }),
    ]);
    return { data, meta: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) } };
  }

  async findOne(id: string): Promise<any> {
    const asset = await this.delegate.findFirst({
      where: { id },
      include: {
        category: true,
        acquisition: true,
        assignments: { orderBy: { assignedDate: 'desc' as const }, take: 5 },
        transfers: { orderBy: { transferDate: 'desc' as const }, take: 5 },
        depreciations: { orderBy: { period: 'desc' as const }, take: 12 },
        maintenanceLogs: { orderBy: { scheduledDate: 'desc' as const }, take: 5 },
        repairs: { orderBy: { breakdownDate: 'desc' as const }, take: 5 },
        warranties: { orderBy: { warrantyEnd: 'desc' as const } },
        insurance: { orderBy: { renewalDate: 'desc' as const }, take: 5 },
        inspections: { orderBy: { inspectionDate: 'desc' as const }, take: 5 },
        disposals: true,
        revaluations: { orderBy: { revaluationDate: 'desc' as const }, take: 5 },
        checkInOuts: { orderBy: { checkoutDate: 'desc' as const }, take: 5 },
        documents: { orderBy: { uploadedAt: 'desc' as const }, take: 10 },
      },
    });
    if (!asset) throw new NotFoundException(`Asset ${id} not found`);
    return asset;
  }

  async findByCode(code: string): Promise<any> {
    const asset = await this.delegate.findFirst({ where: { assetCode: code }, include: { category: true } });
    if (!asset) throw new NotFoundException(`Asset ${code} not found`);
    return asset;
  }

  async findByBarcode(barcode: string): Promise<any> {
    const asset = await this.delegate.findFirst({ where: { barcode }, include: { category: true } });
    if (!asset) throw new NotFoundException(`Asset with barcode ${barcode} not found`);
    return asset;
  }

  async search(q: string): Promise<any[]> {
    return this.delegate.findMany({
      where: {
        OR: [
          { name: { contains: q, mode: 'insensitive' } },
          { assetCode: { contains: q, mode: 'insensitive' } },
          { serialNumber: { contains: q, mode: 'insensitive' } },
          { barcode: { contains: q, mode: 'insensitive' } },
        ],
      },
      take: 20,
      include: { category: true },
      orderBy: { name: 'asc' as const },
    });
  }

  async create(dto: CreateAssetDto): Promise<any> {
    const assetCode = dto.assetCode ?? await this.seq.next('asset', { prefix: 'AST-' });

    // Approval gate for new asset acquisitions
    const approval = await this.approvals.checkOrRequestApproval({
      entityType: 'asset_acquisition',
      entityId: `new-${assetCode}`,
      snapshot: {
        code: assetCode,
        name: dto.name,
        purchaseCost: dto.purchaseCost,
        categoryId: dto.categoryId,
        acquisitionMethod: dto.acquisitionMethod,
      },
    });
    if (approval?.needsApproval) {
      throw new ForbiddenException(
        `Asset acquisition requires approval. Request ID: ${approval.requestId}.`,
      );
    }

    const data: any = { ...dto, assetCode };
    if (dto.purchaseDate) data.purchaseDate = new Date(dto.purchaseDate);
    if ((dto as any).assignmentDate) data.assignmentDate = new Date((dto as any).assignmentDate);
    if (dto.purchaseCost != null && dto.currentValue == null) data.currentValue = dto.purchaseCost;
    const asset = await this.delegate.create({ data, include: { category: true } });
    this.events.publish('fixed_asset.created', { id: asset.id, organizationId: asset.organizationId });
    return asset;
  }

  async update(id: string, dto: UpdateAssetDto): Promise<any> {
    const existing = await this.delegate.findFirst({ where: { id } });
    if (!existing) throw new NotFoundException(`Asset ${id} not found`);
    const data: any = { ...dto };
    if ((dto as any).purchaseDate) data.purchaseDate = new Date((dto as any).purchaseDate);
    if ((dto as any).assignmentDate) data.assignmentDate = new Date((dto as any).assignmentDate);
    const asset = await this.delegate.update({ where: { id }, data, include: { category: true } });
    this.events.publish('fixed_asset.updated', { id: asset.id, organizationId: asset.organizationId });
    return asset;
  }

  async remove(id: string): Promise<void> {
    const res = await this.delegate.updateMany({ where: { id }, data: { deletedAt: new Date() } });
    if (res.count === 0) throw new NotFoundException(`Asset ${id} not found`);
    this.events.publish('fixed_asset.deleted', { id, organizationId: '' });
  }

  async restore(id: string): Promise<any> {
    const res = await this.delegate.updateMany({ where: { id }, data: { deletedAt: null } });
    if (res.count === 0) throw new NotFoundException(`Asset ${id} not found`);
    return this.findOne(id);
  }

  async getDashboard(): Promise<any> {
    const orgId = this.tenant.organizationId;
    const where = { organizationId: orgId, deletedAt: null };
    const [totalAssets, activeAssets, maintenanceAssets, totalValue, disposalCount, recentAssets, warrantyExpiring] =
      await Promise.all([
        this.delegate.count({ where: { ...where } }),
        this.delegate.count({ where: { ...where, status: 'active' } }),
        this.delegate.count({ where: { ...where, status: 'under_maintenance' } }),
        this.delegate.aggregate({ where: { ...where }, _sum: { currentValue: true } }),
        this.delegate.count({ where: { ...where, status: 'disposed' } }),
        this.delegate.findMany({ where, orderBy: { createdAt: 'desc' as const }, take: 10, include: { category: true } }),
        this.prisma.client.assetWarranty.findMany({
          where: {
            organizationId: orgId,
            warrantyEnd: { gte: new Date(), lte: new Date(Date.now() + 90 * 86400000) },
          },
          include: { asset: { select: { name: true, assetCode: true } } },
          orderBy: { warrantyEnd: 'asc' as const },
          take: 10,
        }),
      ]);
    return {
      totalAssets,
      activeAssets,
      maintenanceAssets,
      totalValue: totalValue._sum.currentValue ?? 0,
      disposalCount,
      recentAssets,
      warrantyExpiring,
    };
  }
}
