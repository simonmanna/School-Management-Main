# Wave 18 — finance & accounting production hardening (2026-09-30)

Branch `wave18-finance-hardening` (off `wave17-audit-remediation`). Source: external finance review (NO-GO,
1 P0 + 4 P1) plus an internal review of posting, periods, fees, mobile money, cash, reporting and tests.
Decisions recorded in [ADR-033](../adr/ADR-033-finance-controls-gl-reconciliation-and-period-lock.md).

## Findings → fixes

| # | Sev | Finding | Fix | Evidence |
|---|-----|---------|-----|----------|
| R1 | P0 | Expense payment saved as posted with no journal when accounts did not resolve | Mandatory posting; mapped expense account; pay-from must be cash/bank; Decimal; journal dated with payment date; `sourceId` = payment | `wave18-expense-posting.spec.ts` |
| R2 | P1 | Bank reconciliation compared `Payment.accountId` with `BankAccount.id`; re-match across runs | GL-line matcher, `BankReconciliationMatch` with live-unique indexes, audited manual actions, report, web page | `wave18-bank-recon.spec.ts` |
| R3 | P1 | Locked period reopenable via `fiscal_period:update`; create accepted `status`; overlaps | Separate grants, reason + audit + closing-entry reversal, later-period guard, DB exclusion constraint; duplicate Core controller removed | `wave18-fiscal-period.spec.ts` |
| R4 | P1 | Expense pay accepted DRAFT; no workflow ⇒ auto-approve; client-supplied approver | Session identities, raiser ≠ approver, approver ≠ payer, petty-cash threshold, approved expenses frozen | `wave18-expense-posting.spec.ts` |
| R5 | P1 | Tie-out "balanced" when a mapping was missing | `not_run` status + reason; nightly job enters each tenant; per-partner control accounts | `wave18-tieout-reports.spec.ts` |
| I1 | P1 | Income and drawer variance/movements skipped GL silently | Fail closed | guard spec, existing cash specs |
| I2 | P1 | Races: expense pay, PO pay, drawer close, allocation reversal, payment reversal, journal reverse, MoMo request status | Row locks + conditional updates | `wave18-concurrency.spec.ts`, `wave18-expense-posting.spec.ts` |
| I3 | P1 | MoMo success callback posted requested amount when amount missing; no currency check | `needs_review` on missing/different amount or missing/foreign currency | `wave18-concurrency.spec.ts` |
| I4 | P1 | MoMo payout could sweep a collection twice / without naming collections | `requestIds` required, conditional linking | `wave18-concurrency.spec.ts` |
| I5 | P2 | Untyped `externalReference` had no DB dedupe; replay returned empty allocations | Type required; `NULLS NOT DISTINCT`; real replay | fees specs |
| I6 | P2 | Period last day dropped by midnight `endDate`; reports used UTC days | End-of-day bounds in org time zone; report ranges likewise | fiscal + reports specs |
| I7 | P2 | P&L served cumulative snapshot for dated range | Snapshot only for open-ended range | reports |
| I8 | P2 | Generic payment void could hard-delete fee refunds/unallocated receipts | Refused for any pupil account | `wave18-concurrency.spec.ts` |
| I9 | P2 | Fractional shillings from percentage discounts; float overpayment math | Fixed-amount rounded discounts; whole-unit checks on collect/refund; Decimal | `wave18-ugx-e2e.spec.ts` |

## End-to-end

`wave18-ugx-e2e.spec.ts` runs one UGX term: bill, cash/bank/MoMo collections, overpayment credit, reversed
receipt, petty cash + approved expense, drawer variance, MoMo payout, bank statement reconcile (difference 0),
tie-out (AR balanced), balance sheet balanced, cash flow reconciled, June closed and locked (posting refused).

`apps/api/scripts/finance-invariants.sql` — 9 invariant queries; on the dev database (all organizations) every
query returned 0 rows on 2026-09-30.

## Verification

- API typecheck clean; unit 145 suites / 2490 tests pass; `authz:check` routes=113 gaps=0; lint 0 errors.
- Integration: all wave18 specs plus fees, cash, ledger, procurement, MoMo, POS regressions — green.
- Web typecheck clean; browser check: fiscal-period confirmation dialog, permission-gated actions, bank
  reconciliation page, expense form without identity pickers.

## Deviations from the plan

- Bursar preset not granted close/lock/reopen (it holds no fiscal-period rights today); Administrator only.
- No separate partial unique index on `(sourceType, sourceId)`; single-post sources carry `postingKey`s,
  whose unique index already enforces one journal per source.
- Historical tie-out is recorded `not_run` rather than rebuilt as-of (the sub-ledger is current-state).
- PO concurrency is covered by the row lock + version fence; no dedicated PO race test.

## Still required before GO

- Independent re-audit of this branch.
- Live-data certification on a host with a real school's data (out of scope here).
- Configure mappings on each tenant (`default_expense` or category accounts, `cash_short_over`,
  `cash_clearing`, `default_bank`, AR/AP) — flows now refuse to run unmapped.
