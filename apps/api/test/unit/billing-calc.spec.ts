/**
 * Unit tests for the BillingService component-calculation logic.
 *
 * The BillingService.calculateForTerm applies discounts and scholarships
 * per component. We mock the DB so the math is exercised in isolation.
 */
import { BillingService } from '../../src/modules/school/fees/billing.service';

interface MockContext {
  prisma: any;
  tenant: any;
  events: any;
  sequence: any;
  documentBuilder: any;
  posting: any;
  determination: any;
}

function makeService(): { service: BillingService; mocks: MockContext } {
  const tenant = { organizationId: 'org_test' };
  const events = { publish: jest.fn() };
  const sequence = { next: jest.fn().mockResolvedValue('FEE-2026-000001') };
  const documentBuilder = { groupForPosting: jest.fn() };
  const posting = { post: jest.fn() };
  const determination = { mapped: jest.fn() };
  const prisma = {
    client: {
      studentProfile: { findMany: jest.fn() },
      feeSchedule: { findMany: jest.fn() },
      document: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn(), update: jest.fn() },
      // A3 batched the per-student lookups: one findMany each, up front.
      studentFeeAssignment: { findMany: jest.fn().mockResolvedValue([]) },
      scholarship: { findMany: jest.fn().mockResolvedValue([]) },
      discount: { findMany: jest.fn().mockResolvedValue([]) },
      // P3: the optional-fee opt-in lookup runs in the same batched Promise.all.
      studentOptionalFee: { findMany: jest.fn().mockResolvedValue([]) },
      schoolFeeInvoice: { create: jest.fn() },
      // P0-5 pre-flight: generateForTerm now refuses to run when any fee
      // product carries a non-zero sales tax, because the totals overwrite in
      // the loop would unbalance the journal and abort the run part way
      // through. Default to "no taxed products" so the existing math tests
      // exercise the path they were written for.
      product: { findMany: jest.fn().mockResolvedValue([]) },
      organization: { findFirst: jest.fn() },
      $transaction: jest.fn(),
    },
  };
  const dmsTypes = { resolveIdByCode: jest.fn().mockResolvedValue('doctype_sales_invoice') };
  const service = new BillingService(
    prisma as any,
    tenant as any,
    events as any,
    sequence as any,
    documentBuilder as any,
    posting as any,
    determination as any,
    dmsTypes as any,
    { assertTermOpen: jest.fn().mockResolvedValue(undefined) } as any,
  );
  return { service, mocks: { prisma, tenant, events, sequence, documentBuilder, posting, determination } };
}

