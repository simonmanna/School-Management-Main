# Sunrise Academy — school operations demo

> **Fictional.** Sunrise Academy and every pupil, parent, member of staff and
> transaction here are invented for demonstration. Utility and public bodies
> (UEDCL, NWSC, URA, NSSF, KCCA, UNEB) appear only as payees.

A Kampala nursery-and-primary day-and-boarding school (~710 pupils, 82 staff)
with nine months of 2026 money and operations in it: fees, the books, HR and
payroll, expenses, transport and meals. Sits on top of the academic demo
(`db:seed:sunrise-demo`).

## Seeding

```bash
pnpm --filter @erp/api build                         # the seed drives the compiled API services
pnpm --filter @erp/api db:reset:sunrise-ops -- --apply   # optional: clear a previous run
pnpm --filter @erp/api db:seed:sunrise-ops           # ~13 minutes
```

The seed boots the API's own services (`prisma/demo-green-valley/ops/run.cjs`),
so every invoice, receipt, payroll run and expense posts through the real
ledger. A seed clock replays January → yesterday in date order; comms and crons
are off and parent notifications for the replayed year are muted. Idempotent:
re-running fills in only what is missing (e.g. the days since the last run).

It ends with the auditor's checks — trial balance, AR control vs open invoices,
whole shillings — printed to the console.

## Logins (organization code `SUNRISE`, password `Staff@123`)

| Email | Role | Show |
|---|---|---|
| `bursar@sunrise.test` | Bursar | Fees desk, receipts, defaulters, statements, expenses, P&L / balance sheet |
| `head@sunrise.test` | Head Teacher | Approving expenses, waivers, payroll; budget vs actual |
| `accounts@sunrise.test` | Accounts Assistant (Bursar role) | Mobile-money receipts, tuck-shop top-ups |
| `hr@sunrise.test` | HR Officer | Staff files, leave, advances, loans, payroll runs and payslips |
| `transport@sunrise.test` | Transport Manager | Fleet, routes, pupils on buses, trips, incidents |
| `kitchen@sunrise.test` | Catering | Menus, meal attendance, kitchen production, tuck shop |
| `nurse@sunrise.test` | Nurse | Sick-bay role |

## What is in it (as of 4 Oct 2026)

**Books.** School chart of accounts (revenue by stream: tuition, boarding,
transport, meals, development levy, exams…; 19 expense lines). Stanbic fees
collection account, Centenary operations account, MTN / Airtel collection
wallets, petty cash. Balances b/f from 2025 (buildings, buses, bus loan).
Weekly cash banking, month-end MoMo sweeps, fees → operations transfers, bank
charges, bus-loan instalments. Monthly fiscal periods for 2026.
Revenue ≈ UGX 1.9bn, expenses ≈ 1.18bn, total assets ≈ 3.7bn.

**Fees.** 23 published structures (Baby–Top, P.1–P.7 day and boarding,
development levy, P.7 PLE fee, new-pupil pack, swimming / music / coaching /
after-school care, Term 2 Jinja trip). Bursaries (staff child, merit, talent,
orphan), 3 sponsors with 12 pupils, termly collection budgets. ~3,900 fee
invoices + meals and transport invoices; ~4,200 receipts (Stanbic deposits,
MTN/Airtel, cash) from prompt payers, instalment payers, late payers and a
handful of defaulters; overpayments held as fee credits; waivers approved,
pending and rejected. Term 3 is mid-collection.

**HR & payroll.** 82 employees on 10 departments and 22 positions (37 support
staff added: cooks, matrons, drivers, bus attendants, guards, cleaners, nurse,
storekeeper, librarian…). Salaries by grade, allowances, SACCO and welfare
deductions; PAYE, NSSF 5%/10%, LST. Contracts and teaching qualifications.
Payroll January–September: calculated, approved, paid by Centenary bank batch
and MoMo; PAYE / NSSF / SACCO remitted by the 15th. Leave (incl. maternity),
salary advances, staff loans, a leaver with a final payslip, two mid-year hires.

**Expenses.** 30 suppliers, ~370 bills: posho, beans, produce, meat, milk
weekly; UEDCL, NWSC, fibre monthly; bus diesel, servicing, insurance; exam
printing; stationery; repairs. Raised → approved by the head → paid by the
bursar; some awaiting payment, some pending approval, two rejected, one voided.
Petty cash vouchers and weekly petty-cash top-ups.

**Transport.** 3 fee zones, 21 stops, 5 routes (Ntinda–Kyanja, Kireka–Kira,
Ggaba road, Nansana, nursery shuttle), 6 vehicles with insurance / inspection
documents (one inspection expiring this month), 12 crew, 146 pupils on the
buses each term with authorised collectors. Termly transport billing. Trips
since 21 September recorded stop by stop: inspection, dispatch, boarding,
drop-off, end-of-trip check. 5 incidents (breakdown, motion sickness, fight,
road closure, unauthorised pick-up refused).

**Meals.** Breakfast, break porridge, lunch, evening tea, supper; plans for
day pupils, nursery and boarders; Ugandan weekly menu backed by recipes.
Meal plans billed each term. Every Term 2 lunch and every Term 3 meal recorded
class by class (~79,000 meals served), daily kitchen production with cost per
plate and waste. Tuck-shop cards since Term 2: 168 pupils, MoMo top-ups,
~5,800 card transactions.

## A 15-minute walk-through

1. `bursar@` → Fees: a P.5 pupil's statement (invoices, receipts by method,
   credit), the defaulters list, today's receipts; Finance → budget variance.
2. `bursar@` → Accounting reports: trial balance (balanced), P&L by stream,
   balance sheet; AR ↔ GL reconciliation shows zero variance.
3. `head@` → Expenses awaiting approval (borehole pump, photocopier).
4. `hr@` → Payroll runs → September payslips; leave calendar; staff loans.
5. `transport@` → Transport → Trips for 2 October; Incidents.
6. `kitchen@` → Meals → today's menu, attendance, production and waste.

## Known gaps

- No depreciation run, so the surplus is higher than a real school's.
- Procurement / stock: food is expensed on purchase (periodic method); kitchen
  production records quantities and cost but does not move inventory.
