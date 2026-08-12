# DMS Consumer Map — Document / documentType usage audit (Phase 0.3)

Date: 2026-08-10 · Method: ripgrep over `apps/api/src` for `documentType`, `DocumentPrintLog`, `DocumentStatus`, `document.create/update`; prisma migrate status verified up to date (34 migrations); RLS via `scripts/setup-rls-role.ts` (idempotent, 254 policies exist on dev DB).

**Gate conclusion: the only rows that touch `Document.documentType` writes are TWO files. Every other reference is a read filter or a workflow/event key that is NOT the DB enum. The one-shot FK migration (ADR O4) therefore touches only 2 write sites; all readers keep working unchanged against the retained mirror column.**

## A. Writers of `Document` (must set `documentTypeId` once NOT NULL)

| # | File | Line(s) | What it does | Action |
|---|---|---|---|---|
| W1 | `apps/api/src/modules/invoicing/document/document-builder.service.ts` | 190–268 (`createDocument`) | THE generic document creator (sales_invoice / credit_note / vendor_bill). `client.document.create({ data: { documentType, … } })`. Numbering map at 199–203. | Inject `DmsTypeResolver`; set `documentTypeId` from code. Type union extended later per type. |
| W2 | `apps/api/src/kernel/recurring/recurring.service.ts` | 141–161 (`generateOne`, `this.prisma.raw.document.create`) | Recurring child draft documents. Also writes `DocumentLine` (172) + doc totals update (191). | Set `documentTypeId` via resolver (raw client → resolver supports raw client). |
| — | `recurring.service.ts:57,67` | `RecurringDocument.documentType` (its own column) | **Not** `Document` — the recurring template's enum column. | Phase 6D aligns it (enum → FK). No action now. |

## B. Readers of `Document` (filter on the enum column — NO change; remain valid on mirror column)

| File | Usage | Notes |
|---|---|---|
| `modules/invoicing/invoice/invoice.service.ts` :39,107,133,170,339,405,439 | where filters (sales_invoice) + normalized read payload `documentType: 'sales_invoice'` literal | Read-only; mirror column fine. Loose literals replaced by def.code in Phase 7 UI mapping. |
| `modules/invoicing/credit-note/credit-note.service.ts` :37,56,80,134 | where filters (credit_note / sales_invoice) | Read-only. |
| `modules/invoicing/vendor-bill/vendor-bill.service.ts` :45,71,110,173,265,302 | where filters (vendor_bill) | Read-only. |
| `modules/invoicing/payment/payment.service.ts` :151 | where filter (vendor_bill) | Read-only. |
| `modules/invoicing/reporting/ar-reporting.service.ts` :13,139 | OPEN where (sales_invoice) | Read-only. |
| `modules/invoicing/reporting/ap-aging.service.ts` :49 | where filter (vendor_bill) | Read-only. |
| `modules/pos/pos.service.ts` :981 | cash-session document listing (sales_invoice) | Read-only. |
| `modules/pos/pos-reports.service.ts` :440 | reports join (sales_invoice) | Read-only. |
| `modules/pos/pos-table-reports.service.ts` :118 | table sales (sales_invoice) | Read-only. |
| `modules/school/school.service.ts` :148 | student billing filter (sales_invoice) | Read-only. Module import disabled in app.module (line 27) but file still compiles. |
| `modules/accounting/reporting/reports-dashboard.controller.ts` :44,49,104,194 | dashboard where filters | Read-only. |
| `modules/accounting/reporting/export.controller.ts` :75 | export filter | Read-only. |
| `modules/accounting/reporting/tieout.service.ts` :90,104 | tie-out where filters | Read-only. |
| `modules/accounting/reporting/snapshots/snapshot-rebuild.service.ts` :210 | snapshot rebuild filter (vendor_bill) | Read-only. |
| `modules/crm/crm-analytics.service.ts` :148 | analytics filter (sales_invoice/proforma) | Read-only. |
| `modules/accounting/reporting/...` | all | — |

## C. False positives — NOT Document.documentType

| File | What it actually is |
|---|---|
| `kernel/workflow/workflow.registry.ts` + `workflow.service.spec.ts` + `.spec` | Workflow registry keys: 'invoice', 'payment', 'journal_entry', 'order', 'partner' — flow identifiers, independent of the DB enum. Ignore. |
| `modules/invoicing/workflows/invoicing-workflows.initializer.ts` | Initializes above workflows (keys 'invoice', 'credit_note', 'vendor_bill', 'payment'). Ignore. |
| `modules/accounting/workflows/accounting-workflows.initializer.ts` | 'journal_entry' workflow key. Ignore. |
| `modules/pos/pos.workflows.ts` / `.spec` | 'order' workflow key. Ignore. |
| `modules/pos/pos-kds.service.ts` :288 + `spec` + `inventory-posting.subscriber.spec.ts` :39 | Fulfillment event payload field `documentType: 'kitchen_ticket'` — KitchenTicket model, not Document. Ignore. |
| `kernel/search/search.service.ts` :108,128,168 | Search index ServiceResult.documentType strings — custom index documents, not the DB table. Optionally remapped in Phase 8. |

## D. Specs / tests creating Documents directly

None found via `document.create|update` grep. Specs exercise writers (W1/W2) or mock the prisma client — no direct Document creation in specs. `pos-e2e` (separate repo) drives the API and is unaffected by a NOT NULL FK column as long as API writers set it.

## E. Migration plan (one-shot, ADR O4)

1. Migration SQL self-seeds 5 core `DocumentTypeDef` rows (codes = existing enum values: sales_invoice, credit_note, vendor_bill, debit_note, proforma_invoice).
2. `ALTER TABLE "Document" ADD COLUMN "documentTypeId"` nullable → `UPDATE … SET documentTypeId = (SELECT id FROM "DocumentTypeDef" WHERE code = "Document".documentType)` → `SET NOT NULL` + FK + index.
3. Code: `DmsTypeResolver` (documents module, exported) resolves code → id (boot cache + fallback query); W1 + W2 set both `documentType` and `documentTypeId`.
4. Enum mirror column retained (ADR-014); dropped at Phase 6/8 sign-off after Phase 2 moves readers.
5. Post-migration: `npx prisma generate`, rebuild shared, run `scripts/setup-rls-role.ts`, psql verify (backfill 1:1, NOT NULL, FK, RLS on new tables).

## F. Open risk register

- R1: migration runs against live rows — backfill must be 1:1 (verify `count(*) where documentTypeId is null` = 0 before SET NOT NULL).
- R2: recurring worker runs on raw client — resolver must not depend on tenant context (global table lookup only).
- R3: `DocumentTypeDef` inserts in migration must be idempotent-safe (ON CONFLICT (code) DO NOTHING) so re-runs/replays don't duplicate.