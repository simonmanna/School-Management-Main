import { Injectable } from '@nestjs/common';
import { ACCOUNT_MAPPING_REGISTRY, REQUIRED_ACCOUNT_MAPPING_KEYS } from '@erp/shared';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { AccountResolverService } from '../posting/account-resolver.service';

/** Org-level account determination defaults (key -> account). */
@Injectable()
export class AccountMappingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly accounts: AccountResolverService,
  ) {}

  list() {
    return this.prisma.client.accountMapping.findMany({ orderBy: { key: 'asc' } });
  }

  /**
   * The mapping catalog: key, label, group, and the categories an account must
   * belong to. The web picker filters on `expectedCategories` rather than
   * hardcoding its own list — two such hardcoded copies are how the UI drifted
   * from the posting code in the first place.
   */
  registry() {
    return ACCOUNT_MAPPING_REGISTRY;
  }

  /** Required keys with no mapping row. These throw at posting time. */
  async missingRequired(): Promise<string[]> {
    const rows = await this.prisma.client.accountMapping.findMany({ select: { key: true } });
    const configured = new Set((rows as { key: string }[]).map((r) => r.key));
    return REQUIRED_ACCOUNT_MAPPING_KEYS.filter((k) => !configured.has(k));
  }

  /**
   * Point a mapping key at an account.
   *
   * Rejects group / inactive / deprecated accounts, and accounts whose category
   * is not one the key expects — mapping `cogs` at a revenue account silently
   * corrupts every downstream report. `force` overrides the category check for
   * organizations with a genuinely unusual chart of accounts.
   */
  async set(key: string, accountId: string, opts: { force?: boolean } = {}) {
    await this.accounts.assertValidForMapping(key, accountId, opts);
    const organizationId = this.tenant.organizationId;
    return this.prisma.client.accountMapping.upsert({
      where: { organizationId_key: { organizationId, key } },
      create: { organizationId, key, accountId },
      update: { accountId },
    });
  }
}