describe('BillingService — generateForTerm math', () => {
  it('returns count=0 when there are no active students', async () => {
    const { service, mocks } = makeService();
    mocks.prisma.client.studentProfile.findMany.mockResolvedValue([]);
    await expect(
      service.generateForTerm({ termId: 'term_1' }),
    ).rejects.toThrow(/No active students/);
  });

  it('rejects when no fee schedule exists for the term', async () => {
    const { service, mocks } = makeService();
    mocks.prisma.client.studentProfile.findMany.mockResolvedValue([
      { id: 's1', partnerId: 'p1', admissionNo: 'STU-001', currentClassId: 'c1', currentClass: { name: 'P.1 A' } },
    ]);
    mocks.prisma.client.feeSchedule.findMany.mockResolvedValue([]);
    await expect(
      service.generateForTerm({ termId: 'term_missing' }),
    ).rejects.toThrow(/No fee schedule configured/);
  });

  it('skips existing invoices (idempotent on rerun)', async () => {
    const { service, mocks } = makeService();
    const student = {
      id: 's1', partnerId: 'p1', admissionNo: 'STU-001',
      currentClassId: 'c1', currentClass: { name: 'P.1 A' },
    };
    mocks.prisma.client.studentProfile.findMany.mockResolvedValue([student]);
    mocks.prisma.client.feeSchedule.findMany.mockResolvedValue([{
      id: 'sch1', dueDate: new Date(),
      feeStructure: {
        id: 'fs1', applicableTo: {}, components: [{ code: 'TUITION', productId: 'prod1', amount: 800000 }],
      },
    }]);
    // Existing invoice for the (student, schedule) tuple.
    // P0-6: the dedupe check now runs inside the $transaction callback
    // (tx.document.findFirst), not on prisma.client.document.findFirst.
    // The mock for `tx` resolves to { document: { findFirst: ... } }.
    mocks.prisma.client.$transaction.mockImplementation(async (cb: any) => {
      return cb({ document: { findFirst: jest.fn().mockResolvedValue({ id: 'existing-doc' }) } });
    });

    const result = await service.generateForTerm({ termId: 'term_1' });
    expect(result.count).toBe(0);
    expect(result.skipped).toEqual([
      { studentProfileId: 's1', documentId: 'existing-doc', reason: 'already_billed' },
    ]);
    // The transaction IS called (the dedupe check now happens inside it).
    expect(mocks.prisma.client.$transaction).toHaveBeenCalled();
  });

  it('treats a P2002 unique violation as "already exists" (P0-6 race-condition safety net)', async () => {
    const { service, mocks } = makeService();
    const student = {
      id: 's1', partnerId: 'p1', admissionNo: 'STU-001',
      currentClassId: 'c1', currentClass: { name: 'P.1 A' },
    };
    mocks.prisma.client.studentProfile.findMany.mockResolvedValue([student]);
    mocks.prisma.client.feeSchedule.findMany.mockResolvedValue([{
      id: 'sch1', dueDate: new Date(),
      feeStructure: {
        id: 'fs1', applicableTo: {}, components: [{ code: 'TUITION', productId: 'prod1', amount: 800000 }],
      },
    }]);
    // First call to the inner $transaction throws a Prisma P2002
    // (concurrent caller raced ahead and inserted the row first).
    mocks.prisma.client.$transaction.mockRejectedValueOnce({
      code: 'P2002',
      message: 'Unique constraint failed on the fields: (`organizationId`,`sourceType`,`sourceId`,`reference`)',
    });
    // The fallback findFirst (after catching P2002) returns the
    // existing row inserted by the racing caller.
    mocks.prisma.client.document.findFirst.mockResolvedValue({ id: 'raced-doc' });

    const result = await service.generateForTerm({ termId: 'term_1' });
    expect(result.count).toBe(0);
    expect(result.skipped).toEqual([
      { studentProfileId: 's1', documentId: 'raced-doc', reason: 'already_billed' },
    ]);
  });

  it('records a per-student failure instead of aborting the whole run (A3)', async () => {
    // A3 contract: a run of 2,000 students must not die because one student's
    // transaction failed. Non-P2002 errors are captured in `failed[]` with the
    // rest of the run continuing — "1,000 POSTED / 1 FAILED / 999 PENDING".
    const { service, mocks } = makeService();
    const student = {
      id: 's1', partnerId: 'p1', admissionNo: 'STU-001',
      currentClassId: 'c1', currentClass: { name: 'P.1 A' },
    };
    mocks.prisma.client.studentProfile.findMany.mockResolvedValue([student]);
    mocks.prisma.client.feeSchedule.findMany.mockResolvedValue([{
      id: 'sch1', dueDate: new Date(),
      feeStructure: {
        id: 'fs1', academicYearId: 'ay1', applicableTo: {},
        components: [{ code: 'TUITION', productId: 'prod1', amount: 800000 }],
      },
    }]);
    mocks.prisma.client.$transaction.mockRejectedValueOnce({
      code: 'P2003',  // foreign-key violation, NOT P2002
      message: 'Foreign key constraint failed',
    });
    const result = await service.generateForTerm({ termId: 'term_1' });
    expect(result.count).toBe(0);
    expect(result.failed).toEqual([
      { studentProfileId: 's1', error: 'Foreign key constraint failed' },
    ]);
  });
});