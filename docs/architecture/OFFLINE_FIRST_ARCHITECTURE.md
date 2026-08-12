# Offline-First POS Architecture

**Android (Kotlin) app + offline web PWA + LAN→cloud sync**

Status: approved 2026-07-06 · updated 2026-07-12 · Phase 0 in progress (web half shipped, server half pending)

---

## 1. Goals

| Goal | Requirement |
|---|---|
| Android POS | Native app, **fully functional with zero connectivity** (orders, settle, KOT, cash sessions, inventory views, X/Z reports), syncs when internet/Wi-Fi returns |
| Web POS | Existing React terminal keeps selling through internet outages (LAN stays up), syncs when back |
| Compatibility | Same API, same domain model, same idempotency machinery as current system — additive, not a rewrite |
| Extensibility | Protocol designed so multi-branch later just promotes cloud to authority; branch LAN servers become clients of the *same* op-sync protocol |
| Owner rule | **A sale must never be blocked.** Governs every conflict/stock/validation decision. |

## 2. Topology & authority model

```
[Android POS] ──(offline: Room + op queue)──────────┐
[Web POS ×N] ──(LAN, offline-queue hardened PWA)────┤──► [Cafe LAN PC: NestJS API + Postgres + RAW thermal printing]
                                                    │          ├─ Postgres logical replication ──► [Cloud: read replica + API READ_ONLY_MODE]
                                                    │          └─ nightly pg_dump ──► offsite backup
```

- **LAN Postgres = single source of truth.** All writes land there.
- Android + web terminals are **op-queue clients**: they record ordered, idempotent operations locally and replay them to the LAN server.
- **Cloud = read replica** — remote reports, dashboards, backup. Never a write authority in v1.
- Internet loss ≠ outage: web terminals talk to the LAN server, printing is local (Windows RAW spooler / TCP:9100), so the cafe keeps running. Android additionally survives *LAN* loss (away from cafe, LAN PC down) via its own local store.
- **Multi-branch upgrade path:** cloud gets promoted to authority; each branch LAN server becomes a sync client using the identical `/sync/pull` + `/sync/push` protocol built here. Nothing throwaway.

### Locked decisions (do not re-litigate)
1. **Native Kotlin** Android — rejected Capacitor/Flutter/React Native.
2. Full offline scope (not order-taking only).
3. **One offline device per cafe** — minimal conflict surface.
4. **Custom sync** — no PowerSync/ElectricSQL/Firebase.
5. LAN-server-as-authority topology (matches existing Windows thermal printing).

## 3. What already exists (reuse, never rebuild)

| Asset | Location | Role in this design |
|---|---|---|
| Idempotency (`IdempotencyRecord`, `@Idempotent()` interceptor) | `apps/api/src/kernel/idempotency/` | Per-op replay dedup; core extracted as `executeWithKey` |
| Web offline queue (IndexedDB + replay + `failed-sales` store) | `apps/web/src/features/pos/offline-queue.ts` | Web client op queue; extended in Phase 3 |
| UUID PKs everywhere | Prisma schema | Clients mint entity IDs offline, no coordination |
| `deletedAt` tombstones + `updatedAt` on catalog models | Prisma schema | Cursor-based pull works natively |
| `SequenceService` (per-day/per-year numbers) | API kernel | Untouched; provisional numbers map to final at sync |
| `X-Device-Label` header + `RefreshToken` hash pattern | `auth.service.ts` | Template for `PosDevice` token auth |
| Cash sessions post GL server-side | `accounting/treasury/cash-session.service.ts` | Devices never compute GL; GL posts on replay |
| ESC/POS 48-col ticket frame + transports | `pos-receipts.service.ts` | Ported to Kotlin for Bluetooth/TCP printing |

## 4. Sync protocol

### 4.1 Pull — `GET /api/v1/sync/pull?cursor=<opaque>&scopes=...`

