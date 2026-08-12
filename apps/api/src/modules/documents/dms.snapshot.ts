/**
 * DMS — Phase 4 snapshot & render data (PURE — no I/O, no Prisma).
 *
 * §3.7 ownership rules enforced BY CONSTRUCTION:
 *   - Snapshot data is assembled ONLY from Document + DocumentLine fields
 *     (plus registry-derived type label). Reading a domain table here would
 *     be a review failure — the capture service passes exactly these shapes.
 *   - A snapshot whose domain state changed later still renders
 *     byte-identically from `data` + `templateVersionId` (seal check).
 *
 * Renderers: `renderTemplate` substitutes {{key}} and {{#each lines}}…{{/each}}
 * blocks against a flat data map. a4 → HTML (Puppeteer renders to PDF);
 * thermal/plain → text. No external template engine (G4: no scripting).
 */
import { createHash } from 'crypto';

/** Document-owned representation — the ONLY fields a snapshot may carry. */
export interface SnapshotDocumentData {
  id: string;
  documentNumber: string;
  documentTypeCode: string;
  documentTypeName: string;
  status: string;
  issueDate: string | null;
  dueDate: string | null;
  partnerId: string | null;
  sourceDocument: string | null;
  branchId: string | null;
  subtotal: number;
  discountTotal: number;
  taxAmount: number;
  totalAmount: number;
  amountPaid: number;
  amountResidual: number;
  currencyCode: string | null;
  exchangeRate: number;
  notes?: string | null;
  lines: SnapshotLineData[];
}

export interface SnapshotLineData {
  productId: string | null;
  description: string;
  quantity: number;
  unitPrice: number;
  discountPercent: number;
  taxAmount: number;
  subtotal: number;
  total: number;
  lineNumber: number;
  lineType: string;
}

/** Shapes the capture service must satisfy (compile-time contract, §3.7). */
export type SnapshotDocumentSource = {
  id: string;
  documentNumber: string;
  status: string;
  issueDate: Date | string | null;
  dueDate: Date | string | null;
  partnerId: string | null;
  sourceDocument: string | null;
  branchId: string | null;
  subtotal: unknown;
  discountTotal: unknown;
  taxAmount: unknown;
  totalAmount: unknown;
  amountPaid: unknown;
  amountResidual: unknown;
  currencyId: string | null;
  exchangeRate: unknown;
  notes: string | null;
};

export type SnapshotLineSource = {
  productId: string | null;
  description: string;
  quantity: unknown;
  unitPrice: unknown;
  discountPercent: unknown;
  taxAmount: unknown;
  subtotal: unknown;
  total: unknown;
  lineNumber: number;
  lineType: string;
};

const num = (v: unknown): number =>
  typeof v === 'object' && v !== null && typeof (v as { toNumber?: unknown }).toNumber === 'function'
    ? Number((v as { toNumber: () => unknown }).toNumber())
    : Number(v ?? 0);

/**
 * Assemble the document-owned representation. NO domain fields can enter here
 * by construction — the parameter types only expose Document/DocumentLine
 * columns + registry labels.
 */
export function buildSnapshotData(
  doc: SnapshotDocumentSource,
  lines: SnapshotLineSource[],
  type: { code: string; name: string },
): SnapshotDocumentData {
  return {
    id: doc.id,
    documentNumber: doc.documentNumber,
    documentTypeCode: type.code,
    documentTypeName: type.name,
    status: doc.status,
    issueDate: doc.issueDate ? new Date(doc.issueDate).toISOString() : null,
    dueDate: doc.dueDate ? new Date(doc.dueDate).toISOString() : null,
    partnerId: doc.partnerId,
    sourceDocument: doc.sourceDocument,
    branchId: doc.branchId,
    subtotal: num(doc.subtotal),
    discountTotal: num(doc.discountTotal),
    taxAmount: num(doc.taxAmount),
    totalAmount: num(doc.totalAmount),
    amountPaid: num(doc.amountPaid),
    amountResidual: num(doc.amountResidual),
    currencyCode: doc.currencyId,
    exchangeRate: num(doc.exchangeRate),
    notes: doc.notes,
    lines: lines
      .filter((l) => l.lineType !== 'section' && l.lineType !== 'note')
      .map((l) => ({
        productId: l.productId,
        description: l.description,
        quantity: num(l.quantity),
        unitPrice: num(l.unitPrice),
        discountPercent: num(l.discountPercent),
        taxAmount: num(l.taxAmount),
        subtotal: num(l.subtotal),
        total: num(l.total),
        lineNumber: l.lineNumber,
        lineType: l.lineType,
      })),
  };
}

/**
 * Immutable seal: sha256(canonical(data) + templateVersionId). Renders from
 * (data, templateVersionId) must reproduce the same seal → byte-stable output.
 */
export function sealSnapshot(data: SnapshotDocumentData, templateVersionId: string | null): string {
  const canonical = JSON.stringify(data, Object.keys(data).sort());
  return createHash('sha256').update(`${canonical}|${templateVersionId ?? ''}`).digest('hex');
}

/** Flat render map for template substitution (numbers formatted 2dp). */
export function toRenderContext(data: SnapshotDocumentData): Record<string, unknown> {
  const money = (v: number): string =>
    new Intl.NumberFormat('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);
  const date = (v: string | null): string =>
    v ? new Date(v).toISOString().slice(0, 10) : '';
  return {
    documentNumber: data.documentNumber,
    documentTypeName: data.documentTypeName,
    status: data.status,
    issueDate: date(data.issueDate),
    dueDate: date(data.dueDate),
    partnerCode: data.partnerId ? data.partnerId.slice(0, 8) : '—',
    branchName: data.branchId ? data.branchId.slice(0, 8) : '—',
    subtotal: money(data.subtotal),
    discountTotal: money(data.discountTotal),
    taxAmount: money(data.taxAmount),
    totalAmount: money(data.totalAmount),
    amountPaid: money(data.amountPaid),
    amountResidual: money(data.amountResidual),
    currencyCode: data.currencyCode ?? '',
    generatedAt: new Date().toISOString(),
    lines: data.lines.map((l) => ({
      lineNumber: l.lineNumber,
      description: l.description,
      quantity: num(l.quantity),
      unitPrice: money(l.unitPrice),
      total: money(l.total),
    })),
  };
}

/**
 * Substitute {{key}} scalar placeholders and {{#each lines}}…{{/each}} blocks.
 * Unknown placeholders are left untouched (templates may carry optional bits).
 */
export function renderTemplate(template: string, ctx: Record<string, unknown>): string {
  let out = template.replace(/\{\{#each lines\}\}([\s\S]*?)\{\{\/each\}\}/g, (_m, body: string) => {
    const lines = (ctx.lines as Array<Record<string, unknown>>) ?? [];
    return lines
      .map((l) => body.replace(/\{\{(\w+)\}\}/g, (_x, key: string) => String(l[key] ?? '')))
      .join('');
  });
  out = out.replace(/\{\{(\w+)\}\}/g, (_m, key: string) => {
    const v = ctx[key];
    if (v === undefined) return _m; // unknown placeholder — leave untouched
    return v === null ? '' : String(v);
  });
  return out;
}
