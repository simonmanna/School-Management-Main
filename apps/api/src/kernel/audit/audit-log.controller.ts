import { Controller, Get, Logger, Query } from '@nestjs/common';
import { PERMISSIONS } from '@erp/shared';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from '../tenancy/tenant-context.service';

@Controller('audit-logs')
@RequirePermissions(PERMISSIONS.auditLog.read)
export class AuditLogController {
  private readonly logger = new Logger('AuditLogController');

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
  ) {}

  @Get()
  async list(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('entity') entity?: string,
  ) {
    const p = Number(page) || 1;
    const ps = Math.min(Number(pageSize) || 50, 200);
    const orgId = this.tenant.organizationId;

    const where: any = { organizationId: orgId };
    if (entity) where.entity = entity;

    const [data, total] = await Promise.all([
      this.prisma.client.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (p - 1) * ps,
        take: ps,
      }),
      this.prisma.client.auditLog.count({ where }),
    ]);

    return {
      data,
      meta: { page: p, pageSize: ps, total, totalPages: Math.max(1, Math.ceil(total / ps)) },
    };
  }
}
