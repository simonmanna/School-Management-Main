/**
 * DMS seed data (Phase 1) — 6 lifecycles, 17 document types, 9 relation
 * types. This IS the "add a new document type = seed rows only" contract.
 * Policy fields are C(onfig)/P(olicy)/R(eference) — never logic (§2.1).
 */
import type {
  GuardJson,
  LifecycleSeed,
  RelationTypeSeed,
  TypePolicy,
} from './dms.types';

export const DMS_LIFECYCLES: LifecycleSeed[] = [
  {
    code: 'receipt_doc',
    name: 'Receipt',
    description: 'Simple cash-receipt flow: post then pay. Used by POS receipts, rental deposits, school receipts.',
    states: ['draft', 'posted', 'paid'],
    initialState: 'draft',
    transitions: [
      { from: 'draft', to: 'posted', action: 'post', guard: {} },
      { from: 'posted', to: 'paid', action: 'pay', guard: {} },
      { from: 'posted', to: 'posted', action: 'reverse', guard: { requiresReason: true } },
    ],
  },
  {
    code: 'sales_doc',
    name: 'Sales document',
    description: 'Order-to-cash flow: submit → approve → post → pay, with cancels from any pre-effects state (rev 4: cancel-vs-reverse, §3.6).',
    states: ['draft', 'submitted', 'approved', 'posted', 'paid', 'cancelled'],
    initialState: 'draft',
    transitions: [
      { from: 'draft', to: 'submitted', action: 'submit', guard: {} },
      { from: 'submitted', to: 'approved', action: 'approve', guard: {} },
      { from: 'submitted', to: 'draft', action: 'reject', guard: {} },
      { from: 'approved', to: 'posted', action: 'post', guard: {} },
      { from: 'posted', to: 'paid', action: 'pay', guard: {} },
      { from: 'draft', to: 'cancelled', action: 'cancel', guard: { requiresReason: true } },
      { from: 'submitted', to: 'cancelled', action: 'cancel', guard: { requiresReason: true } },
      { from: 'approved', to: 'cancelled', action: 'cancel', guard: { requiresReason: true } },
      // reverse is an ENGINE-orchestrated action (counterpart + CANCELS link);
      // the stay-transition documents it without changing state (§3.6).
      { from: 'posted', to: 'posted', action: 'reverse', guard: { requiresReason: true } },
    ],
  },
  {
    code: 'purchase_doc',
    name: 'Purchase document',
    description: 'Procure-to-pay flow: confirm → post → pay → close.',
    states: ['draft', 'confirmed', 'posted', 'paid', 'closed', 'cancelled'],
    initialState: 'draft',
    transitions: [
      { from: 'draft', to: 'confirmed', action: 'confirm', guard: {} },
      { from: 'confirmed', to: 'posted', action: 'post', guard: {} },
      { from: 'posted', to: 'paid', action: 'pay', guard: {} },
      { from: 'paid', to: 'closed', action: 'close', guard: { requiresPaid: true } },
      { from: 'draft', to: 'cancelled', action: 'cancel', guard: { requiresReason: true } },
      { from: 'confirmed', to: 'cancelled', action: 'cancel', guard: { requiresReason: true } },
      { from: 'posted', to: 'posted', action: 'reverse', guard: { requiresReason: true } },
    ],
  },
  {
    code: 'contract_doc',
    name: 'Contract / agreement',
    description: 'Contractual flow with a long-lived active state (rental agreements, service contracts).',
    states: ['draft', 'submitted', 'approved', 'active', 'expired', 'terminated', 'cancelled'],
    initialState: 'draft',
    transitions: [
      { from: 'draft', to: 'submitted', action: 'submit', guard: {} },
      { from: 'submitted', to: 'approved', action: 'approve', guard: {} },
      { from: 'submitted', to: 'draft', action: 'reject', guard: {} },
      { from: 'approved', to: 'active', action: 'activate', guard: {} },
      { from: 'active', to: 'expired', action: 'expire', guard: {} },
      { from: 'active', to: 'terminated', action: 'terminate', guard: { requiresReason: true } },
      { from: 'draft', to: 'cancelled', action: 'cancel', guard: { requiresReason: true } },
      { from: 'submitted', to: 'cancelled', action: 'cancel', guard: { requiresReason: true } },
      { from: 'approved', to: 'cancelled', action: 'cancel', guard: { requiresReason: true } },
    ],
  },
  {
    code: 'certificate_doc',
    name: 'Certificate / letter',
    description: 'Issue-and-revoke flow for certificates, letters, report cards.',
    states: ['draft', 'approved', 'issued', 'revoked', 'cancelled'],
    initialState: 'draft',
    transitions: [
      { from: 'draft', to: 'approved', action: 'approve', guard: {} },
      { from: 'approved', to: 'issued', action: 'issue', guard: {} },
      { from: 'issued', to: 'revoked', action: 'revoke', guard: { requiresReason: true } },
      { from: 'draft', to: 'cancelled', action: 'cancel', guard: { requiresReason: true } },
    ],
  },
  {
    code: 'approval_doc',
    name: 'Approval-gated document',
    description: 'Sales flow with an explicit approval gate at posting (school fee invoices, service orders).',
    states: ['draft', 'submitted', 'approved', 'posted', 'paid', 'cancelled'],
    initialState: 'draft',
    transitions: [
      { from: 'draft', to: 'submitted', action: 'submit', guard: {} },
      { from: 'submitted', to: 'approved', action: 'approve', guard: {} },
      { from: 'submitted', to: 'draft', action: 'reject', guard: {} },
      { from: 'approved', to: 'posted', action: 'post', guard: { requiresApproval: true } },
      { from: 'posted', to: 'paid', action: 'pay', guard: {} },
      { from: 'draft', to: 'cancelled', action: 'cancel', guard: { requiresReason: true } },
      { from: 'submitted', to: 'cancelled', action: 'cancel', guard: { requiresReason: true } },
      { from: 'approved', to: 'cancelled', action: 'cancel', guard: { requiresReason: true } },
      { from: 'posted', to: 'posted', action: 'reverse', guard: { requiresReason: true } },
    ],
  },
];

