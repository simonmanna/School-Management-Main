/**
 * Integration — portal identity and LMS authorization, against a real DB.
 *
 * The unit suites mock Prisma, so they prove the branching logic but not that
 * the queries behind it actually scope correctly. These are the cases where a
 * wrong `where` clause is the whole bug:
 *
 *  - one family reading another's data through a real `StudentGuardian` join
 *  - the `PortalIdentity` CHECK constraint refusing a half-formed identity
 *  - tenancy isolation on the new LMS tables
 *  - a guardianship revoked mid-session taking effect immediately
 */
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { describeDb } from './_setup';
import { KernelModule } from '../../src/kernel/kernel.module';
import { DocumentsModule } from '../../src/modules/documents/documents.module';
import { CoreModule } from '../../src/modules/core/core.module';
import { AccountingModule } from '../../src/modules/accounting/accounting.module';
import { InventoryModule } from '../../src/modules/inventory/inventory.module';
import { InvoicingModule } from '../../src/modules/invoicing/invoicing.module';
import { SchoolModule } from '../../src/modules/school/school.module';
import { TenantContextService } from '../../src/kernel/tenancy/tenant-context.service';
import { PortalIdentityService } from '../../src/kernel/auth/portal-identity.service';
import type { PortalClaim } from '../../src/kernel/auth/portal-identity.types';

