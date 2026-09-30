# Purchasing, inventory and stock production-readiness audit

**Date:** 2026-09-30  
**Scope:** Current repository at `C:\Dev\School-Management`; static code, schema, migration and test review. No production database was accessed.  
**Verdict:** **NO-GO** for unsupervised school deployment. Three P0 and six P1 findings remain; live data, tenant, restore and load gates are unverified.

## A. Executive summary

The application has a real NestJS/Prisma stock engine, receipt-to-ledger-to-GL transaction paths, location balances, physical counts, approval infrastructure, RLS migrations and reconciliation reports. Existing integration tests cover partial PO receipt, over-receipt, AVCO, transfer, count and GL examples. These are substantive controls, but they do not close the findings below.

| Severity | Count | Principal risk |
| --- | ---: | --- |
| P0 | 3 | Wrong item can be stocked against an ordered line; a broad permission permits unapproved absolute stock changes; receipt retries can post twice. |
| P1 | 6 | PR approval bypass, negative stock default, unvalidated GRN lines, mutable ledger at DB level, UOM drift, missing deployment proof. |
| P2 | 2 | Reservations do not enforce ATP; draft/adhoc audit and event side effects are outside the stock transaction. |
| P3 | 0 | — |

**Evidence boundary:** `docker ps` could not connect to the local Docker engine. No database mutation, API abuse request, independent balance query, migration rehearsal, large-data benchmark, or restore was performed. The unit selection `cost-resolver|stock-posting|tenancy` passed: 5 suites, 63 tests. This does not establish deployment readiness. The unrelated existing modification to `apps/web/src/pages/school/attendance.tsx` was left untouched.

## B. Architecture assessment

Frontend: React pages under `apps/web/src/pages/{procurement,inventory,purchasing}` call the API feature clients. Backend: NestJS controllers/services under `apps/api/src/modules/{procurement,inventory,accounting}`. Persistence: PostgreSQL via Prisma, `apps/api/prisma/schema.prisma` and `apps/api/prisma/migrations`. `PrismaService.client` adds tenant scoping and sets `app.org_id`; RLS migration `20260731093000_rls_all_org_scoped_tables` enables and forces policies on organization-scoped tables. A separate raw/system client exists. Production startup checks the application role posture, but deployed role, policies and cross-school behavior were not observed in this audit.

```text
PurchaseRequest (create → submit → approve)
  → PurchaseOrder (create → optional approval → active)
  → GoodsReceiptNote (PO receive, draft/post, or ad-hoc)
  → StockService.receiveForDocument
  → InventoryLedger + StockItem + optional InventoryBatch/Serial
  → StockPostingService (inventory/GRNI/AP and payment entries)
  → InventoryQueryService / accounting valuation and reconciliation reports

StockOut / Waste / Adjustment / Transfer / Count
  → StockDocService / InventoryCountService
  → StockService issue / adjust / transfer
  → ledger + quant + GL
```

The `StockItem` unique key is `(organizationId, productId, variantKey, locationId)`; the ledger stores signed quantity, cost, reference and actor. PO receipt uses line/PO version checks inside a transaction. Transfer uses a conditional decrement. Count submission creates and posts its adjustment in one transaction and checks post-count movement. These controls are **partial** until the database and HTTP paths are exercised.

## C. Feature audit matrix

`PASS` means supported by inspected implementation and targeted automated evidence, not a production signoff. `PARTIAL` means a material gap or an unverified operational property. `MISSING` means no corresponding workflow was identified in the inspected surface.

