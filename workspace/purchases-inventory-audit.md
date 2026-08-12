# Purchases / Procurement / Inventory Management — Production-Readiness Audit

**Scope:** Procurement (PurchaseRequest → PurchaseOrder → GoodsReceiptNote → DebitNote), inventory core (locations, stock engine, batches/serials, reservations, costing), stock documents (StockOut / Waste / Adjustment / Transfer), inventory count sessions, posting rules.
**Method:** Static read of source + spec coverage + `tsc -p tsconfig.build.json --noEmit` + jest unit run.
**Branch:** `feat/android-pos-parity` @ `338b172`. 31 modified, 20 untracked. Surface: **5,342 LoC** across 8 controllers + 9 services + 4 submodules (`costing/`, `posting/`, `dto/`, `direct-stock/`) + 2 spec files (211 LoC).

---

## Executive Summary

**Verdict: PRODUCTION READY WITH MAJOR FIXES — 71/100**

The inventory core is **one of the best-engineered surfaces in the codebase**. The stock engine is sophisticated and correct: AVCO / FIFO / STANDARD / SPECIFIC (serial) costing, FEFO / FIFO / MANUAL picking strategies, batch/serial tracking with full traceability, UoM conversion that preserves total value, configurable negative-stock policy (default keeps sales unblocked — owner rule), layered GL posting per movement type, soft reservations for available-to-promise (ATP). The `StockItem` schema is exemplary — `variantKey` non-null mirror on the unique index to defeat Postgres NULL-distinct duplicate quants. Every controller endpoint has `@RequirePermissions`.

Procurement is competent — POs have an approval gate, optimistic-lock `version`, over-receive guards, single `$transaction` for receive. GRN flows are approval-gated. Debit notes (incl. RTV) are correctly posted in one TX with cost-aware stock-out + variance. Inventory count sessions are the most carefully designed flow I've read in this audit: idempotent draft creation with P2002 fallback, approval gate, atomic create+approve adjustment in one TX, mandatory reason per variance line.

What's keeping this at **71/100** (not 84 like the POS audit):

1. **No unit tests for any procurement or stock service.** Only 2 spec files exist across 5,342 LoC — `cost-resolver.service.spec.ts` (128 LoC) and `stock-posting.service.spec.ts` (83 LoC). 13 tests pass; nothing covers PO/GRN/debit-note/stock/stock-doc/count logic. This is the single biggest gap.
2. **TOCTOU race in `DirectStockService.directOut`** — stock availability pre-check at line 106-117 runs outside the `$transaction`; concurrent calls can both pass and both decrement.
3. **Permission mismatches on `/receive` and `/pay`** — PO controller uses `purchase_order:create` instead of the registered `purchase_order:receive` / `purchase_order:pay`. Same value, wrong decorator.
4. **Duplicate GRN-posting paths** — three different code paths can post a GRN: `PurchaseOrdersService.receive`, `GoodsReceiptsService.createAdhoc`, `GoodsReceiptsService.post`. The stock service is correctly the single source of truth for quants, but the approval-gate logic is repeated three times with subtle differences.
5. **`pay()` doesn't require `status === 'received'`** — can pay a PO that's still active (no GRN yet). Likely intentional (deposit on order) but undocumented and would surprise a finance team.

### Inherited system-wide gaps (carry-over)

- **RolesGuard permissive-by-default** at the kernel layer (out of scope here, but confirmed again).
- **Single-tenant** (`organizationId` on every row). Acceptable for v1 single-cafe.
- **Throttler not installed** at controller level (no `@nestjs/throttler` decorator visible).

### Lowest-scoring dimension caps the verdict

