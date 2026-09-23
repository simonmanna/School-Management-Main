# HR & Payroll — Production Review and Hardening

_Review date: 2026-09-04. Scope: `apps/api/src/modules/hr`, `apps/web/src/pages/hr`,
the HR schema, and the HR integration suites._

## 1. Where the module started

The module was already broad — 7,800 lines of service code, 220 routes, 50 tables,
and 30 green integration tests covering Uganda PAYE/NSSF, GL posting, the
school-staff bridge and employee self-service. The GL integration in particular
was better than most: one journal per run, a per-employee `partnerId` subledger on
net pay, a posting key for idempotence, and an audit record written inside the
approval transaction so a run can never post unaudited.

What it was **not** was correct at the edges where payroll actually costs money,
and it had no outputs — no payslip document, no statutory schedule, no export.

## 2. Defects found

Each of these was money or compliance, not tidiness.

| # | Defect | Consequence |
|---|--------|-------------|
| 1 | Every date window used `lt: period.endDate` | The closing day of the period was excluded everywhere. Attendance, leave and hires dated on the 30th did not count. |
| 2 | Tax tables, statutory config and advance eligibility resolved against `new Date()` | Recalculating a September run in November priced it with November's tax table. A routine correction silently repriced history. |
| 3 | No pro-rata | A teacher hired on the 28th was paid a full month. So was one who resigned on the 2nd. |
| 4 | `HrLeaveType.isPaid` was never read by payroll | Approved **unpaid** leave cost the employee nothing. `absenceDays` was hardcoded to zero. |
| 5 | `isTaxable` on allowances was decorative | PAYE was charged on the entire gross. A receipted reimbursement was taxed as income. |
| 6 | `isRecurring: false` components were dead config | There was no way to pay a one-off bonus at all. `bonusAmount` and `commissionAmount` were hardcoded zero. |
| 7 | `reverseRun` reversed only the GL journal | Loan and advance balances stayed written down, payslips stayed ISSUED. A reversed-and-rerun payroll took a **second** installment for a month the employee repaid once. |
| 8 | One attendance aggregate + one component query **per employee**, inside the interactive transaction | ~800 round trips for a 400-staff school, inside a transaction with a 120s budget. |
| 9 | Balance seeded with the full annual entitlement on first use | A joiner in October held a full year of leave on day one; a March leaver was settled for a year they had not earned. |
| 10 | No payslip document, no register export, no statutory schedule, no bank list | The system could compute payroll but could not produce a single thing a bursar, an employee or a revenue authority needs. |

## 3. What was changed

### 3.1 Payroll engine (`hr-payroll.service.ts`)

`calculateRun` was rewritten. The governing rule is now: **everything
time-sensitive resolves as at the period's last day, never as at the clock.**

- Period arithmetic is UTC calendar arithmetic with an inclusive closing day.
- **Pro-rata**: `paidDays / periodDays`, where `paidDays` is days employed in the
  period (bounded by hire date and offboarding last working day) less approved
  unpaid-leave days. Applied to salaried base pay and to FIXED allowances;
  **not** applied to hourly pay (hours are already actual) or to PERCENTAGE
  allowances (they ride on an already-pro-rated base and must not be scaled
  twice) or to fixed deductions (an obligation is not a share of the month).
- `periodDays`, `paidDays`, `proRataFactor` and `unpaidLeaveDays` are **stored**
  on the payroll item, so a payslip stays explainable years later when the
  period, the leave records and the hire date have all moved.
- **Eligibility**: a mid-period leaver still earns a final payslip; someone who
  left in an earlier period, or is hired after the period closes, is excluded.
- **Taxable pay is tracked separately from gross**, so `isTaxable: false` on an
  allowance or an input genuinely excludes it from the PAYE base.
- **Batched**: employees, attendance, unpaid leave, inputs, components and grade
  structures are each fetched once. The per-employee loop is pure computation.

`reverseRun` now undoes everything approval did, inside the same transaction as
the journal reversal: loan and advance balances are restored (including
`installmentsPaid` and a `PAID` → `ACTIVE` reopen), payslips are **cancelled
rather than deleted** — staff may hold a printed copy, so the number has to keep
resolving to a voided slip — and consumed one-off inputs return to `APPROVED`.

### 3.2 Ad-hoc payroll inputs (new)

`HrPayrollInput` — one-off money for one employee in one period, which is what
Odoo calls "other inputs". Types: `BONUS`, `COMMISSION`, `ALLOWANCE`,
`DEDUCTION`, `REIMBURSEMENT`.

