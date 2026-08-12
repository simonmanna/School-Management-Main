# ADR-010: Document Framework & Accounts Receivable

- **Status:** Accepted
- **Date:** 2026-06-14

## Context
Phase 3 must support School fees, POS sales, restaurant/hotel/hospital bills and
service invoices **without changing the accounting engine**. It also needs
payments, allocation and credit notes.

## Decision
A **single generic `Document`/`DocumentLine`** with a `documentType`
discriminator and `sourceType`/`sourceId` provenance. Verticals create documents;
`PostingService` posts them.

- **No duplicate receivable ledger.** The brief proposed a `Receivable` table
  with `outstandingAmount`. That is a *second set of books* and violates our core
  rule (TRANSFER.md / ADR-001). Instead, settlement state lives on the document
  (`amountPaid`, `amountResidual`, `paymentStatus`) and the **GL AR account is
  the financial truth**; aging is derived from open documents.
- **Server-authoritative totals.** A central `TaxCalculationService`
  (exclusive / inclusive / compound) recomputes line subtotal/tax/total and the
  document totals — client-supplied amounts are never trusted.
- **Payments + allocation.** `Payment` + `PaymentAllocation` (many-to-many)
  model partial payments, multi-invoice allocation and overpayment (unallocated
  credit). Each allocation updates the document residual transactionally and
  emits `invoice.paid` when residual hits zero.
- **Posting shapes (through PostingService):**
  - Invoice → Dr Accounts Receivable; Cr Revenue (per income account); Cr Tax.
  - Payment → Dr Cash/Bank; Cr Accounts Receivable.
  - Credit note → Dr Revenue; Dr Tax; Cr Accounts Receivable (and reduces the
    linked invoice's residual).
- **Numbering** reuses the Phase-2 `SequenceService` (`INV-2026-000001`).

## Consequences
**Positive**
- One document model serves every vertical; POS/School add workflow + screens,
  not accounting.
- Open-items and the GL can't drift — there is only one source of truth.
- Tax logic is centralized and unit-tested.

**Negative / Trade-offs**
- One line carries one tax today; multi-tax-per-line is a (non-breaking)
  extension of the already-array-based tax engine.
- Aging/aggregations are computed from documents in app code; very large AR books
  will later want a summarized read model or SQL views.

## Alternatives considered
- **Separate tables per document type (SalesInvoice, POSOrder…):** rejected —
  fragments posting/payment logic and duplicates CRUD.
- **`Receivable` balance table:** rejected — reconciliation drift; see above.
- **Trust client totals:** rejected — correctness/security risk.
