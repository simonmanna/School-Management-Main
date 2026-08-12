# Offline sync protocol

How the Android app and the offline web POS stay usable with no network, and
reconcile with the server afterwards.

## Authority model

```
[Android POS] ──(offline: Room + op queue)──┐
[Web POS × N] ──(LAN, offline queue)────────┤→ [cafe LAN PC: NestJS + Postgres + printing]
                                            │        ├─ logical replication → [cloud: read-only replica]
                                            │        └─ nightly pg_dump → off-site
```

The **cafe LAN Postgres is the only source of truth**. Devices are op-queue
clients. The cloud is a read replica for reports and backup — never a write
authority. (Multi-branch later: the cloud becomes authority and each branch's
LAN server becomes a client of this same protocol.)

**Owner rule that governs everything below: a sale must never be blocked.**
When something is ambiguous, the sale wins and the discrepancy gets flagged —
never dropped.

## Transport auth

Devices authenticate `/sync/*` with an opaque `X-Device-Token` (256-bit,
stored server-side only as a sha256 hash — the `RefreshToken` pattern). It is
issued once at registration and shown once in the UI.

The token is **transport auth only**. *Who* did something travels per-op as
`actorUserId`, because a sale rung up at 09:00 may not sync until 17:00, long
after any user JWT expired.

Registration is manager-gated (`organization:update`); revocation stops the
device on its next contact.

## Pull — `GET /sync/pull?cursor=<opaque>&scopes=a,b,c`

Incremental catalog download.

- **Cursor**: opaque base64 JSON, one ISO watermark per scope, always stamped
  from the **server clock** — device clocks never participate. Rows with
  `updatedAt > watermark − 5s` are returned; the overlap is harmless because
  clients upsert by id.
- **Why `updatedAt` and not the EventOutbox**: the outbox only carries events
  someone explicitly published, so it is an incomplete change feed, and its
  rows are transient worker state. `updatedAt` is complete and already indexed.
- **Scopes**: `menuItems`, `menuCategories`, `modifierGroups`, `taxes`,
  `posTables`, `cashRegisters`, `staff`, `settings`, `products`,
  `productCategories`, `productPackagings`, `partners`, `reservations`.
  (Canonical list: `SYNC_PULL_SCOPES` in `dto/sync.dto.ts`.) `productPackagings`
  carries multipack barcodes so a scanned case adds `quantity` base units on the
  device. `reservations` delivers upcoming/active bookings (rolling 24h floor);
  terminal statuses (cancelled/no_show/completed) are treated as tombstones.
- **`menuItems` is an aggregate**: item + variants + modifier-group links +
  accompaniment groups/options. Child tables have no `updatedAt` of their own,
  so child writes must touch the parent (see *Known gaps*).
- **Deletes**: catalog models carry `deletedAt` — a pulled row with
  `deletedAt` set is a tombstone and the client deletes it locally. A "deleted"
  MenuItem is really `isAvailable=false`, an ordinary update.
- **`staff` includes the bcrypt `pinHash`** so cashiers can log in offline.

## Push — `POST /sync/push`

The device drains its op queue in `deviceSeq` order.

```jsonc
// Headers: X-Device-Token, Idempotency-Key: <batchId>
{
  "deviceId": "uuid",
  "ops": [{
    "opId": "uuid",           // per-op idempotency key
    "deviceSeq": 42,          // strictly increasing; defines apply order
    "type": "sale.checkout",
    "actorUserId": "uuid",    // who rang it up (PIN-verified on device)
    "occurredAt": "2026-07-16T14:05:00Z",
    "payload": { /* the same body the online endpoint takes */
                 "clientId": "…", "provisionalNumber": "D1-000042" }
  }]
}
```

Op types: `cash_session.open|close|movement`, `sale.checkout`, `tab.settle`,
`sale.refund`, `sale.void`, `reservation.create|seat|cancel|noShow`,
`customer.upsert|delete`, `setting.set`. (Canonical list: `SYNC_OP_TYPES` in
`dto/sync.dto.ts`.)

- **`reservation.*`** book/seat/cancel/no-show a table. `reservation.create`
  carries a client-minted `id` the server honours as the row id (like
  `customer.upsert`), so a booking taken offline is seat/cancel-able by that
  same id and a later pull never duplicates it. seat/cancel/no-show reference
  `reservationId`.

