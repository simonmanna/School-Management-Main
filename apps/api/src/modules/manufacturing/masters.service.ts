import { Injectable, NotFoundException } from '@nestjs/common';
import { dec } from '../../kernel/common/money';
import { PrismaService } from '../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../kernel/tenancy/tenant-context.service';
import { CreateResourceDto, CreateRoutingDto, CreateWorkCenterDto } from './dto/phase4.dto';

@Injectable()
export class WorkCenterService {
  constructor(private readonly prisma: PrismaService, private readonly tenant: TenantContextService) {}
  private get org() { return this.tenant.organizationId; }

  create(dto: CreateWorkCenterDto) {
    return this.prisma.client.workCenter.create({
      data: {
        organizationId: this.org,
        code: dto.code,
        name: dto.name,
        description: dto.description ?? null,
        isActive: dto.isActive ?? true,
        createdBy: this.tenant.userId ?? null,
      },
    });
  }

  update(id: string, dto: Partial<CreateWorkCenterDto>) {
    return this.prisma.client.workCenter.update({
      where: { id },
      data: { ...dto, updatedBy: this.tenant.userId ?? null },
    });
  }

  list() {
    return this.prisma.client.workCenter.findMany({ orderBy: { name: 'asc' }, include: { resources: true } });
  }

  remove(id: string) {
    return this.prisma.client.workCenter.update({ where: { id }, data: { deletedAt: new Date(), isActive: false } });
  }
}

@Injectable()
export class ResourceService {
  constructor(private readonly prisma: PrismaService, private readonly tenant: TenantContextService) {}
  private get org() { return this.tenant.organizationId; }

  create(dto: CreateResourceDto) {
    return this.prisma.client.resource.create({
      data: {
        organizationId: this.org,
        code: dto.code ?? null,
        name: dto.name,
        kind: dto.kind,
        workCenterId: dto.workCenterId ?? null,
        fixedAssetId: dto.fixedAssetId ?? null,
        userId: dto.userId ?? null,
        costPerHour: dec(dto.costPerHour ?? 0),
        capacityMinsPerDay: dto.capacityMinsPerDay ?? null,
        isActive: dto.isActive ?? true,
        createdBy: this.tenant.userId ?? null,
      },
    });
  }

  update(id: string, dto: Partial<CreateResourceDto>) {
    const { costPerHour, ...rest } = dto;
    return this.prisma.client.resource.update({
      where: { id },
      data: {
        ...rest,
        ...(costPerHour != null ? { costPerHour: dec(costPerHour) } : {}),
        updatedBy: this.tenant.userId ?? null,
      },
    });
  }

  list(params: { kind?: string } = {}) {
    return this.prisma.client.resource.findMany({
      where: { kind: params.kind ? (params.kind as any) : undefined },
      orderBy: { name: 'asc' },
      include: { workCenter: true },
    });
  }

  remove(id: string) {
    return this.prisma.client.resource.update({ where: { id }, data: { deletedAt: new Date(), isActive: false } });
  }
}

@Injectable()
export class RoutingService {
  constructor(private readonly prisma: PrismaService, private readonly tenant: TenantContextService) {}
  private get org() { return this.tenant.organizationId; }

  create(dto: CreateRoutingDto) {
    return this.prisma.client.routing.create({
      data: {
        organizationId: this.org,
        name: dto.name,
        productId: dto.productId ?? null,
        bomId: dto.bomId ?? null,
        createdBy: this.tenant.userId ?? null,
        operations: {
          create: dto.operations.map((o) => ({
            organizationId: this.org,
            sequence: o.sequence,
            name: o.name,
            workCenterId: o.workCenterId ?? null,
            durationMins: o.durationMins ?? 0,
            setupMins: o.setupMins ?? 0,
            instructions: o.instructions ?? null,
          })),
        },
      },
      include: { operations: { orderBy: { sequence: 'asc' } } },
    });
  }

  list(params: { bomId?: string; productId?: string } = {}) {
    return this.prisma.client.routing.findMany({
      where: { bomId: params.bomId, productId: params.productId },
      orderBy: { name: 'asc' },
      include: { operations: { orderBy: { sequence: 'asc' } } },
    });
  }

  async get(id: string) {
    const r = await this.prisma.client.routing.findFirst({
      where: { id },
      include: { operations: { orderBy: { sequence: 'asc' } } },
    });
    if (!r) throw new NotFoundException('Routing not found');
    return r;
  }

  remove(id: string) {
    return this.prisma.client.routing.update({ where: { id }, data: { deletedAt: new Date(), isActive: false } });
  }
}
