import { PrismaClient } from '@prisma/client';
import { AuditService } from './audit.service';

/**
 * D1-3 acceptance: when AuditService.recordInTx throws, the surrounding
 * $transaction must roll back, leaving NO orphan business rows.
 *
 * Requires DATABASE_URL. Runs in the `integration` jest project.
 */
// QA-01: this spec runs in the `integration` jest project, whose setup file
// hard-fails when DATABASE_URL is absent. It no longer skips itself.
const describeDb = describe;

describeDb('AuditService.recordInTx (rolls back on audit failure)', () => {
  const prisma = new PrismaClient();
  const organizationId = '00000000-0000-0000-0000-000000000000';

  // Tenant context always returns this org for the test.
  //
  // `optionalOrganizationId` is what recordInTx actually reads. The stub used to
  // omit it, so every call threw "called without a tenant context" — which made
  // the roll-back test pass for the wrong reason (it asserts only *that* it
  // threw) and the persistence test fail outright. A getter keeps it in sync
  // with the real org id assigned in beforeAll.
  const tenantSvc = {
    organizationId,
    get optionalOrganizationId() {
      return this.organizationId;
    },
    userId: 'test-user',
    requestId: 'phase0-request-id',
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
    // The failure has to happen on the transaction client, because that is what
    // recordInTx writes through. The previous version replaced
    // `(failingAudit as any).prisma.client.auditLog.create` — a path recordInTx
    // never touches — so nothing ever threw and the assertion below passed only
    // because the incomplete tenant stub was throwing for an unrelated reason.
    //
    // Here the real `tx` is wrapped so `auditLog.create` rejects while every
    // other model (the partner write) still goes to the genuine transaction.
    const failingTx = (tx: any) =>
      new Proxy(tx, {
        get(target, prop, receiver) {
          if (prop === 'auditLog') {
            return { create: () => Promise.reject(new Error('forced audit failure')) };
          }
          return Reflect.get(target, prop, receiver);
        },
      });

    let created: any = null;
    let threw = false;
    let thrownMessage = '';
    try {
      await prisma.$transaction(async (tx) => {
        const p = await tx.partner.create({
          data: { organizationId: (tenantSvc as any).organizationId, code: `AUD-${Date.now()}`, name: 'Should Roll Back' },
        });
        created = p;
        await audit.recordInTx(failingTx(tx), {
          entity: 'Partner',
          entityId: p.id,
          action: 'create',
          newValues: p,
        });
      });
    } catch (err) {
      threw = true;
      thrownMessage = err instanceof Error ? err.message : String(err);
    }

    expect(threw).toBe(true);
    // Prove it failed for the reason under test, not an unrelated one.
    expect(thrownMessage).toContain('forced audit failure');
    expect(created).not.toBeNull();
    const found = await prisma.partner.findFirst({ where: { id: created.id } });
    // The partner row must NOT exist — the tx rolled back.
    expect(found).toBeNull();
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
    const row = await prisma.auditLog.findFirstOrThrow({ where: { entity: 'Partner', entityId: partner.id } });
    expect(row.actorId).toBe('test-user');
    expect(row.requestId).toBe('phase0-request-id');
  });
});
