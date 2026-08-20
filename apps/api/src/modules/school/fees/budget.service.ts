import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { CreateBudgetDto, UpdateBudgetDto } from './dto.types';

@Injectable()
export class BudgetService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
  ) {}

  private get orgId() {
    return this.tenant.organizationId;
  }

  list() {
    return this.prisma.client.budget.findMany({
      where: { organizationId: this.orgId },
      orderBy: { createdAt: 'desc' },
      include: { academicYear: true, term: true },
    });
  }

  async findOne(id: string) {
    const row = await this.prisma.client.budget.findFirst({
      where: { id, organizationId: this.orgId },
      include: { academicYear: true, term: true },
    });
    if (!row) throw new NotFoundException(`Budget ${id} not found`);
    return row;
  }

  create(dto: CreateBudgetDto) {
    return this.prisma.client.budget.create({
      data: {
        organizationId: this.orgId,
        category: dto.category,
        name: dto.name,
        amount: dto.amount,
        academicYearId: dto.academicYearId,
        termId: dto.termId,
        currency: dto.currency,
        periodFrom: dto.periodFrom ? new Date(dto.periodFrom) : undefined,
        periodTo: dto.periodTo ? new Date(dto.periodTo) : undefined,
        notes: dto.notes,
        status: dto.status ?? 'approved',
      },
    });
  }

  async update(id: string, dto: UpdateBudgetDto) {
    await this.findOne(id);
    return this.prisma.client.budget.update({
      where: { id },
      data: {
        category: dto.category,
        name: dto.name,
        amount: dto.amount,
        academicYearId: dto.academicYearId,
        termId: dto.termId,
        currency: dto.currency,
        periodFrom: dto.periodFrom ? new Date(dto.periodFrom) : undefined,
        periodTo: dto.periodTo ? new Date(dto.periodTo) : undefined,
        notes: dto.notes,
        status: dto.status,
      },
    });
  }

  async remove(id: string) {
    await this.findOne(id);
    await this.prisma.client.budget.delete({ where: { id } });
    return { id };
  }
}
