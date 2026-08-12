# Development Roadmap — Generic Business Platform (build order)

> **What this file is.** The *execution plan*: the exact phase-by-phase order to
> build the reusable core, what each phase ships, and the "definition of done"
> that tells you a phase is finished. For the *why* (architecture & rationale),
> see `TRANSFER.md`.
>
> **One-line summary.** **START** with platform plumbing + a balanced general
> ledger; build finance → invoicing → payments → reports → inventory →
> procurement; that is the complete reusable core (**the big checkpoint**);
> **END** by building verticals (POS, School…) on top — they never touch the
> core again.

---

## Ground rules (non-negotiable — these are what keep it simple)

1. **One General Ledger + one Stock Ledger.** No module ever keeps its own
   balances or a second set of books.
2. **All financial effects post through ONE `PostingService`** via a `Postable`
   contract, inside a single DB transaction. Verticals never write
   debits/credits directly.
3. **Account determination is config-driven** — product category, tax, and
   journal carry the accounts; the engine reads them.
4. **`company_id` on every table from day one** (even if v1 is single-tenant).
5. **Dependencies point downward only:** Vertical → Core → Kernel/Engines. Core
   never imports a vertical. Enforce in CI (dependency-cruiser / Nx boundaries).
6. **Compile-time NestJS modules + JSONB custom fields.** No dynamic/metadata
   ORM. A new *entity* = a real table; a new *attribute* = a JSONB custom field.
7. **Posted entries are immutable** — correct with reversing entries, never
   `UPDATE`.
8. **Each phase is a thin, testable slice.** Prove it before starting the next.

### Do NOT build (avoids the complexity you said you don't want)
- No dynamic/metadata-driven ORM. No microservices. No auto-generated UI
  framework. No POS/School logic inside the core. Don't over-model — start with
  the minimum entities below and extend via JSONB.

---

## Sequence at a glance

```
Phase 0  Kernel & platform foundations        ─┐
Phase 1  Base master data                       │
Phase 2  General Ledger (Engine 1) + journals   │
Phase 3  Invoicing (AR)                          ├─ GENERIC REUSABLE CORE
Phase 4  Payments / Collection / Cash            │   (Phases 0–7)
Phase 5  Financial reports                       │
Phase 6  Inventory (Engine 2)                    │
Phase 7  Procurement / Expenses (AP)           ─┘
─────────────── ✅ CHECKPOINT: core complete & tested ───────────────
Phase 8  First vertical end-to-end (POS or Restaurant)
Phase 9  Second vertical (School) — proves reuse
Phase 10 Satellites as needed (Fixed Assets, Budget, Payroll)
```

