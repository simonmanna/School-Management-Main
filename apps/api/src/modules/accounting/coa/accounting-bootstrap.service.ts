import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import type { AccountingBootstrap } from '../../../kernel/common/org-bootstrap.tokens';
import { seedAccountingCore } from './coa-seeder';

/**
 * Accounting's implementation of the kernel `ACCOUNTING_BOOTSTRAP` hook.
 *
 * `core` cannot import `accounting` (ADR-011), so it injects this through the
 * kernel-owned token instead. Uses the raw client because a brand-new
 * organization has no tenant context yet.
 */
@Injectable()
export class AccountingBootstrapService implements AccountingBootstrap {
  constructor(private readonly prisma: PrismaService) {}

  /** `client` lets bootstrap run the whole seed inside its transaction. */
  async seedOrganization(organizationId: string, client?: unknown): Promise<void> {
    await seedAccountingCore((client as any) ?? this.prisma.raw, organizationId);
  }
}