export const DMS_TYPE_POLICIES: TypePolicy[] = [
  // ---- System types (code = legacy enum value; seeded by migration too) ----
  {
    code: 'sales_invoice',
    name: 'Sales Invoice',
    description: 'Universal sales document (POS counter sales and manual invoicing).',
    category: 'retail',
    isSystem: true,
    numberingKey: 'invoice',
    numberingPrefix: 'INV-',
    numberingPadding: 5,
    lifecycle: 'sales_doc',
    approvalPolicy: { requiresApproval: false },
    postingPolicy: { behavior: 'accounting', journalHints: ['sales'] },
    paymentPolicy: {},
    cancellationPolicy: { reversable: true, needsReason: true },
    editPolicy: 'IMMUTABLE_AFTER_ISSUE',
    snapshotPolicy: { captureOn: ['post', 'amend'], snapshotOnPrint: false, keepRenderedFile: false },
    printProfile: { formats: ['a4', 'thermal'], reprintable: true },
    businessEffects: { inventory: true },
    security: { basePermission: 'document', visibility: 'org', workflowHooks: ['pos_inventory'] },
    isFinancial: true,
    isInventoryRelevant: true,
    requiresPosting: true,
  },
  {
    code: 'credit_note',
    name: 'Credit Note',
    description: 'Reversal counterpart of a sales invoice (CANCELS relation, §3.6).',
    category: 'retail',
    isSystem: true,
    numberingKey: 'creditnote',
    numberingPrefix: 'CN-',
    numberingPadding: 5,
    lifecycle: 'sales_doc',
    postingPolicy: { behavior: 'accounting', journalHints: ['sales_returns'] },
    cancellationPolicy: { reversable: false, needsReason: true },
    editPolicy: 'IMMUTABLE_AFTER_ISSUE',
    isFinancial: true,
    isInventoryRelevant: true,
    requiresPosting: true,
  },
  {
    code: 'vendor_bill',
    name: 'Vendor Bill',
    description: 'Supplier invoice payable (purchase side).',
    category: 'procurement',
    isSystem: true,
    numberingKey: 'vendorbill',
    numberingPrefix: 'BILL-',
    numberingPadding: 5,
    lifecycle: 'purchase_doc',
    postingPolicy: { behavior: 'accounting', journalHints: ['purchases'] },
    cancellationPolicy: { reversable: true, needsReason: true },
    editPolicy: 'IMMUTABLE_AFTER_ISSUE',
    businessEffects: { inventory: true },
    isFinancial: true,
    isInventoryRelevant: true,
    requiresPosting: true,
  },
  {
    code: 'debit_note',
    name: 'Debit Note',
    description: 'Supplier debit — purchase-side adjustment.',
    category: 'procurement',
    isSystem: true,
    numberingKey: 'debitnote',
    numberingPrefix: 'DN-',
    numberingPadding: 5,
    lifecycle: 'purchase_doc',
    postingPolicy: { behavior: 'accounting' },
    cancellationPolicy: { reversable: true, needsReason: true },
    editPolicy: 'IMMUTABLE_AFTER_ISSUE',
    isFinancial: true,
    requiresPosting: true,
  },
  {
    code: 'proforma_invoice',
    name: 'Proforma Invoice',
    description: 'Pre-billing estimate for a sale — no accounting effects.',
    category: 'retail',
    isSystem: true,
    numberingKey: 'proforma',
    numberingPrefix: 'PRO-',
    numberingPadding: 5,
    lifecycle: 'sales_doc',
    cancellationPolicy: { reversable: false, needsReason: false },
    editPolicy: 'EDITABLE',
    isFinancial: false,
    requiresPosting: false,
  },
  // ---- POS / Retail ----
  {
    code: 'pos_receipt',
    name: 'POS Receipt',
    description: 'Thermal receipt issued by the POS terminal at tender.',
    category: 'pos',
    numberingKey: 'posreceipt',
    numberingPrefix: 'RCPT-',
    lifecycle: 'receipt_doc',
    postingPolicy: { behavior: 'accounting', journalHints: ['sales'] },
    cancellationPolicy: { reversable: true, needsReason: true },
    editPolicy: 'IMMUTABLE_AFTER_ISSUE',
    printProfile: { formats: ['thermal'], reprintable: true },
    security: { basePermission: 'document', visibility: 'org' },
    isFinancial: true,
    isInventoryRelevant: true,
    requiresPosting: true,
  },
  {
    code: 'delivery_note',
    name: 'Delivery Note',
    description: 'Goods-out document — inventory effects, no accounting.',
    category: 'retail',
    numberingKey: 'deliverynote',
    numberingPrefix: 'DLV-',
    lifecycle: 'sales_doc',
    postingPolicy: { behavior: 'inventory' },
    cancellationPolicy: { reversable: false, needsReason: true },
    editPolicy: 'IMMUTABLE_AFTER_ISSUE',
    isFinancial: false,
    isInventoryRelevant: true,
    requiresPosting: true,
  },
  {
    code: 'quotation',
    name: 'Quotation',
    description: 'Proposal to a customer — fully editable until accepted.',
    category: 'retail',
    numberingKey: 'quotation',
    numberingPrefix: 'QT-',
    lifecycle: 'sales_doc',
    cancellationPolicy: { reversable: false, needsReason: false },
    editPolicy: 'EDITABLE',
    isFinancial: false,
    requiresPosting: false,
  },
  // ---- Rental ----
  {
    code: 'rental_agreement',
    name: 'Rental Agreement',
    description: 'Binding lease contract (contract_doc lifecycle). Domain truth lives in the rental module; the DMS only links via DocumentSource.',
    category: 'rental',
    numberingKey: 'rentalagreement',
    numberingPrefix: 'RA-',
    lifecycle: 'contract_doc',
    approvalPolicy: { requiresApproval: true },
    cancellationPolicy: { reversable: false, needsReason: true },
    editPolicy: 'VERSIONED',
    snapshotPolicy: { captureOn: ['issue', 'amend'], snapshotOnPrint: false, keepRenderedFile: true },
    printProfile: { formats: ['a4'], reprintable: true },
    businessEffects: { notify: true },
    security: { basePermission: 'document', visibility: 'branch' },
    isFinancial: false,
    isInventoryRelevant: true,
    requiresPosting: false,
  },
  {
    code: 'rental_return',
    name: 'Rental Return',
    description: 'Return-of-unit document — inventory effects; "deposit refund only if returned" is a rental-module rule, never DMS.',
    category: 'rental',
    numberingKey: 'rentalreturn',
    numberingPrefix: 'RTN-',
    lifecycle: 'receipt_doc',
    postingPolicy: { behavior: 'inventory' },
    cancellationPolicy: { reversable: false, needsReason: true },
    editPolicy: 'IMMUTABLE_AFTER_ISSUE',
    isFinancial: false,
    isInventoryRelevant: true,
    requiresPosting: true,
  },
  {
    code: 'rental_deposit',
    name: 'Rental Deposit',
    description: 'Cash deposit received against an agreement.',
    category: 'rental',
    numberingKey: 'rentaldeposit',
    numberingPrefix: 'DEP-',
    lifecycle: 'receipt_doc',
    postingPolicy: { behavior: 'accounting' },
    cancellationPolicy: { reversable: true, needsReason: true },
    editPolicy: 'IMMUTABLE_AFTER_ISSUE',
    isFinancial: true,
    requiresPosting: true,
  },
  {
    code: 'rental_service_order',
    name: 'Rental Service Order',
    description: 'Chargeable service on a rental (cleaning, late fee) — approval-gated.',
    category: 'rental',
    numberingKey: 'rentalserviceorder',
    numberingPrefix: 'RSO-',
    lifecycle: 'approval_doc',
    approvalPolicy: { requiresApproval: true },
    postingPolicy: { behavior: 'accounting' },
    cancellationPolicy: { reversable: true, needsReason: true },
    editPolicy: 'IMMUTABLE_AFTER_ISSUE',
    isFinancial: true,
    requiresPosting: true,
  },
  // ---- School (v1 scope, ADR O5) ----
  {
    code: 'school_fee_invoice',
    name: 'School Fee Invoice',
    description: 'Tuition/fee invoice against a student (school_fee invoice).',
    category: 'school',
    numberingKey: 'feeinvoice',
    numberingPrefix: 'SFI-',
    lifecycle: 'approval_doc',
    approvalPolicy: { requiresApproval: true },
    postingPolicy: { behavior: 'accounting', journalHints: ['school_fees'] },
    cancellationPolicy: { reversable: true, needsReason: true },
    editPolicy: 'IMMUTABLE_AFTER_ISSUE',
    snapshotPolicy: { captureOn: ['issue', 'post', 'amend'], snapshotOnPrint: false, keepRenderedFile: true },
    printProfile: { formats: ['a4'], reprintable: true },
    security: { basePermission: 'document', visibility: 'branch' },
    isFinancial: true,
    requiresPosting: true,
  },
  {
    code: 'school_receipt',
    name: 'School Receipt',
    description: 'Payment receipt against fee invoices (or cash).',
    category: 'school',
    numberingKey: 'feereceipt',
    numberingPrefix: 'SFR-',
    lifecycle: 'receipt_doc',
    postingPolicy: { behavior: 'accounting' },
    cancellationPolicy: { reversable: true, needsReason: true },
    editPolicy: 'IMMUTABLE_AFTER_ISSUE',
    printProfile: { formats: ['a4', 'thermal'], reprintable: true },
    isFinancial: true,
    requiresPosting: true,
  },
  {
    code: 'school_admission_letter',
    name: 'Admission Letter',
    description: 'Offer/admission letter — editable, issued once.',
    category: 'school',
    numberingKey: 'admission',
    numberingPrefix: 'ADM-',
    lifecycle: 'certificate_doc',
    editPolicy: 'EDITABLE',
    snapshotPolicy: { captureOn: ['issue'], snapshotOnPrint: false, keepRenderedFile: true },
    printProfile: { formats: ['a4'], reprintable: true },
    security: { basePermission: 'document', visibility: 'branch' },
    isFinancial: false,
    requiresPosting: false,
  },
  {
    code: 'school_certificate',
    name: 'Certificate',
    description: 'Completion/participation certificate — versioned content.',
    category: 'school',
    numberingKey: 'certificate',
    numberingPrefix: 'CERT-',
    lifecycle: 'certificate_doc',
    editPolicy: 'VERSIONED',
    snapshotPolicy: { captureOn: ['issue'], snapshotOnPrint: false, keepRenderedFile: true },
    printProfile: { formats: ['a4'], reprintable: true },
    security: { basePermission: 'document', visibility: 'branch' },
    isFinancial: false,
    requiresPosting: false,
  },
  {
    code: 'school_report_card',
    name: 'Report Card',
    description: 'Term report card — versioned, re-issued each term change.',
    category: 'school',
    numberingKey: 'reportcard',
    numberingPrefix: 'RC-',
    lifecycle: 'certificate_doc',
    editPolicy: 'VERSIONED',
    snapshotPolicy: { captureOn: ['issue'], snapshotOnPrint: false, keepRenderedFile: true },
    printProfile: { formats: ['a4'], reprintable: true },
    security: { basePermission: 'document', visibility: 'branch' },
    isFinancial: false,
    requiresPosting: false,
  },
];

