# Fees & Payments — Production-Readiness Review (School-Management)

**Reviewer:** Hermes Agent (professional-level standards review)
**Date:** 2026-08-27 (EAT)
**Scope:** `apps/api/src/modules/school/fees/*` (Fees & Payments) and its relation to `apps/api/src/modules/accounting/*` (Accounting/GL).
**Method:** Source read of the full module (billing, payment, advanced, reconciliation, controls, query, mobile-money, catalog), Prisma schema models, the single `PostingService` GL writer; plus **runtime verification** — `nest build` (0 errors), the live DB `schooldb-planet` (integrity indexes confirmed present), and the project's own certification test suites executed end-to-end against that live DB.

---

## Verdict

**PRODUCTION READY — with two non-blocking items to close before a real-money go-live.**

This is not a stub, a demo, or a hollow clone. The Fees & Payments module is a genuinely engineered double-entry billing system with database-enforced idempotency, concurrency-safe credit drawdown, immutable reversal semantics, a canonical single balance calculation, live AR⇄GL reconciliation, mobile-money replay safety, and a school-domain term-close control distinct from the accounting fiscal period. It reuses the platform's one payment writer and one posting service rather than hand-rolling accounting — which is exactly the architecture a production system should have.

**Evidence executed (not asserted):**
- `nest build` → **0 compile errors**.
- Integrity migration `20260824120000_fees_integrity_constraints` **is live** in `schooldb-planet`: both Business-Key unique indexes (`Document_org_partner_source_reference_key`, `Payment_org_externalref_direction_key`) exist.
- **G4/G5 certification gate** (`school-fees-concurrency.spec.ts`) → **3/3 PASS** against live DB:
  - P0-A: two concurrent billing runs for the same student/term → exactly ONE invoice.
  - P0-B: two concurrent MoMo collects with same `externalReference` → ONE payment.
  - G5: billing into a closed term → rejected before any document is written (no partial leak).
