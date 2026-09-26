import { Prisma } from '@prisma/client';
import { LmsExecutionService } from '../../src/modules/school/lms/lms-execution.service';
import { FinanceControlsService } from '../../src/modules/school/fees/finance-controls.service';
import { AdvancedFinanceService } from '../../src/modules/school/fees/advanced.service';
import { SchoolFinanceQueryService } from '../../src/modules/school/fees/school-finance-query.service';
import { StudentAttendanceService } from '../../src/modules/school/attendance/student-attendance.service';
import { PromotionRunService } from '../../src/modules/school/enrollment/promotion-run.service';
import { FinanceCorrectionRequestService } from '../../src/modules/school/fees/finance-correction-request.service';
import { DataScopeService } from '../../src/kernel/auth/data-scope.service';

/**
 * Re-audit #3 (2026-09-25) — business-scenario findings. Each block names the
 * finding it pins. The ledger ones (P0-2 bounced receipt, P0-3 refund
 * ownership) live beside their services in allocation-reversal-ledger.spec.ts
 * and fees-phase0-hardening.spec.ts.
 */
const D = (n: number) => new Prisma.Decimal(n);

describe('P0-1 · family callers cannot read other pupils through LMS reporting', () => {
  function make(principal: any, accessible: string[] = []) {
    const findMany = jest.fn(async (_a: any) => []);
    const create = jest.fn(async (a: any) => a.data);
    const prisma = {
      client: {
        learningObjectiveProgress: { findMany },
        studentCourseProgress: { findMany },
        discussion: { create, findFirst: jest.fn(async () => ({ id: 'd_1' })) },
        discussionPost: { create },
      },
    };
    const tenant = { organizationId: 'org_1', userId: 'u_parent' };
    const portalIdentity = {
      principal: jest.fn(() => principal),
      accessibleStudents: jest.fn(async () => accessible),
    };
    const svc = new LmsExecutionService(prisma as any, tenant as any, {} as any, {} as any, portalIdentity as any);
    return { svc, findMany, create };
  }

  it("a parent naming another family's pupil gets nothing of theirs", async () => {
    const { svc, findMany } = make({ kind: 'guardian' }, ['own_child']);
    await svc.objectiveMastery({ studentProfileId: 'stranger' });
    expect(findMany.mock.calls[0][0].where.studentProfileId).toEqual({ in: [] });
  });

  it('a parent naming nobody is narrowed to their own children', async () => {
    const { svc, findMany } = make({ kind: 'guardian' }, ['own_child']);
    await svc.courseProgressList({});
    expect(findMany.mock.calls[0][0].where.studentProfileId).toEqual({ in: ['own_child'] });
  });

  it('staff are not narrowed', async () => {
    const { svc, findMany } = make({ kind: 'staff' });
    await svc.objectiveMastery({ studentProfileId: 'any' });
    expect(findMany.mock.calls[0][0].where.studentProfileId).toBe('any');
  });

  it('a post is authored by the caller, whatever the body claims', async () => {
    const { svc, create } = make({ kind: 'guardian' });
    await svc.addPost('d_1', { body: 'hi', authorId: 'the_head_teacher' });
    expect(create.mock.calls[0][0].data.authorId).toBe('u_parent');
    await svc.createDiscussion({ title: 't', createdById: 'the_head_teacher' });
    expect(create.mock.calls[1][0].data.createdById).toBe('u_parent');
  });
});

describe('P1-10 · a posted adjustment cannot be rejected', () => {
  it('refuses unless the adjustment is still pending', async () => {
    const updateMany = jest.fn(async () => ({ count: 0 }));
    const prisma = {
      client: {
        feeAdjustment: { findFirst: jest.fn(async () => ({ id: 'adj_1', code: 'ADJ-1', status: 'posted' })), updateMany },
      },
    };
    const svc = new FinanceControlsService(
      prisma as any, { organizationId: 'org_1' } as any, { record: jest.fn() } as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any,
    );
    await expect(svc.rejectAdjustment('adj_1', 'no')).rejects.toThrow(/not pending_approval/);
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'adj_1', status: 'pending_approval' } }));
  });
});

