# Wave 19 — accounting production readiness (2026-10-12)

Branch `wave19-accounting-readiness` (off `main` at c7a8383). Source: internal re-audit of the accounting
module after wave 18 — posting engine, manual journals, period close, statements, currency, and the
journal-entry screens.

## Findings → fixes

| # | Sev | Finding | Fix | Evidence |
|---|-----|---------|-----|----------|
| A1 | P1 | Every performance statement summed the period-closing journal, so a closed period reported zero revenue, expense and profit (income statement, P&L, revenue/expense analysis, ratios, dashboard KPIs, P&L snapshot) | `EXCLUDE_CLOSING_JOURNAL` filter (journal type `closing`, which also holds a reopen's reversal) on every P&L-type read; balance views keep closing entries | `wave19-accounting-readiness.spec.ts` — closed period |
| A2 | P1 | Manual journals ran with `systemContext`, so a person could post straight to receivable, payable or stock control accounts and break the sub-ledger tie-out | Manual entries refused on `controlAccountType` ar/ap/inventory, on AR/AP/stock mapped accounts and on partner overrides; `allowManualPosting` honoured | spec — manual journals |
| A3 | P1 | Drafts (maker-checker) could not be approved or discarded anywhere in the web app | **Approve & Post** and **Discard** on the entry page; own drafts cannot be approved | browser |
| A4 | P1 | The journal screen could reverse an entry a document posted (fee receipt, bill, payroll), leaving the document claiming money the ledger no longer shows | Reverse only manual entries and Opening Balances loads; others are corrected from their document. Reverse button hidden accordingly | spec — document journal |
| A5 | P1 | Posting compared `currencyId` (a Currency row id) with the base currency *code*: the rate lookup always failed and foreign-currency entries were booked 1:1 | Resolve id or code; a missing rate refuses the posting unless the caller supplies one | spec — currency |
| A6 | P1 | FX revaluation treated base-currency lines (id ≠ code) as foreign and failed; ignored its own earlier adjustments, so a re-run booked the gain twice; summed `posted` only | Resolve codes; earlier revaluations tagged `dimensions.fxCurrency` count toward carrying value; posted + reversed | spec — revaluation |
| A7 | P2 | Equity statement: opening equity left out earlier earnings never closed; profit line read zero after close | Opening carries an "Earnings not yet closed" row; period movements exclude the closing journal | spec — equity |
| A8 | P2 | Close refused a period with no revenue/expense (holiday month) | Closes without a closing entry | spec — periods |
| A9 | P2 | Periods could close out of date order; draft journals dated in a closing period were stranded | Close refused while an earlier period is open or drafts are dated inside | spec — periods |
| A10 | P2 | Manual entries off by ≤ 0.01 were silently balanced to the rounding account | Manual entries must balance exactly; approval re-checks accounts and balance | spec — manual journals |
| A11 | P2 | Dashboard cash and revenue KPIs summed `posted` only, so a reversal alone counted | posted + reversed; closing journal excluded | code review |
| A12 | P2 | Journal register filtered the fetched page in the browser — matches on other pages were hidden and counts wrong | Server-side filters: status, journal, origin (manual / documents), account, date range | spec — list |

## New: opening balances

`/opening-balances` (API `GET|POST /opening-balances`). The bursar enters the previous books' closing trial
balance on the go-live date; the difference goes to **Opening Balance Equity** (account 3900, mapping
`opening_balance_equity`, created on first use). The load is a draft in the `OPENING` journal and needs a second
person's approval. Sub-ledger control accounts are refused — pupil arrears, supplier balances and stock come in
through their own brought-forward documents.

## Invariants

`apps/api/scripts/finance-invariants.sql` gains:
10. manual journal lines on sub-ledger control accounts;
11. drafts dated inside a closed or locked period;
12. open periods older than a closed one.

On the dev database (2026-10-12) queries 1–9, 11, 12 return 0 rows; query 10 returns 2 rows, both in the
wave 18 tie-out test organizations (deliberate drift fixtures).

## Verification

- API typecheck clean (one pre-existing error in `prisma/demo-green-valley/admissions/19-admissions.ts`,
  untouched); web typecheck clean; lint 0 errors; `authz:check` gaps=0.
- New `wave19-accounting-readiness.spec.ts` 8/8 green; against the pre-fix code 7/8 fail.
- Wave 1/6/18 ledger, fiscal, tie-out and UGX end-to-end specs green on a fresh database.
- Finance regression batch on a fresh database: 19 suites / 103 tests green (fees, MoMo, cash, POS, procurement,
  payroll posting, expense posting, bank recon, concurrency, stock posting, restore drill).
- Unit: 2599/2602; the 3 failures are LMS family-scope cases in `test/unit/wave9-scenarios.spec.ts` (no
  accounting code involved). Full integration run: `wave10-handoffs` H2 fails on a hard-coded 2026-10-01
  placement date against today's clock (not accounting); the single-process run hit the Node heap limit after
  25 suites, so finance specs were re-run as a batch.

## Not done (proposed next)

- GL budget vs actual by account and period (today's budgets compare fee collections only).
- Recurring and auto-reversing journals (accruals, prepayments).
- Attachments on manual journals (supporting vouchers).
- Dashboard "this month" and entry-number year use the server/UTC calendar, not the school's time zone.