export const DMS_RELATION_TYPES: RelationTypeSeed[] = [
  {
    code: 'CONVERTED_FROM',
    name: 'Converted from',
    description: 'Source document that this one was converted from (quotation → sales order → invoice).',
    direction: 'out',
    allowedSourceCategories: ['pos', 'retail', 'finance'],
    allowedTargetCategories: ['pos', 'retail', 'finance'],
    cardinality: 'one',
    inverseImplicit: false,
    duplicatesAllowed: false,
  },
  {
    code: 'CONVERTED_TO',
    name: 'Converted to',
    description: 'Explicit reverse of CONVERTED_FROM.',
    direction: 'out',
    allowedSourceCategories: ['pos', 'retail', 'finance'],
    allowedTargetCategories: ['pos', 'retail', 'finance'],
    cardinality: 'one',
    inverseImplicit: false,
    duplicatesAllowed: false,
  },
  {
    code: 'GENERATED_FROM',
    name: 'Generated from',
    description: 'Generated from a parent (recurring children, fee invoices from terms).',
    direction: 'out',
    cardinality: 'many',
    duplicatesAllowed: false,
  },
  {
    code: 'REFERENCES',
    name: 'References',
    description: 'Generic cross-reference (audit trail, contextual linking).',
    direction: 'out',
    cardinality: 'many',
    duplicatesAllowed: true,
  },
  {
    code: 'FULFILLS',
    name: 'Fulfills',
    description: 'Delivery note / GRN fulfills an order or invoice. One fulfill-per-source enforced.',
    direction: 'out',
    cardinality: 'one',
    duplicatesAllowed: false,
  },
  {
    code: 'CANCELS',
    name: 'Cancels',
    description: 'Reversal document cancels the original (credit note → invoice). Implicit inverse maintained.',
    direction: 'out',
    cardinality: 'one',
    inverseImplicit: true,
    duplicatesAllowed: false,
  },
  {
    code: 'REISSUES',
    name: 'Reissues',
    description: 'Phase 6 — reissue reverses a reversal (original → reversal counterpart). Mirror of CANCELS for the reissued doc.',
    direction: 'out',
    cardinality: 'one',
    inverseImplicit: true,
    duplicatesAllowed: false,
  },
  {
    code: 'AMENDS',
    name: 'Amends',
    description: 'New version supersedes the previous issuance (contracts, certificates).',
    direction: 'out',
    cardinality: 'many',
    inverseImplicit: true,
    duplicatesAllowed: false,
  },
  {
    code: 'REPLACES',
    name: 'Replaces',
    description: 'Direct replacement, same type (re-issue of a corrupted/lost document).',
    direction: 'out',
    cardinality: 'one',
    inverseImplicit: true,
    duplicatesAllowed: false,
  },
];

