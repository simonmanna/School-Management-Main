import { AudienceResolverService } from './audience-resolver.service';
import { PlacementLookupService } from '../../school/enrollment/placement-lookup.service';

/**
 * Fixture: one class, three children, and the messy realities a school roster
 * actually contains — two siblings sharing a mother's phone, a father typed in
 * local format, a guardian with 'n/a' where a number should be.
 */
interface Fixture {
  students: {
    id: string;
    currentClassId: string;
    partner: { name: string; phone: string | null; phoneE164: string | null; email: string | null } | null;
    currentClass: { name: string } | null;
  }[];
  guardians: {
    studentProfileId: string;
    relationship: string;
    guardianContactId: string;
    isPrimary: boolean;
    receivesStatements: boolean;
    guardianContact: { firstName: string; lastName: string | null; phone: string | null; email: string | null } | null;
  }[];
}

function serviceWith(fx: Fixture) {
  const prisma = {
    raw: {
      studentProfile: {
        findMany: jest.fn(async ({ where }: { where: { id?: { in: string[] } } }) =>
          fx.students.filter((s) => (where.id?.in ? where.id.in.includes(s.id) : true)),
        ),
      },
      studentGuardian: {
        findMany: jest.fn(
          async ({
            where,
          }: {
            where: {
              studentProfileId: { in: string[] };
              isPrimary?: boolean;
              receivesStatements?: boolean;
            };
          }) =>
            fx.guardians
              .filter((g) => where.studentProfileId.in.includes(g.studentProfileId))
              .filter((g) => (where.isPrimary === undefined ? true : g.isPrimary === where.isPrimary))
              .filter((g) =>
                where.receivesStatements === undefined ? true : g.receivesStatements === where.receivesStatements,
              ),
        ),
      },
      portalIdentity: { findMany: jest.fn(async () => []) },
      // These learners carry only the StudentProfile projection — the
      // un-backfilled case the ADR-027 compat path exists for — so the class
      // name is resolved from the projected class id.
      enrollmentPlacement: { findMany: jest.fn(async () => []) },
      schoolClass: {
        findMany: jest.fn(async ({ where }: { where?: { id?: { in?: string[] } } } = {}) =>
          where?.id?.in?.includes('c1') ? [{ id: 'c1', name: CLASS.name }] : [],
        ),
      },
      gradeLevel: { findMany: jest.fn(async () => []) },
      section: { findMany: jest.fn(async () => []) },
      stream: { findMany: jest.fn(async () => []) },
      department: { findMany: jest.fn(async () => []) },
      staffProfile: { findMany: jest.fn(async () => []) },
      user: { findMany: jest.fn(async () => []) },
    },
  };
  return {
    svc: new AudienceResolverService(prisma as never, new PlacementLookupService(prisma as never)),
    prisma,
  };
}

const CLASS = { name: 'P5 East' };

const FIXTURE: Fixture = {
  students: [
    {
      id: 's1',
      currentClassId: 'c1',
      partner: { name: 'Aisha Nakato', phone: null, phoneE164: null, email: null },
      currentClass: CLASS,
    },
    {
      id: 's2',
      currentClassId: 'c1',
      partner: { name: 'Brian Nakato', phone: null, phoneE164: null, email: null },
      currentClass: CLASS,
    },
    {
      id: 's3',
      currentClassId: 'c1',
      partner: { name: 'Chloe Okot', phone: null, phoneE164: null, email: null },
      currentClass: CLASS,
    },
  ],
  guardians: [
    // Siblings s1 + s2 share one mother, on one handset.
    {
      studentProfileId: 's1',
      relationship: 'mother',
      guardianContactId: 'g-mum',
      isPrimary: true,
      receivesStatements: true,
      guardianContact: { firstName: 'Grace', lastName: 'Nakato', phone: '0772 123456', email: null },
    },
    {
      studentProfileId: 's2',
      relationship: 'mother',
      guardianContactId: 'g-mum',
      isPrimary: true,
      receivesStatements: true,
      guardianContact: { firstName: 'Grace', lastName: 'Nakato', phone: '+256-772-123456', email: null },
    },
    // A non-primary father who should not be messaged by default.
    {
      studentProfileId: 's1',
      relationship: 'father',
      guardianContactId: 'g-dad',
      isPrimary: false,
      receivesStatements: false,
      guardianContact: { firstName: 'Peter', lastName: 'Nakato', phone: '0700111222', email: null },
    },
    // s3's guardian has junk where a phone number should be.
    {
      studentProfileId: 's3',
      relationship: 'guardian',
      guardianContactId: 'g-none',
      isPrimary: true,
      receivesStatements: true,
      guardianContact: { firstName: 'Sarah', lastName: 'Okot', phone: 'n/a', email: null },
    },
  ],
};