- **`sale.refund` / `sale.void`** reverse a settled sale (GL reversal + restock
  + drawer cash-out), reusing `PosInvoiceService.refund`. `void` forces a
  manager override (`overrideById`, PIN-verified on-device). The payload's
  `invoiceId` is the server invoice id, or — when the sale settled in the *same*
  batch and the device hasn't seen the server id yet — the sale's `clientId`,
  which the push processor resolves the same way it resolves `cashSessionId`.
  Partial (line-level) refunds are online-only: the device never receives
  server invoice-item ids.

Each op runs through `IdempotencyService.executeWithKey(opId)` inside a
per-op tenant context whose identity is `actorUserId`. Handlers are thin
wrappers over the existing `PosService` / `CashSessionService` — offline sales
take the identical code path as online ones, so GL, stock and receipts cannot
drift between the two.

Response per op: `applied` | `replayed` | `failed`, plus id `mapping` and
`finalNumbers`. **Re-pushing a batch is safe** — the second attempt returns
`replayed` with the original ids and charges nothing twice.

### `clientId` — referencing rows that don't exist server-side yet

A sale needs a `cashSessionId`, but the session was opened offline and has no
server id. So the device mints a uuid, sends it as `clientId` on the
`cash_session.open` op, and references that same value in later ops. The push
processor maps client → server ids as the batch applies.

If an op's dependency failed, dependents fail fast with 424 rather than
attaching to the wrong session.

### Failures are never dropped

A rejected op is written to `SyncOpDeadLetter` and surfaced at
**Settings → Offline devices → Rejected sales**. There is deliberately no
retry button: these ops failed a *business rule* (closed session, revoked
device, table already settled), and blind replay is how you double-post. A
manager records what happened; the decision is audited.

## Conflict rules (single offline device per cafe)

| Case | Rule |
|---|---|
| Catalog / settings / staff | **Server always wins.** Devices never edit the catalog. |
| A device's own sales, cash ops | **Device wins** — append-only facts. Stock is best-effort; negative on-hand is allowed. |
| Tab edited on web while a device held it offline | Replay as `addToTab` (append), never `saveTab` (replace) — a replace would clobber the other terminal and 409 on the version token. |
| Cash sessions | One `CashRegister` per device ⇒ cross-device session conflicts are structurally impossible. |
| Table occupancy | Advisory. Occupied-by-another ⇒ detach and flag; never block the sale. |

## Numbering — provisional, then final

Invoice/receipt/order numbers come from Postgres sequences that reset per year
(`INV-YYYY-######`) and per day (`ORD-YYYYMMDD-######`), so pre-reserving
ranges for a device is impractical.

Instead the device prints `D1-000042` plus an explicit **OFFLINE** marker. At
push, the server allocates the real number and stores the provisional one in
`Invoice.provisionalNumber` / `Receipt` / `Order` (with `deviceId`), so either
number finds the sale. Reprints after sync show the final number.

## Business dates — `occurredAt`

Every op carries the moment it actually happened. The server uses it for
`Invoice.issueDate` (which drives the GL/journal date and report buckets) and
the payment date. Without it, a Friday-night sale synced Monday morning would
land in Monday's Z-report and Monday's ledger.

Validated as: not in the future (5 min skew allowed), not older than 7 days —
past that it is a broken device clock, not a late sale.

## Security trade-off: PIN hashes on the device

Syncing `pinHash` is what makes offline login possible, and a stolen tablet
holds bcrypt hashes of short numeric PINs — brute-forceable offline. Mitigated
by: SQLCipher-encrypted database keyed from the Android Keystore, POS-role
users only, an on-device lockout mirroring the server's 10-attempt rule, and
revocation wiping enrollment on next contact. Accepted for a single-cafe trust
model — revisit for multi-tenant fleets.

## Known gaps

- **Menu child writes don't touch the parent yet.** Editing only a variant or a
  modifier link does not bump `MenuItem.updatedAt`, so the aggregate may not
  re-pull until the item itself changes. Until that lands, a device picks up
  such edits on a full re-pull (clear the cursor). Fix: bump the parent in
  `pos-variant.service.ts`, `pos-accompaniment.service.ts`,
  `pos-modifiers.service.ts`, `pos-menu.service.ts`.
- **Web offline queue has no automated tests** (see the repo's open task).
- **Android tabs**: the device app currently does counter sales; dine-in tab
  rounds are queued by the web terminal only.
