# Transfer / Handoff Document — Modular Multi-Industry Business System

> **Purpose of this document.** It captures the full context of a design
> conversation so the work can be continued in a fresh chat (or by another
> developer/AI) without re-deriving anything. Read it top-to-bottom and you have
> everything needed to start building or to ask deeper follow-up questions.
>
> **Source.** Claude share chat "Designing a modular multi-industry business
> system" (snapshot `606cbbe0-b6b3-4248-a226-3b9caf3b5061`, 8 messages).
> Two diagrams and the final phase chart in the original were interactive
> artifacts and were **not** included in the shared transcript text. The phase
> plan below is reconstructed from the two consistent "build order" sections
> that *are* in the transcript.

---

## 1. Goal

Build a **generic financial, accounting & inventory platform** that is
**modular, pluggable, and extendable like Odoo**, then build industry verticals
(**POS, School, Restaurant, Supermarket, Clinic, NGO…**) as thin layers on top
of it. Build and test the generic core once; reuse it for every vertical.

**Explicit constraint from the user:** keep it simple, do **not** add complexity.

**Target stack:** NestJS + PostgreSQL + TypeScript (user has a NestJS
background). Nest modules are the plugin unit; Postgres provides ACID + JSONB +
materialized views for reporting.

---

## 2. The core insight (the whole design rests on this)

> **Every vertical reduces to documents posting onto two universal engines — a
> double-entry ledger and a stock-move graph.**

A school fee, a restaurant order, and a supermarket checkout are financially and
materially identical at the bottom: each creates a **balanced journal entry**,
and (if goods are involved) **moves stock between locations**. Verticals only
add *vocabulary* (a "dish", a "student", a "lane") and *workflow*. Get the two
engines + a module system right, and POS/School/Restaurant become thin modules.

### Three layers, dependencies point **downward only**

```
Verticals      (POS, School, Restaurant, Supermarket, Clinic …)
   │  may call ↓
Core           (Invoicing, Collection, Procurement, Reporting,
   │            Budget, Fixed Assets, Payroll)
   │  may call ↓
Kernel         (module loader, event bus, DI, multi-tenant base)
                +  the two ENGINES: Ledger + Stock
```

**The one hard rule:** a vertical can call the core, the core can call the
kernel, but **nothing in the core ever knows a specific vertical exists.** That
single constraint is what keeps the system pluggable. Enforce it with tooling
(dependency-cruiser or Nx module boundaries) so the build *fails* if a core
module imports a vertical.

---

## 3. The two engines (build and test these first)

### 3.1 The Ledger (universal financial substrate)

- **Model:** `Account` (configurable chart of accounts), `Journal` (sales,
  purchase, cash, bank, POS), `JournalEntry` (header, date, state
  draft/posted), `JournalLine` (account, debit, credit, partner, optional
  analytic/cost-center tag).
- **Posting is irreversible.** Never `UPDATE` a posted entry — reverse it with a
  counter-entry.
- **Account determination is the trick that makes it generic.** Verticals must
  **never** write debits/credits directly. Configuration decides which account
  each line hits:
  - product category → income account, expense account, stock-valuation account
  - tax → tax account
  - journal → default receivable/payable accounts
  - A single `PostingService` translates *any* document into a balanced entry by
    reading these mappings. New document type later = define its mapping rule
    only; the engine is untouched.
  - Example — sales invoice posts as: **debit** Receivable (total), **credit**
    Income per line (net), **credit** Tax Payable (tax). A payment posts as:
    **debit** Bank, **credit** Receivable.
- **Reporting is built once on top of the ledger** and works for every vertical:
  trial balance, P&L, balance sheet, general ledger, aged receivables = queries
  that group `JournalLine` by account type and period.

### 3.2 The Stock-move graph (universal material substrate)

- **Model:** every physical movement is a
  `StockMove(product, qty, from_location, to_location)`.
- **Locations are typed** — supplier, internal/stock, customer, production,
  inventory-loss — and that typing lets one primitive express everything:
  - Receiving a delivery → supplier → stock
  - Selling (POS or invoice) → stock → customer
  - Restaurant cooking → stock → production (consumes ingredients via a bill of
    materials)
  - Manufacturing output → production → stock
  - Stock-count adjustment → inventory-loss ↔ stock
- `Quant` = current quantity at each location. `ValuationLayer` = cost tracking
  (FIFO / AVCO / standard).
- **Perpetual inventory hook:** when on, a stock move *also* fires a journal
  entry (**debit COGS, credit Stock Valuation**) through the same
  `PostingService`. Verticals just create moves; the engine handles quants,
  valuation, and the accounting side effect.