- Cursor = opaque base64 JSON: one ISO watermark per scope. Server returns rows with `updatedAt > watermark − 5s` (overlap harmless — clients upsert by id). `nextCursor` computed from server clock only (client clocks untrusted).
- Per-model `updatedAt` cursors — **not** EventOutbox LSN (outbox rows are transient worker state).
- **Scopes:** `menuItems` (full aggregate: item + variants + modifier links + accompaniments + tax + category — item returned when it OR any child changed), `menuCategories`, `modifierGroups`, `taxes`, `posTables`, `cashRegisters`, `staff`, `settings(pos.*)`, `combos`.
- Child/join tables lack `updatedAt` → solved by **parent-touch**: every child write bumps parent `MenuItem.updatedAt`.
- Deletes arrive as `deletedAt` tombstone rows; menu "delete" is `isAvailable=false`. No hard deletes reach clients.
- `staff` scope ships bcrypt `pinHash` (active, non-deleted, POS-permission users only) for offline PIN login.

### 4.2 Push — `POST /api/v1/sync/push` (Android; web keeps per-endpoint replay)

Headers: `X-Device-Token`, `Idempotency-Key: <batchId>`.

```jsonc
{
  "deviceId": "…",
  "ops": [{
    "opId": "uuid",            // per-op idempotency key
    "deviceSeq": 41,           // strict FIFO order
    "type": "sale.checkout",   // see op types below
    "actorUserId": "…",        // cashier attribution (no live posToken needed)
    "occurredAt": "ISO",       // real business timestamp
    "payload": { /* existing DTO shape + clientId?, provisionalNumber? */ }
  }]
}
```

- **Op types:** `cash_session.open|close|movement`, `sale.checkout`, `tab.add_items`, `tab.fire_kitchen`, `tab.settle`, `sale.refund`, `stock.adjustment`.
- Each op runs through `IdempotencyService.executeWithKey(orgId, opId, hash, run)`; handlers are thin wrappers over existing `PosService`/`CashSessionService` methods inside `TenantContextService.run()` with identity = `actorUserId`.
- Sequential + dependency-aware: op referencing a failed op's `clientId` fails too; independent ops continue.
- Failures → `SyncOpDeadLetter` table + admin review screen. **Never silently dropped.**
- Response per op: `status: applied|replayed|failed`, id mappings, `finalNumbers` (invoice/receipt/order).
- Why batch endpoint instead of replaying individual endpoints: strict cross-op ordering (session open → sales → close), offline cashier attribution, final-number return, dead-lettering.

### 4.3 Conflict rules (single offline device keeps this small)

| Case | Rule |
|---|---|
| Catalog / settings / staff | Server wins, always. Android v1 catalog is read-only. |
| Device's own sales / cash / stock ops | Device wins — append-only facts. Stock best-effort, negative OK. |
| Tab on table T edited on web while Android held T offline | Replay as `addToTab` (append) — never full-replace `saveTab`. If tab settled/closed meanwhile: new order without table binding, flagged `needs_review`; **sale still posts**. |
| Cash sessions | One `CashRegister` per device → cross-device session conflicts structurally impossible. |
| Table occupancy | Advisory. Occupied-by-other ⇒ detach + flag, never block. |

### 4.4 Offline numbering — provisional

Device prints `D<n>-NNNNNN` (local counter) + "OFFLINE" marker. At push, server allocates final numbers via untouched `SequenceService`; stores provisional in new `provisionalNumber` + `deviceId` columns on `Invoice`/`Receipt`/`Order` (both searchable); device applies mapping; reprints show final number. (Daily/yearly sequence resets are why pre-reserved ranges lose.)

### 4.5 Offline auth

- New `PosDevice` model: `id, organizationId, branchId, name, platform, tokenHash, prefix, lastSeenAt, lastPushSeq, revokedAt`.
- Manager enrolls device via `POST /sync/devices/register` → one-time opaque 256-bit token, stored hashed (`RefreshToken` pattern), sent as `X-Device-Token`. Revocable.
- Android PIN login: bcrypt verify on-device against synced `pinHash`. Documented tradeoff: stolen device holds brute-forceable short-PIN hashes → mitigations: SQLCipher DB keyed via Android Keystore, POS-role users only, revocation wipes data on next contact, local lockout mirroring `MAX_FAILED_ATTEMPTS=10`. Acceptable for single-cafe trust model.
- Expired JWT offline: irrelevant on Android (device token = transport; `actorUserId` = attribution). Web refreshes against LAN (usually up); if LAN down, session held in memory and ops queue.