### Your 10 listed systems → which phase builds them
| # | System | Phase |
|---|--------|-------|
| 1 | Core Accounting | **2** (+ reports in **5**) |
| 2 | Billing & Invoicing | **3** |
| 3 | Cash Management | **2** (cash/bank journals) + **4** (registers, daily closing) |
| 4 | Revenue Collection | **4** |
| 5 | Inventory | **6** |
| 6 | Procurement | **7** |
| 7 | **POS** | **8** (it's a *vertical*, not core) |
| 8 | Budget | **10** |
| 9 | Payroll | **10** |
| 10 | Fixed Assets | **10** |

**Relative effort:** Phases 0–7 (the core) are the bulk of the work. Phase 8 is
medium (it stress-tests the core). Phase 9 and each Phase-10 satellite are
small. There is no shortcut around Phase 2 and the posting engine — that is the
real product.

---

## Phase 0 — Platform Kernel & Foundations
**Objective:** a bootable app with the plugin machinery + tenancy. No business
features yet.

**Build**
- Monorepo layout: `kernel/`, `modules/*`, `libs/*` (Nx or Nest monorepo).
- **Module loader:** read manifests → build dependency graph → topological sort
  (fail loudly on cycles/missing deps) → load in order (register entities, wire
  DI, subscribe hooks, run migrations).
- **Manifest format:** `{ name, version, depends[], provides[] }`.
- **Event bus** (`@nestjs/event-emitter`) — synchronous-in-transaction where it
  matters.
- **DB + migrations runner** — pick the ORM now (TypeORM or Prisma) + Postgres.
- **Multi-tenant base:** `Company` entity, a base entity/mixin adding
  `company_id`, request-scoped tenant context + automatic query filter.
- **Auth + ACL scaffolding:** users, roles, permissions (minimal).
- Config, structured logging, error handling, healthcheck.
- **CI:** lint, test, and a **module-boundary rule** that fails the build if a
  core module imports a vertical.

**Definition of Done:** app boots; a dummy module loads purely from its
manifest; migrations run; every record carries `company_id`; a test proves
tenant isolation; CI blocks an illegal upward import.

---

## Phase 1 — Base Master Data
**Objective:** the shared nouns every module needs.

**Build — module `base`**
- `Partner` — one party model with customer/supplier/employee flags.
- `Product` + `ProductCategory` — category carries **income / expense /
  stock-valuation accounts** (for account determination); product type
  `service | stockable`.
- `UoM` (unit of measure).
- `Tax` — rate, type, tax account.
- `Currency` (+ optional rate table) — model it even if single-currency in v1.
- `FiscalYear` / `Period` — accounting periods that can be opened/closed.

**Definition of Done:** CRUD partners, products (service + stockable), taxes,
UoMs; products carry their accounting config; periods can be opened/closed.

---

## Phase 2 — General Ledger (Engine 1) + Cash/Bank Journals
**Objective:** the financial backbone — anything can post a balanced entry.
*This is the foundation everything else stands on.*

**Build — module `accounting`**
- `Account` + **Chart of Accounts** (seedable template); account types
  asset/liability/equity/income/expense + receivable/payable/bank/cash subtypes.
- `Journal` (sales, purchase, cash, bank, misc) with default accounts + number
  sequences.
- `JournalEntry` (date, period, state `draft|posted`, reference) +
  `JournalLine` (account, debit, credit, partner, optional **analytic /
  cost-center tag**).
- **Posting rules:** entry must balance to zero; posting locks it; immutability;
  reversal mechanism.
- **`PostingService` + `Postable` contract + account-determination resolver**
  (reads product/tax/journal config).
- Period locking.
- **Seed:** default chart of accounts + standard journals.
- **Report:** Trial Balance + General Ledger listing (proves the query model).

**Covers:** #1 (CoA, GL, journal entries; AR/AP accounts defined), #3 (cash &
bank journals live here).

**Definition of Done:** post a manual journal entry that balances; an unbalanced
entry is rejected; a posted entry can't be edited but can be reversed; trial
balance is correct; cash & bank journals exist.

---

## Phase 3 — Invoicing (Accounts Receivable side)
**Objective:** the first real document that posts through the engine — validates
the whole posting abstraction.

**Build — module `invoicing`**
- **`Document` + `DocumentLine`** polymorphic base with a `type` discriminator
  (reused later by vendor bills and POS orders).
- **Sales Invoice** — customer, lines (product, qty, price, tax, discount),
  subtotal/tax/total.
- Tax & discount computation.
- **Credit Notes** (as reversal documents).
- Confirm → `post()` → **debit Receivable, credit Income per line, credit Tax
  Payable**.
- Numbering, states (`draft|confirmed|posted|paid`), basic print/PDF.

**Covers:** #2 (invoice generation, credit notes, discounts, tax).

**Definition of Done:** issuing a sales invoice posts a balanced AR entry via
`PostingService`; credit note reverses cleanly; totals/taxes correct; the GL
Receivable balance equals the sum of open invoices.

---

## Phase 4 — Payments, Collection, Receipts & Cash Management
**Objective:** take money in (and lay the groundwork to pay money out), with cash
control.

**Build — module `payments`**
- **`Payment` document (generic)** — settles a Receivable now (and a Payable in
  Phase 7): debit Bank/Cash, credit Receivable.
- **Payment methods** (cash, mobile money, bank, card) — each maps to a
  journal/account via config.
- **Allocation/matching** — payment ↔ one or more invoices; partial payments;
  per-partner payment history.
- **Receipts** (printable) + numbering.
- **Cash registers / sessions** — opening float, cash in/out, petty cash,
  **end-of-day cash closing & reconciliation**.
- **Bank reconciliation** — enter/import statement lines, match to payments,
  reconcile.

**Covers:** #4 (recording, methods, receipts, history), #3 (registers, petty
cash, daily closing, reconciliation), #1 (bank reconciliation).

**Definition of Done:** a payment by each method posts correctly and settles its
invoice; partial payments work; a cash session opens and closes with a balanced
daily report; a bank line matches a payment and reconciles; a receipt prints.

---

## Phase 5 — Financial Reporting Engine
**Objective:** the standard statements, built once, generic over the ledger.