/** Static helper for specs / docs — all keys the DMS seeds. */
export interface DmsPermissionRow {
  key: string;
  resource: string;
  action: string;
  description: string;
}

export function buildPermissionRows(): DmsPermissionRow[] {
  const rows: DmsPermissionRow[] = [];
  for (const action of ['create', 'read', 'update', 'delete', 'print', 'archive', 'manage']) {
    rows.push({ key: `document:${action}`, resource: 'document', action, description: `Document (generic) — ${action}` });
  }
  for (const code of DMS_TYPE_POLICIES.map((t) => t.code)) {
    for (const action of [
      'submit', 'approve', 'reject', 'confirm', 'issue', 'activate',
      'expire', 'revoke', 'post', 'pay', 'close', 'cancel', 'reverse', 'reissue', 'terminate', 'archive',
      'amend',
    ]) {
      rows.push({
        key: `document:${code}:${action}`,
        resource: `document:${code}`,
        action,
        description: `Document ${code} — ${action}`,
      });
    }
  }
  return rows;
}

export function buildDmsPermissionKeys(): string[] {
  return buildPermissionRows().map((r) => r.key);
}

// ---------------------------------------------------------------------------
// Phase 4 — render templates (seeded per type; zero engine code for new types).
// Template content is static data (classification C), the render service owns
// substitution. templateKey convention: `<typeCode>:<format>`.
// ---------------------------------------------------------------------------

