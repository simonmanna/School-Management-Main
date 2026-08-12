import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';

/** Org-level account determination defaults (key -> account). */
@Injectable()
export class AccountMappingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
  ) {}

  list() {
    return this.prisma.client.accountMapping.findMany({ orderBy: { key: 'asc' } });
  }

  set(key: string, accountId: string) {
    const organizationId = this.tenant.organizationId;
    return this.prisma.client.accountMapping.upsert({
      where: { organizationId_key: { organizationId, key } },
      create: { organizationId, key, accountId },
      update: { accountId },
    });
  }
}