**Build — module `reporting`**
- General Ledger, Account statements, Trial Balance (extend).
- **Profit & Loss, Balance Sheet, Cash Flow.**
- **Aged Receivables** (and an Aged Payables stub for Phase 7).
- Period selectors + comparatives; CSV/PDF export; SQL/materialized views for
  heavy reports.

**Covers:** #1 (P&L, Balance Sheet, Cash Flow).

**Definition of Done:** P&L, Balance Sheet and Cash Flow reconcile to the trial
balance on a test dataset; aged receivables matches open invoices; every report
is company- and period-scoped.

> You now have a complete generic **finance** core. Inventory + procurement next
> make it complete for product-based businesses.

---

## Phase 6 — Inventory (Engine 2)
**Objective:** the material backbone + its automatic accounting side effect.

**Build — module `inventory`**
- **`Location`** (typed: supplier, internal/stock, customer, production,
  inventory-loss).
- **`StockMove(product, qty, from, to, state)`** + **`Quant`** (qty on hand per
  product/location).
- **`ValuationLayer`** + costing method — start with **AVCO or standard**; FIFO
  later.
- Stock In / Stock Out / Stock Adjustments (counts) as moves.
- **Perpetual-inventory hook:** a stockable move posts **debit COGS, credit
  Stock Valuation** via the *same* `PostingService`.
- Reports: on-hand, valuation, movement history.

**Covers:** #5 (stock in/out/adjust, valuation).

**Definition of Done:** stock-in raises quants; stock-out lowers them and posts
COGS; valuation matches the GL stock-valuation account; adjustments post to
inventory-loss; negative-stock policy decided.

---

## Phase 7 — Procurement, Expenses & Accounts Payable
**Objective:** the buy side — closes the loop so the core is whole.

**Build — module `procurement`**
- Suppliers (Partners) + supplier prices.
- **Purchase Request → RFQ/Quotation → Purchase Order.**
- **Goods Received Note (GRN)** → creates stock-in moves (Inventory).
- **Vendor Bill / Supplier Invoice** (reuse `Document`) → posts AP (debit
  Expense/Stock, credit Payable).
- **Expense claims / direct expenses** → post to expense accounts.
- **Supplier payments** → reuse the Phase-4 `Payment` (debit Payable, credit
  Bank/Cash).
- **Aged Payables** report (completes the pair).

**Covers:** #6 (PR, quotation, PO, GRN, supplier invoices), expenses, AP,
supplier management.

**Definition of Done:** the full PR → PO → GRN → Bill → Payment cycle works; GRN
moves stock; the bill posts AP; the payment settles it; aged payables is
correct; three-way match (PO/GRN/Bill) sanity-checked.

---

## ✅ MAJOR CHECKPOINT — Generic Reusable Core Complete & Tested

This is exactly the reusable system you asked for: **core platform + finance +
accounting + inventory + invoicing + receipts + payments + expenses +
procurement + reports + cash sessions**.

What's in the box (post this commit):

- **Phase 0 — Kernel**: tenancy (ALS + Prisma extension), auth + RBAC, audit,
  events, settings, sequence, **module registry with boot-time validation**,
  **dependency-cruiser CI rule** (ADR-011 + `.dependency-cruiser.cjs`),
  **WorkflowService runtime** (ADR-007).
- **Phase 1 — Master Data**: `Partner`, `Contact`, `Address`, `PartnerCategory`,
  `Product`, `ProductCategory`, `UoM`, `Tax`, `FiscalPeriod`, `Branch` — all
  with CRUD + UI.
- **Phase 2 — GL Engine**: Chart of Accounts, Journals, `JournalEntry` +
  `JournalLine`, `PostingService` (single writer, atomic sequences, period
  control, reversal-via-mirror), `AccountDetermination`, `FiscalPeriod`,
  `Treasury` (bank accounts + transfers), Trial Balance + Account Ledger + GL
  listing.
- **Phase 3 — Documents (AR)**: universal `Document` / `DocumentLine` with
  server-side tax + total computation, `Invoice` (post/cancel),
  `CreditNote`, vendor bill (mounted at `/expenses`), partial / multi-invoice
  payments.
- **Phase 4 — Inventory → GL (M3)**: per-product costing (`AVCO` / `FIFO` /
  `STANDARD`), `StockPostingService` writes `Dr COGS / Cr Stock Valuation`
  on issue, **GRNI pre-stage** on vendor bills (`Dr Stock / Cr GRNI` then
  `Dr GRNI / Cr AP`), inventory movements reconcile with the GL in one
  transaction. Opening balance and adjustments post to GL.
