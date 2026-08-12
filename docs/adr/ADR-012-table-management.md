# ADR-012 — Tables Management Module

**Status:** Implemented (Phase T1, June 2026)
**Supersedes:** None
**Related:** ADR-002 (Prisma), ADR-004 (tenancy), ADR-005 (module registration), ADR-006 (audit logging), ADR-009 (document model), ADR-011 (vertical extension contract).

## Context

The Cafe POS shipped without first-class table management. The cashier terminal referenced `/api/tables` and `/orders/:id` (with `tableId`) but neither the `Table` model nor the `/tables/*` endpoints existed in the backend. The previous demo (`apps/web/src/pages/pos-previous/POSPro/TablePicker.tsx`) used an external legacy service.

We need a production-grade table module comparable to Toast / Square / Lightspeed, covering:

- CRUD on physical seats (number, name, zone, geometry, status, waiter).
- Visual floor plan with drag-and-drop (deferred to the next iteration).
- Live merge / transfer / split of in-flight sales.
- Reservations (party size + time window) with automated status flips.
- Reports: utilization by hour, revenue per table / per zone, reservation outcomes.
- KDS extension: every ticket shows table + section + guest.
- RBAC: `tables:view / create / edit / delete / transfer / merge / split / clean / reserve`.

## Decision

### Schema (Phase T1)

Three new tables plus one denormalised column on `Document`:

| Model | Purpose |
|---|---|
| `PosTable` | A physical seat: name, number, zone, custom zone, shape, layout geometry (posX/posY/width/height), status, active, assignedWaiterId, mergedIntoId (self-FK for cascading merges). Soft-archived via `active=false`. |
| `PosTableOrder` | Live link table ↔ open `Document`. `@@unique([tableId, documentId])` prevents double-link. Tracks `customerName`, `guestCount`, `openedAt`, `closedAt`. Source of truth for occupancy-time math. |
| `PosTableReservation` | A booking: customer name, phone, email, partySize, startAt, endAt, status (pending / seated / completed / cancelled / no_show). |
| `Document.tableId` | Denormalised hot-path cache so reports GROUP BY table without joining. Authoritative link is `PosTableOrder.documentId`; kept in sync inside the same transaction. |

Four new enums: `PosTableStatus`, `PosTableShape`, `PosTableZone`, `PosReservationStatus`. `AuditAction` gains `merge`, `clean`, `reserve`.

### Money model

Money still flows through `Document` / `Payment` / `KitchenTicket`. The three `PosTable*` tables are operational metadata only. The POS checkout endpoint accepts an optional `tableId`; when present the service runs `attachSaleToTable` inside the same transaction, then `markForCleaning` so the table flips to DIRTY after the invoice is paid.

### Merge semantics (hard move)

The user picked the "Hard move: reassign all open docs to target" option. When `merge(source, target)` runs:

1. Acquire `SELECT … FOR UPDATE` on both rows (lower id first to avoid deadlocks).
2. Reassign every open `PosTableOrder` row + its `Document.tableId` cache.
3. Source becomes `AVAILABLE` with `mergedIntoId=targetId`; cascades to any tables already merged into source.
4. Target absorbs `OCCUPIED`/`RESERVED` if source was active.
5. All in one transaction — partial failure leaves no inconsistent state.

Unmerge is refused if the source still has open orders (transfer them first).

### Reservations

Full lifecycle. `PosReservationsService.create` rejects overlapping pending/seated bookings on the same table. If `startAt < now + 60min`, the table flips to `RESERVED` immediately. Seating a reservation opens a `PosTableOrder` + flips table to `OCCUPIED`. A cron worker (`reservation-worker.ts`) sweeps:

- **Every minute** — PENDING reservations whose `startAt < now − 30min` → `no_show`.
- **Every 5 minutes** — upcoming reservations within 60min → flip their table to `RESERVED` if AVAILABLE.

Multi-tenant: the worker iterates every active org and runs each org's tick inside its own `tenant.run` scope so the Prisma extension sees the right `app.org_id` GUC.

### RBAC

Nine permission keys under `tables.*` (`view`, `create`, `edit`, `delete`, `transfer`, `merge`, `split`, `clean`, `reserve`). Registered in `packages/shared/src/permissions.ts` and exposed via the `ModuleRegistry`. Controllers gate with `@RequirePermissions`.

### Realtime

Mirror the KDS pattern (Phase P5): `GET /pos/tables/stream` returns `text/event-stream`, emits `data: {snapshot}\n\n` every 2 seconds with the full table list + stats. The terminal picker still uses TanStack polling for offline-friendly behaviour; the SSE channel is the source of truth when online.

### Tenancy + RLS

All three new models are added to `ORG_SCOPED` in `tenancy.extension.ts`. The migration installs `tenant_isolation` RLS policies (FORCEd) identical to the D2-1 pattern. The Prisma `$transaction` wrapper sets `app.org_id` GUC at tx start so RLS sees the right tenant. Cross-tenant reads are impossible even to the table owner.

### Concurrency

Every status-changing endpoint runs inside `prisma.$transaction` with `tx.$queryRawUnsafe('SELECT id FROM "PosTable" WHERE id = $1 AND "organizationId" = $2 FOR UPDATE')` to acquire a row-level lock before mutation. Conflicts return 409 (`ConflictException`) so the UI can render a clear "table busy" message. The `PosTableOrder` unique constraint `@@unique([tableId, documentId])` catches P2002 from the rare case where two cashiers both create an order on the same table.

### Audit

Every mutating service method calls `audit.recordInTx` inside the same transaction. The new `AuditAction` enum members (`merge`, `clean`, `reserve`) cover the new verbs. Event publishing follows ADR-003: `PosTableCreated`, `PosTableMerged`, `PosTableReservationSeated`, etc.

### Idempotency

All money-mutating endpoints (the existing `pos/checkout` already does; the new table endpoints with side effects on Document all do) honour the `Idempotency-Key` header via the existing `IdempotencyInterceptor`.

## Consequences

**Pros**
- Production-grade: row-level locks, RLS, audit, idempotency, events, cron workers.
- Reuses the existing money model — no duplication.
- Compatible with the existing KDS / receipts / loyalty modules.
- Permissions are explicit; admin can grant fine-grained access.

**Cons / known limitations**
- Floor Plan drag-and-drop editor is deferred. The data model is ready (posX/posY/width/height on `PosTable`); only the UI is missing.
- Reservations don't auto-send email / SMS confirmations — `NotificationsService` is ready to consume `PosTableReservationCreated`; left for a fast-follow.
- Reports roll up using `Document.tableId`. Reports that need per-table dining time use `PosTableOrder.closedAt`.
- The existing `PosHold` is still table-agnostic — held tickets don't appear under any table card until they're recalled and a `Document` is created.

## Deferred work (next iteration)

- Floor Plan editor (drag/resize/shape picker, snap-to-grid).
- Waiter assignment UI in the sidebar (backend ready).
- Email / SMS for reservations.
- Optional `waiter_app` mobile-friendly list of "my tables".
- Auto-clean cron (manual clean only today).