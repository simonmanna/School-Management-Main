# ADR-013 — School Fee Economic Events

**Status:** Accepted
**Date:** 2026-08-20
**Supersedes:** none
**Related:** ADR-009 (GL engine), ADR-010 (Document/AR), ADR-011 (vertical extension contract)

## Context

The school Fees & Finance production-hardening audit found that the school vertical
reduced student balances by mutating cached document columns directly —
`document.amountResidual -= amount`, `document.amountPaid += amount` — for waivers
and credit drawdowns. This produced four classes of defect:

- **P0-2** a partial waiver committed subledger changes with no GL entry;
- **P0-3** waivers and credits were counted as cash received;
- **P1-2** a fee credit could be minted with no funding source;
- **P1-3** an overpayment and the credit it funded were counted as two separate
  refundable pots.

The root cause is the absence of a **typed economic event** behind each balance
change. This ADR freezes the semantics of every school-finance economic event
before Phase 1 builds them, so the historical remediation (Phase 0.9) and the new
services target the same target model.

## Decision

**Every financial change is a typed economic event that persists atomically with
both its subledger effect and its accounting effect, and is corrected only through
a compensating/reversal event — never by editing a posted record.**

The event types and their frozen semantics:

### INVOICE / PENALTY (charges — Debit AR)

A charge issues a `Document` (via `DocumentBuilderService`) plus, for tuition, a
`SchoolFeeInvoice` bound 1:1. Debit AR, credit revenue (+ output tax when present).
Immutable once posted. A penalty is a *new charge*, not a reduction — it is not
part of the fee-calculation pipeline.

### PAYMENT (Credit AR)

Realized payment consideration, any tender method. Written only by
`PaymentService.createReceipt`, which caps allocation at residual and writes
`CashMovement`. Recorded as `PaymentAllocation` rows; `Document.amountPaid` is the
cached projection of `SUM(PaymentAllocation)` and is **cash only** — never touched
by a waiver or credit.

### WAIVER (forgiveness — Credit AR)

The school forgives a receivable it does not expect to collect. `Dr Waiver Expense
/ Cr AR`. Reduces `amountResidual` and increments the new `amountWaived` column;
**never** `amountPaid`. Terminal once applied. Requires approval
(`school:fees:waiver:approve`) and `approvedById ≠ createdById` (maker-checker).
A bad-debt write-off is a waiver with `badDebt = true`.

### FeeCredit + CREDIT_APPLIED (stored value)

A `FeeCredit` is student-held value applicable to *future* receivables — a
liability, not a payment. `createCredit` posts `Dr AR / Cr Fee-Credit Liability`
and **requires an explicit origin**:

- `overpayment` — funded by unallocated inbound payment; records the conversion
  against `sourcePaymentId` so the entitlement is counted once (P1-3 fix);
- `refund_conversion` — a refund carried forward as credit instead of paid out;
- `approved_adjustment` — requires an approver;
- `opening_balance` — migration only.

Creation with no origin is rejected. Application draws down against invoices
oldest-first, recorded as **`FeeCreditAllocation`** rows (the credit subledger),
posting `Dr Fee-Credit Liability / Cr AR`. `FeeCredit.remaining` is a derived
cache: `amount − SUM(valid allocations) + SUM(valid reversals)`, never
authoritative. Lifecycle: `ACTIVE → PARTIALLY_APPLIED → FULLY_APPLIED`, with
`EXPIRED / REFUNDED / REVERSED` branches. `isRefundable` governs whether the
outstanding balance may be paid out.

### REFUND (Debit AR or Credit Cash)

Money paid back, via `PaymentService.createCustomerRefund` (outbound,
counterAccount = receivable). Capped at the canonical `refundableAmount`:

```
refundableAmount(partner) =
      eligible posted inbound payment value
    − allocated to invoices
    − previously refunded
    − amount already converted into a FeeCredit
  + SUM(FeeCredit outstanding WHERE isRefundable AND status IN (ACTIVE, PARTIALLY_APPLIED))
```

Refunding an *allocated* payment reverses the allocation and **restores AR**
(a `REVERSAL` event); refunding *unallocated* cash does not create AR. Requires
approval. The original payment stays immutable.

### ADJUSTMENT (either direction)

Any balance change not explained by the above is a `FeeAdjustment` — typed,
directional (debit/credit), reason-bearing, approved, GL-posted, reversible.
This is the escape hatch that prevents a future `amountResidual -= x` from ever
being the "adjust balance" mechanism.

### REVERSAL

Corrections use `PostingService.reverse` + a compensating entry. Posted financial
records are never edited.

## Consequences

- Balances are reproducible from immutable events; `SchoolFinanceQueryService`
  becomes the single calculation layer, reading — never inventing — truth.
- Cached columns (`amountPaid`, `amountResidual`, `amountWaived`, `remaining`) are
  performance projections. A CI reconciliation test asserts they equal their
  subledger (Gate 1/4).
- No new accounting engine: every event reuses `PostingService` and
  `PaymentService`. The school vertical remains a disciplined consumer per ADR-011.
- Historical rows that mutated balances without an event are corrected through
  Phase 0.9 remediation batches, not migrations.

## Alternatives considered

- **Keep mutating cached columns, add a GL post alongside.** Rejected: leaves the
  subledger and GL able to diverge silently (the P0-2 failure mode), and gives no
  audit trail for *why* a balance changed.
- **A single generic `LedgerEntry` table for all events.** Rejected for now: the
  events have materially different lifecycles, approval rules, and funding
  constraints; typed models make those enforceable. The student *ledger* is still
  a typed union view over them.
- **Scalar `Document.amountCredited`.** Rejected: a credit is stored value with
  its own lifecycle and allocation semantics, not a per-document scalar; it needs
  the `FeeCreditAllocation` subledger.
