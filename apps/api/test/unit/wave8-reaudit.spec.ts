/**
 * Re-audit 2026-09-24 fixes that can be proven without a database.
 *
 *   #3  marks cannot be written into a CLOSED academic year
 *   #4  a class-scoped teacher cannot open a pupil or class they do not teach
 *   #10 an actor cannot edit or delete a role more powerful than themselves
 *   P1-2 phone numbers are sent in E.164 (+256 for a Ugandan 07… number)
 */
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { MarkingService } from '../../src/modules/school/assessment/marking.service';
import { RolesService } from '../../src/kernel/auth/staff/roles/roles.service';
import { DataScopeService } from '../../src/kernel/auth/data-scope.service';
import { toE164 } from '../../src/kernel/notifications/notifications.service';

describe('re-audit #3 — marking refuses a closed year', () => {
  function make(yearStatus: string) {
    const tx: any = {
      studentAssessment: {
        findFirst: jest.fn(async () => ({ id: 'sa1', assessmentId: 'a1', approvalStatus: 'draft', version: 1, maxScore: 100 })),
        updateMany: jest.fn(async () => ({ count: 1 })),
      },
      assessment: { findFirst: jest.fn(async () => ({ id: 'a1', termId: 't1', courseOfferingId: null, lockedAt: null })) },
      term: { findFirst: jest.fn(async () => ({ academicYearId: 'y1' })) },
      $queryRaw: jest.fn(async () => [{ id: 'y1', name: '2025', status: yearStatus }]),
      markEntry: { deleteMany: jest.fn(), create: jest.fn(), findMany: jest.fn(async () => []) },
    };
    const svc = new MarkingService(
      {} as any,
      { organizationId: 'org1', userId: 'u1', permissions: [] } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );
    return { svc, tx };
  }

  it('a mark posted into a CLOSED year is refused before the ledger is touched', async () => {
    const { svc, tx } = make('CLOSED');
    await expect(svc.postMark(tx, { studentAssessmentId: 'sa1', score: 50, source: 'manual' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(tx.studentAssessment.updateMany).not.toHaveBeenCalled();
  });

  it('an ARCHIVED year is refused too', async () => {
    const { svc, tx } = make('ARCHIVED');
    await expect(svc.postMark(tx, { studentAssessmentId: 'sa1', score: 50, source: 'manual' })).rejects.toThrow(/archived/);
  });

  it('a backfill re-projecting an approved exam mark is not blocked', async () => {
    const { svc, tx } = make('CLOSED');
    // Stops later for an unrelated reason (the mock has no recompute data);
    // what matters is that the year guard did not refuse it.
    await svc
      .postMark(tx, { studentAssessmentId: 'sa1', score: 50, source: 'exam', allowWhenApproved: true })
      .catch(() => undefined);
    expect(tx.studentAssessment.updateMany).toHaveBeenCalled();
  });
});

describe('re-audit #4 — teacher reads follow the classes they teach', () => {
  function make(scope: 'school' | 'class', taught: string[], seated: boolean) {
    const db: any = {
      user: { findFirst: jest.fn(async () => ({ roles: [{ dataScope: scope }] })) },
      teacherAssignment: { findMany: jest.fn(async () => taught.map((classId) => ({ classId }))) },
      timetableSlot: { findMany: jest.fn(async () => []) },
      schoolClass: { findMany: jest.fn(async () => []) },
      section: { findMany: jest.fn(async () => []) },
      schoolProfile: { findFirst: jest.fn(async () => ({ classTeacherScope: 'STREAM' })) },
      courseOfferingTeacher: { findMany: jest.fn(async () => []) },
      // Seat-based reads resolve the pupil through their current placement.
      studentProfile: { findMany: jest.fn(async (args: any) => (seated ? [{ id: args.where.AND[0].id.in[0] }] : [])) },
      enrollmentPlacement: { findFirst: jest.fn(async () => (seated ? { id: 'p1' } : null)) },
    };
    const svc = new DataScopeService(
      { client: db } as any,
      { organizationId: 'org1', userId: 'teacher' } as any,
      { staffProfileIdForCaller: async () => 'staff1' } as any,
      {} as any,
    );
    return { svc, db };
  }

  it('a class teacher may open a pupil seated in a class they teach', async () => {
    const { svc } = make('class', ['k1'], true);
    await expect(svc.assertMayReadStudent('pupil1')).resolves.toBeUndefined();
  });

  it('…but not a pupil in another class', async () => {
    const { svc } = make('class', ['k1'], false);
    await expect(svc.assertMayReadStudent('pupil2')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('…nor list a class they do not teach', async () => {
    const { svc } = make('class', ['k1'], false);
    await expect(svc.assertMayReadClass('k2')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(svc.assertMayReadClass('k1')).resolves.toBeUndefined();
  });

  it('school-wide staff are not narrowed', async () => {
    const { svc, db } = make('school', [], false);
    await expect(svc.assertMayReadStudent('anyone')).resolves.toBeUndefined();
    expect(db.studentProfile.findMany).not.toHaveBeenCalled();
  });

  it('only assignments in an open year count as teaching', async () => {
    const { svc, db } = make('class', ['k1'], true);
    await svc.assertMayReadStudent('pupil1');
    expect(db.teacherAssignment.findMany.mock.calls[0][0].where.OR).toEqual([
      { termId: null },
      { term: { academicYear: { status: { in: ['PLANNING', 'ACTIVE'] } } } },
    ]);
  });
});

describe('re-audit #10 — roles cannot be edited by someone weaker', () => {
  function make(actorPerms: string[], role: { name: string; permissions: string[]; isSystem?: boolean }) {
    const prisma: any = {
      client: {
        role: {
          findFirst: jest.fn(async () => ({ id: 'r1', organizationId: 'org1', _count: { users: 0 }, ...role })),
          updateMany: jest.fn(),
          delete: jest.fn(),
        },
        $transaction: jest.fn(),
      },
    };
    const svc = new RolesService(
      prisma,
      { recordInTx: jest.fn() } as any,
      { publish: jest.fn() } as any,
      { organizationId: 'org1', permissions: actorPerms } as any,
      { canGrantScope: async () => true } as any,
    );
    return { svc, prisma };
  }

  const admin = { name: 'Administrator', permissions: ['role:update', 'school:fees:read', 'user:create'], isSystem: true };

  it('an IT admin cannot strip the Administrator role', async () => {
    const { svc, prisma } = make(['role:update', 'user:create'], admin);
    await expect(svc.update('r1', { permissions: ['user:create'] } as any)).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.client.$transaction).not.toHaveBeenCalled();
  });

  it('a built-in role cannot be deleted, even by an administrator', async () => {
    const { svc } = make(['*'], admin);
    await expect(svc.remove('r1')).rejects.toThrow(/built-in/);
  });
});

describe('re-audit P1-2 — SMS numbers are E.164', () => {
  it.each([
    ['0772 123456', '+256772123456'],
    ['+256-772-123456', '+256772123456'],
    ['256772123456', '+256772123456'],
    ['(0772) 123 456', '+256772123456'],
  ])('%s → %s', (raw, e164) => {
    expect(toE164(raw, '+256')).toBe(e164);
  });

  it('rejects something that is not a phone number', () => {
    expect(() => toE164('12', '+256')).toThrow();
  });
});
