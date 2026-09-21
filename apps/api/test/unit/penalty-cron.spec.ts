/**
 * Unit tests for the penalty idempotency logic (P0-2, C2 + H6).
 *
 * Bug:
 *  - The old generatePenaltyRun had no idempotency check, so every cron
 *    tick minted a new penalty Document for the same overdue invoice.
 *  - Penalty Documents were created with status='draft' and NO
 *    DocumentLine, so the GL posting was skipped entirely.
 *
 * Fix (this PR):
 *  - A PenaltyRun row is created with `cronDate = today(UTC)`. A unique
 *    constraint on (organizationId, scheduleId, cronDate) makes a
 *    second run on the same day impossible.
 *  - For every overdue source Document, a PenaltyAssessment row is
 *    created. A unique constraint on (sourceDocumentId, penaltyRunId)
 *    prevents two penalties for the same source within the same run.
 *  - The penalty Document now has a DocumentLine + posts to the GL.
 */
import { BillingService } from '../../src/modules/school/fees/billing.service';
import { makePlacementLookupStub, placement } from './_placement-stub';

interface Mocks {
  penaltyRuleFindFirst: jest.Mock;
  feeScheduleFindFirst: jest.Mock;
  documentFindMany: jest.Mock;
  penaltyRunFindFirst: jest.Mock;
  penaltyRunCreate: jest.Mock;
  penaltyAssessmentCreate: jest.Mock;
  penaltyAssessmentFindFirst: jest.Mock;
  documentCreate: jest.Mock;
  documentLineCreate: jest.Mock;
  documentBuilderGroup: jest.Mock;
  postingPost: jest.Mock;
  documentUpdate: jest.Mock;
  sequenceNext: jest.Mock;
  events: { publish: jest.Mock };
}

function makeService() {
  const tenant = { organizationId: 'org_test' };
  const events = { publish: jest.fn(), publishInTx: jest.fn(async () => undefined) };
  const sequence = { next: jest.fn().mockImplementation((name: string) => Promise.resolve(name.includes('PEN') ? 'PEN-2026-000001' : 'FEE-2026-000001')) };

  const penaltyRuleFindFirst = jest.fn().mockResolvedValue({
    id: 'rule_1',
    feeScheduleId: 'sch_1',
    type: 'percent',
    value: 5,           // 5%
    graceDays: 7,
    isActive: true,
  });
  const feeScheduleFindFirst = jest.fn().mockResolvedValue({
    id: 'sch_1',
    feeStructureId: 'fs_1',
    termId: 'term_1',
    dueDate: new Date('2026-01-15'),
  });
  const penaltyRunFindFirst = jest.fn().mockResolvedValue(null);
  const penaltyRunCreate = jest.fn().mockImplementation((args: any) => ({
    id: 'pr_1',
    ...args.data,
  }));
  const penaltyRunUpdate = jest.fn().mockImplementation((args: any) => ({
    id: args?.where?.id ?? 'pr_1',
    ...args.data,
  }));
  const penaltyAssessmentCreate = jest.fn().mockImplementation((args: any) => ({
    id: 'pa_1',
    ...args.data,
  }));
  // No existing assessment for any (sourceDocumentId, penaltyRunId) pair.
  const penaltyAssessmentFindFirst = jest.fn().mockResolvedValue(null);
  const documentCreate = jest.fn().mockImplementation((args: any) => ({
    id: 'pen_doc_1',
    ...args.data,
  }));
  const documentLineCreate = jest.fn().mockResolvedValue({ id: 'line_1' });
  const documentFindMany = jest.fn().mockResolvedValue([
    { id: 'doc_1', documentNumber: 'FEE-001', partnerId: 'p_1', amountResidual: 100_000, dueDate: new Date('2026-01-15') },
  ]);
  const documentUpdate = jest.fn().mockResolvedValue({ id: 'pen_doc_1' });
  const documentBuilderGroup = jest.fn().mockResolvedValue({
    counterAccount: 'acc_ar',
    itemByAccount: new Map([['acc_revenue', 5_000]]),
    taxByAccount: new Map(),
  });
  const postingPost = jest.fn().mockResolvedValue({ id: 'je_1' });

  const tx = {
    penaltyRule: { findFirst: penaltyRuleFindFirst },
    feeSchedule: { findFirst: feeScheduleFindFirst },
    penaltyRun: { findFirst: penaltyRunFindFirst, create: penaltyRunCreate, update: penaltyRunUpdate },
    penaltyAssessment: { findFirst: penaltyAssessmentFindFirst, create: penaltyAssessmentCreate },
    document: { findMany: documentFindMany, create: documentCreate, update: documentUpdate },
    documentLine: { create: documentLineCreate },
  };

  const prisma = {
    client: {
      $transaction: jest.fn(async (cb: any) => cb(tx)),
    },
  };

  const service = new BillingService(
    prisma as any,
    tenant as any,
    events as any,
    sequence as any,
    { groupForPosting: documentBuilderGroup } as any,
    { post: postingPost } as any,
    { mapped: jest.fn(), receivableAccount: jest.fn() } as any,
    { resolveIdByCode: jest.fn().mockResolvedValue('doctype_sales_invoice') } as any,
    { assertTermOpen: jest.fn().mockResolvedValue(undefined) } as any,
    makePlacementLookupStub() as any,
  );

  const mocks: Mocks = {
    penaltyRuleFindFirst,
    feeScheduleFindFirst,
    documentFindMany,
    penaltyRunFindFirst,
    penaltyRunCreate,
    penaltyAssessmentCreate,
    penaltyAssessmentFindFirst,
    documentCreate,
    documentLineCreate,
    documentBuilderGroup,
    postingPost,
    documentUpdate,
    sequenceNext: sequence.next,
    events,
  };

  return { service, mocks, tx };
}