### 4.6 Cash sessions + GL offline

Device stores session locally; client-minted uuid travels as `clientId` so queued checkouts reference `cashSessionId` before sync. Replay order: open → sales → movements → close. GL posts **server-side on replay** with `occurredAt` so journals land on the correct business date. Offline X/Z computed from Room; canonical Z snapshot written when the close op replays.

### 4.7 LAN → cloud

- Postgres **logical replication**: LAN publication → cloud subscriber (`wal_level=logical`, Tailscale/VPN tunnel, monitor slot lag + WAL retention on the small LAN disk).
- Cloud runs the same API image with `READ_ONLY_MODE=true` (middleware 403s mutating verbs) for remote reports.
- Replication ≠ backup → **plus** nightly `pg_dump` offsite + restore runbook.

## 5. Android app — 2026 stack

New Gradle module tree `apps/android/` (Kotlin DSL, version catalog `libs.versions.toml`, JDK 21, minSdk 26, targetSdk latest).

| Concern | Choice |
|---|---|
| Language / UI | Kotlin 2.x + **Jetpack Compose** (Material 3), single-activity |
| Architecture | MVVM + unidirectional data flow; **repository = local-first** (Room is the read source of truth; network only fills Room) |
| DI | Hilt (KSP) |
| Local DB | **Room + SQLCipher**, key in Android Keystore |
| Network | Retrofit + OkHttp + kotlinx.serialization |
| Background sync | **WorkManager**: periodic + connectivity-triggered + manual `SyncWorker` |
| Settings/cursors | DataStore (proto) |
| Printing | ESC/POS over Bluetooth SPP + TCP:9100; 48-col frame ported from `pos-receipts.service.ts` |
| Money math | Cart totals ported from `packages/shared`, verified by **golden test vectors** (server script emits cart→totals JSON fixtures; Kotlin unit tests assert parity) |

Room entities: menu aggregate (item/variant/modifier/accompaniment/tax/category), tables, staff(+pinHash), settings, cash session, op-queue (`opId, deviceSeq, type, payloadJson, status, lastError`), number mappings, sync cursors.

## 6. Web offline PWA (Phase 3)

- `vite-plugin-pwa` in `injectManifest` mode (merges existing push SW), manifest.json, precached app shell → app loads with server down.
- `persistQueryClient` + IndexedDB persister for menu/tables/staff/settings query keys → catalog renders after reload while offline.
- `offline-queue.ts` extended: cash movements + `fire-kitchen`/`addToTab` rounds, single FIFO with sequence.
- Offline UX: status indicator; disable server-required actions (refunds, splits, report history); failed-sale review dialog (retry / discard-with-confirm).

## 7. Phases

### Phase 0 — Live bugfix + groundwork (~1 wk) — **in progress**

| # | Item | Status |
|---|---|---|
| 1 | Web: `idempotencyKey` header-only (was spread into body → 400 → silent drop → lost sales) | ✅ shipped |
| 2 | Web: `failed-sales` IndexedDB store; 4xx parks for review instead of dropping | ✅ shipped |
| 3 | Web: `occurredAt` stamped at enqueue | ✅ shipped |
| 4 | **Server: whitelist optional `occurredAt`** on `CheckoutDto`/`SettleTabDto`/cash-session DTOs; validate (not future, ≤7 days); thread to `Invoice.issueDate`, Order dates, Payment date, journal date, `CashMovement` | ❌ **blocking** — until done, every web offline replay 400s (visible in review UI, but replay is broken) |
| 5 | Server: accept `provisionalNumber`/`deviceId` (unused until P1) | ❌ |
| 6 | Server: extract `IdempotencyService.executeWithKey(key, hash, run)` | ❌ |
| 7 | Web: finish `useOfflineQueue()` failed-state wiring + red badge + review dialog in `OfflineIndicator.tsx` | ❌ |

**Verify:** stop API → ring 3 sales + 1 settle → restart → all post exactly once with correct `issueDate`; forced 400 lands in review UI.

