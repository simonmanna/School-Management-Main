import { BadRequestException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { AuditService } from './audit.service';
import { TenantContextService } from '../tenancy/tenant-context.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * D1-3 acceptance: when AuditService.recordInTx throws, the surrounding
 * $transaction must roll back, leaving NO orphan business rows.
 *
 * Skipped automatically when no DATABASE_URL is configured.
 */
const HAS_DB = !!process.env.DATABASE_URL;
const describeDb = HAS_DB ? describe : describe.skip;

describeDb('AuditService.recordInTx (rolls back on audit failure)', () => {
  const prisma = new PrismaClient();
  const organizationId = '00000000-0000-0000-0000-000000000000';

  // Tenant context always returns this org for the test.
  const tenantSvc = {
    organizationId,
    userId: 'test-user',
  } as any;

  const prismaSvc = { client: prisma, raw: prisma } as any;
  const audit = new AuditService(prismaSvc, tenantSvc);

  let createdPartnerId: string | null = null;

  beforeAll(async () => {
    // Create a real org for the FK target.
    const org = await prisma.organization.create({
      data: { code: `AUDIT-TEST-${Date.now()}`, name: 'Audit Test Org', currencyCode: 'USD' },
    });
    (tenantSvc as any).organizationId = org.id;
    // Stash for cleanup.
    (audit as any).__orgId = org.id;
  });

  afterAll(async () => {
    const orgId = (audit as any).__orgId;
    if (createdPartnerId) {
      await prisma.partner.delete({ where: { id: createdPartnerId } }).catch(() => undefined);
    }
    if (orgId) await prisma.organization.delete({ where: { id: orgId } }).catch(() => undefined);
    await prisma.$disconnect();
  });

  it('rolls back the partner create when the audit row insert fails', async () => {
    // Simulate audit failure: call recordInTx with a too-long entityId that
    // exceeds the column's TEXT limit OR use a deliberately-broken tx.
    // Simpler & deterministic: wrap recordInTx in a patch that throws.
    const failingAudit = new AuditService(prismaSvc, tenantSvc);
    (failingAudit as any).prisma = {
      client: {
        auditLog: {
          create: jest.fn ? jest.fn().mockRejectedValue(new Error('forced audit failure')) : undefined,
        },
      },
      raw: prisma,
    } as any;

    let created: any = null;
    let threw = false;
    try {
      await prisma.$transaction(async (tx) => {
        const p = await tx.partner.create({
          data: { organizationId: (tenantSvc as any).organizationId, code: `AUD-${Date.now()}`, name: 'Should Roll Back' },
        });
        created = p;
        await (failingAudit as any).recordInTx(tx, {
          entity: 'Partner',
          entityId: p.id,
          action: 'create',
          newValues: p,
        });
      });
    } catch (err) {
      threw = true;
    }

    expect(threw).toBe(true);
    if (created) {
      const found = await prisma.partner.findFirst({ where: { id: created.id } });
      // The partner row should NOT exist — tx rolled back.
      expect(found).toBeNull();
    }
  });

  it('writes the audit row inside the same tx as the business write', async () => {
    const before = await prisma.auditLog.count();
    const partner = await prisma.$transaction(async (tx) => {
      const p = await tx.partner.create({
        data: { organizationId: (tenantSvc as any).organizationId, code: `OK-${Date.now()}`, name: 'Should Persist' },
      });
      createdPartnerId = p.id;
      await audit.recordInTx(tx, {
        entity: 'Partner',
        entityId: p.id,
        action: 'create',
        newValues: p,
      });
      return p;
    });
    const after = await prisma.auditLog.count();
    expect(after).toBe(before + 1);
    expect(partner.id).toBeDefined();
  });
});