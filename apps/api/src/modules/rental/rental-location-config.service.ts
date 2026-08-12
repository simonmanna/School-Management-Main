import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../kernel/tenancy/tenant-context.service';
import { RentalLocationRole } from '@prisma/client';

/**
 * RentalLocationConfigService — the five rental inventory locations.
 *
 * Checkout is an internal stock transfer between these: RENT-STOCK → RENT-OUT
 * (and back on return). The mapping role → InventoryLocation is per-org config;
 * this service bootstraps the five locations on first run (idempotent), using
 * the `virtual` location type so they never appear on sales floor pick lists.
 */
@Injectable()
export class RentalLocationConfigService implements OnModuleInit {
  private readonly logger = new Logger('RentalLocationConfigService');

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
  ) {}

  private readonly BOOTSTRAP: Array<{ role: RentalLocationRole; code: string; name: string }> = [
    { role: 'stock', code: 'RENT-STOCK', name: 'Rental Stock' },
    { role: 'out', code: 'RENT-OUT', name: 'Rental Out (with customer)' },
    { role: 'cleaning', code: 'RENT-CLEAN', name: 'Rental Cleaning' },
    { role: 'repair', code: 'RENT-REPAIR', name: 'Rental Repair' },
    { role: 'damaged', code: 'RENT-DAMAGED', name: 'Rental Damaged' },
  ];

  async onModuleInit(): Promise<void> {
    // Best-effort: tenant context may be absent at boot (no request in flight).
    try {
      const orgId = this.tenant.organizationId;
      await this.ensureForOrg(orgId);
    } catch {
      // Module boots before the first request; org bootstrap runs lazily via
      // `ensureForOrg` on first use. Nothing to do here.
    }
  }

  /** Ensure the five locations + config rows exist for an org. Idempotent. */
  async ensureForOrg(orgId: string): Promise<void> {
    for (const row of this.BOOTSTRAP) {
      const existing = await this.prisma.client.inventoryLocation.findUnique({
        where: { organizationId_code: { organizationId: orgId, code: row.code } },
        select: { id: true },
      });
      const locationId = existing?.id ?? (
        await this.prisma.client.inventoryLocation.create({
          data: {
            organizationId: orgId,
            code: row.code,
            name: row.name,
            type: 'virtual',
            isActive: true,
          },
        })
      ).id;

      await this.prisma.client.rentalLocationConfig.upsert({
        where: { organizationId_role: { organizationId: orgId, role: row.role } },
        update: { locationId },
        create: { organizationId: orgId, role: row.role, locationId },
      });
    }
    this.logger.log(`Rental locations ensured for org ${orgId}`);
  }

  /** Resolve the InventoryLocation id for a role, ensuring bootstrap first. */
  async resolve(role: RentalLocationRole): Promise<string> {
    const orgId = this.tenant.organizationId;
    await this.ensureForOrg(orgId);
    const cfg = await this.prisma.client.rentalLocationConfig.findUnique({
      where: { organizationId_role: { organizationId: orgId, role } },
    });
    if (!cfg) throw new Error(`Rental location role '${role}' not configured for org ${orgId}`);
    return cfg.locationId;
  }

  /** Tx-aware variant used inside larger transactions (checkout/return). */
  async resolveInTx(tx: any, orgId: string, role: RentalLocationRole): Promise<string> {
    await this.ensureForOrg(orgId);
    const cfg = await tx.rentalLocationConfig.findUnique({
      where: { organizationId_role: { organizationId: orgId, role } },
    });
    if (!cfg) throw new Error(`Rental location role '${role}' not configured for org ${orgId}`);
    return cfg.locationId;
  }

  /** All five role→location mappings for an org. */
  async all(): Promise<Record<RentalLocationRole, string>> {
    const orgId = this.tenant.organizationId;
    await this.ensureForOrg(orgId);
    const rows = await this.prisma.client.rentalLocationConfig.findMany({
      where: { organizationId: orgId },
    });
    const map = {} as Record<RentalLocationRole, string>;
    for (const r of rows) map[r.role] = r.locationId;
    return map;
  }

  /** Bootstrap the five rental locations for the current org (idempotent). */
  async bootstrap() {
    const orgId = this.tenant.organizationId;
    await this.ensureForOrg(orgId);
    return this.all();
  }
}