### Phase 1 — Server sync module (~1.5–2 wks)

- New `apps/api/src/modules/sync/`: `device.controller/service` (register/list/revoke), `device-token.guard` (X-Device-Token → org/branch + TenantContext), `sync-pull.controller/service` (scopes/cursors/aggregates), `sync-push.controller/service` (batch processor + dead-letter).
- Migration: `PosDevice`, `SyncOpDeadLetter`; `provisionalNumber` + `deviceId` on Invoice/Receipt/Order/CashSession; `clientId` in `OpenSessionDto`.
- Parent-touch on menu child writes: `pos-menu.service.ts`, `pos-variant.service.ts`, `pos-accompaniment.service.ts`, `pos-modifiers.service.ts`.
- **Verify (Jest integration):** zero-cursor pull = full catalog; variant edit → aggregate reappears; full offline-day batch pushed twice → all `replayed`, row counts unchanged; poisoned op → dead-letter, independents applied; GL trial balance matches an identical online day.

### Phase 2 — Android app (~4–5 wks, long pole; start after P1 API freeze)

- **2a Skeleton:** project setup, server URL setting (LAN + cloud), device enrollment, `SyncWorker`, Room entities + cursors, local PIN screen.
- **2b Orders + checkout:** local-first repositories; cart math + golden vectors; op-queue; counter + dine-in rounds (append semantics), settle, holds; provisional counter.
- **2c Cash sessions + local X/Z** from Room (mirror `pos-reports.service.ts` queries).
- **2d Printing:** Bluetooth SPP + TCP:9100; 48-col frame + KOT layout; OFFLINE marker + provisional number on unsynced tickets.
- **2e Push integration:** FIFO push, mapping/final-number application, dead-letter surfacing, revocation wipe.
- **Verify:** airplane-mode E2E — enroll → pull → full offline day (open session, 10 sales w/ modifiers/variants, KOT + receipt on real printer, pay-out, close) → reconnect → push → server asserts counts/totals/GL/Z/mapping; repeat push idempotent; clock-skew +2h test; tab-conflict flagged not blocked.

### Phase 3 — Web offline hardening (~1 wk, parallel with P2)

Section 6 scope. **Verify:** Lighthouse PWA pass; kill LAN API mid-shift → reload → catalog renders, sales + kitchen rounds queue → restart → ordered replay, zero 400s, failures visible.

### Phase 4 — LAN→cloud replication (~0.5–1 wk)

`infra/`: cloud compose (Postgres subscriber + API `READ_ONLY_MODE=true`), LAN publication config, tunnel, lag monitoring, nightly pg_dump + restore runbook. Small API change: read-only guard middleware. **Verify:** LAN sale visible in cloud reports <10 s; sever tunnel 1 h → catch-up without gaps; restore drill.

### Phase 5 — Hardening (~1–1.5 wks)

Device management UI (list/revoke/rename/last-seen/pending-ops), dead-letter review screen, sync metrics, PIN-change forces staff re-pull, 500-op batch load test, `docs/sync-protocol.md`.

## 8. Build order & effort

**P0 → P1 → (P2 ∥ P3) → P4 → P5 ≈ 9–11 weeks single dev.** Android is the long pole; a second dev parallelizes P3/P4.

## 9. Critical files

- `apps/web/src/features/pos/offline-queue.ts` — P0 fix (done) + P3 extension
- `apps/api/src/kernel/idempotency/idempotency.service.ts` — extract `executeWithKey`
- `apps/api/src/modules/pos/pos.controller.ts` + `pos.service.ts` — occurredAt/provisional threading; append-tab semantics reused by push
- `apps/api/prisma/schema.prisma` — `PosDevice`, `SyncOpDeadLetter`, provisional/deviceId columns
- `apps/api/src/modules/pos/pos-receipts.service.ts` — ESC/POS frame to port; OFFLINE ticket variant
- `apps/api/src/modules/accounting/treasury/cash-session.service.ts` — `clientId` + `occurredAt` acceptance
- New: `apps/api/src/modules/sync/*`, `apps/android/*`
