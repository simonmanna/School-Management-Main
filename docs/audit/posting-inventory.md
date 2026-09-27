# Posting-path inventory (financial truth)

Audit 2026-09-27, plan Phase 2.1. Every path that creates or changes a school fee figure, and how it satisfies the four posting rules. Invariants: I-020 (one approval, one effect), I-021 (closed term, no posting), I-022/I-003 (pupil from the document), I-023 (cash custody).

Rules:
- **Claim** — the state that decides whether to post is read under a row lock or a conditional update inside the posting transaction.
- **Doc lock** — rows whose residual is recomputed are locked before read-modify-write (or the write is relative/conditional).
- **Close gate** — `lockTermsOpen` / `assertTermOpen(…, tx)` / `assertDocumentsPeriodOpen(…, tx)` inside the posting transaction; holds the shared term-close advisory lock until commit. `closeTerm` / `reopenTerm` take it exclusively and snapshot under it.
- **Replay** — a repeated request returns the first result.

| Path | Service / method | Claim | Doc lock | Close gate | Replay | Pupil source |
|---|---|---|---|---|---|---|
| Term billing (bulk) | `BillingService.generateForTerm` → `billStudentTransaction` | existing-doc check + business-key unique index | n/a (new doc) | `assertTermOpen(termId, tx)` (Wave 14) | unique index + P2002 → skipped | placement |
| Single pupil / billing-run item | `billSingleStudent` → `billStudentTransaction`; `BillingRunService.process` | item compare-and-set claim | n/a | in tx (Wave 14); `process` pre-check (Wave 14) | already-billed skip | placement |
| Penalty run | `BillingService.generatePenaltyRun` | `PenaltyRun` per (schedule, day) | n/a | `assertTermOpen(schedule.termId, tx)` (Wave 14) | per-day run row | source invoice |
| Meal billing | `MealBillingService` | existing-doc check | n/a | `lockTermsOpen(tx, …)` (Wave 14, was missing) | sourceId + postingKey | assignment |
| Transport billing | `TransportBillingService` | `TransportCharge` per period | n/a | `lockTermsOpen(tx, …)` (Wave 14, was missing) | charge per period | assignment |
| Fee adjustment approve | `FinanceControlsService.approveAdjustment` | `FOR UPDATE` adjustment + status re-read in tx (Wave 14, was pre-tx read) | `FOR UPDATE` document (Wave 14) | `assertDocumentsPeriodOpen(…, tx)` | posted → original; `postingKey`; unique `journalEntryId` | invoice (Wave 14, was request body) |
| Fee adjustment reject | `rejectAdjustment` | conditional `updateMany` on `pending_approval` | n/a | n/a (no posting) | 400 on second | — |
| Waiver apply / bad-debt write-off | `AdvancedFinanceService.applyWaiver` | `FOR UPDATE` waiver | per-doc | `assertDocumentsPeriodOpen(settled, tx)` | status check under lock | waiver's pupil |
| Credit drawdown | `applyCredits` | credit remaining under tx | per-doc | `assertDocumentsPeriodOpen(…, tx)` | allocation rows | credit's pupil |
| Allocation reversal / reallocate | `PaymentAllocationReversalService` | reversal row unique | per-doc | `assertDocumentsPeriodOpen(…, db/tx)` | alreadyReversed | allocation |
| Payment reversal | `reversePayment` | status claim | per-doc | via allocation reversal | alreadyReversed | payment |
| Fee refund | `SchoolPaymentService.refundFee` | entitlement re-derived in tx | — | `assertDocumentsPeriodOpen(…, tx)` for allocated refunds | refund request state | pupil |
| Receipt (desk, batch, MoMo, portal) | `SchoolPaymentService.collect` → `PaymentService.createReceipt` | idempotency key + DB unique external ref | allocation writer | **Deliberately none** — owner decision D1 (2026-09-25): arrears in a closed term stay collectible; settlement books no revenue and the close snapshot is frozen | replay → original | request (scoped) |
| Cash custody | `collect` / `refundFee` → `cashCustodySession` | — | — | — | — | drawer mode: caller's open session required (Wave 14) |
| Admission fee | `AdmissionFeeService` | application state | — | not term-bound | payment ref | applicant |
| Library fine | `LibraryService` | fine row | — | not term-bound | fine status | borrower |
| Term close / reopen | `closeTerm` / `reopenTerm` | exclusive advisory lock; snapshot inside the same tx (Wave 14) | — | — | upsert | — |

Evidence: `apps/api/test/integration/wave14-finance-integrity.spec.ts` (D03, D04, D05, D09, F21); existing `school-fees-integrity`, `school-fees-concurrency`, `fees-accounting-hardening`.

Re-run this review when a new financial mutation is added: it must call a close gate with its transaction, derive the pupil from the document it touches, and claim its deciding state inside the transaction.