Two properties matter:

- **Separation of duties.** Capture needs `hr:payroll_input`; **approving** needs
  `hr:payroll`, the same right as running payroll. A clerk can key a bonus list
  off a memo without being able to authorise the money.
- **Paid once.** Only `APPROVED` inputs are picked up. Approving the run stamps
  them `APPLIED` with the run id, which is what stops a recalculate or a second
  run in the same period paying the same bonus twice. An `APPLIED` input cannot
  be edited, cancelled or deleted without reversing the run.

Bulk capture is one transaction, so a bad row rejects the whole list rather than
leaving half a bonus run behind. Reimbursements default to untaxed.

### 3.3 Leave accrual engine (new)

`HrLeaveAccrualService`, with one rule: **the ledger is the truth, the balance is
a cache.**

Every grant, carry-forward, forfeiture and expiry writes an `HrLeaveAccrual` row
keyed uniquely by `(employee, leaveType, periodKey)` — `2026-09` for a monthly
accrual, `2026` for an annual grant, `2026-CF` for a carry-forward. `accruedDays`
is then recomputed as the **sum** of that ledger, never incremented.

That key is what makes the job safe on a cron, on a retry, after a crash, or when
an administrator presses the button twice. It also makes "why do I have 14.5
days?" answerable line by line.

Leave types gained `accrualMethod` (`ANNUAL_UPFRONT` — the existing behaviour and
the default, so nothing changes for existing rows — `MONTHLY`, or `NONE`),
`accrualStartsAfterMonths` (the probation bar), `carryForwardExpiryMonths`, and
`maxBalanceDays` (a ceiling, so an employee who never takes leave does not
accumulate an unbounded liability).

Year end carries forward `min(remaining, carryForwardDays)` and **writes the
forfeiture to the ledger too** — an employee who loses eleven days is entitled to
see that it happened, rather than finding the number quietly smaller in January.
Carry-forward expiry consumes used days against the carried block first, which is
the reading that favours the employee.

`dryRun` on every mutating operation returns the movements without writing.

### 3.4 Payslip PDF (new)

`GET /hr/payslips/:id/pdf` (`hr:payslip`) and `GET /hr/self/payslips/:id/pdf`
(`hr:self`). pdfkit, for the reasons `ReportPdfSerializer` already documents.

- The self-service route passes the resolved employee id into the **WHERE
  clause**. Checking ownership after the read would still have loaded a
  colleague's payslip into memory, one early return away from serving it.
- Prints only stored figures. Nothing is recomputed, so the slip cannot disagree
  with the register, the journal or the bank instruction built from the same row.
