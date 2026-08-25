/**
 * Phase 2 of the Fees production-hardening: pricing provenance (P1-A, P1-G) and
 * period control on every affected document (P1-B), plus credit expiry (P1-E).
 *
 * These cover FINANCIAL_INVARIANTS clauses added by this work:
 *
 *   §Pricing provenance — no financial transaction may derive its price from
 *     mutable configuration. FeeStructure → published FeeStructureVersion →
 *     FeeItem → billing → DocumentLine.
 *   §Period control — a mutation validates the period of EVERY document it
 *     touches, never only the period named in the request.
 */
import { BillingService } from '../../src/modules/school/fees/billing.service';
import { FeeStructureService } from '../../src/modules/school/fees/catalog.service';
import { FinanceControlsService } from '../../src/modules/school/fees/finance-controls.service';

const student = {
  id: 's1',
  partnerId: 'p1',
  admissionNo: 'ADM-001',
  currentClassId: 'c1',
  currentClass: { gradeLevelId: 'g1' },
};

/* ───────────────────────── pricing provenance ───────────────────────── */

function makeBilling(feeStructure: any, items: any[] = []) {
  const prisma = {
    client: {
      studentProfile: { findMany: jest.fn().mockResolvedValue([student]) },
      feeSchedule: { findMany: jest.fn().mockResolvedValue([{ id: 'sch1', dueDate: new Date(), feeStructure }]) },
      studentFeeAssignment: { findMany: jest.fn().mockResolvedValue([]) },
      scholarship: { findMany: jest.fn().mockResolvedValue([]) },
      discount: { findMany: jest.fn().mockResolvedValue([]) },
      studentOptionalFee: { findMany: jest.fn().mockResolvedValue([]) },
      feeItem: { findMany: jest.fn().mockResolvedValue(items) },
      document: { findFirst: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn(),
    },
  };
  const service = new BillingService(
    prisma as any,
    { organizationId: 'org_test' } as any,
    { publish: jest.fn() } as any,
    { next: jest.fn() } as any,
    { groupForPosting: jest.fn() } as any,
    { post: jest.fn() } as any,
    { mapped: jest.fn() } as any,
    { resolveIdByCode: jest.fn() } as any,
    { assertTermOpen: jest.fn().mockResolvedValue(undefined) } as any,
  );
  return { service, prisma };
}

describe('billing prices only from an immutable version (P1-A, P1-G)', () => {
  it('refuses to bill a DRAFT fee structure', async () => {
    // Billing used to read FeeStructure.components regardless of status, so an
    // unpublished, still-being-edited structure would invoice the school.
    const { service } = makeBilling({
      id: 'fs1',
      name: 'Work in progress',
      status: 'draft',
      currentVersionId: null,
      applicableTo: {},
      components: [{ code: 'TUITION', amount: 800_000 }],
    });

    const result = await service.generateForTerm({ termId: 'term_1' } as any);
    expect(result.count).toBe(0);
    expect(result.skipped[0]).toMatchObject({ studentProfileId: 's1', reason: 'unpriceable_structure' });
    expect(result.skipped[0].detail).toMatch(/draft, not published/);
  });

  it('refuses to bill a published structure that has no frozen version', async () => {
    const { service } = makeBilling({
      id: 'fs1',
      name: 'Standard',
      status: 'published',
      currentVersionId: null,
      applicableTo: {},
      components: [{ code: 'TUITION', amount: 800_000 }],
    });

    const result = await service.generateForTerm({ termId: 'term_1' } as any);
    expect(result.count).toBe(0);
    expect(result.skipped[0].detail).toMatch(/no published version/);
  });

  it('prices from the frozen FeeItem, NOT the mutable components JSON', async () => {
    // The heart of P1-A. The structure's JSON says 999,999 — someone edited it
    // after publication. The frozen version still says 800,000, and that is
    // what the student must be charged.
    const { service } = makeBilling(
      {
        id: 'fs1',
        name: 'Standard',
        status: 'published',
        currentVersionId: 'fsv1',
        applicableTo: {},
        components: [{ code: 'TUITION', amount: 999_999 }],
      },
      [
        {
          feeStructureVersionId: 'fsv1',
          code: 'TUITION',
          name: 'Tuition',
          productId: null,
          amount: 800_000,
          isOptional: false,
        },
      ],
    );

    let captured: any[] = [];
    jest.spyOn(service as any, 'billStudentTransaction').mockImplementation(async (...args: unknown[]) => {
      captured = args[4] as any[];
      return { _skipped: true, documentId: 'doc1' };
    });

    await service.generateForTerm({ termId: 'term_1' } as any);
    expect(captured).toHaveLength(1);
    expect(captured[0].unitPrice).toBe(800_000);
    expect(captured[0].unitPrice).not.toBe(999_999);
  });
});

describe('a published fee structure is frozen (P1-A)', () => {
  function makeCatalog(status: string) {
    const prisma = {
      client: {
        feeStructure: { findFirst: jest.fn().mockResolvedValue({ status, name: 'Standard' }) },
        feeCategory: { findMany: jest.fn().mockResolvedValue([]) },
      },
    };
    const service = new FeeStructureService(
      prisma as any,
      { organizationId: 'org_test' } as any,
      { record: jest.fn(), recordInTx: jest.fn() } as any,
    );
    return { service, prisma };
  }

  it('refuses a components edit once published, naming the repricing route', async () => {
    const { service } = makeCatalog('published');
    await expect(
      service.update('fs1', { components: [{ code: 'TUITION', amount: 999_999 }] } as any),
    ).rejects.toThrow(/publish/);
  });

  it('still allows editing a draft structure', async () => {
    const { service } = makeCatalog('draft');
    // Reaches normalizeComponents (and then the base CRUD update), i.e. it is
    // not rejected by the freeze. The base update is not mocked, so we only
    // assert that the ConflictException is NOT what comes back.
    await expect(
      service.update('fs1', { components: [{ code: 'TUITION', amount: 900_000 }] } as any),
    ).rejects.not.toThrow(/frozen/);
  });
});

/* ───────────────────────── period control ───────────────────────── */

describe('period control covers every affected document (P1-B)', () => {
  function makeControls(invoices: any[], closedTermIds: string[]) {
    const prisma = {
      client: {
        schoolFeeInvoice: { findMany: jest.fn().mockResolvedValue(invoices) },
        termFinancialClose: {
          findMany: jest.fn().mockResolvedValue(closedTermIds.map((termId) => ({ termId }))),
        },
      },
    };
    return new FinanceControlsService(
      prisma as any,
      { organizationId: 'org_test', userId: 'u1' } as any,
      { record: jest.fn(), recordInTx: jest.fn() } as any,
      { publish: jest.fn() } as any,
      { next: jest.fn() } as any,
      { post: jest.fn() } as any,
      { receivableAccount: jest.fn() } as any,
      { ensureByCode: jest.fn() } as any,
      { studentBalance: jest.fn() } as any,
    );
  }

  it('blocks a payment allocated to an invoice in a CLOSED term', async () => {
    // The gap this closes: assertTermOpen checks the term the REQUEST names. A
    // payment taken in an open Term 2 could still be allocated to a Term 1
    // invoice after Term 1 was closed and reconciled.
    const controls = makeControls(
      [{ termId: 'term_1', invoiceNumber: 'SFI-000001' }],
      ['term_1'],
    );
    await expect(controls.assertDocumentsPeriodOpen(['doc_1'])).rejects.toThrow(/financially closed term/);
  });

  it('allows the same allocation when the term is open', async () => {
    const controls = makeControls([{ termId: 'term_1', invoiceNumber: 'SFI-000001' }], []);
    await expect(controls.assertDocumentsPeriodOpen(['doc_1'])).resolves.toBeUndefined();
  });

  it('is a no-op for documents with no school invoice (nothing to close against)', async () => {
    const controls = makeControls([], ['term_1']);
    await expect(controls.assertDocumentsPeriodOpen(['doc_adhoc'])).resolves.toBeUndefined();
  });

  it('short-circuits on an empty document list without querying', async () => {
    const controls = makeControls([], []);
    await expect(controls.assertDocumentsPeriodOpen([])).resolves.toBeUndefined();
  });
});