describeDb('integration: portal identity + LMS authorization', () => {
  const rawUrl = (() => {
    const u = process.env.DATABASE_URL ?? '';
    return u.includes('connection_limit=') ? u : `${u}${u.includes('?') ? '&' : '?'}connection_limit=1`;
  })();
  const raw = new PrismaClient({ datasources: { db: { url: rawUrl } } });

  let moduleRef: TestingModule;
  let tenant: TenantContextService;
  let identity: PortalIdentityService;

  const organizationId = `org_authz_${Date.now()}`;
  const otherOrgId = `org_other_${Date.now()}`;
  const setOrg = (id: string) => raw.$executeRawUnsafe(`SELECT set_config('app.org_id', $1, false)`, id);

  let alice = '';
  let bob = '';
  let mumContactId = '';
  let mumUserId = '';
  let aliceUserId = '';

  /** Run a block as a given portal principal — exactly what the token would carry. */
  const asPortal = <T>(portal: PortalClaim | undefined, userId: string, fn: () => Promise<T>): Promise<T> =>
    tenant.run({ organizationId, userId, permissions: ['school:read'], portal }, fn);

  beforeAll(async () => {
    await raw.$connect();
    await raw.currency.upsert({
      where: { code: 'UGX' },
      update: {},
      create: { code: 'UGX', symbol: 'USh', name: 'Ugandan Shilling', decimalPlaces: 0 },
    });
    await setOrg(organizationId);
    for (const [id, code] of [[organizationId, `AZ-${Date.now()}`], [otherOrgId, `AZ2-${Date.now()}`]] as const) {
      await raw.organization.create({ data: { id, code, name: 'Authz School', currencyCode: 'UGX' } });
    }

    const grade = await raw.gradeLevel.create({ data: { organizationId, name: 'S1', order: 8 } });
    const cls = await raw.schoolClass.create({ data: { organizationId, gradeLevelId: grade.id, name: 'S1 Authz' } });

    // Two unrelated pupils.
    const mk = async (name: string) => {
      const partner = await raw.partner.create({
        data: { organizationId, name, code: `P-AZ-${name}-${Date.now()}` },
      });
      return (await raw.studentProfile.create({
        data: {
          organizationId, partnerId: partner.id, admissionNo: `ADM-${name}-${Date.now()}`,
          currentClassId: cls.id, enrollmentDate: new Date(), status: 'active',
        },
      })).id;
    };
    alice = await mk('Alice');
    bob = await mk('Bob');

    // A guardian, related to Alice only.
    const mumPartner = await raw.partner.create({
      data: { organizationId, name: 'Mrs Doe', code: `P-MUM-${Date.now()}` },
    });
    const mumContact = await raw.contact.create({
      data: { organizationId, partnerId: mumPartner.id, firstName: 'Mrs', lastName: 'Doe' },
    });
    mumContactId = mumContact.id;
    await raw.studentGuardian.create({
      data: { organizationId, studentProfileId: alice, guardianContactId: mumContactId, relationship: 'mother', isPrimary: true },
    });

    // Login accounts + the identities that bind them to real people.
    const mkUser = async (email: string) =>
      (await raw.user.create({
        data: { organizationId, email, passwordHash: 'x', firstName: 'T', lastName: 'User', isActive: true },
      })).id;
    mumUserId = await mkUser(`mum-${Date.now()}@example.test`);
    aliceUserId = await mkUser(`alice-${Date.now()}@example.test`);

    await raw.portalIdentity.create({
      data: { organizationId, userId: aliceUserId, subjectType: 'student', studentProfileId: alice },
    });
    await raw.portalIdentity.create({
      data: { organizationId, userId: mumUserId, subjectType: 'guardian', guardianContactId: mumContactId },
    });

    moduleRef = await Test.createTestingModule({
      imports: [KernelModule, DocumentsModule, CoreModule, AccountingModule, InventoryModule, InvoicingModule, SchoolModule],
    }).compile();
    await moduleRef.init();
    tenant = moduleRef.get(TenantContextService);
    identity = moduleRef.get(PortalIdentityService);
  });

  afterAll(async () => {
    await moduleRef?.close();
    await raw.$disconnect();
  });

  describe('the PortalIdentity CHECK constraint', () => {
    it('refuses a student identity with no student, and a guardian with no contact', async () => {
      // The application relies on "exactly one subject per row"; the database is
      // where that is actually guaranteed.
      await expect(
        raw.portalIdentity.create({ data: { organizationId, userId: aliceUserId, subjectType: 'student' } }),
      ).rejects.toThrow();
      await expect(
        raw.portalIdentity.create({ data: { organizationId, userId: mumUserId, subjectType: 'guardian' } }),
      ).rejects.toThrow();
    });

    it('refuses a row naming both a student and a guardian', async () => {
      await expect(
        raw.portalIdentity.create({
          data: {
            organizationId, userId: aliceUserId, subjectType: 'student',
            studentProfileId: alice, guardianContactId: mumContactId,
          },
        }),
      ).rejects.toThrow();
    });
  });

  describe('claimFor — what login signs into the token', () => {
    it('builds a student claim from the real row', async () => {
      const claim = await tenant.run({ organizationId }, () => identity.claimFor(aliceUserId, organizationId));
      expect(claim).toEqual({ kind: 'student', studentProfileId: alice });
    });

    it('builds a guardian claim carrying contacts, not children', async () => {
      const claim = await tenant.run({ organizationId }, () => identity.claimFor(mumUserId, organizationId));
      expect(claim).toEqual({ kind: 'guardian', guardianContactIds: [mumContactId] });
      // Children are resolved live so a revocation bites immediately.
      expect(JSON.stringify(claim)).not.toContain(alice);
    });

    it('returns undefined for a staff account', async () => {
      const staffId = (await raw.user.create({
        data: { organizationId, email: `staff-${Date.now()}@example.test`, passwordHash: 'x', firstName: 'S', lastName: 'T', isActive: true },
      })).id;
      const claim = await tenant.run({ organizationId }, () => identity.claimFor(staffId, organizationId));
      expect(claim).toBeUndefined();
    });
  });

  describe('cross-family access', () => {
    it('a pupil reaches only themselves', async () => {
      await asPortal({ kind: 'student', studentProfileId: alice }, aliceUserId, async () => {
        await expect(identity.canAccessStudent(alice)).resolves.toBe(true);
        await expect(identity.canAccessStudent(bob)).resolves.toBe(false);
      });
    });

    it('a guardian reaches their own child through the real join, and no one else', async () => {
      await asPortal({ kind: 'guardian', guardianContactIds: [mumContactId] }, mumUserId, async () => {
        await expect(identity.canAccessStudent(alice)).resolves.toBe(true);
        await expect(identity.canAccessStudent(bob)).resolves.toBe(false);
        await expect(identity.accessibleStudents()).resolves.toEqual([alice]);
      });
    });

    it('strips another family from a batch request', async () => {
      // The parent portal accepts a comma-separated id list; appending someone
      // else's id must yield nothing, not their dashboard.
      await asPortal({ kind: 'guardian', guardianContactIds: [mumContactId] }, mumUserId, async () => {
        await expect(identity.filterAccessibleStudents([alice, bob])).resolves.toEqual([alice]);
      });
    });

    it('revoking the guardianship takes effect at once, without a new token', async () => {
      await raw.studentGuardian.updateMany({
        where: { organizationId, studentProfileId: alice, guardianContactId: mumContactId },
        data: { deletedAt: new Date() },
      });
      await asPortal({ kind: 'guardian', guardianContactIds: [mumContactId] }, mumUserId, async () => {
        // Same claim as before — the difference is the live lookup.
        await expect(identity.canAccessStudent(alice)).resolves.toBe(false);
        await expect(identity.accessibleStudents()).resolves.toEqual([]);
      });
      // Restore for any later test.
      await raw.studentGuardian.updateMany({
        where: { organizationId, studentProfileId: alice, guardianContactId: mumContactId },
        data: { deletedAt: null },
      });
    });
  });

  describe('tenancy isolation on the new tables', () => {
    it('a PortalIdentity in another org is invisible', async () => {
      const otherUser = await raw.user.create({
        data: { organizationId: otherOrgId, email: `other-${Date.now()}@example.test`, passwordHash: 'x', firstName: 'O', lastName: 'U', isActive: true },
      });
      const otherPartner = await raw.partner.create({
        data: { organizationId: otherOrgId, name: 'Other Pupil', code: `P-OT-${Date.now()}` },
      });
      const otherStudent = await raw.studentProfile.create({
        data: {
          organizationId: otherOrgId, partnerId: otherPartner.id, admissionNo: `ADM-OT-${Date.now()}`,
          enrollmentDate: new Date(), status: 'active',
        },
      });
      await raw.portalIdentity.create({
        data: { organizationId: otherOrgId, userId: otherUser.id, subjectType: 'student', studentProfileId: otherStudent.id },
      });

      // Resolving that user's claim while scoped to OUR org must find nothing —
      // otherwise a shared email across tenants would cross the boundary.
      const claim = await tenant.run({ organizationId }, () => identity.claimFor(otherUser.id, organizationId));
      expect(claim).toBeUndefined();
    });
  });
});