- **Integrity invariants gate** (`school-fees-integrity.spec.ts`) → **8/8 PASS** (after the test's own seed was corrected — see Finding N1). Specifically proves: `collected = SUM(PaymentAllocation)`, portal==statement==ledger, a waiver posts a GL entry and never touches `amountPaid`, refund capped at canonical entitlement, adjustment moves residual AND GL AR leg together, and **AR subledger reconciles to GL AR control with zero variance**.
- **30 unit assertions** (`fees-phase0-hardening`, `fees-pricing-and-period`, `optional-fees-billing`) → **30/30 PASS**.
- Live DB has real operating data: **13 Fee Categories, 79 Fee Structures, 76 published versions, 314 SchoolFeeInvoices, 1,021 school_fee documents (341 already posted to the GL), Fee-Credit Liability account (`FEE-CR`) with live journal lines.**

---

## Scorecard

| Dimension | Score | Notes |
|---|---|---|
| Billing correctness (pricing provenance, proration, discounts/scholarships, optional gating) | 9/10 | One real gap in test coverage (N1); logic itself sound. |
| Payment integrity (idempotency, allocation, overpayment→credit, refunds) | 10/10 | Concurrency-safe, DB-enforced, entitled-refund cap correct. |
| Accounting integration (single PostingService, AR/GL tie-out) | 9/10 | Real and verifiable; one reconciliation edge worth tightening (N3). |
| Concurrency / race safety | 10/10 | Conditional `updateMany` decrements, DB unique indexes as backstop. |
| Real-world Ugandan fit (MoMo, partial pay, boarding/day, clearance) | 9/10 | Strong; sponsorship still gated (by design — see N2). |
| Auditability / controls (maker-checker, term close, immutable reversals) | 10/10 | Excellent. |
| Test suite (gating quality) | 8/10 | Genuine gates, but one suite ships with stale seed data (N1). |
| **Overall** | **9.1/10** | **Production ready; close N1 + N2/N3 before go-live.** |

---

## What is genuinely production-grade

1. **One payment writer, one GL writer.** `SchoolPaymentService.collect` delegates to `PaymentService.createReceipt`; every fee posting goes through `PostingService.post`. No parallel accounting paths to diverge.
2. **Database-enforced idempotency.** Replayed MoMo/bank callbacks and re-imported statement rows are caught by unique indexes under READ COMMITTED — the application `findFirst` is a convenience, the DB is the guarantee. Verified by G4 P0-B.
3. **Immutable economic events.** Allocations, credits, waivers, adjustments, refunds are never edited — they are reversed-then-re-created as new rows. The authoritative record is the reversal/allocation row, not a cached `status`.
4. **Canonical balance.** `studentBalance` computes `billed − collected − waived − credited + adjusted` where `collected` is `SUM(PaymentAllocation)`, never the polluted `amountPaid`. Portal, statement, and ledger all read this one function. P0-1/P0-3/P0-4 class defects are structurally impossible here.
5. **Concurrency-safe credit drawdown.** `applyCredits` and `refundFee` use conditional `updateMany({ where: { id, remaining: { gte: take } }, data: { decrement } })` so two simultaneous refunds cannot both pay out one credit.
6. **Live AR⇄GL reconciliation** (`reconcileCurrentArToGl`) that correctly accounts for prepayments (unallocated inbound) so an ordinary "parent paid ahead" doesn't cry wolf — and a cached-projection drift check (`reconcileCachedProjections`) that would catch any `amountPaid`/`amountWaived`/`FeeCredit.remaining` divergence.
7. **School-domain term financial close** (A4.1) deliberately separate from the accounting fiscal period, with maker-checker reopen, so closing a term can't accidentally close the org's books.
8. **Fee clearance before exams** (`feeClearance`) gated on a configurable percentage; waivers/credits count toward clearance. This is the real-world Ugandan requirement wired end-to-end.
9. **Mobile-money collection** (MTN MoMo / Airtel) with HMAC signature verification, provider abstraction, and every confirmed callback funnelled into the single `collect` path — no second money-recording path.
10. **Full catalog CRUD**: Fee Categories, Fee Structures (+ versioned publish), Schedules, Student Assignments, Optional Fees (mandatory/optional gating by `StudentOptionalFee`), Discounts, Scholarships, Installment Plans. Competitor-parity catalog (Fee Categories + Fee Structure) is fully wired and runtime-verified (13 categories, 79 structures live).

---

## Findings

### 🟡 N1 (Important) — `school-fees-integrity.spec.ts` ships with a stale seed; the suite is RED on a clean run
**Evidence:** `test/integration/school-fees-integrity.spec.ts:116` creates a `FeeStructure` but **omits the published `FeeStructureVersion` + `FeeItem`** and the `currentVersionId`. `BillingService.pricedComponents` correctly returns `null` (unpriceable structure) → `generateForTerm` bills 0 students → first assertion `expect(res.count).toBe(1)` **fails**, cascading to 5 more failures (including the headline "AR reconciles to zero variance" reading 10000, which is actually the test's *own* un-created invoice, not a product variance).
**Impact:** A reviewer running the suite sees 6 failures and concludes the module is broken. The product is fine — the gate's own fixture is wrong.
**Verification:** I temporarily added the published version to the seed and **all 8 invariants passed** (billing 1:1, waiver GL + no `amountPaid` mutation, refund cap, adjustment GL lock-step, AR⇄GL zero variance). I then reverted the test to its original state so this is reported, not silently hidden.
**Fix:** In the `beforeAll` seed, after creating `feeStructure`, also create a `FeeStructureVersion` (with `feeItems`) and set `status:'published'`, `currentVersionId`. This mirrors what the passing G4 suite already does. **This is a test-data fix, not a product fix.** (I can apply it on your go-ahead — I left the file reverted so you can decide.)

### 🟡 N2 (Important) — Sponsorship is intentionally gated, not a defect
**Evidence:** `AdvancedFinanceService.sponsorStatement` honestly reports `paidBySponsor: 0` for every student and documents that a sponsor is **not yet a real payer** — collections still land on the student's AR. The `capAmount` field is validated for positivity and overlapping-period rejection, but the cap is explicitly *not* enforced against consumption because no money is collected "from the sponsor."
**Impact:** If you intend to let sponsors pay on their own receivable (a real third-party-payer flow), this is the one feature that is **not** production-ready and is correctly switched off at the controller (Phase 5). Waivers, credits, refunds, penalties, and defaulters ARE production-ready.
**Recommendation:** Either keep sponsorship admin-only (current state, safe) or promote the sponsor to a real Partner-payer with its own AR before exposing it to guardians.

### 🟢 N3 (Nice-to-have) — Reconciliation is current-state only; add an as-of snapshot
**Evidence:** `reconcileCurrentArToGl` and `reconcileCachedProjections` are point-in-time. There is no date-scoped (`as-of`) AR⇄GL tie-out, which `FINANCIAL_INVARIANTS` itself says to forbid mixing with the current GL balance. For audit at period close you currently rely on the frozen `TermFinancialClose.snapshot`.
**Recommendation:** Add a `reconcileArToGlAsOf(date)` that reads the GL net *up to* the posting date (not the live balance). Not blocking — the period-close snapshot already covers the common need.

### 🟢 N4 (Nice-to-have) — Sweeping the cash drawer fee custody
**Evidence:** `reconcileOperationalCash` compares Payment vs CashMovement for cash methods. This is solid for cash. Bank/MoMo settlement is (correctly) reported separately as a legitimately-lagging timing difference.
**Recommendation:** None required; this is the right call. Just ensure a daily Z-report is actually run so the cash leg is exercised.

---

## Real-world readiness against your stated Ugandan primary-school realities

| Reality | Status |
|---|---|
| UGX, 3 terms/yr | ✅ `AcademicYear`/`Term`, currency `UGX`, decimals to 6. |
| Cash + MoMo at the gate | ✅ Cash sessions + live MTN/Airtel request-to-pay + bank/MoMo statement import. |
| Partial-payment norm | ✅ Oldest-first allocation; overpayment auto-converts to FeeCredit. |
| Boarding/day pricing | ✅ `appliesTo.residenceTypes` (P2) — was a real bug, now fixed. |
| Fee-clearance-before-exams | ✅ `feeClearance` + `classFeeClearance`, configurable %. |
| MoMo/Airtel gateways | ✅ Provider abstraction, HMAC verify, replay-safe. |
| SMS / printable termly statements | ✅ `FeeNotificationsSubscriber` (SMS) + `explainBalance` statement payload; `sponsorStatement`/`studentLedger`. |
| Competitor parity: Fee Categories + Fee Structure | ✅ Both fully CRUD'd, versioned, live (13 / 79). |

---

## Final answer to "is it production ready?"

**Yes — for billing, collection, waiver, credit, refund, penalty, defaulter, and reconciliation flows, this is production-grade and runtime-verified.** Close **N1** (fix the test seed so the gate is green on a clean checkout) and consciously decide on **N2** (keep sponsorship gated, or finish the third-party-payer flow) before a real-money go-live. N3/N4 are polish, not blockers.

The single most important point: the headline "6 failing tests" a casual run shows is a **stale test fixture**, not a product defect — I proved the product passes all 8 invariants end-to-end against the live database.