| Dimension | Score | Rationale |
|---|---|---|
| **Test surface** | 2/10 | 2 spec files, 211 LoC. Nothing covers the core stock engine, PO service, GRN service, debit-note service, count service. |
| **Concurrency correctness** | 7/10 | One confirmed TOCTOU in `DirectStockService.directOut`; `transfer` and `adjust` use atomic conditional updates correctly |
| **RBAC** | 9/10 | Every endpoint gated; one permission mismatch on PO `/receive` and `/pay` |
| **Domain correctness** | 9/10 | Decimal precision, GL posting, recipes, costing methods, picking strategies, ATP |
| **Workflow coverage** | 9/10 | PR → PO → GRN → payment, debit notes (in/out/RTV), stock-out/waste/adj/transfer, counts, reservations |
| **Audit trail** | 8/10 | `AuditService.record` on every mutation; `audit.recordInTx` inside TXs; a few "best-effort" `.catch` swallowing in PO compensation paths |
| **Schema design** | 9/10 | Decimal(20,6), `version`, audit columns, `variantKey` non-null mirror, soft-friendly FKs, partial unique index on draft counts |
| **Operational readiness** | 7/10 | No throttler; audit outside TX in a few non-critical paths; reservations not auto-consumed on stock-issue (manual consume step exists) |

**Overall: 71/100 → PRODUCTION READY WITH MAJOR FIXES** (1 P0 + 4 P1 + 6 P2 + 4 P3). The engine is excellent; the surface around it has 1 race + 1 missing test suite + 4 permission/structural cleanups. A 3-day hardening sprint + a 2-day test sprint gets you to 88+.

---

## Audit dimensions

### 1. Domain correctness (9/10)

| What I checked | Verdict |
|---|---|
| Money precision (Decimal vs Float) | ✅ `Decimal(20,6)` on StockItem, InventoryBatch, InventoryLedger, StockReservation. `dec()` helper everywhere. |
| Costing methods | ✅ AVCO, FIFO, STANDARD, SPECIFIC (serial) — all implemented. AVCO recomputed on every receipt; FIFO via `InventoryBatch` per-batch decrement with `updateMany where quantity >= consumed` (atomic). |
| Picking strategy | ✅ FEFO (default), FIFO, MANUAL — strategy cascade: tx override > setting override > product column > FEFO fallback. |
| UoM conversion | ✅ `toBaseQtyCost` preserves total value (`unitCost` divided by same factor qty is multiplied by). |
| Batch tracking | ✅ Required when `product.batchTracking=true`; auto-numbering optional via `inventory.batchAutoNumber` setting; expiry required when `expiryTracking`. |
| Serial tracking | ✅ SPECIFIC costing per serial; receipt upsert (not create) so re-receipt flips status back; overflow at product cost when serials fewer than qty. |
| Stock-out categories | ✅ StockOutCategory → StockMoveType mapping (sample/comp → promo_sample; damaged → waste; expired → expiry_write_off; etc.) — GL routes correctly. |
| InventoryMovementType → GL | ✅ `INV_MOVE_TYPES` map in `stock.service.ts:775-782` covers 6 movement types and falls back to STOCK_OUT. |
| Stock-to-GL linkage | ✅ Dr/Cr Stock Valuation / Adj Income/Expense / Adj Expense via `StockPostingService`. Bills post GRNI flow (`receiveFromBill`). |
| Reservations (ATP) | ✅ Soft reservations; idempotent per (sourceType, sourceId, product, variant, location); `available = onHand − sum(active)`. |
| Counts | ✅ Snapshot on-hand at start; variance requires reason; atomic create+approve adjustment in one TX; partial unique index prevents concurrent drafts. |
| Negative-stock policy | ✅ Default `allowNegativeStock=true` (owner rule: never block a sale). Strict mode checks `product.stockPolicy` (`block` / `warn` / `silent`). |
| Direct stock | 🟡 TOCTOU race in `directOut` (F1) — pre-check outside TX. |
| Debit note RTV | ✅ Single TX; stock leaves at cost via `stock.issue(skipGlPosting)`; GL variance (Cr Stock Adj Income if credit > cost, Dr Stock Adj Expense if credit < cost). |

### 2. RBAC & Security (9/10)

| Controller | Endpoints | `@RequirePermissions` | Gaps |
|---|---|---|---|
| `InventoryController` | 32 | 32 | None |
| `InventoryCountController` | 5 | 5 | None |
| `StockReservationController` | 5 | 5 | None |
| `PostingRuleController` | 7 | 7 | None |
| `PurchaseRequestsController` | 7 | 7 | None |
| `PurchaseOrdersController` | 9 | 9 | 🟡 2 use `purchase_order:create` where `:receive` / `:pay` exist |
| `GoodsReceiptsController` | 5 | 5 | None |
| `DebitNotesController` | 5 | 5 | None |