| ID | Feature | Status | Severity | Evidence | Blocker |
| --- | --- | --- | --- | --- | --- |
| F01 | Item master, costing, purchase UOM | PARTIAL | P1 | `schema.prisma` Product; receipt reads current `purchaseUomId` | Yes |
| F02 | Multi-location stock and transfer | PARTIAL | P1 | `stock.service.ts:1038-1085`; integration transfer cases | Gate |
| F03 | Signed stock ledger and reconciliation endpoint | PARTIAL | P1 | `schema.prisma:3426-3461`; `inventory-query.service.ts:507-547` | Yes |
| F04 | Purchase request lifecycle and approval | PARTIAL | P1 | `purchase-requests.service.ts:97-178`; PO create | Yes |
| F05 | PO calculation, partial receipt, over-receipt | PARTIAL | P0 | `purchase-orders.service.ts:253-330,395-515`; `procurement-flow.spec.ts:212-271` | Yes |
| F06 | Goods receipt posting and damaged/rejected quantity | PARTIAL | P1 | `goods-receipts.service.ts:188-363`; no rejected/damaged quantity on GRN line | Yes |
| F07 | Direct stock in/out, adjustment | FAIL | P0 | `inventory.controller.ts:76-128`; `stock.service.ts:938-1025` | Yes |
| F08 | Count/recount/variance adjustment | PARTIAL | P1 | `inventory-count.service.ts:333-444`; DB execution unavailable | Gate |
| F09 | Waste/loss/expiry and return-to-vendor | PARTIAL | P2 | `stock-doc.service.ts`; `debit-notes.service.ts` | Gate |
| F10 | Reservations/available-to-promise | FAIL | P2 | `stock-reservation.service.ts:39-93` | No |
| F11 | Weighted-average/FIFO valuation and GL | PARTIAL | P1 | `stock.service.ts`; `cost-resolver.service.spec.ts`; no live tie-out | Gate |
| F12 | Supplier history/payment | PARTIAL | P1 | Partner, PO, PurchasePayment models; no live AP tie-out | Gate |
| F13 | Three-way match | PARTIAL | P1 | VendorBillLink model exists; discrepancy scenario unverified | Gate |
| F14 | Closed-period stock posting | PARTIAL | P1 | Posting/period services; no direct closed-period rehearsal | Gate |
| F15 | Procurement idempotency | FAIL | P0 | Procurement controllers have no `@Idempotent` interceptor | Yes |
| F16 | RLS and cross-school API isolation | PARTIAL | P1 | RLS migration and tenancy extension; no two-school probe | Gate |
| F17 | RBAC/segregation of duties | FAIL | P0 | Raw stock route shares `inventory:move` | Yes |
| F18 | Dashboard/reports/reconciliation | PARTIAL | P1 | Reconciliation query exists; no raw-data comparison | Gate |
| F19 | Backup/restore | PARTIAL | P1 | `docs/operations/backup-and-restore.md`; no restore in this run | Gate |
| F20 | Performance at requested volumes | PARTIAL | P1 | No 10k/100k/20k workload executed | Gate |
| F21 | Real-school 500-book scenario | PARTIAL | P1 | Component tests exist; complete scenario not executed | Gate |

## D–Q. Findings by purchasing, inventory, finance, security and operations

### P0-01 — PO line identity does not bind the stocked product

**Module/status:** Purchasing and goods receiving; FAIL. **API:** `POST /procurement/purchase-orders/:id/receive`, `PATCH /procurement/goods-receipts/:id/post`. **Models:** PurchaseOrderLine, GoodsReceiptLine, InventoryLedger, StockItem. **Evidence:** `purchase-orders.service.ts:275-285` accepts an explicit line ID if it belongs to the PO; `:395-403` retains the separately supplied product ID; `:484-509` stocks that product. `goods-receipts.service.ts:293-335` has the same posting shape. No inspected test submits conflicting line/product IDs.

**Current behavior:** A payload can name ordered line A and product B. The PO received quantity for A advances while B is stocked and valued. An unmatched product line can also be stocked because unmatched lines are ignored by `applyReceiptToPO` (`purchase-orders.service.ts:249-251,291-295`) but processed by the stock loop. **Expected:** Every PO-linked stocked line must bind to exactly one PO line and match its product, UOM and allowed quantity; unplanned goods need a separately authorized discrepancy workflow. **Root cause:** Independent client-controlled identifiers are not cross-validated. **Impact:** False stock, false PO completion, AP and valuation misstatement; an authorized receiver can manipulate inventory. **Fix:** Validate resolved PO line/product/UOM in the transaction, reject unmatched lines, and use persisted PO line identity for posting. **Regression:** Direct API tests for mismatched ID/product, unknown product and unmatched line; assert zero GRN, stock, ledger and GL effects. **Deployment blocker:** YES.