export interface TemplateSeed {
  typeCode: string;
  templateKey: string;
  format: 'a4' | 'thermal';
  name: string;
  content: string;
  engine: string;
}

/** Minimal A4 HTML shell — placeholders get {{key}} substitution at render. */
export function buildDefaultA4Content(def: { code: string; name: string }): string {
  return `<html><head><meta charset="utf-8"><style>
body{font-family:Georgia,serif;color:#1a1a1a;margin:48px}
h1{font-size:20px;border-bottom:2px solid #333;padding-bottom:8px}
table{width:100%;border-collapse:collapse;margin-top:16px}
th,td{border:1px solid #ccc;padding:6px 8px;text-align:left;font-size:13px}
th{background:#f4f4f4}
.meta{font-size:12px;color:#555;margin-top:8px}
.totals{width:280px;margin-left:auto;margin-top:16px}
.totals td{padding:4px 8px;font-size:13px}
.totals .grand td{font-weight:bold;border-top:2px solid #333}
</style></head><body>
<h1>{{companyName}} — {{documentTypeName}}</h1>
<div class="meta">
{{documentNumber}} · {{issueDate}} · Status: {{status}}<br/>
Partner: {{partnerCode}} · Branch: {{branchName}}
</div>
<table>
<tr><th>#</th><th>Description</th><th>Qty</th><th>Unit Price</th><th>Total</th></tr>
{{#each lines}}<tr><td>{{lineNumber}}</td><td>{{description}}</td><td>{{quantity}}</td><td>{{unitPrice}}</td><td>{{total}}</td></tr>{{/each}}
</table>
<table class="totals">
<tr><td>Subtotal</td><td>{{subtotal}}</td></tr>
<tr><td>Tax</td><td>{{taxAmount}}</td></tr>
<tr class="grand"><td>Total</td><td>{{totalAmount}}</td></tr>
</table>
<div class="meta">Generated by POS-CAFE · DMS · {{generatedAt}}</div>
</body></html>`;
}

