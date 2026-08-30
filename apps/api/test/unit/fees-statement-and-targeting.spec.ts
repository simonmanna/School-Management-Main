/**
 * Functional Phase A — D1 (one canonical fee figure everywhere) and
 * D2 (fee-structure targeting).
 *
 * D1: the parent portal and the bursar statement both used to report
 *     `paid = billed - balance`. Waivers, credit applications and credit
 *     adjustments all reduce `amountResidual`, so every shilling the school
 *     FORGAVE was reported to the family as money they had paid — and on the
 *     bursar statement that figure sits directly beside the actual receipts,
 *     so the two contradicted each other on screen.
 *
 * D2: `appliesTo` honoured `classIds` and silently ignored `gradeLevelIds`,
 *     which the schema documents and `discountApplies` respects. A structure
 *     scoped to P1–P3 billed the whole school.
 */
import { BillingService } from '../../src/modules/school/fees/billing.service';
import { PortalsService } from '../../src/modules/school/portals/portals.service';
import { StudentService } from '../../src/modules/school/people/student.service';

/* ───────────────────── D1 · one canonical figure ───────────────────── */

/**
 * A pupil billed 1,000,000 who PAID 200,000 and was WAIVED 300,000.
 * The old arithmetic reported paid = 1,000,000 − 500,000 = 500,000.
 */
const BALANCE = {
  studentProfileId: 'stu_1',
  billed: 1_000_000,
  collected: 200_000,
  waived: 300_000,
  credited: 0,
  adjusted: 0,
  balance: 500_000,
  invoiceCount: 2,
};

describe('D1 · the parent portal reports received money, not forgiven money', () => {
  function makePortal() {
    const finance = { studentBalance: jest.fn().mockResolvedValue(BALANCE) };
    const prisma = {
      client: {
        studentProfile: {
          findMany: jest.fn().mockResolvedValue([
            { id: 'stu_1', partnerId: 'p_1', currentClassId: 'c1' },
          ]),
        },
        studentAttendance: { findMany: jest.fn().mockResolvedValue([]) },
        announcement: { findMany: jest.fn().mockResolvedValue([]) },
      },
    };
    const service = new PortalsService(
      prisma as any,
      { organizationId: 'org_test' } as any,
      // Identity resolvers: this suite exercises the fee arithmetic, not who may
      // see it. Ownership is covered by the portal-identity specs.
      { principal: () => ({ kind: 'staff', userId: 'u_1' }), accessibleStudents: jest.fn().mockResolvedValue([]) } as any,
      { forUser: jest.fn().mockResolvedValue(null) } as any,
      { catalogByCode: jest.fn().mockResolvedValue({}) } as any,
      finance as any,
    );
    return { service, finance };
  }

  it('reports collected, not billed − balance', async () => {
    const { service, finance } = makePortal();
    const [row] = await service.parentDashboard(['stu_1']);

    expect(row.fees.collected).toBe(200_000);
    // The old figure. If this ever comes back, a bursary family is being told
    // they paid a third of a million shillings they never paid.
    expect(row.fees.collected).not.toBe(500_000);
    expect(finance.studentBalance).toHaveBeenCalledWith('stu_1');
  });

  it('reports the waiver as its own figure, never folded into paid', async () => {
    const { service } = makePortal();
    const [row] = await service.parentDashboard(['stu_1']);

    expect(row.fees.waived).toBe(300_000);
    expect(row.fees.total).toBe(1_000_000);
    expect(row.fees.balance).toBe(500_000);
    // The identity a parent can check by hand.
    expect(row.fees.total - row.fees.collected - row.fees.waived - row.fees.credited).toBe(
      row.fees.balance,
    );
  });

  it('exposes no derived "paid" field at all', async () => {
    const { service } = makePortal();
    const [row] = await service.parentDashboard(['stu_1']);
    expect(row.fees).not.toHaveProperty('paid');
  });
});

