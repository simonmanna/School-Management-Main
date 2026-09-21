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

## 6. Still open

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
7. **`other_deductions_payable` account mapping.** Other deductions are currently
   credited back against salary expense, which balances the entry but creates no
   liability — correct for a reimbursement, wrong for union dues owed onward.
   Flagged in a comment in `approveRun` since before this review.
8. **Web UI for everything added here** — payroll inputs, the accrual engine, the
   report centre and the payslip download all have API surface and no screens yet.
9. **Scheduled execution.** The accrual and alert jobs are endpoints; nothing
   calls them on a schedule.
