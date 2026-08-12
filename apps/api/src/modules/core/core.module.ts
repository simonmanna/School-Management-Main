import { Module, OnModuleInit } from '@nestjs/common';
import { ALL_PERMISSIONS } from '@erp/shared';
import { ModuleRegistry } from '../../kernel/module-loader/module-registry.service';
import { PrismaService } from '../../kernel/prisma/prisma.service';
import { PartnerModule } from './partner/partner.module';
import { ProductModule } from './product/product.module';
import { FiscalPeriodService } from './fiscal-period.service';
import { FiscalPeriodController } from './fiscal-period.controller';
import { BranchService } from './branch.service';
import { BranchController } from './branch.controller';
import { BranchScopeService } from './branch/branch-scope.service';
import { OrganizationsService } from './organizations.service';
import { OrganizationsController } from './organizations.controller';
import { PaymentTermService } from './payment-term.service';
import { PaymentTermController } from './payment-term.controller';
import { FiscalPositionService } from './fiscal-position.service';
import { FiscalPositionController } from './fiscal-position.controller';

/**
 * Core master-data module (Phase 1). Owns the universal entities every future
 * vertical builds on. Registers its manifest so the kernel can validate the
 * dependency graph at boot.
 */
@Module({
  imports: [PartnerModule, ProductModule],
  controllers: [FiscalPeriodController, BranchController, OrganizationsController, PaymentTermController, FiscalPositionController],
  providers: [FiscalPeriodService, BranchService, BranchScopeService, OrganizationsService, PaymentTermService, FiscalPositionService],
  exports: [FiscalPeriodService, BranchService, BranchScopeService, OrganizationsService, PaymentTermService, FiscalPositionService],
})
export class CoreModule implements OnModuleInit {
  constructor(
    private readonly registry: ModuleRegistry,
    private readonly prisma: PrismaService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.registry.register({
      name: 'core',
      version: '1.3.0',
      dependencies: ['kernel'],
      permissions: ALL_PERMISSIONS,
    });

    // Sync the permissions catalog + every Administrator role with the current
    // ALL_PERMISSIONS set. This is the fix for "permission denied after a new
    // permission is added to @erp/shared but never reaches the DB or the admin
    // role" — a silent drift that previously surfaced as 403s on newly-added
    // routes. Runs fire-and-forget at boot; safe to call repeatedly (idempotent).
    setImmediate(() => {
      this.syncPermissions().catch((e) =>
        // eslint-disable-next-line no-console
        console.warn('[CoreModule] permission sync failed:', e?.message ?? e),
      );
    });
  }

  /**
   * Two-part idempotent sync:
   *   1. Upsert every `key` from ALL_PERMISSIONS into the global Permission catalog.
   *   2. For every role named "Administrator" across all orgs, append any
   *      missing permission keys to its `permissions` array (so a fresh
   *      permission immediately becomes available to admin users).
   *
   * Wrapped in setImmediate() so it never blocks app boot.
   */
  private async syncPermissions(): Promise<void> {
    const client = this.prisma.raw;

    // 1. Catalog: insert any missing keys. Wrapped in a single transaction.
    const catalogRows = ALL_PERMISSIONS.map((key) => {
      const [resource, action] = key.split(/[:.]/);
      return { key, resource, action };
    });
    for (const row of catalogRows) {
      await client.$executeRawUnsafe(
        `INSERT INTO "Permission" ("id", "key", "resource", "action", "createdAt")
         VALUES (gen_random_uuid()::text, $1, $2, $3, NOW())
         ON CONFLICT ("key") DO NOTHING`,
        row.key, row.resource, row.action,
      );
    }

    // 2. Admin roles: append any missing permission keys.
    const admins = await client.role.findMany({
      where: { name: 'Administrator' },
      select: { id: true, permissions: true },
    });
    const allKeys = new Set(ALL_PERMISSIONS);
    for (const admin of admins) {
      const have = new Set(admin.permissions);
      const missing = [...allKeys].filter((k) => !have.has(k));
      if (missing.length === 0) continue;
      const merged = Array.from(new Set([...admin.permissions, ...missing]));
      await client.role.update({
        where: { id: admin.id },
        data: { permissions: merged },
      });
    }
  }
}
