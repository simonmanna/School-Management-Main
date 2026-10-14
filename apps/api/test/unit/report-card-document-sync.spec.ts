/**
 * Releasing a report card from the Report Cards page keeps its ReportDocument
 * (the provenance record on Term Results › Report cards) in step.
 *
 * The two release paths used to diverge: Term Results published the document
 * AND the card, while the Report Cards page stamped only the card. The document
 * then said "issued, not released" while the family could already read it.
 */
import { ReportCardService } from '../../src/modules/school/examinations/examinations.service';

function makeService(card: Record<string, unknown>) {
  const tx: any = {
    reportCard: {
      findFirst: jest.fn().mockResolvedValue(card),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    reportDocument: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    resultSet: {
      findFirst: jest.fn().mockResolvedValue({ revision: 2, status: 'published', publishedAt: new Date('2026-08-01') }),
    },
  };
  const client: any = { $transaction: jest.fn((fn: any) => fn(tx)) };
  const service = new ReportCardService(
    { client } as any,
    { organizationId: 'org_1', userId: 'user_1', store: { permissions: [] } } as any,
    {} as any,
    { publishInTx: jest.fn() } as any,
    {} as any,
    { recordInTx: jest.fn() } as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
  );
  return { service, tx };
}

const pinned = {
  id: 'rc_1', studentProfileId: 'stu_1', termId: 'term_1', publishedAt: null,
  payload: { provenance: { source: 'result_spine', resultSetId: 'rs_1', resultSetRevision: 2 } },
};

describe('ReportCardService publish ↔ ReportDocument', () => {
  it('releasing a card publishes its issued document', async () => {
    const { service, tx } = makeService(pinned);
    await service.publish('rc_1');
    expect(tx.reportDocument.updateMany).toHaveBeenCalledWith({
      where: { reportCardId: 'rc_1', status: { in: ['draft', 'generated'] } },
      data: expect.objectContaining({ status: 'published', publishedById: 'user_1' }),
    });
  });

  it('withdrawing a card returns its published document to issued', async () => {
    const { service, tx } = makeService({ ...pinned, publishedAt: new Date('2026-08-02') });
    await service.unpublish('rc_1');
    expect(tx.reportDocument.updateMany).toHaveBeenCalledWith({
      where: { reportCardId: 'rc_1', status: 'published' },
      data: { status: 'generated', publishedAt: null, publishedById: null },
    });
  });

  it('a live-marks preview is still refused, and no document changes', async () => {
    const { service, tx } = makeService({ ...pinned, payload: { provenance: { source: 'live_marks' } } });
    await expect(service.publish('rc_1')).rejects.toThrow('staff preview only');
    expect(tx.reportDocument.updateMany).not.toHaveBeenCalled();
  });
});
