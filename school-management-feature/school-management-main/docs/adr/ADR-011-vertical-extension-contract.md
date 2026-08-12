# ADR-011: Vertical Extension Contract

- **Status:** Accepted
- **Date:** 2026-06-21
- **Supersedes:** (none)

## Context

Phases 0–7 of the roadmap produce a "reusable core" — platform + finance +
accounting + inventory + invoicing + receipts + payments + expenses + reports.
After that we add **verticals** (POS, School, Restaurant, Clinic, Hotel…). The
core is frozen: verticals ride on top and never modify it.

To make this real we need:

1. A **written contract** that says what a vertical may import and what it must
   not touch.
2. **Automated enforcement** in CI so a careless import is caught before review
   (`ROADMAP.md` ground rule 5 promises `dependency-cruiser` / Nx boundaries).
3. A **one-page guide** for adding a new vertical (`VERTICAL-CHECKLIST.md`).

Without (2) the contract decays within one release. Without (1) reviewers
disagree on every PR.

## Decision

### 1. Layering (enforced by `dependency-cruiser`)

```
┌──────────────────────────────────────────────────────────────────────┐
│  apps/api/src/modules/<vertical>/   ── e.g. pos, school, restaurant  │
│         depends on: accounting, invoicing, inventory, core, kernel   │
│         depends NOT on: another vertical                             │
├──────────────────────────────────────────────────────────────────────┤
│  apps/api/src/modules/invoicing/                                         │
│         depends on: accounting, core, kernel                            │
├──────────────────────────────────────────────────────────────────────┤
│  apps/api/src/modules/inventory/                                        │
│         depends on: core, kernel                                        │
├──────────────────────────────────────────────────────────────────────┤
│  apps/api/src/modules/accounting/                                       │
│         depends on: core, kernel                                        │
├──────────────────────────────────────────────────────────────────────┤
│  apps/api/src/modules/core/                                             │
│         depends on: kernel                                              │
├──────────────────────────────────────────────────────────────────────┤
│  apps/api/src/kernel/    (platform — tenancy, auth, posting, events…) │
│         depends on: nothing inside apps/api/src                        │
└──────────────────────────────────────────────────────────────────────┘
```

A module may import **downward** (its own declared `dependencies`) and the
**kernel** (`apps/api/src/kernel/**`). It may not import upward, sideways into a
peer, or reach into a peer module's internals.

### 2. What a vertical MAY import from a peer module

Only the module's `index.ts` / public barrel — **never** a deep path. Concrete:

| Peer module | Allowed entry points | Forbidden |
|---|---|---|
| `kernel` | services under `apps/api/src/kernel/{tenancy,prisma,events,audit,settings,sequence,workflow,auth,common,module-loader}/*` | internals like `prisma.client` from non-tenant paths |
| `core` | `BaseCrudService`, `PartnerService`, `ProductService` (read+write per their declared permissions) | raw prisma writes to `partner` / `product` |
| `accounting` | `PostingService`, `AccountDeterminationService`, `FiscalPeriodService`, `BankAccountService`, `TreasuryService`, reporting services | `journalLine.create`, raw `journalEntry.create` (use `PostingService.post`) |
| `invoicing` | `DocumentBuilderService`, `InvoiceService`, `CreditNoteService`, `VendorBillService`, `PaymentService`, AR/AP reporting | direct writes to `document`, `paymentAllocation`, `journalLine` |
| `inventory` | `StockService`, `LocationService`, `InventoryQueryService` | direct writes to `stockItem`, `inventoryLedger`, `inventoryBatch` |

### 3. What a vertical MUST do

- Register an `ERPModule` manifest at `onModuleInit` (ADR-005).
- Declare every permission it owns in `PERMISSIONS` (in `@erp/shared`).
- Declare every event it publishes in `EVENTS` (in `@erp/shared`).
- Add every new table to `ORG_SCOPED` and (if soft-deletable) `SOFT_DELETE` in
  `tenancy/tenancy.extension.ts`.
- Go through `PostingService` for every financial effect (ground rule 2).
- Emit events via `EventBus.publish`; subscribe via `EventBus.subscribe`.

### 4. What a vertical MUST NOT do

- Import another vertical (`pos` cannot reach into `school`).
- Bypass `PostingService` and write `JournalLine` rows directly.
- Bypass `StockService` and write `StockItem` / `InventoryLedger` directly.
- Bypass `PaymentService` and mutate `Payment.amountPaid` /
  `Document.amountResidual` directly.
- Modify core services to expose private hooks (open an ADR instead).

### 5. CI enforcement

`.dependency-cruiser.cjs` at repo root; `pnpm lint:arch` runs
`depcruise apps/api/src`; failure blocks merge. The rules:

- `kernel` cannot import any `modules/**` code.
- `modules/core/**` cannot import `modules/accounting` / `invoicing` /
  `inventory` / `<vertical>/**`.
- `modules/accounting/**` cannot import `modules/invoicing` / `inventory` /
  `<vertical>/**`.
- `modules/invoicing/**` cannot import `modules/inventory` / `<vertical>/**`.
- `modules/inventory/**` cannot import `modules/invoicing` / `<vertical>/**`.
- Any module under `modules/<vertical>/` cannot import another
  `modules/<other-vertical>/`.
- No "deep" imports past a module's public barrel (`*/internal/*` is forbidden
  by convention; if you need to expose internals, add them to the barrel and
  open an ADR).

### 6. Adding a vertical

A single command (`pnpm gen:vertical <name>`) scaffolds:

- `apps/api/src/modules/<name>/<name>.module.ts` — module + manifest.
- `apps/api/src/modules/<name>/<name>.service.ts` — empty service placeholder.
- `apps/api/src/modules/<name>/<name>.controller.ts` — empty controller.
- `apps/api/src/modules/<name>/dto/` — placeholder DTO folder.
- `apps/api/src/modules/<name>/<name>.module.spec.ts` — registration spec.
- Adds the new module to `AppModule.imports` so the next `pnpm dev:api` boot
  validates the graph.

`dependency-cruiser` is updated to include `<name>` as a known vertical (one
extra `forbidden` rule generated by the script).

## Consequences

**Positive**
- The contract is provable — a bad import fails CI in seconds.
- Onboarding a new vertical is one command + reading
  `docs/VERTICAL-CHECKLIST.md`.
- The kernel/core layers stay small because adding code to them requires an
  ADR.

**Negative / Trade-offs**
- `dependency-cruiser` adds ~3–5 s to CI.
- We have to keep the public barrels honest. If a vertical needs to peek into a
  peer's internals, the right answer is "open an ADR and add it to the public
  surface", not "exempt the rule".
- A handful of `kernel` services are now legitimately part of the vertical's
  import set; if any of them turn out to be the wrong shape, every vertical
  has to migrate. Mitigated by freezing public contracts at the
  "core complete" checkpoint (see `ROADMAP.md` §"MAJOR CHECKPOINT").

## Alternatives considered

- **No enforcement, only convention:** the existing codebase already drifts —
  `VendorBillController` is mounted at `/expenses` instead of `/vendor-bills`
  because there was no checklist. Same pattern would repeat.
- **Nx / Turborepo project-graph boundaries:** heavier toolchain; we already
  have pnpm workspaces.
- **One repo per vertical (microservices):** explicitly rejected by ADR-001.