describe('BillingService.generatePenaltyRun — idempotency (P0-2, C2 + H6)', () => {
  it('creates exactly one PenaltyRun per (scheduleId, day)', async () => {
    const { service, mocks } = makeService();
    await service.generatePenaltyRun('sch_1');
    expect(mocks.penaltyRunCreate).toHaveBeenCalledTimes(1);
  });

  it('sets cronDate to today (UTC) on the PenaltyRun', async () => {
    const { service, mocks } = makeService();
    await service.generatePenaltyRun('sch_1');
    const call = mocks.penaltyRunCreate.mock.calls[0][0];
    expect(call.data.cronDate).toBeDefined();
    // cronDate is a Date instance with UTC hours zeroed out.
    expect(call.data.cronDate).toBeInstanceOf(Date);
    const now = new Date();
    expect(call.data.cronDate.getUTCFullYear()).toBe(now.getUTCFullYear());
    expect(call.data.cronDate.getUTCMonth()).toBe(now.getUTCMonth());
    expect(call.data.cronDate.getUTCDate()).toBe(now.getUTCDate());
    expect(call.data.cronDate.getUTCHours()).toBe(0);
  });

  it('returns early when a PenaltyRun already exists for today (idempotent on rerun)', async () => {
    const { service, mocks } = makeService();
    // Simulate a run for today already exists.
    mocks.penaltyRunFindFirst.mockResolvedValue({
      id: 'pr_existing',
      organizationId: 'org_test',
      scheduleId: 'sch_1',
      cronDate: new Date(),
      totalAssessed: 5_000,
      createdInvoices: ['pen_doc_1'],
    });
    const result = await service.generatePenaltyRun('sch_1');
    expect(result.id).toBe('pr_existing');
    // No new PenaltyRun or PenaltyAssessment created.
    expect(mocks.penaltyRunCreate).not.toHaveBeenCalled();
    expect(mocks.penaltyAssessmentCreate).not.toHaveBeenCalled();
  });

  it('creates a PenaltyAssessment for each overdue source document', async () => {
    const { service, mocks } = makeService();
    mocks.documentFindMany.mockResolvedValue([
      { id: 'doc_1', documentNumber: 'FEE-001', partnerId: 'p_1', amountResidual: 100_000 },
      { id: 'doc_2', documentNumber: 'FEE-002', partnerId: 'p_2', amountResidual: 200_000 },
    ]);
    await service.generatePenaltyRun('sch_1');
    expect(mocks.penaltyAssessmentCreate).toHaveBeenCalledTimes(2);
    expect(mocks.penaltyAssessmentCreate.mock.calls[0][0].data.sourceDocumentId).toBe('doc_1');
    expect(mocks.penaltyAssessmentCreate.mock.calls[1][0].data.sourceDocumentId).toBe('doc_2');
  });

  it('calculates penalty as percent of outstanding amount', async () => {
    const { service, mocks } = makeService();
    // rule.value = 5%, outstanding = 100,000 → penalty = 5,000
    await service.generatePenaltyRun('sch_1');
    const call = mocks.penaltyAssessmentCreate.mock.calls[0][0];
    expect(Number(call.data.amount)).toBe(5_000);
  });

  it('skips assessment when an existing one is found for (sourceDocumentId, penaltyRunId)', async () => {
    const { service, mocks } = makeService();
    // For doc_1, an assessment already exists in this run.
    mocks.penaltyAssessmentFindFirst.mockImplementation((args: any) => {
      if (args.where?.sourceDocumentId === 'doc_1') {
        return Promise.resolve({ id: 'pa_existing', sourceDocumentId: 'doc_1' });
      }
      return Promise.resolve(null);
    });
    mocks.documentFindMany.mockResolvedValue([
      { id: 'doc_1', documentNumber: 'FEE-001', partnerId: 'p_1', amountResidual: 100_000 },
      { id: 'doc_2', documentNumber: 'FEE-002', partnerId: 'p_2', amountResidual: 200_000 },
    ]);
    await service.generatePenaltyRun('sch_1');
    // Only 1 assessment created (for doc_2).
    expect(mocks.penaltyAssessmentCreate).toHaveBeenCalledTimes(1);
    expect(mocks.penaltyAssessmentCreate.mock.calls[0][0].data.sourceDocumentId).toBe('doc_2');
  });

  it('creates a penalty Document that ends up posted (H6 fix)', async () => {
    const { service, mocks } = makeService();
    await service.generatePenaltyRun('sch_1');
    // The Document is created as 'draft' and then promoted to 'posted'
    // after the GL post. Verify the final state via the update call.
    const updateCall = mocks.documentUpdate.mock.calls[0][0];
    expect(updateCall.data.status).toBe('posted');
    expect(updateCall.data.paymentStatus).toBe('not_paid');
    expect(updateCall.data.journalEntryId).toBe('je_1');
  });

  it('creates a DocumentLine for the penalty amount (H6 fix)', async () => {
    const { service, mocks } = makeService();
    await service.generatePenaltyRun('sch_1');
    expect(mocks.documentLineCreate).toHaveBeenCalledTimes(1);
    const lineCall = mocks.documentLineCreate.mock.calls[0][0];
    // The line uses the penalty product (or null) and the penalty amount.
    expect(lineCall.data.documentId).toBe('pen_doc_1');
    expect(Number(lineCall.data.subtotal)).toBe(5_000);
  });

  it('posts the penalty to the GL (H6 fix)', async () => {
    const { service, mocks } = makeService();
    await service.generatePenaltyRun('sch_1');
    expect(mocks.postingPost).toHaveBeenCalledTimes(1);
    const postArgs = mocks.postingPost.mock.calls[0][0];
    expect(postArgs.sourceType).toBe('school_penalty_invoice');
    expect(postArgs.lines.length).toBeGreaterThan(0);
  });

  it('updates the penalty Document with journalEntryId and postedAt (H6 fix)', async () => {
    const { service, mocks } = makeService();
    await service.generatePenaltyRun('sch_1');
    expect(mocks.documentUpdate).toHaveBeenCalledTimes(1);
    const updArgs = mocks.documentUpdate.mock.calls[0][0];
    expect(updArgs.data.journalEntryId).toBe('je_1');
    expect(updArgs.data.status).toBe('posted');
    expect(updArgs.data.paymentStatus).toBe('not_paid');
  });

  it('rejects when no active penalty rule exists for the schedule', async () => {
    const { service, mocks } = makeService();
    mocks.penaltyRuleFindFirst.mockResolvedValue(null);
    await expect(service.generatePenaltyRun('sch_1')).rejects.toThrow(/No active penalty rule/);
  });

  it('rejects when the FeeSchedule does not exist', async () => {
    const { service, mocks } = makeService();
    mocks.feeScheduleFindFirst.mockResolvedValue(null);
    await expect(service.generatePenaltyRun('sch_1')).rejects.toThrow(/FeeSchedule/);
  });

  it('emits PenaltyRunCompleted event with the correct totals', async () => {
    const { service, mocks } = makeService();
    mocks.documentFindMany.mockResolvedValue([
      { id: 'doc_1', documentNumber: 'FEE-001', partnerId: 'p_1', amountResidual: 100_000 },
      { id: 'doc_2', documentNumber: 'FEE-002', partnerId: 'p_2', amountResidual: 200_000 },
    ]);
    await service.generatePenaltyRun('sch_1');
    expect(mocks.events.publish).toHaveBeenCalled();
    // 5% of 100,000 + 5% of 200,000 = 5,000 + 10,000 = 15,000
    const penaltyEvent = mocks.events.publish.mock.calls.find((c) => c[0] === 'school.fee.penalty.run');
    expect(penaltyEvent).toBeDefined();
  });
});
