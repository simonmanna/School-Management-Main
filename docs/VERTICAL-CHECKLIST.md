# Vertical Extension Checklist

> **Audience:** anyone adding a new vertical (POS, School, Restaurant, Clinic…)
> to the Generic ERP. Read ADR-011 first; this checklist is the "how".
>
> **Time to first commit:** ~30 minutes for the scaffold (one command), plus
> the actual vertical logic. The scaffold is a starting point, not a finished
> product.

---

## 1. Run the scaffold

```bash
pnpm gen:vertical <name>     # e.g. pnpm gen:vertical pos
```

This creates:

```
apps/api/src/modules/<name>/
├── <name>.module.ts          # NestJS module + ERPModule manifest registration
├── <name>.service.ts         # placeholder service
├── <name>.controller.ts      # placeholder controller (mounted at /<name>)
├── <name>.module.spec.ts     # registration spec
└── dto/
    └── .gitkeep
```

It also:
- Adds the module to `AppModule.imports` (so it boots).
- Updates `.dependency-cruiser.cjs` so the new vertical's name is in the
  allowlist (and remains forbidden from reaching other verticals).

Verify it boots cleanly:

```bash
pnpm lint:arch && pnpm typecheck
```

You should see one new module in the registry log on startup:

```
[ModuleRegistry] Loaded N module(s): kernel -> core -> accounting -> inventory -> invoicing -> <name>
```

---

## 2. Declare dependencies

Open `apps/api/src/modules/<name>/<name>.module.ts`. Update the manifest:

```ts
this.registry.register({
  name: 'pos',
  version: '0.1.0',
  dependencies: ['accounting', 'invoicing', 'inventory', 'core', 'cashSessions' /* if you use them */],
  permissions: ['pos:read', 'pos:checkout', 'pos:refund'],
});
```

**Allowed dependencies:** any of `kernel`, `core`, `accounting`, `invoicing`,
`inventory`. **Never** another vertical — `dependency-cruiser` will reject
it.

Add the imports to the `@Module({ imports: [...] })` array — same names as
the manifest's `dependencies`.

---

## 3. Declare permissions

Add to `packages/shared/src/permissions.ts`:

```ts
pos: {
  read: 'pos:read',
  checkout: 'pos:checkout',
  refund: 'pos:refund',
  openSession: 'pos:openSession',
  closeSession: 'pos:closeSession',
},
```

The `ALL_PERMISSIONS` flattened list picks this up automatically (re-run
`pnpm db:seed` to refresh the global permission catalog).

---

## 4. Declare events

Add to `packages/shared/src/events.ts`:

```ts
PosOrderCreated: 'pos.order.created',
PosOrderCompleted: 'pos.order.completed',
PosRefundIssued: 'pos.refund.issued',
```

…then add the matching payloads to `DomainEventMap` for type-safe
publish/subscribe.

---

## 5. Add tables (if needed)

Two options:

**Option A — JSONB custom field on an existing entity.** If the new attribute
isn't queried/filtered often, add it under `customFields Json` on `Partner` or
`Product` (ADR-008). No migration. Indexed later if it becomes hot.

**Option B — a new table.** Add to `apps/api/prisma/schema.prisma`, generate
a migration (`pnpm db:migrate`), then:

1. Add the model name to `ORG_SCOPED` in
   `apps/api/src/kernel/prisma/tenancy.extension.ts` (and `SOFT_DELETE` if it
   has a `deletedAt`).
2. The tenancy extension auto-scopes reads/writes to the current org.

---

## 6. Routes, services, controllers

Follow the existing patterns:

- One service per aggregate (`PosOrderService`, `PosSessionService`).
- One controller per resource (`@Controller('pos/orders')`).
- Use `BaseCrudService` for simple CRUD (`apps/api/src/kernel/common/base-crud.service.ts`).
- Use `PaginationDto` + `RequirePermissions` decorators on every endpoint.

**For any financial effect:** call `PostingService.post(..., tx)` inside the
same `$transaction` as your entity update. Never write `JournalLine` directly.
Never mutate `Document.amountPaid` or `Document.amountResidual` directly —
allocate via `PaymentService.record` with allocations.

**For stockable products:** call `StockService.issue(...)` for sales,
`StockService.receiveFromBill(...)` for restocks, inside the same transaction
as the GL post.

**For state transitions:** declare a `WorkflowDefinition` and register it in
the module's `onModuleInit` (see `invoicing-workflows.initializer.ts` for the
pattern). The engine handles permission checks, guard evaluation, status
update, audit row, and event emission — atomically.

---

## 7. UI

Add pages under `apps/web/src/pages/<name>/`. Reuse the components in
`apps/web/src/components/ui/` (button, card, table, dialog, input, label,
skeleton). The app shell in `apps/web/src/components/layout/app-shell.tsx`
auto-hides nav items the user has no permission for, so new routes appear
automatically once the permission strings exist.