---

## 4. The document framework (ties verticals to the engines)

Invoices, vendor bills, sales orders, and POS receipts are all the **same
shape**: a header (partner, date, state, journal) + lines (product, quantity,
unit price, taxes, subtotal). Model once as a polymorphic `Document` +
`DocumentLine` with a `type` discriminator (or a thin base that specific types
extend).

**A vertical's entire contract with the core is three verbs:**
1. create the right **Products**,
2. generate a **Document**,
3. on confirmation call **`post()`** — which routes through the ledger (always)
   and the stock engine (if any line is a stockable product).

---

## 5. What makes it pluggable: the module contract

A module is a self-contained folder with a manifest declaring identity + deps:

```
modules/accounting/
  manifest.ts        # { name, version, depends: ['base'], provides: [...] }
  entities/          # ORM models this module OWNS (Account, JournalEntry…)
  extensions/        # fields/behaviour added to OTHER modules' entities
  services/          # business logic (PostingService…)
  controllers/       # API routes
  hooks/             # event subscriptions
  migrations/        # schema changes
  seed/              # default chart of accounts, journals…
```

A **module loader** at boot reads every manifest, builds the dependency graph,
topologically sorts it (fail loudly on cycles/missing deps), and loads modules
*in order* — registering entities, wiring services into DI, subscribing hooks,
running pending migrations. Maps directly to NestJS: each module is a
`DynamicModule`; the loader is a custom bootstrap that orders by manifest deps
instead of hand-wiring imports.

This is **compile-time modularity** (redeploy to add a module) — the right call.
For per-tenant variation later, compile all modules in but toggle them per
company via an `enabled_modules` flag checked by hooks/routes (≈90% of the
"pluggable" feel, none of the dynamic-loading machinery).

---

## 6. Decoupling: two mechanisms, both used deliberately

- **Money-critical path → synchronous interface, NOT events.** Define a
  `Postable` contract any document implements; `PostingService` consumes
  anything `Postable` **within the same DB transaction**. A dropped event when a
  ledger entry is on the line is unacceptable — atomicity is non-negotiable.
  *(This is also the core reason for a modular monolith over microservices.)*
- **Side effects → in-process event bus.** Notifications, analytics,
  denormalized read models, third-party sync, a vertical reacting to a core
  event. e.g. POS emits `sale.confirmed`; loyalty / SMS-receipt /
  reporting-cache modules subscribe without POS knowing they exist. Use
  `@nestjs/event-emitter`.

---

## 7. Extension without migrations (and the rabbit hole to avoid)

**Decision rule (clean and load-bearing):**

| Need | Solution |
|------|----------|
| Vertical needs a new **entity** it owns (restaurant `Table`, school `Enrollment`) | **Real table** in a compile-time module — typed, FK'd, fast, standard tooling |
| Vertical/user needs a new **attribute** on a core entity, possibly per-tenant or defined at runtime (loyalty tier, tax-exempt flag, language) | **JSONB custom field** — flexible, no migration |

Real-world extension is overwhelmingly the second kind (additive scalars +
config), so JSONB gives Odoo-style flexibility exactly where it's needed while
keeping static-schema guarantees for the ~95% structural part of the system.

**JSONB implementation:** a `custom_field_definition` table describes fields per
company/module; values live in a `customFields` JSONB column; validate at the
app layer (a zod schema generated from the definitions); add an expression/GIN
index for any field queried hot.

**What JSONB does NOT give you** (and why you never put new
entities-with-relationships there): compile-time type safety on values, real FK
integrity, and as-cheap querying as a native column.

---

## 8. Two architecture decisions (stated so they can be challenged, but settled)

1. **Modular monolith over microservices** — atomicity of posting demands one
   ACID transaction; splitting accounting and inventory across services turns it
   into a distributed-transaction nightmare for zero benefit at this stage.
2. **Compile-time modules + JSONB over a dynamic (Odoo-style metadata) ORM** —
   the cost/benefit isn't close for a small team.

### Why NOT a dynamic ORM (the single biggest reason Odoo clones stall)

A dynamic ORM stores fields as **data, not code** (a metadata table row like
`(model='res.partner', field='loyalty_tier', type='selection')`), generates
columns via live DDL, and queries through a generic `search(domain)` engine. To
build a credible version you'd need: a metadata layer, a schema-sync step
emitting CREATE/ALTER DDL (incl. cross-module field additions + uninstall), a
domain-to-SQL compiler, computed/related fields with dependency tracking +
invalidation, an in-memory record cache, a concurrency-safe rebuildable
registry, security woven throughout, **and** a metadata-driven view layer. That
is a *framework* (15+ years, a whole team at Odoo), not a feature — and the type
checker is switched off across the whole app.