### P0-02 — Raw absolute adjustment bypasses approval and reason controls

**Module/status:** Inventory/RBAC; FAIL. **API:** `POST /inventory/stock/adjust`. **Evidence:** `inventory.controller.ts:89-100` grants the route to `inventory:move`; `dto/stock.dto.ts:206-225` allows optional notes and no reason; `stock.service.ts:938-1025` sets `StockItem.quantity` to client-supplied `countedQuantity` and immediately posts ledger and GL. The separate document path in `stock-doc.service.ts:305-350` has an approval gate, but this route avoids it.

**Current behavior:** Any principal with `inventory:move` can set stock to an arbitrary nonnegative number without a second approver or mandatory reason. **Expected:** Sensitive adjustment rights and approval, variance, reason and evidence controls; restrict direct engine routes to trusted internal callers or a distinct privileged permission. **Root cause:** The low-level engine method is exposed as a public business endpoint. **Impact:** Concealed loss or fictitious stock with corresponding valuation/GL change and weak attribution. **Fix:** Remove or restrict raw adjust/receive/issue/transfer endpoints; route human operations through document workflows and enforce separation of requester/approver. **Regression:** Role/API matrix, self-approval denial and ledger/GL no-effect assertion. **Deployment blocker:** YES.

### P0-03 — Procurement posting has no retry idempotency

**Module/status:** Procurement/concurrency; FAIL. **APIs:** PO receive/pay, GRN ad-hoc/create/post. **Evidence:** `inventory.controller.ts:26,75-128` explicitly installs `IdempotencyInterceptor` and `@Idempotent`; the procurement controllers do neither. `goods-receipts.service.ts:47-173` generates a new receipt number and immediately posts ad-hoc stock; `purchase-orders.service.ts:407-415` generates a new GRN for each receive. Ordered-quantity guards limit total PO receipts, but a retry of a partial receipt can still consume more of the order. Ad-hoc receipts have no PO cap.

**Current behavior:** A browser retry/double click with the same business payload creates another document and stock/GL effect. **Expected:** One logical receipt/payment per client request, with a persisted key and replayed result. **Root cause:** No idempotency contract at procurement mutation routes. **Impact:** Duplicate stock, AP, cash/bank and supplier history. **Fix:** Apply the existing idempotency infrastructure to every posting mutation, require a client key for receipt/payment, and add a unique business document reference where available. **Regression:** Same-key sequential and concurrent requests, timeout/retry, different-body/same-key rejection; assert one GRN, movement and JE. **Deployment blocker:** YES.

### P1-04 — Linking a PO to a PR does not enforce approved conversion

**Evidence:** `purchase-orders.service.ts:45-159` copies `dto.requestId` into the PO without loading the request or validating status/lines. `purchase-requests.service.ts:163-178` has conversion helpers, but no caller was found in the procurement module. **Current behavior:** A PO can reference a draft/rejected PR, and multiple POs can cite the same PR without an allocation guard. **Impact:** Approval bypass and duplicate ordering. **Fix:** Under one transaction lock the PR, require approved state, validate tenant and requested quantities, allocate ordered quantity, and change state using a conditional update. **Regression:** draft/rejected/cross-school/concurrent double-conversion tests. **Blocker:** YES when PR approval is required by policy.

### P1-05 — Negative stock is the default for general issue

**Evidence:** `setting-registry.ts:64-75` defaults `inventory.allowNegativeStock` to true; `stock.service.ts:519-577` skips its availability guard under that setting; `:819-843` decrements AVCO/standard stock unconditionally. Integration test `inventory-engine.spec.ts:207-249` explicitly expects negative stock. **Current behavior:** A stock issue can take 11 from 10. **Impact:** Unreliable availability and interim valuation/COGS exposure; contradicts the school workflow requirement. **Fix:** Use a school-specific default of false with a documented exception for POS if needed; enforce an atomic nonnegative decrement for protected items/locations. **Regression:** simultaneous 7+6 from 10, direct issue, document issue, count and report behavior. **Blocker:** YES until school policy is set and tested.