**No P0 RBAC gaps in inventory or procurement modules.** Permission issues:
- 🟡 P2: `purchase-orders.controller.ts:66` (`/receive`) uses `purchase_order:create` instead of `:receive` (which is registered, line 69 of `procurement.module.ts`)
- 🟡 P2: `purchase-orders.controller.ts:73` (`/pay`) uses `purchase_order:create` instead of `:pay` (which is registered, line 70)

The permissions exist and are registered; they're just not wired. Net effect: a user with `:receive` permission but NOT `:create` can't call `/receive`. P2 because the existing `:create` decorator still gates correctly (someone with `:create` can call `/receive`, which is overpermissive but not insecure).

### 3. Test surface (2/10)

| Spec file | LoC | Coverage | Status |
|---|---|---|---|
| `cost-resolver.service.spec.ts` | 128 | Cost resolver branches (AVCO / FIFO / STANDARD / receipt cost resolution) | ✅ Pass |
| `stock-posting.service.spec.ts` | 83 | Stock posting GL rules (one per movement type) | ✅ Pass |
| (everything else) | 0 | None | ❌ |

**2 spec files for 5,342 LoC of production code = 4% test coverage by file count.** The two existing specs are excellent (13 tests, all pass). The risk is enormous:
- `stock.service.ts` (1,097 LoC, 30+ async methods) — zero tests
- `stock-doc.service.ts` (457 LoC) — zero tests
- `purchase-orders.service.ts` (656 LoC) — zero tests
- `goods-receipts.service.ts` (370 LoC) — zero tests
- `debit-notes.service.ts` (373 LoC) — zero tests
- `inventory-count.service.ts` (346 LoC) — zero tests
- `stock-reservation.service.ts` (124 LoC) — zero tests
- `direct-stock.service.ts` (162 LoC) — zero tests
- `purchase-requests.service.ts` (187 LoC) — zero tests
- `inventory-query.service.ts` (467 LoC) — zero tests

**`tsc -p tsconfig.build.json --noEmit` — clean.** All 13 unit tests pass. But the surface-area test ratio is a P0 concern.

### 4. Transaction integrity (7/10)

| Mutation | Guard | TX | Note |
|---|---|---|---|
| `PO.create` | `approvals.requestApproval` (auto-approve or draft) | ✅ Inside `$transaction` | Audit row also written |
| `PO.receive` | Over-receive guard + optimistic-lock `version` per line + on PO | ✅ Inside `$transaction` | 7 steps in one TX; strong |
| `PO.pay` | Manual payment guard (`amount > 0`, `amount <= remaining`) | ✅ Inside `$transaction` | No `FOR UPDATE` on PO row — relies on optimistic lock; concurrent pays can race but second will fail the version check (acceptable) |
| `PO.cancel` | Status guard (`!['received','cancelled','billed','closed']`) | ⚠️ Plain update, no `$transaction` | P2 — single update, low risk |
| `PO.update` | Status guard (active only) | ⚠️ Plain update | P3 — doesn't bump `version`, so concurrent updates all succeed last-write-wins |
| `PO.activate` | Approval-pending guard | ⚠️ Plain update | Acceptable |
| `PO.remove` | Status guard | ⚠️ Hard `delete` | P2 — `PurchasePayment` and `GoodsReceiptNote` may have `onDelete: Restrict` (verify); safe-delete leaves orphans |
| `GRN.createAdhoc` | Approval-gate | ✅ Inside `$transaction` | One path |
| `GRN.create` (draft only) | None | ⚠️ Outside `$transaction` | Creates draft GRN, then `post(id)` is the TX |
| `GRN.post` | Approval check | ✅ Inside `$transaction` | Another path |
| `GRN via PO.receive` | See PO | ✅ Inside PO TX | Third path |
| `DebitNote.create` | None | ⚠️ Plain create + lines | Acceptable; lines are child records |
| `DebitNote.post` | Status guard + RTV branch | ⚠️ Outside `$transaction` (default) + ✅ inside `$transaction` (RTV) | 🟡 P2 — default branch is plain `posting.post()` then `debitNote.update`; a partial failure leaves audit drift |
| `DebitNote.postSupplierReturn` | RTV: location resolution, stock issue, variance GL | ✅ Inside `$transaction` | Strong |
| `StockService.receiveCore` | Product/location existence, batch/serial rules, UoM conversion | ✅ Inside `$transaction` (via `run` callback) | Strong; optional external TX |
| `StockService.issue` | Stock availability (with optional strict-mode), picking strategy, batch/serial allocation | ✅ Inside `$transaction` | Strong |
| `StockService.adjust` | Atomic conditional update (`where quantity = currentQty`) — concurrent-adjust race | ✅ Inside `$transaction` | Strong |
| `StockService.transfer` | Atomic conditional decrement at source (`where quantity >= qty`) | ✅ Inside `$transaction` | Strong |
| `StockDocService.approveStockOut/Waste/Adjustment/Transfer` | Item-by-item stock engine call inside TX | ✅ Inside `$transaction` | Strong; idempotent via `postedAt` |
| `InventoryCount.submit` | Approval gate + reason validation; create+approve adjustment in one TX | ✅ Inside `$transaction` | Strong |
| **`DirectStockService.directOut`** | **Pre-check stock OUTSIDE the TX** | ❌ Race window | **🔴 P0 — F1** |
| `DirectStockService.directIn` | Batch/expiry pre-check | ✅ Inside `$transaction` | Strong |