describe("P1-9 · an overpayment credit must be funded by the payer's own unallocated receipt", () => {
  function make(drawnCount: number) {
    const paymentUpdateMany = jest.fn(async (_a: any) => ({ count: drawnCount }));
    const tx = {
      studentProfile: { findFirst: jest.fn(async () => ({ id: 'stu_1', partnerId: 'p_1' })) },
      payment: { updateMany: paymentUpdateMany },
    };
    const prisma = { client: { $transaction: jest.fn(async (fn: any) => fn(tx)) } };
    const svc = new AdvancedFinanceService(
      prisma as any, { organizationId: 'org_1' } as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any,
    );
    const createCredit = jest.spyOn(svc, 'createCredit').mockResolvedValue({ id: 'cr_1' } as any);
    return { svc, paymentUpdateMany, createCredit };
  }

  it('draws the receipt down in the same transaction', async () => {
    const { svc, paymentUpdateMany, createCredit } = make(1);
    await svc.createCreditFromRequest({ studentProfileId: 'stu_1', amount: 200, source: 'overpayment', sourcePaymentId: 'pay_1' });
    expect(paymentUpdateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({ id: 'pay_1', partnerId: 'p_1', direction: 'inbound', unallocatedAmount: { gte: D(200) } }),
      data: { unallocatedAmount: { decrement: D(200) } },
    });
    expect(createCredit).toHaveBeenCalled();
  });

  it("refuses another payer's receipt, or one without that much unallocated", async () => {
    const { svc, createCredit } = make(0);
    await expect(
      svc.createCreditFromRequest({ studentProfileId: 'stu_1', amount: 200, source: 'overpayment', sourcePaymentId: 'pay_x' }),
    ).rejects.toThrow(/not a live receipt of this pupil's payer/);
    expect(createCredit).not.toHaveBeenCalled();
  });
});

describe('P1-7 · converted overpayment is not subtracted twice from the refundable amount', () => {
  it('refundable = unallocated + refundable credits', async () => {
    const db = {
      payment: { aggregate: jest.fn(async () => ({ _sum: { unallocatedAmount: D(150) } })) },
      feeCredit: {
        // A 200 overpayment converted long ago would have been subtracted again here.
        aggregate: jest.fn(async () => ({ _sum: { amount: D(200) } })),
        findMany: jest.fn(async () => [{ id: 'cr_1', code: 'CR-1', source: 'overpayment', remaining: D(50) }]),
      },
    };
    const svc = new SchoolFinanceQueryService({ client: db } as any, { organizationId: 'org_1' } as any, {} as any, {} as any);
    const r = await svc.refundableBreakdown('p_1', 'stu_1', db);
    expect(r.fromPayments).toBe(150);
    expect(r.fromCredits).toBe(50);
    expect(r.total).toBe(200);
  });
});

describe('P1-14 · correcting a closed year register is refused', () => {
  it('runs the closed-year guard for the corrected day', async () => {
    const queryRaw = jest.fn(async () => [{ id: 'y_1', name: '2025', status: 'CLOSED' }]);
    const tx = {
      $queryRaw: queryRaw,
      academicYear: { findFirst: jest.fn(async () => ({ id: 'y_1' })) },
      studentAttendance: { update: jest.fn() },
    };
    const prisma = {
      client: {
        studentAttendance: {
          findFirst: jest.fn(async () => ({ id: 'att_1', classId: 'c_1', date: new Date('2025-06-02'), studentProfileId: 's_1', status: 'absent' })),
        },
        $transaction: jest.fn(async (fn: any) => fn(tx)),
      },
    };
    const dataScope = { assertTeachesClass: jest.fn(async () => undefined) };
    const svc = new StudentAttendanceService(
      prisma as any, { organizationId: 'org_1' } as any, { publish: jest.fn() } as any, {} as any, {} as any, dataScope as any,
    );
    await expect(svc.correct('att_1', { status: 'present' } as any)).rejects.toThrow(/is closed/);
    expect(tx.studentAttendance.update).not.toHaveBeenCalled();
  });
});

describe('P1-11 · learners whose year was marked complete are still promoted', () => {
  it('the rollover reads completed seats as well as open ones', async () => {
    const placementFindMany = jest.fn(async (_a: any) => []);
    const client = {
      term: {
        findFirst: jest.fn(async (a: any) =>
          a.where.id === 't_from' ? { id: 't_from', academicYearId: 'y_2026' } : { id: 't_to', academicYearId: 'y_2027' },
        ),
      },
      academicYear: {
        findFirst: jest.fn(async (a: any) =>
          a.where.id === 'y_2026'
            ? { id: 'y_2026', name: '2026', startDate: new Date('2026-02-01') }
            : { id: 'y_2027', name: '2027', startDate: new Date('2027-02-01') },
        ),
      },
      enrollmentPlacement: { findMany: placementFindMany },
    };
    const svc = new PromotionRunService({ client } as any, { organizationId: 'org_1' } as any, {} as any, {} as any);
    await svc.rollover({ fromTermId: 't_from', toTermId: 't_to', dryRun: true } as any).catch(() => undefined);
    const where = placementFindMany.mock.calls[0][0].where;
    expect(where.OR).toEqual(
      expect.arrayContaining([{ endReason: 'COMPLETION', enrollment: { status: 'COMPLETED' } }]),
    );
  });
});


