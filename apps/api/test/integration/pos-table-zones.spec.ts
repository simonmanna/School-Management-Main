// Stub the MFA/OTP chain — same rationale as the other POS specs (ESM deps).
jest.mock('otplib', () => ({
  generateSecret: () => 'TESTSECRET',
  generateURI: () => 'otpauth://stub',
  verifySync: () => true,
  authenticator: { generateSecret: () => 'TESTSECRET', keyuri: () => 'otpauth://stub', verify: () => true, check: () => true },
}));

import { Test, TestingModule } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { describeDb } from './_setup';
import { KernelModule } from '../../src/kernel/kernel.module';
import { DocumentsModule } from '../../src/modules/documents/documents.module';
import { PosModule } from '../../src/modules/pos/pos.module';
import { PosTableZonesService } from '../../src/modules/pos/pos-table-zones.service';
import { PosTablesService } from '../../src/modules/pos/pos-tables.service';
import { TenantContextService } from '../../src/kernel/tenancy/tenant-context.service';

/**
 * Configurable table zones (dining areas) — PosTableZonesService proof.
 * Runs the real service against a fresh org and asserts the lazy-seed,
 * CRUD, re-key guard and archive-with-references guard.
 */
describeDb('integration: configurable table zones (PosTableZonesService)', () => {
  const prisma = new PrismaClient();
  let moduleRef: TestingModule;
  let zones: PosTableZonesService;
  let tenant: TenantContextService;
  let organizationId: string;

  beforeAll(async () => {
    await prisma.$connect();
    const org = await prisma.organization.create({
      data: { code: `INT-ZON-${Date.now()}`, name: 'Zone Integration', currencyCode: 'UGX' },
    });
    organizationId = org.id;

    moduleRef = await Test.createTestingModule({ imports: [KernelModule, DocumentsModule, PosModule] }).compile();
    await moduleRef.init();
    zones = moduleRef.get(PosTableZonesService);
    tenant = moduleRef.get(TenantContextService);
  });

  afterAll(async () => {
    if (organizationId) {
      await prisma.posTable.deleteMany({ where: { organizationId } });
      await prisma.posTableZone.deleteMany({ where: { organizationId } });
      await prisma.auditLog.deleteMany({ where: { organizationId } });
      await prisma.eventOutbox.deleteMany({ where: { organizationId } });
      await prisma.organization.delete({ where: { id: organizationId } });
    }
    if (moduleRef) await moduleRef.close();
    await prisma.$disconnect();
  });

  it('lazy-seeds the 6 default zones in sortOrder for a fresh org', async () => {
    const rows: any[] = await tenant.run({ organizationId }, () => zones.list());
    expect(rows.length).toBe(6);
    expect(rows.map((z) => z.key)).toEqual([
      'indoor', 'outdoor', 'terrace', 'vip', 'garden', 'bar',
    ]);
    expect(rows.map((z) => z.sortOrder)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(rows.map((z) => z.name)).toEqual([
      'Indoor', 'Outdoor', 'Terrace', 'VIP', 'Garden', 'Bar',
    ]);
    expect(rows.every((z) => z.color && z.active && !z.deletedAt)).toBe(true);
  });

  it('creates, renames and reorders a custom zone', async () => {
    const created: any = await tenant.run({ organizationId }, () =>
      zones.create({ name: 'Rooftop', color: '#0ea5e9', sortOrder: 7 }),
    );
    expect(created.key).toBe('rooftop');
    expect(created.name).toBe('Rooftop');
    expect(created.sortOrder).toBe(7);

    const renamed: any = await tenant.run({ organizationId }, () =>
      zones.update(created.id, { name: 'Sky Deck', sortOrder: 0 }),
    );
    expect(renamed.name).toBe('Sky Deck');
    expect(renamed.sortOrder).toBe(0);
    // Key is immutable (tables reference it) — only name/color/order change.
    expect(renamed.key).toBe('rooftop');
  });

  it('rejects a duplicate zone key with 409', async () => {
    await expect(
      tenant.run({ organizationId }, () => zones.create({ name: 'Indoor Clone', key: 'indoor' })),
    ).rejects.toThrow(ConflictException);
  });

  it('rejects re-keying an existing zone with 400', async () => {
    const [zone]: any[] = await tenant.run({ organizationId }, () => zones.list());
    await expect(
      tenant.run({ organizationId }, () => zones.update(zone.id, { key: 'moved' })),
    ).rejects.toThrow(BadRequestException);
  });

  it('refuses to archive a zone that active tables reference (409)', async () => {
    const [zone]: any[] = await tenant.run({ organizationId }, () => zones.list());
    await prisma.posTable.create({
      data: { organizationId, number: 900, name: 'Ref-Table', seats: 2, zone: zone.key },
    });
    await expect(
      tenant.run({ organizationId }, () => zones.archive(zone.id)),
    ).rejects.toThrow(ConflictException);
  });

  it('archives a zone with no tables, hides it from list, then restores it', async () => {
    // Create a zone, point a table at it, then delete the table so it is free.
    const created: any = await tenant.run({ organizationId }, () =>
      zones.create({ name: 'Backroom', sortOrder: 99 }),
    );
    await prisma.posTable.create({
      data: { organizationId, number: 901, name: 'Backroom-1', seats: 2, zone: created.key },
    });
    await prisma.posTable.deleteMany({ where: { organizationId, number: 901 } });

    const archived: any = await tenant.run({ organizationId }, () => zones.archive(created.id));
    expect(archived.deletedAt).not.toBeNull();

    const visible: any[] = await tenant.run({ organizationId }, () => zones.list());
    expect(visible.find((z) => z.id === created.id)).toBeUndefined();

    const deleted: any[] = await tenant.run({ organizationId }, () => zones.listDeleted());
    expect(deleted.some((z) => z.id === created.id)).toBe(true);

    const restored: any = await tenant.run({ organizationId }, () => zones.restore(created.id));
    expect(restored.deletedAt).toBeNull();

    const visibleAfter: any[] = await tenant.run({ organizationId }, () => zones.list());
    expect(visibleAfter.find((z) => z.id === created.id)).toBeTruthy();
  });

  it('tables layer rejects unknown zone keys with 400 and accepts catalog keys', async () => {
    const tablesSvc = moduleRef.get(PosTablesService);

    // Unknown key → 400 with the available catalog in the message.
    await expect(
      tenant.run({ organizationId }, () =>
        tablesSvc.create({ name: 'BadZone', number: 902, seats: 2, zone: 'does_not_exist' }),
      ),
    ).rejects.toThrow(BadRequestException);

    // A custom catalog key resolves and the table is created under it.
    await tenant.run({ organizationId }, () =>
      zones.create({ name: 'Courtyard', sortOrder: 50 }),
    );
    const created: any = await tenant.run({ organizationId }, () =>
      tablesSvc.create({ name: 'Courtyard-1', number: 903, seats: 2, zone: 'courtyard' }),
    );
    expect(created.zone).toBe('courtyard');
  });
});
