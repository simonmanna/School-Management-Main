import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from '../tenancy/tenant-context.service';

/**
 * Settings live at system / organization / module scope (ADR-005). The Setting
 * table has a nullable organizationId, so it is excluded from the tenancy
 * extension and scoped explicitly here via the raw client.
 */
@Injectable()
export class SettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
  ) {}

  listForOrganization() {
    return this.prisma.raw.setting.findMany({
      where: { organizationId: this.tenant.organizationId, scope: 'organization' },
      orderBy: { key: 'asc' },
    });
  }

  get(key: string) {
    return this.prisma.raw.setting.findFirst({
      where: { organizationId: this.tenant.optionalOrganizationId ?? null, scope: 'organization', key },
    });
  }

  async set(key: string, value: unknown) {
    const organizationId = this.tenant.organizationId;
    const existing = await this.prisma.raw.setting.findFirst({
      where: { organizationId, scope: 'organization', key },
    });
    if (existing) {
      return this.prisma.raw.setting.update({
        where: { id: existing.id },
        data: { value: value as Prisma.InputJsonValue },
      });
    }
    return this.prisma.raw.setting.create({
      data: { organizationId, scope: 'organization', key, value: value as Prisma.InputJsonValue },
    });
  }
}