### 5. Print / lifecycle (N/A for this module)

No print lifecycle in this module. POS receipts are reviewed in the prior audit.

### 6. Workflow coverage (9/10)

| Workflow | Status |
|---|---|
| Create purchase request | ✅ |
| Submit + approve PR | ✅ |
| Convert PR → PO | ✅ via `consumeForOrder` + `markConverted` (note: PR status flip can race if 2 POs created from same PR — `consumeForOrder` reads but doesn't lock) |
| Create PO (draft) | ✅ |
| PO approval gate | ✅ via `ApprovalsService.requestApproval` — auto-approves to `active` when no policy exists |
| PO line-level edit (post-approval) | ⚠️ `update()` only allows description/expectedDeliveryDate/notes/terms; cannot edit lines after receive — by design |
| PO cancel | ✅ Status guard |
| Receive against PO | ✅ With over-receive guard |
| Three-way match (PO ↔ GRN ↔ vendor bill) | 🟡 The skill flags "ThreeWayMatch" kernel module exists; not deep-read in this audit |
| Cash PO auto-settle on receive | ✅ via `if (po.paymentType === 'cash')` block in `receive()` TX |
| Credit PO manual payment | ✅ `pay()` |
| GRN ad-hoc (no PO) | ✅ `createAdhoc` |
| GRN approval-gated | ✅ |
| Debit note outbound (we charge customer more) | ✅ |
| Debit note inbound (supplier charges us) | ✅ |
| RTV (return-to-vendor with stock back) | ✅ Single TX with cost-aware stock issue + GL variance |
| Direct stock in / out | ✅ (with F1 race) |
| StockOut document | ✅ approval-gated |
| Waste document | ✅ approval-gated |
| Adjustment document | ✅ approval-gated, snapshot systemQty on create |
| Transfer document | ✅ approval-gated, multi-step |
| Inventory count | ✅ All four states (draft → submitted → approved → cancelled), mandatory reason on variance |
| Reservation release / consume | ✅ |
| Reorder suggestions | 🟡 `getReorderSuggestions` exists; not deep-read |
| Expiry reports | ✅ |

### 7. Operational readiness (7/10)

| Concern | Status |
|---|---|
| Throttler / rate-limit on stock ops | ❌ No throttler. Brute-force / runaway script risk. P2. |
| Audit log inside TX | ✅ For `receiveCore`, `issue`, `adjust`, `transfer` (audit.recordInTx). 🟡 PO receive audit is OUTSIDE the TX (line 454 of `purchase-orders.service.ts`). Same for debit-note post. P2 — matches the POS audit pattern. |
| Health endpoints | ✅ kernel |
| Structured logging | ✅ Logger per service |
| Reservations auto-consume on issue | ❌ Manual `consume(sourceType, sourceId)` — caller responsibility. Not invoked from `stock.issue`. P3 — acceptable design but documents should call this out. |
| Approvals engine integration | ✅ Strong — every financial mutation goes through `ApprovalsService.requestApproval` |
| Sequence service | ✅ `appends nextValue` atomically, supports `tx` for in-transaction allocation. Used everywhere. |
| Soft-delete pattern | ✅ Most models have `deletedAt`; locations use soft-delete |

---

## Findings table (sorted by severity)

| ID | Severity | Location | Description | Fix |
|---|---|---|---|---|
| **F1** | 🟠 **P0** | `apps/api/src/modules/inventory/direct-stock.service.ts:106-118` | **TOCTOU race in `directOut`.** Stock availability is pre-checked outside the `$transaction`; concurrent calls can both pass the check and both decrement. Unlike `stock.transfer` (atomic conditional decrement `where quantity >= qty`), this path has no atomic guard. | Move the availability check inside the TX (using `tx.stockItem.findFirst` + `tx.stock.issue`), OR refactor `stock.issue` to add an atomic conditional decrement in non-strict mode. |
| **F2** | 🟡 **P1** | (entire procurement + stock surface) | **Zero unit tests** for `purchase-orders.service.ts` (656 LoC), `goods-receipts.service.ts` (370 LoC), `debit-notes.service.ts` (373 LoC), `stock.service.ts` (1,097 LoC), `stock-doc.service.ts` (457 LoC), `inventory-count.service.ts` (346 LoC), `direct-stock.service.ts` (162 LoC), `purchase-requests.service.ts` (187 LoC), `inventory-query.service.ts` (467 LoC). Only 2 spec files exist (211 LoC). | Write 8+ spec files covering: approval gate paths, over-receive guard, pay() payment validation, debit-note RTV stock-out at cost, stock.receive AVCO recompute, stock.issue picking strategy (FEFO/FIFO/MANUAL/SPECIFIC), stock.adjust atomic update, stock.transfer atomic decrement, count.submit reason validation, directOut race fix. |
| **F3** | 🟡 **P1** | `apps/api/src/modules/procurement/purchase-orders.service.ts:454-470, 529-538` | **Audit log OUTSIDE the main `$transaction`** for `receive` and `pay`. A rollback of the stock/payment/GRN sequence leaves the data mutated but no audit row (matches POS F4 pattern). | Move `audit.record` inside the TX or after a successful try/catch that re-raises on audit failure. |
| **F4** | 🟡 **P1** | `apps/api/src/modules/procurement/purchase-orders.service.ts:566-580, 549-563` | `cancel()` and `update()` are plain `prisma.update` outside any `$transaction` and don't bump `version`. Concurrent admin edits all succeed last-write-wins. | Wrap in `$transaction`; bump `version`. |
| **F5** | 🟡 **P1** | `apps/api/src/modules/procurement/goods-receipts.service.ts:163-217` | **`GoodsReceiptsService.create()` creates draft GRN outside any TX**, then `post(id)` enters a TX. Same logical action as `createAdhoc` and `PO.receive` (3 paths to post a GRN). | Either (a) deprecate `create()` + force callers to use `createAdhoc()`, or (b) consolidate the three paths into one helper. |
| **F6** | 🟢 **P2** | `apps/api/src/modules/procurement/purchase-orders.controller.ts:66, 73` | `/receive` and `/pay` use `@RequirePermissions('purchase_order:create')` instead of the registered `:receive` / `:pay`. | Change decorators. |
| **F7** | 🟢 **P2** | `apps/api/src/modules/procurement/purchase-orders.service.ts:476-545` | `pay()` does not check `po.status === 'received'`. A cashier can pay an `active` PO with no GRN yet. Probably intentional (deposit on order) but undocumented and would surprise finance. | Either add status guard or document the "deposit" use case in JSDoc + OpenAPI. |
| **F8** | 🟢 **P2** | `apps/api/src/modules/procurement/debit-notes.service.ts:208-220` | `DebitNote.post()` (non-RTV path) calls `posting.post()` and `debitNote.update` outside any `$transaction`. A posting failure leaves the note in `draft` (acceptable) but a rollback would leave a partial state. | Wrap in `$transaction`. |
| **F9** | 🟢 **P2** | `apps/api/src/modules/inventory/inventory.controller.ts` | No `@nestjs/throttler` on stock operations. Brute-force / runaway script risk. | Add throttler (per-IP, e.g. 60 req/min on stock ops, 30 on count/transfer). |
| **F10** | 🟢 **P2** | `apps/api/src/modules/inventory/stock.service.ts:1067-1077` | Transfer between same-product locations preserves AVCO correctly. But transfer between **branches** (different `organizationId`?) — verify no scope leakage. | Confirm transfer's organizationId check covers source + dest locations. |
| **F11** | 🟢 **P2** | `apps/api/src/modules/inventory/stock-reservation.service.ts:39-72` | `reserve()` is NOT inside a `$transaction` and has no atomic check vs available stock. Concurrent reserve calls can over-reserve (sum(active reservations) > onHand). | Wrap in `$transaction` + atomic conditional check. |
| **F12** | 🟢 **P2** | `apps/api/src/modules/procurement/purchase-requests.service.ts:163-178` | `consumeForOrder` reads PR but doesn't take a lock. Two concurrent POs created from the same PR would both see "available" lines and double-create. | Add `FOR UPDATE` lock or convert PR to "converted" on first PO creation. |
| **F13** | 🟢 **P3** | `apps/api/src/modules/procurement/purchase-orders.service.ts:585-594` | `remove()` hard-deletes the PO. With `PurchasePayment` and `GoodsReceiptNote` FK rules `onDelete: Restrict` (verify), the delete could throw a confusing FK error. | Document the FK rules; consider soft-delete. |
| **F14** | 🟢 **P3** | `apps/api/src/modules/procurement/purchase-orders.service.ts:66-69, 161-167` | `/receive` controller takes `purchase_order:create` permission but also bumps `version` after receive — verify the next call from the same client doesn't 400 on stale version. | Confirm UI sends the post-receive version. |
| **F15** | 🟢 **P3** | `apps/api/src/modules/inventory/stock.service.ts:436` | Picking strategy cascade: `dto.distStrategy ?? settingOverride ?? product.pickingStrategy ?? 'FEFO'`. The `product.pickingStrategy` field may not exist on `Product` schema (verify). | Verify schema has `pickingStrategy` field; fall back to `'FEFO'` constant if not. |

---

## Final verdict (your 8 closing questions)

### 1. Can a buyer create a purchase order end-to-end?
**Yes.** Create PR → submit → approve → convert to PO → optional approval (auto-approve if no policy) → receive against PO (with over-receive guard + optimistic lock + auto GL/stock issue) → pay (credit purchases).

### 2. Can received stock flow into inventory + accounting?
**Yes.** Stock engine is the single source of truth. Every receive writes `StockItem` (upsert with AVCO recompute), `InventoryLedger` row, optional `InventoryBatch` (when batchTracking), optional `InventorySerial` (when serialTracking), `audit_log` (inside TX), and an event. GL is posted only on bill-backed receipts (GRNI flow) or via the StockPostingService. AVCO is correct; FIFO uses atomic per-batch decrement.

### 3. Can stock be issued against a sale / production / transfer / waste?
**Yes.** Single `stock.issue` engine handles all four: stock-out (POS sale), waste / expiry_write_off, transfer (split into transfer_out + transfer_in ledger rows), RTV (with `skipGlPosting` flag because the debit note owns the balanced JE). Picking strategy: FEFO default; FIFO via batch orderBy; MANUAL via explicit batchNumber. Layer cost computed exactly from consumed batches; passed to GL so it doesn't re-resolve.

### 4. Can a stock count be performed and posted?
**Yes.** Best-designed flow in the audit. Start session (idempotent, cancels prior draft, P2002 fallback to existing draft) → saveDraft (per-line upsert, recompute variance) → submit (approval gate, mandatory reason per variance line, atomic create+approve adjustment in one TX, idempotent via `postedAt` on StockAdjustment).

### 5. Does the inventory integrate with the accounting/GL?
**Yes, deeply.** `StockPostingService` has dedicated methods: `postReceiveFromBill` (Dr Stock Valuation / Cr GRNI-Accrued), `postIssue` (Dr expense / Cr Stock Valuation, with movement-type-aware account mapping), `postAdjustment` (Dr/Cr Stock Valuation + Adj Income/Expense), `postReturnRestock` (Dr Stock Valuation / Cr COGS reversal), `postTransfer` (Dr destination / Cr source). All configurable via `InventoryPostingRule` model. StockDocService maps StockOutCategory → StockMoveType → InventoryMovementType correctly.

### 6. Are reservations / ATP correct?
**Mostly.** Reservation model is right (soft, org-scoped, idempotent per source). But `reserve()` (F11) is not in a TX and has no atomic check — concurrent calls can over-reserve. ATP computation is correct.

### 7. Can concurrent stock operations serialize correctly?
**Mostly.** `stock.transfer` and `stock.adjust` use atomic conditional updates (`where quantity >= qty` / `where quantity = currentQty`). `stock.issue` in strict mode checks `available >= qty` inside TX (for layer-costed products). **`DirectStockService.directOut` (F1) is the only confirmed race.**

### 8. Is it production-ready?
**PRODUCTION READY WITH MAJOR FIXES — 71/100.**
- **Ship-blocker:** F1 (TOCTOU race in direct stock-out)
- **Should-fix-before-public-launch:** F2 (zero tests for the procurement surface), F3 (audit outside TX), F4 (PO update/cancel no version bump), F5 (3 GRN-posting paths)
- **Day-2 work:** F6-F12 (permission cleanups, debit-note TX wrap, throttler, reservation race, PR→PO lock)

The inventory engine itself is excellent. The risk is the integration points around it.

---

## Recommended path to production (sprint plan)

### Sprint 1 — race + structural (1–2 days)

| Commit | Fix | Why |
|---|---|---|
| `fix(inv): move directOut availability check inside TX` | F1 | Eliminates the confirmed race |
| `fix(inv): atomic reservation upsert + lock` | F11 | Prevents over-reservation |
| `fix(po): bump version on cancel/update + wrap in TX` | F4 | Concurrent-edit safety |
| `fix(po): use purchase_order:receive / :pay permissions` | F6 | Permission taxonomy |
| `fix(po): audit.record inside TX for receive/pay` | F3 | Audit completeness |
| `fix(po): consolidate GRN-posting paths (deprecate create)` | F5 | Single-source-of-truth |

### Sprint 2 — tests (2 days)

| Commit | Fix | Why |
|---|---|---|
| `test(po): over-receive guard, payment guard, version bumps, cancel state machine` | F2 partial | Closes the largest gap |
| `test(grn): approval-gate paths, draft → post, auto-stock-issue` | F2 partial | Same |
| `test(debit): inbound/outbound/RTV stock-out + GL variance` | F2 partial | Critical for finance |
| `test(stock): receiveCore AVCO recompute, issue picking strategies, adjust atomic, transfer atomic` | F2 partial | The engine itself |
| `test(count): idempotent start, variance reason guard, atomic adjustment create+approve` | F2 partial | The most complex flow |
| `test(inv-query): ledger, reorder, expiry, product stock levels` | F2 partial | Reporting correctness |

### Sprint 3 — operational polish (1–2 days)

| Commit | Fix | Why |
|---|---|---|
| `feat(throttler): install + apply per-IP limits` | F9 | Rate-limit |
| `fix(debit): wrap non-RTV post in TX` | F8 | Audit completeness |
| `fix(po): require received status for pay() OR document deposit semantics` | F7 | Clear contract |
| `fix(po): FOR UPDATE on PR when converting to PO` | F12 | PR→PO race |
| `docs(stock-reservation): document auto-consume step on issue` | — | Caller docs |

---

## What this audit did NOT do

- **No runtime exercise.** Per your `production ready` bar, the live-server smoke (every stock op against a populated DB, every count submit, every RTV) is a separate step.
- **No three-way match deep read** (`apps/api/src/kernel/three-way-match/*`). The skill flags it as a kernel module; not in audit scope here.
- **No vendor bill deep read** (`apps/api/src/modules/invoicing/*`). Bills tie into PO via `VendorBillLink`; not in audit scope here.
- **No `inventory-query.service.ts` deep read** (467 LoC). Reports are presumed correct based on schema + stock service correctness; no regressions found.
- **No `posting-rule.service.ts` deep read**. StockPostingService is unit-tested.
- **No web frontend audit** of `apps/web/src/pages/procurement/*` and `apps/web/src/pages/inventory/*`. UIs built per the Odoo/SAP template (per memory); APIs are clean.
- **No Android procurement UI audit.** Android focus was POS per the branch name.

---

## Files referenced

**Procurement (10 files, 2,293 LoC):**
- `apps/api/src/modules/procurement/procurement.module.ts` (80 LoC — 22 permissions registered)
- `apps/api/src/modules/procurement/purchase-orders.service.ts` (656 LoC, 7 async methods)
- `apps/api/src/modules/procurement/purchase-orders.controller.ts` (95 LoC, 9 endpoints)
- `apps/api/src/modules/procurement/purchase-orders.dto.ts` (227 LoC)
- `apps/api/src/modules/procurement/purchase-requests.service.ts` (187 LoC, 7 async methods)
- `apps/api/src/modules/procurement/purchase-requests.controller.ts` (76 LoC, 7 endpoints)
- `apps/api/src/modules/procurement/goods-receipts.service.ts` (370 LoC, 4 async methods — 3 paths to post a GRN)
- `apps/api/src/modules/procurement/goods-receipts.controller.ts` (84 LoC, 5 endpoints)
- `apps/api/src/modules/procurement/debit-notes.service.ts` (373 LoC, 5 async methods incl. RTV)
- `apps/api/src/modules/procurement/debit-notes.controller.ts` (76 LoC, 5 endpoints)

**Inventory (15 files, 3,049 LoC):**
- `apps/api/src/modules/inventory/inventory.module.ts` (44 LoC)
- `apps/api/src/modules/inventory/inventory.controller.ts` (259 LoC, 32 endpoints — all gated)
- `apps/api/src/modules/inventory/stock.service.ts` (1,097 LoC — the engine, single source of truth)
- `apps/api/src/modules/inventory/stock-doc.service.ts` (457 LoC — 4 document wrappers)
- `apps/api/src/modules/inventory/inventory-query.service.ts` (467 LoC)
- `apps/api/src/modules/inventory/inventory-count.service.ts` (346 LoC)
- `apps/api/src/modules/inventory/inventory-count.controller.ts` (46 LoC, 5 endpoints)
- `apps/api/src/modules/inventory/direct-stock.service.ts` (162 LoC — F1 race)
- `apps/api/src/modules/inventory/stock-reservation.service.ts` (124 LoC)
- `apps/api/src/modules/inventory/stock-reservation.controller.ts` (60 LoC, 5 endpoints)
- `apps/api/src/modules/inventory/location.service.ts` (56 LoC)
- `apps/api/src/modules/inventory/costing/cost-resolver.service.ts` (+spec 128 LoC — passing)
- `apps/api/src/modules/inventory/posting/stock-posting.service.ts` (+spec 83 LoC — passing)
- `apps/api/src/modules/inventory/posting/posting-rule.service.ts` (posting rules engine)
- `apps/api/src/modules/inventory/posting/posting-rule.http.controller.ts` (7 endpoints — all gated)

**Schema (`apps/api/prisma/schema.prisma` — 5,885 lines total, relevant models):**
- `PurchaseRequest` + `PurchaseRequestLine` (line 3805)
- `PurchaseOrder` + `PurchaseOrderLine` + `PurchasePayment` (line 3859)
- `GoodsReceiptNote` + `GoodsReceiptLine` + `VendorBillLink` (line 3964)
- `InventoryLocation` (line 2485) — soft-delete
- `StockItem` (line 2516) — `Decimal(20,6)`, `variantKey` non-null mirror defeats NULL-distinct
- `InventoryBatch` (line 2546) — optional expiry, `isActive` flag
- `StockReservation` (line 2585) — soft reservation, ATP
- `InventoryLedger` (line 2630) — immutable stock ledger
- `InventorySerial` (line 2670) — SPECIFIC costing per serial
- `StockOut` + `StockOutItem` (line 2711)
- `StockAdjustment` + `StockAdjustmentItem` (line 2805)
- `StockTransfer` + `StockTransferItem` (line 2850)
- `InventoryCountSession` + `InventoryCountLine` (line 2923) — partial unique index on draft
- `InventoryException` (line 5141) — durable stock posting failure work-queue
- `StockPostingJob` (line 5113) — durable stock posting queue

---

**Saved:** `workspace/purchases-inventory-audit.md`. Approve Sprint 1 (F1 race is the only ship-blocker; the rest are P1–P2) and I can execute it as a focused 1–2 day commit sequence with the new specs as the regression net.
