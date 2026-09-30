# ADR-033 — Finance controls: mandatory posting, GL-based bank reconciliation, period lock policy

- **Status:** Accepted (owner decisions 2026-09-30)
- **Wave:** 18 (finance & accounting production hardening)
- **Supersedes:** the "best-effort GL" comments in expenses, income and cash sessions; the Phase D Payment-based bank matcher

## Context

The 2026-09-30 finance review found that cash could leave the school without a journal (expense payment
skipped posting when an account did not resolve), that bank reconciliation compared `Payment.accountId` (a
ledger account) with `BankAccount.id` and could not see expense payments or mobile-money payouts, that a
locked fiscal period could be reopened by anyone with `fiscal_period:update` (and a second `/fiscal-periods`
controller accepted `status` in a PATCH body), that expense approval trusted identities sent by the client,
and that the AR/AP tie-out reported "balanced" when it had not run.

## Decisions

1. **Posting is mandatory.** Every writer of cash, bank, income or expense records posts its journal in the
   same transaction or fails with an error naming the missing mapping. There is no "record now, journal later".
   `test/unit/no-best-effort-gl.spec.ts` guards the money writers against the old patterns.

2. **Bank reconciliation matches the general ledger.** A statement line reconciles to a `JournalLine` on
   `BankAccount.accountId`, signed the bank's way (`baseDebit − baseCredit`). A `BankReconciliationMatch` row
   records each match; partial unique indexes allow one live match per statement line and per ledger line across
   all runs; unmatching stamps the row instead of deleting it. Auto-match needs an exact signed amount and
   currency within a 0–7 day window; the closest date wins and ties go to a person. The report shows adjusted
   bank vs adjusted book balance; reconciled means a difference of 0.

3. **Period lock policy.** Close, lock, reopen and unlock are separate permissions. `closed → open` needs
   `fiscal_period:reopen`; `locked → open` needs `fiscal_period:unlock` (Administrator only). Both require a
   reason, refuse while any later period is closed or locked, reverse the closing entry on its own date, and
   write an audit row with the prior close metadata. A period's status never comes from a request body; periods
   cannot overlap (database exclusion constraint) and end at the last millisecond of their last day in the
   organization's time zone. Posting takes the covering period `FOR SHARE`; close takes it `FOR UPDATE`.

4. **Expense segregation of duties.** Identities come from the session. The raiser cannot approve; the approver
   cannot pay (`settings.finance.enforcePayerApproverSod`, default on). Without an approval workflow an expense
   waits for an inline approval by a second person — nothing is auto-approved — except petty cash: a CASH expense
   at or below `settings.finance.pettyCashThreshold` (default 0 = off) may be raised, approved and paid by one
   person and is audited as `pettyCash`.

5. **Truthful reconciliations.** A tie-out that cannot be computed is stored as `not_run` with a reason and is
   never balanced. Report date ranges are calendar days in the organization's time zone.

## Consequences

- A fresh install must map `default_expense` (or map each expense category), `cash_short_over`,
  `cash_clearing`, `default_bank` and the AR/AP control accounts before those flows work; the error says which.
- Old Payment-based bank matches are not migrated (greenfield); every statement line starts unmatched.
- The old CoreModule `FiscalPeriodController` is removed; `/fiscal-periods` is served by the accounting module.
