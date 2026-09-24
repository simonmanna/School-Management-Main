import { PortalIdentityService } from '../../src/kernel/auth/portal-identity.service';
import type { PortalClaim } from '../../src/kernel/auth/portal-identity.types';
import { ForbiddenException } from '@nestjs/common';

const PARENT = ['school:portal:parent', 'school:portal:student', 'school:portal:self', 'school:lms:read'];
const STUDENT = ['school:portal:student', 'school:portal:self'];
const ADMIN = ['school:read', 'school:portal:parent', 'school:portal:student'];

/**
 * L0.1/L0.6 — portal identity regression suite.
 *
 * The bug this guards against: `User` had no relation to `StudentProfile`, so
 * every student-scoped endpoint read the subject id off the URL and trusted it.
 * Any authenticated caller could read (and on some routes write) another family's
 * data by editing a query parameter, and the LMS capability guard's student
 * branch was dead code because nothing ever populated it.
 *
 * The rule these tests encode: the subject comes from the signed token, never
 * from request input. Do not relax a case without a replacement.
 */

/** Guardianship rows the fake StudentGuardian table will answer from. */
function makeService(
  claim: PortalClaim | undefined,
  guardianships: Array<{ studentProfileId: string; guardianContactId: string }> = [],
  permissions: string[] = [],
) {
  const studentGuardian = {
    findFirst: jest.fn(async (args: any) => {
      const w = args.where;
      const ids: string[] = w.guardianContactId?.in ?? [];
      const hit = guardianships.find(
        (g) => g.studentProfileId === w.studentProfileId && ids.includes(g.guardianContactId),
      );
      return hit ? { id: 'link_1' } : null;
    }),
    findMany: jest.fn(async (args: any) => {
      const w = args.where;
      const ids: string[] = w.guardianContactId?.in ?? [];
      const wanted: string[] | undefined = w.studentProfileId?.in;
      return guardianships
        .filter((g) => ids.includes(g.guardianContactId))
        .filter((g) => (wanted ? wanted.includes(g.studentProfileId) : true))
        .map((g) => ({ studentProfileId: g.studentProfileId }));
    }),
  };
  const prisma = { client: { studentGuardian }, raw: { portalIdentity: { findMany: jest.fn(async () => []) } } } as any;
  const tenant = { organizationId: 'org_1', userId: 'user_1', portal: claim, permissions } as any;
  return new PortalIdentityService(prisma, tenant);
}