### P1-06 — GRN draft accepts unchecked lines and silently skips unknown products

**Evidence:** `goods-receipts.controller.ts:13-77` accepts a plain body type without validation decorators; `goods-receipts.service.ts:188-228` writes quantity/cost and optional PO IDs without positivity or relationship checks; `:312-317` skips product rows it cannot find. `applyReceiptToPO` aggregates any numeric quantity (`purchase-orders.service.ts:288-314`). **Current behavior:** A malformed or negative nonstock line can become a posted receipt or alter PO received quantity while stocking nothing; an unknown product row is skipped rather than failing the whole receipt. **Impact:** PO/GRN/stock disagreement and incomplete receipt audit. **Fix:** DTO validation plus in-transaction checks for positive quantity, nonnegative cost, valid tenant-owned product/location/supplier and exact PO line binding; reject rather than skip. **Regression:** negative/zero/unknown/cross-school line and rollback tests. **Blocker:** YES.

### P1-07 — Ledger immutability is an application convention

**Evidence:** `schema.prisma:3426-3461` defines InventoryLedger and indexes; migrations create FK/index/RLS but no inspected `BEFORE UPDATE OR DELETE` rejection or restricted ledger write role. The integration setup itself calls `inventoryLedger.deleteMany` (`inventory-engine.spec.ts:140`). **Current behavior:** The database permits privileged application or SQL code to alter/delete past stock movements. **Impact:** Historical balance can be rewritten without a compensating reversal. **Fix:** Add a DB trigger or privileges that forbid update/delete under the runtime role, define controlled reversal entries, and separate test cleanup privileges. **Regression:** SQL attempt to update/delete as app role must fail; reversal must reconcile. **Blocker:** YES for auditable production stock.

### P1-08 — Receipt UOM uses mutable product master data

**Evidence:** PO line stores `unitOfMeasureId` (`schema.prisma:4843-4870`), GRN line does not (`:4900-4918`); both PO receive (`purchase-orders.service.ts:492-509`) and GRN post (`goods-receipts.service.ts:319-335`) pass the product's *current* `purchaseUomId` to stock conversion. **Current behavior:** Changing a product's purchase UOM between PO/draft receipt and posting can change the base quantity created from the same document quantity. **Impact:** Wrong stock and valuation after a master-data edit. **Fix:** Snapshot line UOM and conversion factor at order/receipt creation; post using that snapshot, with migration/backfill policy for existing drafts. **Regression:** 10 boxes at 12 packets then change master UOM, post and assert 120 packets and unchanged historic costs. **Blocker:** YES.

### P1-09 — Production evidence gate not yet demonstrated

**Evidence:** Local Docker engine was unavailable; no DB/API/recovery/load execution was possible. Existing `procurement-flow.spec.ts` and `inventory-engine.spec.ts` cover selected paths but not the full 500-book scenario, two-school IDOR, 3-way mismatch, duplicate ad-hoc receipt, migration on an existing dataset or 100,000 movements. **Impact:** A passing build and targeted unit tests cannot prove live balances, RLS, backup or timing. **Fix:** Execute the release gate below in an isolated staging environment configured like production and retain machine-readable results. **Blocker:** YES as a release gate; not a claim that these mechanisms fail.

### P2-10 — Reservation does not enforce available-to-promise

**Evidence:** `stock-reservation.service.ts:44-93` locks the stock row, then creates/updates a reservation without comparing requested quantity with on-hand minus active reservations. **Current behavior:** Reservation totals can exceed on-hand even without a race. **Impact:** Promised supplies may not exist. **Fix:** Calculate ATP inside the lock and reject/override with a distinct permission; define semantics when the stock row does not yet exist. **Regression:** reserve 7 then 6 against 10 and concurrent equivalent. **Blocker:** NO if reservation feature is disabled for launch.

