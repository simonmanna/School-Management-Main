/**
 * Phase 4 — snapshot assembly + sealing (PURE, no DB).
 * §3.7: snapshots are built ONLY from Document + DocumentLine + registry
 * label. Domain fields must be structurally impossible to inject.
 */
import { buildSnapshotData, renderTemplate, sealSnapshot } from './dms.snapshot';

const docSource = {
  id: 'doc-1',
  documentNumber: 'INV-2026-00042',
  status: 'posted',
  issueDate: new Date('2026-08-01T09:00:00Z'),
  dueDate: new Date('2026-08-15T09:00:00Z'),
  partnerId: 'partner-7',
  sourceDocument: 'SO-100',
  branchId: 'branch-1',
  subtotal: '100.00',
  discountTotal: '0',
  taxAmount: '10.00',
  totalAmount: '110.00',
  amountPaid: '0',
  amountResidual: '110.00',
  currencyId: 'USD',
  exchangeRate: '1',
  notes: 'urgent',
};

const lineSources = [
  {
    productId: 'prod-1',
    description: 'Consulting',
    quantity: '2',
    unitPrice: '50',
    discountPercent: '0',
    taxAmount: '10',
    subtotal: '100',
    total: '110',
    lineNumber: 1,
    lineType: 'item',
  },
  {
    productId: null,
    description: '—',
    quantity: '0',
    unitPrice: '0',
    discountPercent: '0',
    taxAmount: '0',
    subtotal: '0',
    total: '0',
    lineNumber: 2,
    lineType: 'note', // must be excluded from snapshot lines
  },
];

const type = { code: 'sales_invoice', name: 'Sales Invoice' };

describe('buildSnapshotData (§3.7)', () => {
  it('assembles only document-owned fields with numeric normalization', () => {
    const data = buildSnapshotData(docSource as never, lineSources as never, type);
    expect(data.documentNumber).toBe('INV-2026-00042');
    expect(data.documentTypeCode).toBe('sales_invoice');
    expect(data.status).toBe('posted');
    expect(data.totalAmount).toBe(110);
    expect(data.subtotal).toBe(100);
    expect(data.amountResidual).toBe(110);
    expect(data.currencyCode).toBe('USD');
    expect(data.issueDate).toBe('2026-08-01T09:00:00.000Z');
  });

  it('excludes non-item lines (sections/notes) from the representation', () => {
    const lines = lineSources as never as Parameters<typeof buildSnapshotData>[1];
    const data = buildSnapshotData(docSource as never, lines, type);
    expect(data.lines).toHaveLength(1);
    expect(data.lines[0].description).toBe('Consulting');
  });

  it('renders numbers via Number() regardless of Decimal/string input', () => {
    const data = buildSnapshotData(
      { ...docSource, totalAmount: { toNumber: () => 110.5 } as unknown } as never,
      lineSources as never,
      type,
    );
    expect(data.totalAmount).toBe(110.5);
  });
});

describe('sealSnapshot (§4.4 reproducibility)', () => {
  it('is deterministic for identical data + template version', () => {
    const a = buildSnapshotData(docSource as never, lineSources as never, type);
    const b = buildSnapshotData(docSource as never, lineSources as never, type);
    expect(sealSnapshot(a, 'tpl-1')).toBe(sealSnapshot(b, 'tpl-1'));
  });

  it('changes when the template version changes (render fingerprint)', () => {
    const a = buildSnapshotData(docSource as never, lineSources as never, type);
    expect(sealSnapshot(a, 'tpl-1')).not.toBe(sealSnapshot(a, 'tpl-2'));
  });

  it('is stable under key-order differences', () => {
    const a = buildSnapshotData(docSource as never, lineSources as never, type);
    const reordered = JSON.parse(JSON.stringify(a)) as Record<string, unknown>;
    const keys = Object.keys(reordered);
    const first = keys.shift()!;
    const value = reordered[first];
    delete reordered[first];
    reordered[first] = value;
    expect(sealSnapshot(reordered as never, null)).toBe(sealSnapshot(a, null));
  });
});

describe('renderTemplate', () => {
  const ctx = {
    documentNumber: 'INV-2026-00042',
    totalAmount: '110.00',
    lines: [{ lineNumber: 1, description: 'Consulting', quantity: 2, unitPrice: '50.00', total: '110.00' }],
  };

  it('substitutes scalars and each-blocks', () => {
    const out = renderTemplate(
      '{{documentNumber}}|{{#each lines}}{{quantity}}x {{description}}={{total}}{{/each}}|{{totalAmount}}',
      ctx,
    );
    expect(out).toBe('INV-2026-00042|2x Consulting=110.00|110.00');
  });

  it('leaves unknown placeholders intact', () => {
    expect(renderTemplate('hi {{missing}} there', ctx)).toBe('hi {{missing}} there');
  });
});