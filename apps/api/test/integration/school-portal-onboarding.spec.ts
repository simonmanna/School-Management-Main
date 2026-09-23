/**
 * Integration — a portal account, from invite to a working session.
 *
 * The identity layer was already correct and already tested. What was missing was
 * everything that turns identity into a usable login, and each gap failed quietly:
 *
 *  - `invite()` created a User with NO roles, and no seed anywhere minted a role
 *    holding `school:portal:*`. A guardian accepted their invite, signed in
 *    successfully, and was refused by every route. Nothing errored; the portal
 *    simply had users with no authority.
 *  - Every portal route made the caller name their own `studentProfileId`, which
 *    the client had no way to learn. `GET school/portals/me` is that first answer.
 *  - The per-student ownership check lived in a private method on one controller,
 *    so it protected exactly the routes someone remembered to call it from.
 *
 * These cases pin all three down, plus the rule that actually matters once
 * families can log in: one family must never read another's.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { PERMISSIONS } from '@erp/shared';
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
import { PortalAccountService } from '../../src/modules/school/portals/portal-account.service';
import { PortalsService } from '../../src/modules/school/portals/portals.service';
import { OneTimeTokenService } from '../../src/kernel/auth/one-time-token.service';
import type { PortalClaim } from '../../src/kernel/auth/portal-identity.types';
import { placeInClass } from './_placement';

describeDb('integration: portal onboarding — invite to working session', () => {
  const rawUrl = (() => {
    const u = process.env.DATABASE_URL ?? '';
    return u.includes('connection_limit=') ? u : `${u}${u.includes('?') ? '&' : '?'}connection_limit=1`;
  })();
  const raw = new PrismaClient({ datasources: { db: { url: rawUrl } } });

  let moduleRef: TestingModule;
  let tenant: TenantContextService;
  let identity: PortalIdentityService;
  let accounts: PortalAccountService;
  let portals: PortalsService;
  let tokens: OneTimeTokenService;

  const organizationId = `org_portal_${Date.now()}`;
  const setOrg = (id: string) => raw.$executeRawUnsafe(`SELECT set_config('app.org_id', $1, false)`, id);

  // The registrar who does the inviting. Being able to USE a portal must not
  // imply being able to MINT accounts that see other families, so this is a
  // separate grant from the portal permissions themselves.
  const REGISTRAR = [PERMISSIONS.school.read, PERMISSIONS.school.managePortalAccounts];

  let alice = '';
  let bob = '';
  let mumContactId = '';
  let registrarUserId = '';
  const mumEmail = `mum-${Date.now()}@example.test`;

  /** Run a block as staff. */
  const asStaff = <T>(userId: string, permissions: string[], fn: () => Promise<T>): Promise<T> =>
    tenant.run({ organizationId, userId, permissions }, fn);

  /** Run a block as a portal principal — exactly what the access token carries. */
  const asPortal = <T>(
    portal: PortalClaim,
    userId: string,
    permissions: string[],
    fn: () => Promise<T>,
  ): Promise<T> => tenant.run({ organizationId, userId, permissions, portal }, fn);

  beforeAll(async () => {
    await raw.$connect();
    await raw.currency.upsert({
      where: { code: 'UGX' },
      update: {},
      create: { code: 'UGX', symbol: 'USh', name: 'Ugandan Shilling', decimalPlaces: 0 },
    });
    await setOrg(organizationId);
    await raw.organization.create({
      data: { id: organizationId, code: `PT-${Date.now()}`, name: 'Portal School', currencyCode: 'UGX' },
    });

    const grade = await raw.gradeLevel.create({ data: { organizationId, name: 'P5', order: 5 } });
    const cls = await raw.schoolClass.create({ data: { organizationId, gradeLevelId: grade.id, name: 'P5 Blue' } });

    const mkPupil = async (name: string) => {
      const partner = await raw.partner.create({
        data: { organizationId, name, code: `P-PT-${name}-${Date.now()}` },
      });
      const sp = await raw.studentProfile.create({
        data: {
          organizationId,
          partnerId: partner.id,
          admissionNo: `ADM-${name}-${Date.now()}`,
          enrollmentDate: new Date(),
          status: 'active',
        },
      });
      await placeInClass(raw, { organizationId, studentProfileId: sp.id, classId: cls.id });
      return sp.id;
    };
    alice = await mkPupil('Alice');
    bob = await mkPupil('Bob');

    // A guardian of Alice, and of Alice only.
    const mumPartner = await raw.partner.create({
      data: { organizationId, name: 'Mrs Doe', code: `P-MUM-${Date.now()}` },
    });
    const mumContact = await raw.contact.create({
      data: { organizationId, partnerId: mumPartner.id, firstName: 'Mrs', lastName: 'Doe', email: mumEmail },
    });
    mumContactId = mumContact.id;
    await raw.studentGuardian.create({
      data: {
        organizationId,
        studentProfileId: alice,
        guardianContactId: mumContactId,
        relationship: 'mother',
        isPrimary: true,
      },
    });

    registrarUserId = (
      await raw.user.create({
        data: {
          organizationId,
          email: `registrar-${Date.now()}@school.test`,
          passwordHash: 'x',
          firstName: 'Reg',
          lastName: 'Istrar',
          isActive: true,
        },
      })
    ).id;

    moduleRef = await Test.createTestingModule({
      imports: [
        KernelModule,
        DocumentsModule,
        CoreModule,
        AccountingModule,
        InventoryModule,
        InvoicingModule,
        SchoolModule,
      ],
    }).compile();
    await moduleRef.init();
    tenant = moduleRef.get(TenantContextService);
    identity = moduleRef.get(PortalIdentityService);
    accounts = moduleRef.get(PortalAccountService);
    portals = moduleRef.get(PortalsService);
    tokens = moduleRef.get(OneTimeTokenService);
  });

  afterAll(async () => {
    await moduleRef?.close();
    await raw.$disconnect();
  });

  describe('invite to accept to a session that can actually do something', () => {
    let mumUserId = '';
    let inviteToken = '';

    it('mints an INACTIVE account carrying the Parent role', async () => {
      const res = await asStaff(registrarUserId, REGISTRAR, () =>
        accounts.invite({ subjectType: 'guardian', guardianContactId: mumContactId, email: mumEmail }),
      );
      mumUserId = res.userId;
      inviteToken = res.inviteToken;
      expect(inviteToken).toBeTruthy();

      const user = await raw.user.findUniqueOrThrow({
        where: { id: mumUserId },
        include: { roles: true },
      });
      // Inactive until they accept: an unaccepted invite must never be a login.
      expect(user.isActive).toBe(false);
      // The regression this suite exists for. Without a role the account signs in
      // and is then refused by everything.
      expect(user.roles.map((r) => r.name)).toContain('Parent');
      const parent = user.roles.find((r) => r.name === 'Parent');
      expect(parent?.permissions).toContain(PERMISSIONS.school.parentPortal);
      expect(parent?.permissions).toContain(PERMISSIONS.school.portalSelf);
      // A parent may not write anyone's marks.
      expect(parent?.permissions).not.toContain(PERMISSIONS.school.enterGrades);
      // And the row actually written to this tenant must not carry `school:read`.
      // That grant gates roughly three hundred routes — the full pupil register,
      // any family's fee balance, the gradebook, the marks workspace — none of
      // which the portal calls, all of which a guardian with a valid token and a
      // URL could. The preset is asserted separately in
      // test/unit/portal-role-surface.spec.ts; this checks what was persisted.
      expect(parent?.permissions).not.toContain(PERMISSIONS.school.read);
    });

    it('backfills the role on an org that predates portal roles', async () => {
      // `ensurePortalRole` creates on demand precisely so an org that existed
      // before portal roles did does not mint authority-less accounts forever.
      const role = await raw.role.findFirst({ where: { organizationId, name: 'Parent' } });
      expect(role).toBeTruthy();
      expect(role?.isSystem).toBe(true);
    });

    it('activates the account only when the invite is accepted', async () => {
      const before = await raw.user.findUniqueOrThrow({ where: { id: mumUserId } });
      expect(before.isActive).toBe(false);

      await tokens.acceptInvite(inviteToken, 'Str0ng-Passw0rd!');

      const after = await raw.user.findUniqueOrThrow({ where: { id: mumUserId } });
      expect(after.isActive).toBe(true);
      expect(after.passwordHash).not.toBe(before.passwordHash);
    });

    it('refuses a replayed invite with a 400, not a 500', async () => {
      // The page that consumes this needs to say "this link has expired"; a bare
      // Error surfaces as a server error and tells the parent nothing.
      await expect(tokens.acceptInvite(inviteToken, 'An0ther-Passw0rd!')).rejects.toMatchObject({
        status: 400,
      });
    });

    it('signs a guardian claim into the login token', async () => {
      const claim = await tenant.run({ organizationId }, () => identity.claimFor(mumUserId, organizationId));
      expect(claim).toEqual({ kind: 'guardian', guardianContactIds: [mumContactId] });
    });

    it('tells the portal who it is talking to, without being told first', async () => {
      const claim: PortalClaim = { kind: 'guardian', guardianContactIds: [mumContactId] };
      const ctx = await asPortal(claim, mumUserId, [PERMISSIONS.school.read], () => portals.myContext());

      expect(ctx.kind).toBe('guardian');
      expect(ctx.defaultLanding).toBe('parent');
      // Exactly her own child — resolved from the token, never from a parameter.
      expect(ctx.students.map((s) => s.studentProfileId)).toEqual([alice]);
      expect(ctx.students[0].name).toBe('Alice');
      expect(ctx.students[0].className).toBe('P5 Blue');
      expect(ctx.teacher).toBeNull();
    });

    it('serves her own child and refuses the other family', async () => {
      const claim: PortalClaim = { kind: 'guardian', guardianContactIds: [mumContactId] };
      await asPortal(claim, mumUserId, [PERMISSIONS.school.parentPortal], async () => {
        expect(await identity.canAccessStudent(alice)).toBe(true);
        expect(await identity.canAccessStudent(bob)).toBe(false);
        // The list form is where a naive check leaks: appending a stranger's id
        // to your own must not open both.
        expect(await identity.filterAccessibleStudents([alice, bob])).toEqual([alice]);
      });
    });

    it('cuts access off at revocation rather than at token expiry', async () => {
      const row = await raw.portalIdentity.findFirstOrThrow({
        where: { organizationId, userId: mumUserId, revokedAt: null },
      });
      await asStaff(registrarUserId, REGISTRAR, () => accounts.revoke(row.id));

      // The claim is rebuilt on every refresh, so a revoked identity stops
      // producing one — the 15-minute access token is the whole exposure.
      const claim = await tenant.run({ organizationId }, () => identity.claimFor(mumUserId, organizationId));
      expect(claim).toBeUndefined();

      const revoked = await raw.portalIdentity.findUniqueOrThrow({ where: { id: row.id } });
      expect(revoked.revokedAt).not.toBeNull();
    });
  });

  describe('a pupil', () => {
    let aliceUserId = '';

    it('is invited with the Student role, not the Parent one', async () => {
      const res = await asStaff(registrarUserId, REGISTRAR, () =>
        accounts.invite({
          subjectType: 'student',
          studentProfileId: alice,
          email: `alice-${Date.now()}@example.test`,
        }),
      );
      aliceUserId = res.userId;
      const user = await raw.user.findUniqueOrThrow({ where: { id: aliceUserId }, include: { roles: true } });
      const names = user.roles.map((r) => r.name);
      expect(names).toContain('Student');
      expect(names).not.toContain('Parent');
    });

    it('lands on their own dashboard and sees only themselves', async () => {
      const claim: PortalClaim = { kind: 'student', studentProfileId: alice };
      const ctx = await asPortal(claim, aliceUserId, [PERMISSIONS.school.read], () => portals.myContext());
      expect(ctx.kind).toBe('student');
      expect(ctx.defaultLanding).toBe('student');
      expect(ctx.students.map((s) => s.studentProfileId)).toEqual([alice]);
    });

    it('cannot reach another pupil by editing the id', async () => {
      const claim: PortalClaim = { kind: 'student', studentProfileId: alice };
      await asPortal(claim, aliceUserId, [PERMISSIONS.school.studentPortal], async () => {
        expect(await identity.canAccessStudent(bob)).toBe(false);
        expect(await identity.filterAccessibleStudents([bob])).toEqual([]);
      });
    });
  });

  describe('an active account belonging to somebody else', () => {
    it('is never silently handed a pupil', async () => {
      // Attaching a child's identity to an existing active login — most often a
      // member of staff — would quietly give that person the family's data.
      const email = `staff-${Date.now()}@school.test`;
      await raw.user.create({
        data: { organizationId, email, passwordHash: 'x', firstName: 'Some', lastName: 'Staff', isActive: true },
      });
      await expect(
        asStaff(registrarUserId, REGISTRAR, () =>
          accounts.invite({ subjectType: 'student', studentProfileId: bob, email }),
        ),
      ).rejects.toThrow(/already has an active account/i);
    });
  });

  describe('staff', () => {
    it('get an empty portal context rather than everyone', async () => {
      const ctx = await asStaff(registrarUserId, REGISTRAR, () => portals.myContext());
      expect(ctx.kind).toBe('staff');
      expect(ctx.students).toEqual([]);
      // No HrEmployee row, so no teacher facet and nowhere to land.
      expect(ctx.teacher).toBeNull();
      expect(ctx.defaultLanding).toBeNull();
    });
  });
});