### P2-11 — Some audit/event side effects are outside posting transactions

**Evidence:** `goods-receipts.service.ts:160-170,204-240,366-376` records audit after ad-hoc/post commits and after draft creation; events are published after the transaction. **Current behavior:** An audit failure can leave a committed receipt without its receipt-level audit row, and a crash can omit the event. Stock engine audit is often inside the transaction, so this is a traceability gap rather than proof that stock itself partially posts. **Fix:** Record receipt audit in the same transaction and use the durable outbox for notifications. **Regression:** inject audit/event failure and assert committed state plus traceability contract. **Blocker:** NO if stock-ledger audit remains complete; prioritize before mature operations.

## R. Missing or unproved school workflow capabilities

The inspected GRN model has `quantity` but no explicit accepted, rejected or damaged quantities. A delivery of 300 books with 10 damaged therefore cannot be represented as one verified 290-good/10-damaged receipt without a separate workflow. No complete linkage was established for issue return limits, partial transfer acceptance, supplier invoice 3-way discrepancy handling, location-level user permissions, attachments/evidence for loss, or historical UOM snapshots. These require implementation or a documented operational workflow and acceptance test before being marked PASS. Existing debit-note, waste, count and accounting services should be reused where they cover the requirement.

## S. Production blockers

P0-01, P0-02 and P0-03 are unconditional blockers. P1-04 through P1-08 block the requested purchasing/inventory scope. P1-09 is the deployment proof gate. A launch with stock features disabled would require a separately scoped decision; this report does not approve the active purchasing/inventory scope.

## T. Remediation plan and acceptance criteria

1. **P0: Bind PO/GRN lines to a persisted ordered item.** Change `purchase-orders.service.ts`, `goods-receipts.service.ts`, receipt DTOs and tests; add a DB constraint/reference design where practical. Acceptance: no conflicting/unmatched line posts stock, PO or GL.
2. **P0: Close direct stock bypass.** Change `inventory.controller.ts`, permission catalog, stock document API/UI; route adjustments through approved documents with reason and actor separation. Acceptance: `inventory:move` alone cannot set an absolute balance.
3. **P0: Make procurement posting idempotent.** Add interceptor/decorators or a document-key table to procurement controllers, update frontend clients, and run retry/concurrency tests. Acceptance: one key yields one receipt/payment and one GL effect.
4. **P1: Enforce PR conversion and validate GRN inputs.** Add transaction-state checks and DTO validation; test failed conversion and malformed lines. Acceptance: no unauthorized PO linkage or inconsistent GRN/PO quantities.
5. **P1: Set and prove school negative-stock policy.** Configure default and atomic guard, migrate existing settings deliberately, test two concurrent issues. Acceptance: protected location cannot go below zero.
6. **P1: Snapshot receipt UOM and protect the ledger.** Add GRN UOM/conversion columns and migration/backfill; add ledger update/delete guard for app role. Acceptance: UOM edit does not alter historic quantity, SQL mutation fails, reversal remains append-only.
7. **P1 gate: rehearse the complete school scenario and operations.** In staging, run two-school API matrix, DB ledger/quant/report/GL SQL reconciliation, 500-book scenario (300 received, 10 damaged, 100 issued, 20 transferred, 5 returned, 3 missing), closed-period tests, clean/existing-data migrations, an actual restore and large-data timing. Record all source rows and expected balances by location. Acceptance: every equality and denied request is demonstrated, no unexplained difference, restore recovers attachments and accounting, and measured latencies meet an agreed school SLA.
8. **P2: Enforce ATP and transactional audit/outbox.** Update reservation and receipt services, tests and reporting. Acceptance: reservations never exceed configured ATP; audit/event failure behavior is deterministic.

## U. Final deployment gate

**NO-GO.** Reassess only after P0/P1 fixes, affected integration/API/concurrency tests and the staging proof gate pass. This audit does not claim a current database mismatch or cross-tenant leak; neither could be measured here.