describe('AudienceResolverService', () => {
  it('collapses siblings sharing one handset into a single message', async () => {
    // The whole point of per_recipient: Grace has two children in P5 East and
    // must be told about the closure once, not twice.
    const { svc } = serviceWith(FIXTURE);
    const r = await svc.resolve('org1', { scope: 'class', ids: ['c1'] }, '+256');

    const grace = r.members.filter((m) => m.displayName === 'Grace Nakato');
    expect(grace).toHaveLength(1);
    expect(grace[0].phone).toBe('+256772123456');
  });

  it('normalizes two spellings of one number to the same address', async () => {
    // '0772 123456' and '+256-772-123456' are one handset; if they normalized
    // differently the dedupe above would not fire and an opt-out would half-work.
    const { svc } = serviceWith(FIXTURE);
    const r = await svc.resolve('org1', { scope: 'class', ids: ['c1'] }, '+256');
    expect(r.members.map((m) => m.phone)).not.toContain('+2560772123456');
  });

  it('sends per child when the template needs the child (per_student)', async () => {
    const { svc } = serviceWith(FIXTURE);
    const r = await svc.resolve('org1', { scope: 'class', ids: ['c1'], dedupe: 'per_student' }, '+256');
    const grace = r.members.filter((m) => m.displayName === 'Grace Nakato');
    expect(grace).toHaveLength(2);
    expect(grace.map((g) => g.studentName).sort()).toEqual(['Aisha Nakato', 'Brian Nakato']);
  });

  it('reports an unusable phone number as unreachable instead of dropping it', async () => {
    // 'n/a' must become a line in the registrar's to-do list, not a silent
    // shortfall between "400 students" and "380 messages".
    const { svc } = serviceWith(FIXTURE);
    const r = await svc.resolve('org1', { scope: 'class', ids: ['c1'] }, '+256');

    expect(r.members.map((m) => m.displayName)).not.toContain('Sarah Okot');
    expect(r.unreachable.map((m) => m.displayName)).toContain('Sarah Okot');
    expect(r.counts.unreachable).toBe(1);
  });

  it('messages only the primary guardian by default', async () => {
    const { svc } = serviceWith(FIXTURE);
    const r = await svc.resolve('org1', { scope: 'class', ids: ['c1'] }, '+256');
    expect(r.members.map((m) => m.displayName)).not.toContain('Peter Nakato');
  });

  it('includes every guardian when primaryGuardianOnly is off', async () => {
    const { svc } = serviceWith(FIXTURE);
    const r = await svc.resolve('org1', { scope: 'class', ids: ['c1'], primaryGuardianOnly: false }, '+256');
    expect(r.members.map((m) => m.displayName)).toContain('Peter Nakato');
  });

  it('falls back to all guardians for a family with none flagged primary', async () => {
    // Otherwise that family silently receives nothing, and nothing in the report
    // says so — they simply are not there.
    const fx: Fixture = {
      students: [FIXTURE.students[0]],
      guardians: [{ ...FIXTURE.guardians[2], studentProfileId: 's1' }],
    };
    const { svc } = serviceWith(fx);
    const r = await svc.resolve('org1', { scope: 'class', ids: ['c1'] }, '+256');
    expect(r.members.map((m) => m.displayName)).toContain('Peter Nakato');
  });

  it('addresses students directly when asked', async () => {
    const { svc } = serviceWith(FIXTURE);
    const r = await svc.resolve('org1', { scope: 'class', ids: ['c1'], recipients: 'students' }, '+256');
    expect(r.members.length + r.unreachable.length).toBe(3);
    expect(r.members.concat(r.unreachable).every((m) => m.kind === 'student')).toBe(true);
  });

  it('restricts to statement recipients for fee-related sends', async () => {
    const { svc, prisma } = serviceWith(FIXTURE);
    await svc.resolve(
      'org1',
      { scope: 'class', ids: ['c1'], statementRecipientsOnly: true, primaryGuardianOnly: false },
      '+256',
    );
    const call = prisma.raw.studentGuardian.findMany.mock.calls[0][0] as { where: Record<string, unknown> };
    expect(call.where.receivesStatements).toBe(true);
  });

  it('counts distinct students, not rows', async () => {
    const { svc } = serviceWith(FIXTURE);
    const r = await svc.resolve('org1', { scope: 'class', ids: ['c1'], dedupe: 'per_student' }, '+256');
    expect(r.counts.students).toBe(3);
  });

  it('resolves an empty class without querying for guardians', async () => {
    const { svc, prisma } = serviceWith({ students: [], guardians: [] });
    const r = await svc.resolve('org1', { scope: 'class', ids: ['c-empty'] }, '+256');
    expect(r.members).toEqual([]);
    expect(prisma.raw.studentGuardian.findMany).not.toHaveBeenCalled();
  });
});