**The honest comparison of effort:**
- **Compile-time path:** build the engines.
- **Dynamic path:** build a metadata-driven ORM *first*, then build the same
  engines on a less-typed substrate.

The hard domain work (posting service + account determination, stock/valuation
engine, document framework) is **identical either way** — it's the irreducible
product. The dynamic path is pure overhead duplicating what TypeORM/Prisma
already give you.

### Maintainability summary

Compile-time + standard ORM = an ordinary well-structured TypeScript app: type
checker catches cross-module breakage (the most valuable safety net for 1–2
people), migrations are explicit/reviewable, onboarding is "learn NestJS + our
conventions." Only added cost: keeping app-layer validation in sync with JSONB
field definitions + indexing hot keys (bounded, well-understood).

---

## 9. The ONE rule that keeps it reusable

> **One general ledger, one stock ledger — and no subsystem is ever allowed a
> second set of books.**

POS must not track "cash on hand" separately from the GL's cash account.
Invoicing must not track "who owes us" separately from AR. Payroll must not hold
its own balances. Every module reads/writes the *same* two ledgers. The moment
two parts each claim to know the cash balance, they disagree and you write
reconciliation scripts instead of features.

---

## 10. How the user's "10 systems" map onto this design

The user listed 10 systems; they are **not** 10 systems. They collapse into
**2 engines + a posting layer + a few satellites**, and **POS is a vertical, not
a generic subsystem** (the key realization).

| # | User's "system" | Where it actually sits |
|---|-----------------|------------------------|
| 1 | Core Accounting | **Engine** → the general ledger |
| 5 | Inventory | **Engine** → the stock ledger |
| 2 | Billing & Invoicing | Posting layer → invoice document (creates receivable). School fees / utility / customer invoicing = one document, different products |
| 4 | Revenue Collection | Posting layer → payment document (settles receivable, lands in cash/bank/mobile-money). Each payment method = config mapping to a journal |
| 3 | Cash Management | **Not separate** → cash & bank *journals inside the GL* + a daily-closing reconciliation report |
| 6 | Procurement | Buy-side chain: Purchase Request → Quotation → PO → Goods Received Note → Supplier Invoice. GRN = stock-in move; supplier invoice = payable. Suppliers are Partners |
| 8 | Budget | Satellite → target amounts per account/department/period + Budget-vs-Actual report that *reads* the GL. Adds a cost-center **tag** on journal lines (a tag, not an engine) |
| 9 | Payroll | Satellite → calc engine (salaries, deductions, tax) that posts a salary journal entry + payment. Country-specific tax = genuinely separate logic → later/optional module |
| 10 | Fixed Assets | Satellite → asset register + scheduled routine posting depreciation entries, and disposal entries on sale |
| 7 | **POS** | **VERTICAL** (sits with School/Restaurant) → fast checkout combining invoicing + collection + stock-out move, posting to GL in one tap. End-of-day report = the cash-closing report. Adds barcode scan, register/session, receipt printing — **zero** new accounting/inventory logic |

---

## 11. How each vertical collapses onto the core

- **School** — student = `Partner`; tuition = *service* product; term fee =
  `Document` posting to GL; fee payments via Collection; fee statements = AR
  reports. Almost no inventory. Module adds enrollment, classes, fee schedules
  (pure workflow).
- **Restaurant** — dish = product with a **bill of materials** of ingredient
  products; an order consumes ingredients (stock → production moves) and bills
  the customer (document → ledger). Module adds tables, course timing, kitchen
  display (KDS) — workflow + UI.
- **Supermarket POS** — stockable products; a sale fires a stock move
  (stock → customer) + a journal entry. Module adds barcode scanning, fast
  checkout, lane/session management, end-of-day cash reconciliation. Same
  engines, different front-end.

None of them reinvent accounting or inventory — they add vocabulary and screens.

---

## 12. UI strategy (avoid the second Odoo rabbit hole)

Do **not** replicate Odoo's metadata-driven auto-generated UI (another
multi-year subsystem). Pragmatic split:
- A small metadata-driven form/table generator for **boring CRUD** screens.
- **Hand-built React** for the screens that actually matter (POS checkout,
  restaurant floor, KDS).

Backend engine first; generated UI is a phase-three luxury.

---

## 13. Phased build plan (start → end)