- A pro-rated slip **explains itself** ("Pay pro-rated to 50.0% of the period:
  joined 2026-09-16") — otherwise it reads as an underpayment.
- A cancelled slip says so on its face.
- Bank account numbers are masked to the last four digits. Payslips are printed,
  photographed and forwarded; the full number on every one turns a routine
  document into a standing disclosure.

### 3.5 HR report centre (new)

Sixteen reports registered under a new `hr` namespace on the existing core
reporting engine — which was already built for exactly this (`report-registry.service.ts`
says so: "HR's builder will differ, which is why this is held per namespace").
Every report gets CSV, Excel and PDF export, filter validation, sort validation,
row caps and per-report permission checks for free.

**Payroll** (all additionally require `hr:payroll`): Payroll Register, PAYE
Return, Pension & Social Security Schedule, Bank Payment Schedule, Cost by
Department, Variance vs Previous Period, **Payroll Readiness Check**, Staff Loans
& Advances Outstanding, Run Summary.

**Workforce** (`hr:read` and friends): Staff Establishment, Contracts Expiring,
Certifications & Licences Expiring, Leave Balances, Leave Register, Staff
Attendance Summary, Joiners/Leavers & Turnover, Salary Bands by Grade.

Design notes worth keeping:

- Every payroll report is a presentation of the **same stored `HrPayrollItem`
  rows** the payslips and the GL journal were built from. None recalculates, so
  they reconcile by construction.
- A report on a `DRAFT`, `CALCULATED` or `REVERSED` run **says so in a note**.
  Provisional figures must not read as filed ones.
- The PAYE return flags employees who owe tax but have no TIN; the statutory
  schedule flags contributors with no fund number; the bank schedule flags
  everyone with no account at all and **names them**. The failure mode these
  exist to catch is an employee who silently is not paid.
- **Payroll Readiness** is the pre-flight check: missing salary, missing bank
  account, missing TIN, missing hire date (so pro-rata cannot be computed),
  missing partner link (so the ledger can say what payroll cost but not what is
  owed to whom).
- Turnover is leavers over **average** headcount, not closing headcount, which
  flatters a shrinking school.
- Salary Bands by Grade reports the gender pay gap per grade — reported, not
  judged — and needs `hr:payroll` despite being aggregated.

A catalogue spec (`test/unit/hr-report-catalogue.spec.ts`) asserts, among other
things, that **no report outside the payroll grant carries a pay column**. The
staff establishment report had `baseSalary` on it; the spec caught it and it was
removed from the query, not merely from the column list.

### 3.6 Permissions

New: `hr:payroll_input` (capture, not approve), `hr:reports:read`,
`hr:reports:export`. All three added to the HR Officer role bundle. `hr:read` was
deliberately **not** reused for the report centre, for the same reason the school
centre does not use `school:read`: it sits on most HR routes, so gating on it
would be decorative.

## 4. Database

Applied to `schooldb-planet` by `psql` (no `_prisma_migrations` history there),
both scripts idempotent:

- `prisma/sql/hr-payroll-inputs.sql` — `HrPayrollInput` + its two enums,
  `HrPayslipStatus.CANCELLED`, and the four pro-rata columns on `HrPayrollItem`.
- `prisma/sql/hr-leave-accrual.sql` — `HrLeaveAccrual` + its two enums, and the
  four accrual-configuration columns on `HrLeaveType`.

Both need folding into the migration chain before another environment is built.

## 5. Tests

- `test/unit/hr-report-catalogue.spec.ts` — 10 catalogue invariants (new).
- `test/integration/hr-payroll-prorata.spec.ts` — pro-rata for joiners, leavers
  and unpaid leave; the closing-day boundary; recalculation idempotence; ad-hoc
  inputs including that a PENDING input is not paid and an APPLIED one cannot be
  edited; and that reversal restores a loan installment and cancels payslips (new).
- The five existing HR integration suites (30 tests) were green before the work
  started and are the regression baseline.

## 6. Second pass — 2026-09-21

Migration `20260921150000_hr_payroll_production_hardening`. Regression suite:
`test/integration/hr-payroll-hardening.spec.ts` (20 cases); the Uganda,
pro-rata and posting suites were updated for the corrected behaviour.

### 6.1 Money defects fixed

| # | Defect | Fix |
|---|--------|-----|
| 1 | Approval reduced **each** of an employee's loans/advances by the employee's **total** installment; reversal added the total back to each. | Every payroll line records `sourceType`/`sourceId`. Approval and reversal settle each loan, advance and input by its own lines. |
| 2 | Approval stamped **every** approved input in the period APPLIED, including ones approved after calculation — never paid. | Only inputs on this run's lines are stamped; approval is refused if an input was approved, cancelled or changed after calculation. |
| 3 | The tenancy soft-delete filter does not reach nested `include`s, so after a tax-table edit the old **and** new brackets priced PAYE (doubled). | Brackets are always included with an explicit `deletedAt: null`. Brackets are validated (ordered, non-overlapping, PAYE rate is a fraction). |
| 4 | Final settlement paid the last month in its own journal **and** payroll paid it again; untaxed; leave payout summed every balance ever held; employee soft-deleted. | Settlement no longer pays. The final payroll run pays the pro-rated salary, a taxed leave-encashment input (encashable types, current year only, PENDING payroll approval) and recovers loans/advances in full. The leaver is deactivated, not deleted. |
| 5 | PAYE base was gross − NSSF. Uganda does not allow NSSF against PAYE. | `HrTaxTable.contributionsDeductible` (country law). Uganda seed: `false`. |
| 6 | PAYE annualised ×12 for every period type. | ×52 weekly, ×26 bi-weekly, 365/days for custom. |
| 7 | A monthly salary in a weekly period was paid in full every week; DAILY pay was a pro-rated monthly figure. | Salaried staff are paid only in periods of their own frequency; DAILY = day rate × days attended. |
| 8 | No PAYE table → zero tax for the whole school, silently. | Calculation is refused. |
| 9 | Advances were recovered once APPROVED, before any money was paid out. | Only PAID advances and ledger-disbursed loans are recovered. |

### 6.2 Ledger completeness

- **Employer contributions** — `HrStatutoryConfig` (versioned, employee + employer rate, base GROSS/BASIC, monthly ceiling) now drives NSSF/pension. Employer share: Dr `employer_contribution_expense` / Cr the fund's payable, stored per item and shown on the statutory schedule (5% + 10% = 15% remitted). A component duplicating a statutory contribution is refused.
- **Local service tax** — LOCAL tax tables with fixed annual band amounts collected over `collectionMonths`; Cr `local_tax_payable`.
- **Other deductions** — `deductionCategory` on components: `OTHER_PAYABLE` credits `other_deductions_payable`; `RECOVERY` stays a contra to salary expense.
- **Salary payments** — single payslip (`markPaid`) or bank batch (PAID) posts Dr net pay payable (per employee partner) / Cr bank|cash|mobile-money clearing. Run → PAID when every slip is paid. Payment reversal endpoints for both. One live batch per run.
- **Advances / loans** — payout and disbursement post Dr receivable / Cr bank|cash; flat loan interest credits `staff_loan_interest_income`; write-off Dr `bad_debt`.
- New mapping keys auto-provision (COA codes 2250, 2260, 4290, 5720) for orgs created before them.

### 6.3 Controls

- State transitions are claimed with a conditional `updateMany` inside the transaction (runs, payslips, batches, advances, leave) — concurrent double-approve/double-pay cannot both succeed. Run creation and batch generation take an advisory lock.
- Separation of duties: nobody approves an advance they requested or one made out to themselves, or their own leave. Loan write-off needs `hr:payroll`.
- Loan balances cannot be edited; they move only through payroll, reversal or an audited write-off. Disbursed loans cannot be deleted.
- A run with paid payslips cannot be reversed until the payment is reversed. Period dates cannot change under an approved run; overlapping periods are refused; runs need an OPEN period.
- Money is rounded to the currency's minor unit as it is produced, so each item is an exact sum of its lines and every journal balances without a rounding line.
- `previewRun` never writes (a DRAFT run must be calculated first).
- Payroll Readiness report flags organisation blockers (no PAYE table, missing GL mappings, no bank/cash account).
- `HrSchedulerService`: daily leave accrual, 1 Jan year-end rollover, carry-forward expiry, daily HR alerts — advisory-locked, off under `NODE_ENV=test` or `HR_SCHEDULER_ENABLED=false`.

### 6.4 Web

- Offboarding "preview" called `POST /settle` — pressing Compute settled the employee for real. Now a GET estimate plus an explicit Confirm.
- Payroll settings: component rate was labelled "0.05 = 5%" while the engine reads a percent (5% became 0.05%); "Full-time only" was stored without `employmentType:` and applied to everyone. Fixed; added a bracket editor, LST, and a statutory-contributions tab.
- Payroll run: payment batches (generate / sent / paid / cancel / reverse), employer cost. Payslips: payment method, payment reversal, LST line. Advances/loans: payout method, disburse, write-off (no balance edits). Leave types: "paid out on exit".

## 7. Still open

Ordered by what a school feels first.

1. **Disciplinary and grievance records.** Entirely absent, and a school needs
   them — warnings, hearings, outcomes, appeal windows, with document
   attachments and retention.
2. **Appraisal cycles.** `HrPerformanceReview` is a single flat row. A premium
   module wants cycles, objectives, weighted competencies, self-assessment,
   manager review, moderation, and a link into salary review.
3. **Teacher-specific workload.** Cover and substitution management, and
   timetable load against contracted hours. The academics module has the
   timetable; HR has the contract; nothing joins them.
4. **Attendance capture.** Biometric/RFID device ingestion, geofenced mobile
   clock-in, and shift rosters that generate expected attendance. Today
   attendance is largely manual.
5. **Approval delegation and multi-step approval chains** for leave and payroll —
   an acting head of department cannot currently approve anything.
6. **Year-to-date figures on the payslip.** Deliberately omitted rather than
   computed in the renderer; they belong on the payroll item when the engine
   writes them.
7. **Annual employee tax certificates / year-end returns** built from the stored
   payroll items (the per-period PAYE return exists).
8. **Payslip distribution** — email/portal notification when payslips are issued.
9. **Statutory rates to confirm with URA/NSSF before go-live**: PAYE bands, NSSF
   5%/10% on gross, LST bands, and whether LST paid is PAYE-deductible
   (`UG-LST.contributionsDeductible`, seeded `false`).

Closed on 2026-09-21: `other_deductions_payable` mapping (§6.2), web screens for
payments/statutory/brackets (§6.4), scheduled execution (§6.3). The two SQL
scripts in §4 are already folded into the migration chain
(`20260920120000_reconcile_local_drift`).
