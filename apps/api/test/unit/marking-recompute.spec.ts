/**
 * `MarkingService.recompute` — and the self-heal that stops it destroying data.
 *
 * The invariant: `originalScore` / `effectiveScore` / `percentage` are DERIVED
 * from the MarkEntry rounds and the MarkAdjustment ledger. Nothing may write
 * them directly.
 *
 * Two producers used to break that rule — the LMS grade bridge and the homework
 * bridge both set `effectiveScore` with no MarkEntry behind it. Because
 * `computeEffective` returns all-null for a row with no ledger, the next
 * `recompute()` on such a row silently DELETED the mark. 19 live rows on the
 * working database were in that state when this was written.
 *
 * `healLedgerlessScore` adopts an orphaned score into the ledger instead of
 * discarding it. These tests pin that behaviour, and pin that it does NOT fire
 * for rows that legitimately have no score.
 */
import { HEAL_COMMENT, MarkingService } from '../../src/modules/school/assessment/marking.service';

type Row = { id: string; round: string; score: unknown; comment?: string | null };

function makeService(sa: Record<string, unknown>, entries: Row[] = [], adjustments: any[] = []) {
  const created: any[] = [];
  const updated: any[] = [];

  const tx: any = {
    studentAssessment: {
      findFirst: jest.fn().mockResolvedValue(sa),
      updateMany: jest.fn().mockImplementation((args: any) => {
        updated.push(args.data);
        return Promise.resolve({ count: 1 });
      }),
    },
    markEntry: {
      findMany: jest.fn().mockResolvedValue(entries),
      create: jest.fn().mockImplementation((args: any) => {
        const row = { id: `me_${created.length + 1}`, ...args.data };
        created.push(row);
        return Promise.resolve(row);
      }),
    },
    markAdjustment: { findMany: jest.fn().mockResolvedValue(adjustments) },
  };

  const service = new MarkingService(
    { client: {} } as any,
    { organizationId: 'org_1', userId: 'user_1' } as any,
    { record: jest.fn(), recordInTx: jest.fn() } as any,
    { publish: jest.fn(), publishInTx: jest.fn(async () => undefined) } as any,
    // Ownership resolver. This suite exercises the recompute kernel, not who is
    // allowed to run it; assessment ownership is covered by the marking-ownership
    // spec.
    { isSelfTeacher: jest.fn().mockResolvedValue(false) } as any,
    // DataScopeService mock (added when marking ownership moved to DataScopeService).
    { assertOwnsStaffRecord: jest.fn().mockResolvedValue(undefined) } as any,
  );
  // Silence the intentional warn — its presence is asserted via the created row.
  jest.spyOn((service as any).logger, 'warn').mockImplementation(() => undefined);

  return { service, tx, created, updated };
}

const baseSa = {
  id: 'sa_1',
  organizationId: 'org_1',
  assessmentId: 'a_1',
  maxScore: 100,
  enteredById: 'teacher_1',
};

describe('recompute — normal derivation', () => {
  it('derives the score from a single first-round mark', async () => {
    const { service, tx, updated } = makeService({ ...baseSa, effectiveScore: null }, [
      { id: 'me_x', round: 'first', score: 64 },
    ]);

    await service.recompute(tx, 'sa_1');

    expect(Number(updated[0].originalScore)).toBe(64);
    expect(Number(updated[0].effectiveScore)).toBe(64);
    expect(Number(updated[0].percentage)).toBe(64);
    expect(tx.markEntry.create).not.toHaveBeenCalled();
  });

  it('nulls a row that genuinely has no score and no ledger', async () => {
    const { service, tx, updated } = makeService({ ...baseSa, effectiveScore: null }, []);

    await service.recompute(tx, 'sa_1');

    expect(updated[0].originalScore).toBeNull();
    expect(updated[0].effectiveScore).toBeNull();
    expect(tx.markEntry.create).not.toHaveBeenCalled();
  });
});

describe('recompute — self-heal for ledger-less scores', () => {
  it('ADOPTS an orphaned effectiveScore instead of deleting it', async () => {
    // The shape the LMS/homework bridges used to leave behind: a score, no ledger.
    const { service, tx, created, updated } = makeService(
      { ...baseSa, effectiveScore: 80, originalScore: 80, percentage: 80 },
      [],
    );

    await service.recompute(tx, 'sa_1');

    // The score survived — this is the whole point.
    expect(Number(updated[0].effectiveScore)).toBe(80);
    expect(Number(updated[0].originalScore)).toBe(80);
    expect(Number(updated[0].percentage)).toBe(80);

    // …and it now has the ledger row that explains it.
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({
      studentAssessmentId: 'sa_1',
      round: 'first',
      score: 80,
      comment: HEAL_COMMENT,
      markerId: 'teacher_1',
    });
  });

  it('is idempotent — a healed row is not healed twice', async () => {
    const { service, tx, created } = makeService({ ...baseSa, effectiveScore: 80 }, [
      { id: 'me_healed', round: 'first', score: 80, comment: HEAL_COMMENT },
    ]);

    await service.recompute(tx, 'sa_1');

    expect(created).toHaveLength(0);
    expect(tx.markEntry.create).not.toHaveBeenCalled();
  });

  it('does not heal when a replacement adjustment already explains the score', async () => {
    // Special consideration can set a score with no marking round behind it —
    // that is legitimate, and computeEffective handles it. Healing would add a
    // phantom round the adjustment would then be applied on top of.
    const { service, tx, created, updated } = makeService(
      { ...baseSa, effectiveScore: 55 },
      [],
      [{ sequence: 1, delta: null, replacementScore: 55 }],
    );

    await service.recompute(tx, 'sa_1');

    expect(created).toHaveLength(0);
    expect(Number(updated[0].effectiveScore)).toBe(55);
  });

  it('keeps adjustments composing on top of the healed round', async () => {
    const { service, tx, created, updated } = makeService(
      { ...baseSa, effectiveScore: 70 },
      [],
      [{ sequence: 1, delta: 5, replacementScore: null }],
    );

    await service.recompute(tx, 'sa_1');

    expect(created).toHaveLength(1);
    expect(Number(created[0].score)).toBe(70);      // the healed round is the RAW mark
    expect(Number(updated[0].originalScore)).toBe(70);
    expect(Number(updated[0].effectiveScore)).toBe(75); // +5 adjustment still applies
  });
});
