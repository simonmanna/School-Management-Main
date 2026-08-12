import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';

@Injectable()
export class CostCenterService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
  ) {}

  private get db() {
    return this.prisma.client.costCenter as any;
  }

  async list(query: { page?: number; pageSize?: number; type?: string }) {
    const p = Number(query.page) || 1;
    const ps = Math.min(Number(query.pageSize) || 50, 200);
    const where: any = {};
    if (query.type) where.type = query.type;
    const [data, total] = await Promise.all([
      this.db.findMany({ where, orderBy: { code: 'asc' }, skip: (p - 1) * ps, take: ps }),
      this.db.count({ where }),
    ]);
    return { data, meta: { page: p, pageSize: ps, total, totalPages: Math.max(1, Math.ceil(total / ps)) } };
  }

  async findOne(id: string) {
    const item = await this.db.findFirst({ where: { id } });
    if (!item) throw new NotFoundException('Cost center not found');
    return item;
  }

  async create(dto: { code: string; name: string; type?: string }) {
    return this.db.create({
      data: { organizationId: this.tenant.organizationId, code: dto.code, name: dto.name, type: dto.type ?? 'cost' },
    });
  }

  async update(id: string, dto: { code?: string; name?: string; type?: string; isActive?: boolean }) {
    await this.findOne(id);
    return this.db.updateMany({ where: { id }, data: dto });
  }

  async remove(id: string) {
    await this.findOne(id);
    return this.db.updateMany({ where: { id }, data: { deletedAt: new Date() } });
  }
}