describe('D4 · fee corrections are maker-checker', () => {
  function make(permissions: string[], userId = 'u_1', request: any = null) {
    const tx = {
      approvalRequest: {
        create: jest.fn(async (a: any) => ({ id: 'req_1', ...a.data })),
        updateMany: jest.fn(async () => ({ count: 1 })),
      },
      approvalDecision: { create: jest.fn(async () => ({})) },
    };
    const prisma = {
      client: {
        $transaction: jest.fn(async (fn: any) => fn(tx)),
        approvalRequest: { findFirst: jest.fn(async () => request) },
      },
    };
    const tenant = { organizationId: 'org_1', userId, permissions };
    const audit = { recordInTx: jest.fn(async () => undefined) };
    const reversals = {
      reversePayment: jest.fn(async () => ({ paymentId: 'pay_1' })),
      reverseAllocation: jest.fn(async () => ({})),
      reallocate: jest.fn(async () => ({})),
    };
    const finance = { createCreditFromRequest: jest.fn(async () => ({ id: 'cr_1' })) };
    const svc = new FinanceCorrectionRequestService(prisma as any, tenant as any, audit as any, reversals as any, finance as any);
    return { svc, tx, reversals, finance };
  }
  const reverse = { kind: 'reverse_payment' as const, paymentId: 'pay_1', reason: 'cheque bounced' };

  it('a head teacher alone no longer reverses a receipt: the bursar requests, the head approves', async () => {
    const bursar = make(['school:fees:read', 'school:fees:refund'], 'u_bursar');
    const filed = await bursar.svc.submit(reverse);
    expect(filed.status).toBe('pending_approval');
    expect(bursar.reversals.reversePayment).not.toHaveBeenCalled();

    const request = { id: 'req_1', status: 'pending', createdById: 'u_bursar', snapshot: { correction: reverse } };
    const head = make(['school:fees:read', 'school:fees:refund:approve'], 'u_head', request);
    await head.svc.approve('req_1');
    expect(head.reversals.reversePayment).toHaveBeenCalledWith('pay_1', 'cheque bounced', head.tx);
  });

  it('the head teacher asking files a request too — nobody holding one side acts alone', async () => {
    const head = make(['school:fees:read', 'school:fees:refund:approve'], 'u_head');
    const filed = await head.svc.submit(reverse);
    expect(filed.status).toBe('pending_approval');
    expect(head.reversals.reversePayment).not.toHaveBeenCalled();
  });

  it('the requester cannot approve their own correction', async () => {
    const request = { id: 'req_1', status: 'pending', createdById: 'u_head', snapshot: { correction: reverse } };
    const head = make(['school:fees:refund:approve'], 'u_head', request);
    await expect(head.svc.approve('req_1')).rejects.toThrow(/you requested/);
  });

  it('a caller holding both sides applies at once (Administrator)', async () => {
    const admin = make(['school:fees:refund', 'school:fees:refund:approve']);
    const res = await admin.svc.submit(reverse);
    expect(res.status).toBe('applied');
    expect(admin.reversals.reversePayment).toHaveBeenCalled();
  });

  it('a manual credit needs the credit approver, not the refund approver', async () => {
    const credit = { kind: 'credit' as const, studentProfileId: 'stu_1', amount: 100, source: 'opening_balance' as const };
    const request = { id: 'req_2', status: 'pending', createdById: 'u_bursar', snapshot: { correction: credit } };
    const refundApprover = make(['school:fees:refund:approve'], 'u_head', request);
    await expect(refundApprover.svc.approve('req_2')).rejects.toThrow(/cannot decide/);
    const creditApprover = make(['school:fees:credit:approve'], 'u_head', request);
    await creditApprover.svc.approve('req_2');
    expect(creditApprover.finance.createCreditFromRequest).toHaveBeenCalled();
  });

  it('a caller with neither side is refused', async () => {
    const teacher = make(['school:fees:read']);
    await expect(teacher.svc.submit(reverse)).rejects.toThrow(/cannot request/);
  });
});

describe('P1-15 · a class teacher reads the class they are homeroom teacher of', () => {
  function make(homeroomClassIds: string[], sectionClassIds: string[]) {
    const db: any = {
      user: { findFirst: jest.fn(async () => ({ roles: [{ dataScope: 'class' }] })) },
      teacherAssignment: { findMany: jest.fn(async () => []) },
      timetableSlot: { findMany: jest.fn(async () => []) },
      schoolClass: { findMany: jest.fn(async () => homeroomClassIds.map((id) => ({ id }))) },
      section: { findMany: jest.fn(async () => sectionClassIds.map((classId) => ({ classId }))) },
    };
    return new DataScopeService(
      { client: db } as any,
      { organizationId: 'org1', userId: 'teacher' } as any,
      { staffProfileIdForCaller: async () => 'staff1' } as any,
      {} as any,
    );
  }

  it('homeroom (class) teacher with no subject rows still sees their class', async () => {
    await expect(make(['p4'], []).assertMayReadClass('p4')).resolves.toBeUndefined();
  });

  it('stream (section) class teacher sees the class of their stream', async () => {
    await expect(make([], ['p4']).assertMayReadClass('p4')).resolves.toBeUndefined();
    await expect(make([], ['p4']).assertMayReadClass('p5')).rejects.toThrow(/classes you teach/);
  });
});