describe('PortalIdentityService', () => {
  describe('principal()', () => {
    it('reports staff when the token carries no portal claim', () => {
      expect(makeService(undefined).principal()).toEqual({ kind: 'staff', userId: 'user_1' });
    });

    it('reports the student named by the token', () => {
      const svc = makeService({ kind: 'student', studentProfileId: 'sp_alice' });
      expect(svc.principal()).toEqual({ kind: 'student', userId: 'user_1', studentProfileId: 'sp_alice' });
    });

    it('reports a guardian with their contact ids', () => {
      const svc = makeService({ kind: 'guardian', guardianContactIds: ['gc_1', 'gc_2'] });
      expect(svc.principal()).toEqual({ kind: 'guardian', userId: 'user_1', guardianContactIds: ['gc_1', 'gc_2'] });
    });

    it('falls back to staff on a malformed claim rather than trusting it', () => {
      // A student claim with no id, or a guardian claim with no contacts, must not
      // become "some student" — it degrades to staff, which is gated separately.
      expect(makeService({ kind: 'student' } as PortalClaim).principal().kind).toBe('staff');
      expect(makeService({ kind: 'guardian', guardianContactIds: [] }).principal().kind).toBe('staff');
    });
  });

  describe('principal() — revoked family accounts', () => {
    // Revoking a PortalIdentity left the Parent role in place. The next login
    // carried no claim, principal() said "staff", and staff pass every
    // per-student gate: the revoked parent could read every pupil.
    it('refuses a parent account with no live claim instead of treating it as staff', async () => {
      const svc = makeService(undefined, [], PARENT);
      expect(() => svc.principal()).toThrow(ForbiddenException);
      await expect(svc.canAccessStudent('sp_anyone')).rejects.toThrow(ForbiddenException);
      await expect(svc.filterAccessibleStudents(['sp_a', 'sp_b'])).rejects.toThrow(ForbiddenException);
    });

    it('refuses a student account with no live claim', () => {
      expect(() => makeService(undefined, [], STUDENT).principal()).toThrow(ForbiddenException);
    });

    it('refuses a parent account whose claim is malformed', () => {
      expect(() => makeService({ kind: 'guardian', guardianContactIds: [] }, [], PARENT).principal()).toThrow(ForbiddenException);
    });

    it('still treats an administrator (who holds every grant) as staff', () => {
      expect(makeService(undefined, [], ADMIN).principal().kind).toBe('staff');
      expect(makeService(undefined, [], ['*']).principal().kind).toBe('staff');
    });
  });

  describe('canAccessStudent() — the impersonation gate', () => {
    it('lets a student see only themselves', async () => {
      const svc = makeService({ kind: 'student', studentProfileId: 'sp_alice' });
      await expect(svc.canAccessStudent('sp_alice')).resolves.toBe(true);
      await expect(svc.canAccessStudent('sp_bob')).resolves.toBe(false);
    });

    it('lets a guardian see their own child and no one else', async () => {
      const svc = makeService(
        { kind: 'guardian', guardianContactIds: ['gc_mum'] },
        [{ studentProfileId: 'sp_alice', guardianContactId: 'gc_mum' }],
      );
      await expect(svc.canAccessStudent('sp_alice')).resolves.toBe(true);
      await expect(svc.canAccessStudent('sp_bob')).resolves.toBe(false);
    });

    it('resolves a guardian\'s children live, so revoking a guardianship takes effect at once', async () => {
      // No guardianship rows => no access, even though the token still names the
      // contact. This is why the child list is NOT baked into the claim.
      const svc = makeService({ kind: 'guardian', guardianContactIds: ['gc_mum'] }, []);
      await expect(svc.canAccessStudent('sp_alice')).resolves.toBe(false);
    });

    it('passes staff through — they are gated by school permissions and LMS capabilities', async () => {
      await expect(makeService(undefined).canAccessStudent('sp_anyone')).resolves.toBe(true);
    });
  });

  describe('filterAccessibleStudents() — the batch gate', () => {
    it('drops other families from a parent-dashboard id list', async () => {
      const svc = makeService(
        { kind: 'guardian', guardianContactIds: ['gc_mum'] },
        [{ studentProfileId: 'sp_alice', guardianContactId: 'gc_mum' }],
      );
      // The parent portal accepts a comma-separated list; a caller appending
      // another family's id must get it stripped, not served.
      await expect(svc.filterAccessibleStudents(['sp_alice', 'sp_bob'])).resolves.toEqual(['sp_alice']);
    });

    it('reduces a student to their own id', async () => {
      const svc = makeService({ kind: 'student', studentProfileId: 'sp_alice' });
      await expect(svc.filterAccessibleStudents(['sp_alice', 'sp_bob'])).resolves.toEqual(['sp_alice']);
    });

    it('returns nothing for a guardian asked about an empty list', async () => {
      const svc = makeService({ kind: 'guardian', guardianContactIds: ['gc_mum'] }, []);
      await expect(svc.filterAccessibleStudents([])).resolves.toEqual([]);
    });
  });

  describe('accessibleStudents()', () => {
    it('gives a guardian every child, deduplicated across guardianship rows', async () => {
      const svc = makeService(
        { kind: 'guardian', guardianContactIds: ['gc_mum', 'gc_dad'] },
        [
          { studentProfileId: 'sp_alice', guardianContactId: 'gc_mum' },
          { studentProfileId: 'sp_alice', guardianContactId: 'gc_dad' },
          { studentProfileId: 'sp_ben', guardianContactId: 'gc_mum' },
        ],
      );
      await expect(svc.accessibleStudents()).resolves.toEqual(['sp_alice', 'sp_ben']);
    });

    it('gives a student just themselves', async () => {
      const svc = makeService({ kind: 'student', studentProfileId: 'sp_alice' });
      await expect(svc.accessibleStudents()).resolves.toEqual(['sp_alice']);
    });

    it('gives staff an empty set — they must scope by class or course, not by family', async () => {
      await expect(makeService(undefined).accessibleStudents()).resolves.toEqual([]);
    });
  });

  describe('claimFor() — what gets signed into the token', () => {
    function svcWithRows(rows: any[]) {
      const prisma = {
        client: { studentGuardian: { findFirst: jest.fn(), findMany: jest.fn() } },
        raw: { portalIdentity: { findMany: jest.fn(async () => rows) } },
      } as any;
      return new PortalIdentityService(prisma, { organizationId: 'org_1', userId: 'u1' } as any);
    }

    it('returns undefined for a staff account so it is treated as staff', async () => {
      await expect(svcWithRows([]).claimFor('u1', 'org_1')).resolves.toBeUndefined();
    });

    it('builds a student claim', async () => {
      const svc = svcWithRows([{ subjectType: 'student', studentProfileId: 'sp_alice', guardianContactId: null }]);
      await expect(svc.claimFor('u1', 'org_1')).resolves.toEqual({ kind: 'student', studentProfileId: 'sp_alice' });
    });

    it('builds a guardian claim carrying contact ids, not child ids', async () => {
      const svc = svcWithRows([
        { subjectType: 'guardian', studentProfileId: null, guardianContactId: 'gc_mum' },
        { subjectType: 'guardian', studentProfileId: null, guardianContactId: 'gc_dad' },
      ]);
      const claim = await svc.claimFor('u1', 'org_1');
      expect(claim).toEqual({ kind: 'guardian', guardianContactIds: ['gc_mum', 'gc_dad'] });
      // Children are deliberately absent — see the note in portal-identity.types.ts.
      expect(JSON.stringify(claim)).not.toContain('sp_');
    });
  });
});