/** Minimal thermal receipt shell (ESC/POS-style text; printer driver renders). */
export function buildDefaultThermalContent(def: { code: string; name: string }): string {
  return `{{companyName}}
{{documentTypeName}}
--------------------------------
{{documentNumber}}   {{issueDate}}
Partner: {{partnerCode}}
--------------------------------
{{#each lines}}{{quantity}} x {{description}}
    {{unitPrice}} = {{total}}
{{/each}}
--------------------------------
Subtotal   {{subtotal}}
Tax        {{taxAmount}}
TOTAL      {{totalAmount}}
--------------------------------
{{generatedAt}}
`;
}

/** Seeded template rows — one A4 per type (+ thermal for receipt-style types). */
export const DMS_TEMPLATE_SEEDS: TemplateSeed[] = [
  ...DMS_TYPE_POLICIES.map((t) => ({
    typeCode: t.code,
    templateKey: `${t.code}:a4`,
    format: 'a4' as const,
    name: `${t.name} — A4`,
    content: buildDefaultA4Content(t),
    engine: 'puppeteer',
  })),
  ...DMS_TYPE_POLICIES.filter((t) => ['pos_receipt', 'sales_invoice', 'school_receipt', 'rental_deposit'].includes(t.code)).map(
    (t) => ({
      typeCode: t.code,
      templateKey: `${t.code}:thermal`,
      format: 'thermal' as const,
      name: `${t.name} — Thermal receipt`,
      content: buildDefaultThermalContent(t),
      engine: 'escpos',
    }),
  ),
];

// referenced by the seeder for unified guard validation
export type { GuardJson };