---

## 8. Cash sessions (POS, restaurants, school canteen)

Reuse the kernel's `CashSessionService`:

- Open at start of shift: `cashSessions.open({ cashRegisterId, openingFloat })`.
- Record a sale by passing `cashSessionId` on the `Payment` DTO — the
  `PaymentService` writes the `CashMovement` row in the same transaction.
- Record a manual pay-in/out via `cashSessions.recordMovement(...)`.
- Close at end of shift: `cashSessions.close({ closingCounted })` — returns
  `closingExpected`, `closingDifference` for the Z-report.

The sales line of the Z-report is just `expectedCash - openingFloat - payIns
+ payOuts`. Reconciliation ties this back to the ledger via the
`CashMovement.paymentId → Payment.journalEntryId` chain.

---

## 9. Run the boundary check

```bash
pnpm lint:arch
```

This is the automated enforcement from ADR-011. It runs in ~3 s and fails the
build on any:

- Upward import (vertical → core layer).
- Cross-vertical import (pos → school).
- Deep import past a peer's public barrel.
- New orphan file (nothing references it).

If it fails and you believe the rule is wrong, **don't** add an exemption —
open an ADR. The point of the contract is that every exception is
documented and approved.

---

## 10. Definition of done for a vertical

- [ ] Scaffold created via `pnpm gen:vertical <name>`.
- [ ] Manifest declares its dependencies (allowed: kernel, core, accounting, invoicing, inventory).
- [ ] Permissions added to `packages/shared/src/permissions.ts`.
- [ ] Events added to `packages/shared/src/events.ts` + `DomainEventMap`.
- [ ] Tables (if any) added to `ORG_SCOPED` / `SOFT_DELETE`.
- [ ] Services use `PostingService` for GL effects, `StockService` for stock, `CashSessionService` for shifts.
- [ ] State transitions declared as `WorkflowDefinition`s.
- [ ] `pnpm lint:arch` passes.
- [ ] `pnpm typecheck` passes.
- [ ] At least one happy-path test (unit or integration).
- [ ] No upward or cross-vertical imports introduced.

---

## Quick reference: import map for verticals

| What you need                  | Import from                                          |
|--------------------------------|------------------------------------------------------|
| Tenant context                 | `../../../kernel/tenancy/tenant-context.service`     |
| Prisma (tx or client)          | `../../../kernel/prisma/prisma.service`              |
| Events                         | `../../../kernel/events/event-bus`                   |
| Audit                          | `../../../kernel/audit/audit.service`                |
| Sequence numbers               | `../../../kernel/sequence/sequence.service`          |
| Workflow engine                | `../../../kernel/workflow/workflow.service`          |
| Permission decorator           | `../../../kernel/auth/decorators/require-permissions.decorator` |
| `@Public` decorator            | `../../../kernel/auth/decorators/public.decorator`   |
| Base CRUD                      | `../../../kernel/common/base-crud.service`           |
| Money math                     | `../../../kernel/common/money`                       |
| Pagination                     | `../../../kernel/common/pagination.dto`              |
| PostingService (the GL writer) | `../../accounting/posting/posting.service`           |
| AccountDetermination           | `../../accounting/posting/account-determination.service` |
| FiscalPeriod                   | `../../accounting/posting/fiscal-period.service`     |
| BankAccountService             | `../../accounting/treasury/bank-account.service`     |
| CashSessionService             | `../../accounting/treasury/cash-session.service`     |
| DocumentBuilderService         | `../../invoicing/document/document-builder.service`  |
| InvoiceService                 | `../../invoicing/invoice/invoice.service`           |
| CreditNoteService              | `../../invoicing/credit-note/credit-note.service`    |
| VendorBillService              | `../../invoicing/vendor-bill/vendor-bill.service`    |
| PaymentService                 | `../../invoicing/payment/payment.service`           |
| StockService                   | `../../inventory/stock.service`                      |
| LocationService                | `../../inventory/location.service`                   |
| InventoryQueryService          | `../../inventory/inventory-query.service`            |
| PartnerService                 | `../../core/partner/partner.service`                 |
| ProductService                 | `../../core/product/product.service`                 |

If you need to reach something not in this list, **open an ADR**. The
allowlist is conservative on purpose.

---

## Why this is strict

The whole point of the boundary rule is that **a vertical's PR can't break
the core**. The platform's value comes from "you can add a vertical in days
without risking the books". Lose that and you lose the platform.

The cost of being strict is that you occasionally need an ADR to add a small
import. The cost of being lax is that, by vertical three, your POS is reaching
into accounting internals and every upgrade is a nightmare. Pick the cheap
upfront cost.