> Reconstructed and unified from the two "build order" sections in the chat. The
> original final answer was an interactive artifact not captured in the shared
> transcript; this is faithful to the two consistent orderings that were given.

**You START with platform plumbing + a working general ledger. You END with a
production-ready, reusable platform that already has two verticals shipped — at
which point adding a third vertical never touches the core again.**

The single most important checkpoint is between the generic core and the
verticals.

### Phase 0 — Kernel & foundations
Module loader, dependency resolution, migrations runner, event bus,
`Company`/multi-tenant scaffolding. **Put `company_id` on every record from day
one** even if v1 is single-tenant (retrofitting tenancy later is brutal).

### Phase 1 — `base` + General Ledger (Engine #1)
`Partner`, `Product`, `UoM`, security/ACL. Then chart of accounts, journals,
`JournalEntry`/`JournalLine`, the `PostingService` + account-determination
config. Cash & bank journals (the "Cash Management" need) come for free here.
**Prove it with a manual journal entry that balances.**

### Phase 2 — Invoicing + Collection
The `Document` framework + taxes. Post sales invoices and payments through the
ledger. First end-to-end vertical slice — validates the whole posting
abstraction. Now you can issue invoices, take payments by any method, and
produce a daily cash-closing report.

### Phase 3 — Inventory (Engine #2)
Stock moves, locations, quants, valuation, and the COGS journal hook. **Confirm
a delivery moves stock AND posts.**

### Phase 4 — Procurement + Reporting
Purchase document chain (PR → Quote → PO → GRN → Supplier Invoice) feeding
inventory and AP. Build the generic reporting engine: trial balance, P&L,
balance sheet, cash flow, aged receivables as queries over journal lines.

> ### ✅ CHECKPOINT — the reusable generic core is DONE and TESTED
> After Phases 1–4 you have exactly the system the user described. Everything
> after this is built **on top** and never modifies the core.

### Phase 5 — First vertical, end to end
Recommended: **Restaurant or Retail POS** (not School). Exercising *both*
engines (stock + ledger) hardest surfaces every leaky abstraction in the core
while it's still cheap to fix. School is easier but tests less.

### Phase 6 — Second vertical
Proves the reuse story — should be a few weeks of UI + workflow, not a rebuild.

### Phase 7 — Satellites as needed
Fixed Assets (#10) and Budget (#8) are small additions. Payroll (#9) is its own
project (country-specific tax) — do it when a vertical actually needs it.

---

## 14. Anti-patterns / things explicitly rejected

- ❌ A dynamic, metadata-driven ORM (Odoo `models.Model` style) — too costly,
  biggest reason Odoo clones stall.
- ❌ Any module keeping a second set of books / its own balances.
- ❌ Core (or kernel) importing or knowing about any vertical (enforce in CI).
- ❌ New entities-with-relationships stored in JSONB (use real tables).
- ❌ Microservices for accounting/inventory (breaks posting atomicity).
- ❌ Events for the money-critical posting path (use a synchronous in-transaction
  contract).
- ❌ Auto-generated UI for the screens that matter (hand-build POS/floor/KDS).

---

## 15. Where the conversation ended & suggested next steps

The last exchange delivered the phase breakdown (Section 13). The assistant
repeatedly offered to go deep on one of these next — any is a good first prompt
for the continuation session:

1. **`PostingService` + account-determination design** (the heart of the GL).
2. **Stock-move / valuation engine** (quants, FIFO/AVCO, the COGS hook).
3. **Module loader + manifest format** (the plugin mechanism).
4. **`custom_field_definition` schema + read/write/validate flow** (JSONB
   extension).
5. **General ledger schema + posting flow** (the foundation everything stands
   on — the assistant's top recommendation to detail next).

### Suggested prompt to start the next chat

> "I'm continuing the design of a modular multi-industry business platform
> (NestJS + Postgres + TypeScript). Context: two engines (double-entry ledger +
> stock-move graph), a `Postable`/`PostingService` posting layer with
> account-determination config, polymorphic Document framework, compile-time
> NestJS modules + JSONB custom fields (no dynamic ORM), one GL + one stock
> ledger with no second set of books, verticals (POS/School/Restaurant) as thin
> top layers. We finished the phase plan (Phase 0 kernel → Phase 4 generic core
> checkpoint → Phases 5–7 verticals + satellites). **Now design the
> [General Ledger schema and posting flow] in detail**, including tables, the
> `JournalEntry`/`JournalLine` model, the account-determination config, and how
> a sales invoice and a payment post."

---

*End of transfer document.*