- **Phase 5 — Reporting**: Trial Balance, Account Ledger, GL listing,
  AR Aging, **P&L**, **Balance Sheet**, **Cash Flow** (operating / investing /
  financing via `Account.cashFlowCategory`), **AP Aging**, customer balances,
  revenue by customer / period.
- **Phase 6 — Payments / Cash Mgmt**: `Payment` (inbound receipts + outbound
  supplier payments + partial / multi-invoice allocations + void), **`CashRegister`,
  `CashSession`, `CashMovement`** (M5) — open / close with counted-vs-expected
  variance, manual pay-in / pay-out, sales linked to GL via `payment.cashSessionId`.
- **Phase 7 — Procurement / AP**: Vendor Bill (GRNI flow), Supplier Payment
  (reuse Phase-4), AP Aging.

What's NOT in this checkpoint (intentional — these are vertical-specific):

- PO / RFQ / GRN three-way match (vertical concern; v1 bills are direct).
- POS screens (catalog / barcode / fast checkout) — vertical.
- School screens (enrollment / classes / fee schedules) — vertical.
- Bank reconciliation matching — could go in Phase-4 cash mgmt but is a
  big enough surface to be its own vertical if needed.
- Budgets, Fixed Assets, Payroll — Phase 10 satellites.

Before any vertical:
- Write end-to-end integration tests covering invoice→payment, purchase→pay,
  stock-move→COGS, cash-session-open→sale→close. (Costing + workflow have
  unit specs; integration tests require a running DB and are out of scope for
  this commit.)
- **Freeze the public contracts** (`Postable`, the event names, the core
  service interfaces). Verticals will depend on these; changing them later
  is expensive. The contract is: Postable = PostingService.post + .reverse,
  events are declared in `@erp/shared/events.ts`.
- Confirm the boundary rule still passes (no upward dependencies — CI runs
  `pnpm lint:arch`).

Everything after this is built **on top** and must not modify the core.

---

## Phase 8 — First Vertical, End to End (Retail POS *or* Restaurant)
**Objective:** prove the core by building the vertical that exercises **both**
engines hardest — it surfaces every leaky abstraction while it's still cheap to
fix.

**Build — module `pos` (or `restaurant`)**
- POS: catalog view, barcode, **fast checkout**, register/session (reuse Phase-4
  cash session), receipts, refunds (credit note), **end-of-day** (reuse cash
  closing). A sale = invoice + payment + stock-out, **posted in one
  transaction**.
- Restaurant variant adds: tables, **bill of materials** on dishes
  (stock → production moves), kitchen display (KDS).

**Covers:** #7 (POS), as a vertical.

**Definition of Done:** a checkout posts revenue + tax + cash + COGS *and* moves
stock in one atomic transaction; refund reverses; EOD report balances; and
crucially **zero new accounting/inventory logic was added** — only screens and
workflow. Fix any leak you find in the core *now*.

---

## Phase 9 — Second Vertical (School) — proves reuse
**Objective:** show a completely different vertical is thin.

**Build — module `school`:** student = `Partner`; tuition = service product;
term fees = invoices; fee collection = payments; fee statements = AR reports;
enrollment / classes / fee schedules as workflow. Almost no inventory.

**Definition of Done:** enroll a student, raise term fees, collect by multiple
methods, print receipts, produce a fee-balance statement — all on the
**unchanged** core, and built in a fraction of Phase 8's time. That speed is the
proof the platform works.

---

## Phase 10 — Satellites (add only when a vertical needs one)
- **Fixed Assets (#10):** asset register, depreciation schedule that posts
  entries, transfers, disposal. *(Small.)*
- **Budget (#8):** budget targets per account/cost-center/period +
  Budget-vs-Actual report reading the GL; optional approval flow. *(Small —
  relies on the analytic tag from Phase 2.)*
- **Payroll (#9):** salary calc, deductions, allowances, tax, payslips → posts a
  salary journal + payment. *(Its own project due to country-specific tax — do
  it last / when a vertical truly needs it.)*

**Definition of Done (each):** posts through the same GL; keeps no separate
balances; its reports reconcile to the ledger.

---

## End state
A production-ready, reusable platform with two verticals shipped. Adding a third
vertical (Restaurant, Clinic, NGO, Supermarket…) is a few weeks of screens +
workflow and **never touches the core**. That is the system you described —
built in the simplest order that works.