describe('D1 · the bursar statement agrees with the receipts printed beside it', () => {
  function makeStudentService(payments: Array<{ amount: number }>) {
    const finance = { studentBalance: jest.fn().mockResolvedValue(BALANCE) };
    const prisma = {
      client: {
        studentProfile: {
          findFirst: jest.fn().mockResolvedValue({
            id: 'stu_1',
            partnerId: 'p_1',
            admissionNo: 'ADM-001',
          }),
        },
        partner: { findFirst: jest.fn().mockResolvedValue({ id: 'p_1', name: 'Nakato Sarah' }) },
        document: { findMany: jest.fn().mockResolvedValue([]) },
        payment: {
          findMany: jest.fn().mockResolvedValue(
            payments.map((p, i) => ({
              id: `pay_${i}`,
              paymentNumber: `PAY-${i}`,
              amount: p.amount,
              paymentDate: new Date(),
              paymentMethod: 'cash',
            })),
          ),
        },
      },
    };
    return new StudentService(
      prisma as any,
      { organizationId: 'org_test' } as any,
      { record: jest.fn(), recordInTx: jest.fn() } as any,
      { publish: jest.fn(), publishInTx: jest.fn(async () => undefined) } as any,
      { next: jest.fn() } as any,
      finance as any,
    );
  }

  it('reports collected equal to the sum of the receipts it renders', async () => {
    // The defining symptom: the statement showed "Paid 500,000" next to a
    // receipts list totalling 200,000.
    const service = makeStudentService([{ amount: 150_000 }, { amount: 50_000 }]);
    const st: any = await service.statement('stu_1');

    const receiptTotal = st.payments.reduce((t: number, p: any) => t + Number(p.amount), 0);
    expect(st.collected).toBe(receiptTotal);
    expect(st.collected).toBe(200_000);
  });

  it('reports the waiver separately and drops the derived totalPaid', async () => {
    const service = makeStudentService([{ amount: 200_000 }]);
    const st: any = await service.statement('stu_1');

    expect(st.waived).toBe(300_000);
    expect(st).not.toHaveProperty('totalPaid');
    expect(st.totalBilled - st.collected - st.waived - st.credited).toBe(st.balance);
  });
});

/* ───────────────────── D2 · structure targeting ───────────────────── */

describe('D2 · fee structures target class, grade level and residence', () => {
  const service = new BillingService(
    {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any,
  );
  const applies = (filter: any, axes: any) => (service as any).appliesTo(filter, axes);

  const p1Day = { classId: 'c_p1a', gradeLevelId: 'g_p1', residenceType: 'day' };
  const p5Boarder = { classId: 'c_p5a', gradeLevelId: 'g_p5', residenceType: 'boarder' };

  it('applies to everyone when no filter is set', () => {
    expect(applies({}, p1Day)).toBe(true);
    expect(applies(null, p5Boarder)).toBe(true);
  });

  it('honours gradeLevelIds — the defect', () => {
    // A "lower primary" structure must not bill P5. Before the fix this
    // returned true for every pupil in the school.
    const lowerPrimary = { gradeLevelIds: ['g_p1', 'g_p2', 'g_p3'] };
    expect(applies(lowerPrimary, p1Day)).toBe(true);
    expect(applies(lowerPrimary, p5Boarder)).toBe(false);
  });

  it('honours classIds as before', () => {
    expect(applies({ classIds: ['c_p1a'] }, p1Day)).toBe(true);
    expect(applies({ classIds: ['c_p1a'] }, p5Boarder)).toBe(false);
  });

  it('prices boarders apart from day pupils', () => {
    const boardingOnly = { residenceTypes: ['boarder'] };
    expect(applies(boardingOnly, p5Boarder)).toBe(true);
    expect(applies(boardingOnly, p1Day)).toBe(false);
  });

  it('ANDs every dimension', () => {
    // "P5 boarders" — matches the boarder, not a hypothetical P5 day pupil.
    const filter = { gradeLevelIds: ['g_p5'], residenceTypes: ['boarder'] };
    expect(applies(filter, p5Boarder)).toBe(true);
    expect(applies(filter, { ...p5Boarder, residenceType: 'day' })).toBe(false);
    expect(applies(filter, p1Day)).toBe(false);
  });

  it('reads the axes off a student profile, defaulting residence to day', () => {
    const axes = (service as any).targetingAxes({
      currentClassId: 'c_p1a',
      currentClass: { gradeLevelId: 'g_p1' },
    });
    expect(axes).toEqual({ classId: 'c_p1a', gradeLevelId: 'g_p1', residenceType: 'day' });
  });
});
