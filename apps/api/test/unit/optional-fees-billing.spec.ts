/**
 * P3 — the optional-fee gate.
 *
 * A MANDATORY fee component bills every student a fee structure covers. An
 * OPTIONAL one bills nobody until a bursar opts that student in on the Optional
 * Fees screen. Before this, `isOptional` was stored on the component and then
 * ignored by `computeLines`, so a Swimming fee marked optional went onto every
 * student's invoice in the school.
 *
 * These tests drive `computeLines` directly (it is the whole decision) plus one
 * end-to-end `generateForTerm` pass to prove the opt-ins are actually loaded and
 * threaded through the batched path.
 */
import { BillingService } from '../../src/modules/school/fees/billing.service';

type Line = { productId?: string; description: string; quantity: number; unitPrice: number; discountPercent: number };

function makeService(overrides: Record<string, unknown> = {}) {
  const prisma = {
    client: {
      studentProfile: { findMany: jest.fn() },
      feeSchedule: { findMany: jest.fn() },
      document: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn(), update: jest.fn() },
      studentFeeAssignment: { findMany: jest.fn().mockResolvedValue([]), findFirst: jest.fn().mockResolvedValue(null) },
      scholarship: { findMany: jest.fn().mockResolvedValue([]) },
      discount: { findMany: jest.fn().mockResolvedValue([]) },
      studentOptionalFee: { findMany: jest.fn().mockResolvedValue([]) },
      schoolFeeInvoice: { create: jest.fn() },
      // P1-A: the batched run prices from the published version's FeeItem rows.
      feeItem: { findMany: jest.fn().mockResolvedValue([]) },
      product: { findMany: jest.fn().mockResolvedValue([]) },
      organization: { findFirst: jest.fn() },
      $transaction: jest.fn(),
      ...overrides,
    },
  };
  const service = new BillingService(
    prisma as any,
    { organizationId: 'org_test' } as any,
    { publish: jest.fn() } as any,
    { next: jest.fn().mockResolvedValue('SFI-000001') } as any,
    { groupForPosting: jest.fn() } as any,
    { post: jest.fn() } as any,
    { mapped: jest.fn() } as any,
    { resolveIdByCode: jest.fn().mockResolvedValue('doctype_sales_invoice') } as any,
    { assertTermOpen: jest.fn().mockResolvedValue(undefined) } as any,
  );
  return { service, prisma };
}

const student = {
  id: 's1',
  partnerId: 'p1',
  admissionNo: 'STU-001',
  currentClassId: 'c1',
  currentClass: { name: 'S.2', gradeLevelId: 'g1' },
};

const TUITION = { code: 'TUITION', name: 'School Fees', feeCategoryId: 'cat_tuition', amount: 800000, isOptional: false };
const SWIMMING = { code: 'SWIMMING', name: 'Swimming', feeCategoryId: 'cat_swim', amount: 50000, isOptional: true };

/** `computeLines` is private; the gate is the unit worth testing directly. */
const compute = (service: BillingService, components: any[], optIns: Map<string, number | null>): Line[] =>
  (service as any).computeLines(components, {}, [], [], student, optIns);

describe('BillingService — optional fee gating', () => {
  it('bills mandatory components to a student with no opt-ins at all', () => {
    const { service } = makeService();
    const lines = compute(service, [TUITION, SWIMMING], new Map());
    expect(lines).toHaveLength(1);
    expect(lines[0].description).toBe('School Fees');
    expect(lines[0].unitPrice).toBe(800000);
  });

  it('does NOT bill an optional component to a student who has not opted in', () => {
    const { service } = makeService();
    const lines = compute(service, [TUITION, SWIMMING], new Map());
    expect(lines.map((l) => l.description)).not.toContain('Swimming');
  });

  it('bills an optional component once the student is opted in', () => {
    const { service } = makeService();
    const lines = compute(service, [TUITION, SWIMMING], new Map([['cat_swim', null]]));
    expect(lines).toHaveLength(2);
    const swim = lines.find((l) => l.description === 'Swimming')!;
    // A null opt-in amount means "charge whatever the structure says".
    expect(swim.unitPrice).toBe(50000);
  });

  it('uses the per-student opt-in amount when one is set', () => {
    const { service } = makeService();
    const lines = compute(service, [TUITION, SWIMMING], new Map([['cat_swim', 75000]]));
    expect(lines.find((l) => l.description === 'Swimming')!.unitPrice).toBe(75000);
  });

  it('matches an opt-in by category CODE for structures saved before P3 (no feeCategoryId)', () => {
    const { service } = makeService();
    const legacy = { code: 'SWIMMING', amount: 50000, isOptional: true };
    const lines = compute(service, [TUITION, legacy], new Map([['SWIMMING', 60000]]));
    expect(lines).toHaveLength(2);
    expect(lines.find((l) => l.description === 'SWIMMING')!.unitPrice).toBe(60000);
  });

  it('returns no lines when every component is optional and nothing is opted in', () => {
    const { service } = makeService();
    expect(compute(service, [SWIMMING], new Map())).toEqual([]);
  });

  it('labels the invoice line with the category name, not the raw code', () => {
    const { service } = makeService();
    const lines = compute(service, [TUITION], new Map());
    expect(lines[0].description).toBe('School Fees');
  });

  it('threads opt-ins through the batched generateForTerm path', async () => {
    const { service, prisma } = makeService();
    prisma.client.studentProfile.findMany.mockResolvedValue([student]);
    prisma.client.feeSchedule.findMany.mockResolvedValue([
      {
        id: 'sch1',
        dueDate: new Date(),
        feeStructure: {
          id: 'fs1',
          name: 'Standard',
          academicYearId: 'ay1',
          applicableTo: {},
          // P1-A: published with a frozen version — billing reads the version's
          // FeeItem rows below, not these components.
          status: 'published',
          currentVersionId: 'fsv1',
          components: [TUITION, SWIMMING],
        },
      },
    ]);
    prisma.client.feeItem.findMany.mockResolvedValue(
      [TUITION, SWIMMING].map((c) => ({
        feeStructureVersionId: 'fsv1',
        code: c.code,
        name: c.name,
        productId: null,
        amount: c.amount,
        isOptional: c.isOptional,
      })),
    );
    prisma.client.studentOptionalFee.findMany.mockResolvedValue([
      { studentProfileId: 's1', feeCategoryId: 'cat_swim', amount: 90000, feeCategory: { code: 'SWIMMING' } },
    ]);

    // Capture the lines handed to the document builder inside the transaction.
    let captured: Line[] = [];
    const spy = jest
      .spyOn(service as any, 'billStudentTransaction')
      .mockImplementation(async (...args: unknown[]) => {
        captured = args[4] as Line[];
        return { _skipped: true, documentId: 'doc1' };
      });

    await service.generateForTerm({ termId: 'term_1' });
    expect(spy).toHaveBeenCalled();
    expect(captured).toHaveLength(2);
    expect(captured.find((l) => l.description === 'Swimming')!.unitPrice).toBe(90000);

    // The opt-in query must be scoped to the term and to active rows only.
    expect(prisma.client.studentOptionalFee.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ termId: 'term_1', isActive: true }),
      }),
    );
  });
});
