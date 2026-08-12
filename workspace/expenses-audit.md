# Expenses — Production-Readiness Audit

**Scope:** Standalone expense tracker (petty cash + operating expenses), separate from vendor bills / AP. Expense categories, expense lifecycle (create → approve → pay → void), ExpensePayment, GL posting on pay, audit log query.
**Method:** Static read of source + spec coverage + `tsc -p tsconfig.build.json --noEmit` clean.
**Branch:** `feat/android-pos-parity` @ `338b172`. Surface: **1,074 LoC** across 2 controllers + 2 services + 1 module + 1 DTO file.

---

## Executive Summary

**Verdict: NOT READY FOR PRODUCTION — 38/100**

This is the **weakest module I've audited in this codebase.** Compared to the POS (84), Purchases/Inventory (71), and Accounting (82) audits, the expense surface is a single sprint behind the rest of the system — the engineering isn't here.

**The single biggest problem: zero authorization.** Both controllers ship with **ZERO `@RequirePermissions` decorators** and the module doesn't call `registry.register()`, so the permission keys (`expense:create`, `expense:approve`, etc.) aren't even defined in `@erp/shared`. **Any authenticated user — cashier, waiter, unauthenticated guest** — can create an expense, approve it, pay it, void it, and dump the entire expense history as JSON. This is the textbook RBAC P0.

Other critical issues:
- **Pay allows `DRAFT` status** (line 419) — bypasses the approve gate for credit expenses. A user creates + pays a $50,000 DRAFT expense in one shot, no manager involved.
- **No maker-checker on approve** — `dto.approvedBy` is unchecked (line 384). The expense creator can approve their own expense.
- **`stats()` is unbounded** — `findMany({ where })` then iterates in JS (line 127). With a few thousand expenses, OOM.
- **Silent GL skip** — `recordPayment` (line 521-537) skips posting if `debitAccountId` or `creditAccount` is missing. The payment persists with `journalEntryId = NULL`. The docstring at line 56-58 acknowledges this as "best-effort".
- **Zero unit tests** — no `*.spec.ts` file exists in the entire `expenses/` directory.

### Inherited system-wide gaps (carry-over)

- **RolesGuard permissive-by-default** at the kernel layer. Because the expense module ships zero `@RequirePermissions` decorators AND has no registered permissions in `@erp/shared`, the kernel's default behavior (allow on no-decorator) is fully exposed — any authenticated user has full read/write/destroy access.
- **Single-tenant** data model.
- **Throttler not installed.**

### Lowest-scoring dimension caps the verdict

| Dimension | Score | Rationale |
|---|---|---|
| **RBAC & Security** | **0/10** | Zero `@RequirePermissions` on either controller; permission keys not registered; module not registered |
| **Test surface** | **0/10** | Zero `*.spec.ts` files |
| **Workflow controls** | 4/10 | Pay allows DRAFT; no maker-checker on approve; void reverses without strong status guard |
| **Audit trail** | 7/10 | `audit.recordInTx` on every mutation; `getAudit()` reads back nicely |
| **Transaction integrity** | 7/10 | All mutations inside `$transaction`; GL posting composable via `tx` |
| **GL posting** | 6/10 | Correct lines (Dr expense / Cr cash-bank), correct journal routing, but silent skip on missing mappings |
| **Domain correctness** | 7/10 | Decimal precision, lifecycle states, but PATCH-as-reschedule gap (update allowed on APPROVED) |
| **Operational readiness** | 3/10 | No throttler, unbounded stats, no idempotency interceptor, no paidById validation |

**Overall: 38/100 → NOT READY FOR PRODUCTION.** 4 P0s + 5 P1s + 6 P2s. A focused 3-day security sprint + a 2-day test sprint + a 2-day workflow-hardening sprint gets you to 75+. Accounting-engine-quality is achievable within a week.

---

## Audit dimensions

### 1. RBAC & Security (0/10) — 🔴 BLOCKER

| Controller | Endpoints | `@RequirePermissions` | Gaps |
|---|---|---|---|
| `ExpensesController` | 14 | **0** | **🔴 ALL 14 UNGATED** |
| `ExpenseCategoriesController` | 5 | **0** | **🔴 ALL 5 UNGATED** |

**Zero decorators across 19 endpoints.** Concretely, without auth (or with any authenticated user's token):

| Endpoint | Effect |
|---|---|
| `POST /expenses` | Create an expense (POSTED if cash, APPROVED if credit) |
| `POST /expenses/:id/approve` | Approve any DRAFT expense |
| `POST /expenses/:id/pay` | Pay any expense — bypasses DRAFT guard partially |
| `POST /expenses/:id/void` | Void any expense, reverse its GL JEs |
| `DELETE /expenses/:id` | Soft-delete (only when UNPAID, but still — destruction) |
| `GET /expenses` | List all expenses for the tenant |
| `GET /expenses/:id/audit` | Read the audit trail (includes actorId + reasons) |
| `POST /expense-categories` | Create new categories (could attach a privileged ledger account) |
| `PATCH /expense-categories/:id` | Update category ledgerAccountId (could redirect GL posting) |
| `DELETE /expense-categories/:id` | Soft-delete category |

Compounding the problem: **`ExpensesModule` does not call `registry.register()`**, so the permission keys (`expense:create`, `expense:read`, `expense:approve`, `expense:pay`, `expense:void`, `expense:delete`, `expense:export`, `expense_category:create/read/update/delete`) don't exist in `@erp/shared`. Adding `@RequirePermissions('expense:create')` would 403 every caller until the permissions are registered.

This is **F1 P0**.

### 2. Workflow controls (4/10)

| Concern | Verdict |
|---|---|
| `create()` for CASH auto-approves + posts in the same call | 🟡 P2 — by design for petty cash (line 304: `status: isCash ? 'POSTED' : 'APPROVED'`) but undocumented |
| `pay()` allows `DRAFT` status | 🟠 **P0 (F2)** — line 419 `if (!['APPROVED', 'POSTED', 'DRAFT'].includes(exp.status))`. A user creates a $50k credit DRAFT expense and pays it without approval. |
| `approve()` has no maker-checker | 🟠 **P0 (F3)** — line 384 `approvedById: dto.approvedBy`. The creator can pass their own userId as `approvedBy`. No check that `exp.createdById !== dto.approvedBy`. |
| `update()` allows APPROVED status (line 352) | 🟡 P2 — approved-but-unpaid expenses can be edited. After pay, edits are blocked (good). |
| `void()` reverses every posted payment JE | ✅ Acceptable — line 452 guards status, line 456 reverses in same TX |
| `remove()` is soft-delete only | ✅ Acceptable — guarded by status check at line 491 |
| `recordPayment()` always pays full residual | 🟡 P2 — no support for partial payment (the schema has `amountPaid` and `paymentStatus = 'PARTIALLY_PAID'`, but the service never sets PARTIALLY_PAID — line 558 only sets PAID) |
| `ExpensePayment.status` raw string `'posted' | 'void'` | 🟡 P2 — should be enum for consistency with other modules |

### 3. GL posting (6/10)

| What I checked | Verdict |
|---|---|
| `recordPayment()` posts Dr expense / Cr cash-bank | ✅ Correct accounting (line 530-531) |
| `journalForMethod()` routes to CASH / BANK / GEN by payment method | ✅ Correct (line 33-45) |
| `posting.post()` called inside the same TX as the payment | ✅ Atomic |
| `posting.reverse()` on void | ✅ Same TX as the void (line 458-462) |
| GL is best-effort: skips if `debitAccountId` or `creditAccount` is null | 🟡 **P0 (F4)** — silent skip. `if (debitAccountId && creditAccount)` at line 521. `journalEntryId` is null when this fires. |
| `resolveExpenseAccountId()` falls back to "first expense account" | 🟡 P2 — line 587-591. If category's `ledgerAccountId` points to a now-inactive account, the service falls back to the alphabetically first expense account. Could be the wrong account. Should fail loudly. |
| Period control applied? | 🟡 P3 — `recordPayment()` calls `this.posting.post({ date: new Date() })` without resolving `occurredAt` for offline replay. The expense's own `expenseDate` is not threaded into the GL post. |

### 4. Transaction integrity (7/10)

| Mutation | Guard | TX |
|---|---|---|
| `create()` | Status auto-set by payment type | ✅ Inside `$transaction` |
| `update()` | Status guard (`DRAFT` or `APPROVED` + `UNPAID`) | ✅ Inside `$transaction` |
| `approve()` | Status guard (`DRAFT` only) | ✅ Inside `$transaction` |
| `reject()` | Status guard (`DRAFT` only) | ✅ Inside `$transaction` |
| `pay()` | Status guard (allows DRAFT — F2) | ✅ Inside `$transaction` |
| `void()` | Status guard (`!['VOID','CANCELLED']`) | ✅ Inside `$transaction` |
| `remove()` | Status guard (`UNPAID` or `VOID`) | ✅ Inside `$transaction` |
| `recordPayment()` | None on TX level; just rejects residual ≤ 0 | ✅ Called inside the parent's TX |
| `expenseCategory.create/update/remove` | None | ❌ **Outside `$transaction`** — F5 |
| `stats()` | Read-only | n/a |
| `list()` | Read-only, paginated (limit ≤ 200) | n/a |

### 5. Audit trail (7/10)

| Where | What |
|---|---|
| `audit.recordInTx` on `create()` | ✅ `entity: 'Expense'`, `action: 'create'`, `newValues` includes expenseCode/title/amount |
| `audit.recordInTx` on `update()` | ✅ `entity: 'Expense'`, `action: 'update'`, `newValues` is the full data diff |
| `audit.recordInTx` on `approve()` | ✅ `entity: 'Expense'`, `action: 'approve'` |
| `audit.recordInTx` on `reject()` | ✅ `entity: 'Expense'`, `action: 'reject'`, `newValues.reason` |
| `audit.recordInTx` on `void()` | ✅ `entity: 'Expense'`, `action: 'cancel'`, `newValues.reason + reversedPayments count` |
| `audit.recordInTx` on `remove()` | ✅ `entity: 'Expense'`, `action: 'delete'` |
| `audit.recordInTx` on `recordPayment()` | ✅ `entity: 'ExpensePayment'`, `action: 'post'`, `newValues.glPosted` |
| `getAudit()` reader | ✅ Returns actor names (joins users), action, entityType, reason |
| `audit.record` on expense categories | ❌ F6 — categories CRUD writes nothing to the audit log |

### 6. Schema (7/10)

| Concern | Verdict |
|---|---|
| `Decimal(20,6)` on `Expense.amount` + `ExpensePayment.amount` + `Expense.amountPaid` | ✅ |
| `categoryName` snapshot on `Expense` | ✅ History-safe if category is renamed/deleted |
| `journalEntryId` nullable on `ExpensePayment` | 🟡 Acknowledged as "best-effort" but no alert path |
| `deletedAt` soft-delete on `Expense` + `ExpenseCategory` | ✅ |
| `onDelete: Cascade` on `ExpensePayment.expense` | ✅ Safe |
| `ExpenseStatus` + `ExpensePaymentStatus` + `ExpensePaymentType` enums | ✅ |
| `ExpensePayment.status` raw string (`'posted' | 'void'`) | 🟡 Should be enum for consistency |
| `Expense.approvedById` and `Expense.paidById` not enforced FKs | 🟡 Plain strings; no referential integrity |
| `Expense.expenseDate` indexed | ✅ |
| `ExpensePayment.expenseId` indexed | ✅ |

### 7. Test surface (0/10) — 🔴 BLOCKER

```
$ jest src/modules/expenses
No tests found, exiting with code 1
```

**Zero `*.spec.ts` files exist in the entire `expenses/` directory.** Compared to:
- accounting: 4 spec files, 306 LoC, 24 tests
- inventory: 2 spec files, 211 LoC, 13 tests
- procurement: 0 spec files (worse)

### 8. Operational readiness (3/10)

| Concern | Status |
|---|---|
| Throttler | ❌ No `@nestjs/throttler` |
| Idempotency interceptor | ❌ No `@UseInterceptors(IdempotencyInterceptor)` — a double-click on "Pay" creates two ExpensePayment rows |
| **`stats()` unbounded** | ❌ F7 — `findMany({ where })` then iterates in JS. With thousands of expenses, OOM. |
| `list()` bounded | ✅ `limit ≤ 200` (line 74) |
| `paymentAccounts()` unbounded in account list | 🟡 Returns ALL cash/bank/asset accounts — no pagination (acceptable since typically <50) |
| Categorical permission check | ❌ F1 — no permission keys exist |
| Health endpoints | ✅ Kernel |

---

## Findings table (sorted by severity)

| ID | Severity | Location | Description | Fix |
|---|---|---|---|---|
| **F1** | 🟠 **P0** | `apps/api/src/modules/expenses/expenses.controller.ts` + `expense-categories.controller.ts` + `expenses.module.ts` | **ZERO `@RequirePermissions` decorators across 19 endpoints.** Module doesn't call `registry.register()`, so permission keys don't exist in `@erp/shared`. Any authenticated user has full CRUD access. | (a) Add permission keys `expense:create/read/update/delete/approve/pay/void/export` and `expense_category:create/read/update/delete` to `packages/shared/src/permissions.ts`. (b) Call `registry.register({ name: 'expenses', permissions: [...] })` in `ExpensesModule.onModuleInit()`. (c) Decorate every controller endpoint with `@RequirePermissions(...)`. |
| **F2** | 🟠 **P0** | `apps/api/src/modules/expenses/expenses.service.ts:419` | **`pay()` allows `DRAFT` status.** Line 419: `if (!['APPROVED', 'POSTED', 'DRAFT'].includes(exp.status))`. A user can create a credit DRAFT expense and immediately pay it — no manager approval. | Remove `'DRAFT'` from the allowed list. Should be only `'APPROVED'` (and possibly `'POSTED'` for re-payment of partially paid). |
| **F3** | 🟠 **P0** | `apps/api/src/modules/expenses/expenses.service.ts:377-393` | **No maker-checker on approve.** `dto.approvedBy` is unchecked. The expense creator can pass their own userId as approver. | Add: `if (exp.createdById && exp.createdById === dto.approvedBy) throw new ForbiddenException('The creator cannot approve their own expense')`. Mirror the GL manual-JE maker-checker pattern (line 408 of `posting.service.ts`). |
| **F4** | 🟠 **P0** | `apps/api/src/modules/expenses/expenses.service.ts:520-537` | **Silent GL skip.** When `debitAccountId` or `creditAccount` is null, the payment is persisted with `journalEntryId = NULL`. The expense is marked PAID in the books-of-record but the GL never sees the entry. | (a) Throw if both mappings resolve to null — fail loudly. (b) If a "best-effort" mode is required, write a `system_alert` audit row + emit an event so monitoring can surface it. |
| **F5** | 🟡 **P1** | `apps/api/src/modules/expenses/expense-categories.service.ts:48-88` | **Categories CRUD is outside `$transaction`.** A failed update mid-way (e.g. ledgerAccountId FK check fails) leaves partial state. | Wrap each method in `$transaction`. |
| **F6** | 🟡 **P1** | `apps/api/src/modules/expenses/expense-categories.service.ts` | **No audit log writes for category CRUD.** Categories have `createdBy` and `updatedBy` columns but no `audit.record` calls. | Add `audit.recordInTx` calls on create/update/remove. |
| **F7** | 🟡 **P1** | `apps/api/src/modules/expenses/expenses.service.ts:127-205` | **`stats()` is unbounded.** `findMany({ where })` then iterates ALL rows in JS to compute aggregates. With a few thousand expenses, this loads everything into memory + OOMs the response. | Move aggregations to SQL: `prisma.expense.groupBy({ by: ['paymentStatus', 'categoryId', 'supplierId'], _sum: { amount: true, amountPaid: true }, _count: { id: true } })`. Mirror the reporting pattern in `accounting/reporting/pnl-report.service.ts`. |
| **F8** | 🟡 **P1** | `apps/api/src/modules/expenses/expenses.service.ts:415-446` | **No idempotency interceptor on `pay()`.** A double-click creates two `ExpensePayment` rows, overpays the expense, and posts the GL twice. Mirror the POS pattern: `@UseInterceptors(IdempotencyInterceptor)` + `@Idempotent()` at the controller, plus an Idempotency-Key header. | Add Idempotency interceptor at the controller class level. |
| **F9** | 🟡 **P1** | (entire expenses module) | **Zero unit tests** for the entire 653-LoC service. The expense module handles money — this is the highest-risk untested surface in the codebase. | Write 5+ spec files: `expenses.service.spec.ts` (create/approve/pay/void happy + edge paths), `expenses.pay-bypass.spec.ts` (F2 regression), `expenses.approve-makere-checker.spec.ts` (F3 regression), `expense-categories.service.spec.ts`, `expenses.recordPayment.spec.ts` (GL posting paths). |
| **F10** | 🟢 **P2** | `apps/api/src/modules/expenses/expenses.service.ts:415` | **`pay()` allows `DRAFT` (F2) but `approve()` requires `DRAFT`.** After F2 fix, a DRAFT expense can't be paid without approve — but `pay()` doesn't enforce a re-check on the latest status under `$transaction`. Concurrent pay + approve could pass both gates and double-post. | Re-read the expense status inside the TX (line 417 currently reads before the TX body). |
| **F11** | 🟢 **P2** | `apps/api/src/modules/expenses/expenses.service.ts:506-577` | **`recordPayment()` only supports full-payment.** Schema has `ExpensePaymentStatus = 'PARTIALLY_PAID'` but the service never sets it. A user paying half the residual gets `PAID` status with `amountPaid = residual`. | Accept a `partialAmount` field in `PayExpenseDto`; partial payments update `amountPaid += amount` and set `PARTIALLY_PAID`. |
| **F12** | 🟢 **P2** | `apps/api/src/modules/expenses/expenses.service.ts:580-592` | **`resolveExpenseAccountId()` fallback is "first expense account alphabetically"** when category's `ledgerAccountId` is invalid. Could post to a wrong expense account silently. | Throw `BadRequestException` if the resolved account doesn't match expected category; require the category to be updated first. |
| **F13** | 🟢 **P2** | `apps/api/src/modules/expenses/expenses.service.ts` | **No throttler** on any endpoint (carry-over). | Add `@UseInterceptors(ThrottlerGuard)` at the controller class level. |
| **F14** | 🟢 **P2** | `apps/api/src/modules/expenses/expense-categories.service.ts:75` | `updateMany` instead of `update` — bypasses Prisma's unique constraint check. Could write partial data if category doesn't exist. | Use `tx.expenseCategory.update({ where: { id }, data })` with proper error handling. |
| **F15** | 🟢 **P2** | `apps/api/src/modules/expenses/expenses.service.ts:348-375` | **`update()` allows editing of `APPROVED` status expenses** — line 352 `if (!['DRAFT', 'APPROVED'].includes(exp.status)`. But the approval gate has already passed; editing amount/category after approval is a control gap. | Lock edits to `DRAFT` only; require a new approval if `APPROVED` needs modification. |
| **F16** | 🟢 **P3** | `apps/api/src/modules/expenses/expenses.service.ts` | `recordPayment()` uses `new Date()` for the GL date instead of `expense.expenseDate` (or the offline-first `occurredAt`). A back-dated expense posts at today's GL date. | Thread `expense.expenseDate` into the `posting.post({ date })` call. |
| **F17** | 🟢 **P3** | `apps/api/prisma/schema.prisma:5058` | `ExpensePayment.status` is raw `String` instead of enum. Inconsistent with `ExpenseStatus` / `ExpensePaymentStatus` / `ExpensePaymentType` enums. | Add `enum ExpensePaymentStatus { posted void }` and migrate. |
| **F18** | 🟢 **P3** | `apps/api/src/modules/expenses/expense-categories.controller.ts:23-31` | `remove()` doesn't validate that no expenses reference the category. The category is soft-deleted but expenses keep working (via `categoryName` snapshot). Acceptable by design, but a warning event would help. | Emit `expense_category.deactivated` event with the count of referencing expenses. |

---

## Final verdict (your 8 closing questions)

### 1. Can a bookkeeper record an expense end-to-end?
**Yes** — when F1 is fixed (RBAC). Create → approve → pay → (auto) GL post, all in `$transaction`. Void reverses the JE in one TX.

### 2. Can an expense be paid?
**Yes** — but currently **bypasses approval** (F2). A user can create a $50k DRAFT credit expense and immediately pay it without manager review. The default-status guard accepts `DRAFT`.

### 3. Can the approver be the creator?
**Yes** — and that's the bug (F3). `approve()` accepts `dto.approvedBy` unchecked. The creator passes their own userId. **No maker-checker enforcement**, unlike the GL manual-JE flow.

### 4. Does it integrate with the GL?
**Yes, with silent failure modes.** `recordPayment()` posts Dr expense / Cr cash-bank via the shared `PostingService`, inside the same `$transaction`. Correct journal routing by payment method. **BUT** when `debitAccountId` or `creditAccount` is null, the GL is silently skipped (F4) — payment persists with `journalEntryId = NULL`. The expense is marked PAID but the books never see it.

### 5. Can a void reverse the GL correctly?
**Yes.** `void()` iterates `ExpensePayment` rows with `status: 'posted'`, calls `posting.reverse()` for each `journalEntryId`, flips the payment to `void`. All in one `$transaction`. Strong.

### 6. Is the audit trail complete?
**Mostly.** Every expense mutation writes `audit.recordInTx` with the entity, action, and new values. `getAudit()` reads back with actor names. **Categories CRUD has no audit** (F6).

### 7. Can concurrent pays cause issues?
**Yes.** No idempotency interceptor on `pay()` (F8) — a double-click creates two `ExpensePayment` rows and posts the GL twice. No optimistic-lock `version` column on `Expense`. `pay()` re-reads the expense OUTSIDE the `$transaction` (line 417), so a concurrent pay + approve could both pass status guards.

### 8. Is it production-ready?
**NOT READY FOR PRODUCTION — 38/100.**
- **Ship-blockers:** F1 (zero RBAC), F2 (pay bypasses approve), F3 (no maker-checker), F4 (silent GL skip)
- **Should-fix-before-public-launch:** F5 (categories outside TX), F6 (categories no audit), F7 (unbounded stats), F8 (no idempotency), F9 (zero tests)
- **Day-2 work:** F10-F18

The architecture is fine. The execution is missing the security + controls layer that the rest of the codebase has.

---

## Recommended path to production

### Sprint 1 — RBAC + critical workflow guards (2 days)

| Commit | Fix | Why |
|---|---|---|
| `fix(expenses): add permission keys to @erp/shared + register module` | F1 part 1 | Unblocks decorators |
| `fix(expenses): require permissions on all 19 endpoints` | F1 part 2 | Closes the RBAC gap |
| `fix(expenses): pay() requires APPROVED status (drop DRAFT bypass)` | F2 | Closes the no-approval pay hole |
| `fix(expenses): approve() enforces maker-checker (approver ≠ creator)` | F3 | Closes the self-approve hole |
| `fix(expenses): recordPayment() throws on missing GL mappings (no silent skip)` | F4 | Closes the silent GL hole |
| `fix(expenses): wrap expense-categories CRUD in $transaction + audit.recordInTx` | F5, F6 | Audit + atomicity for categories |

### Sprint 2 — tests (2 days)

| Commit | Why |
|---|---|
| `test(expenses): create/approve/pay/void happy path` | F9 |
| `test(expenses): pay() rejects DRAFT (F2 regression)` | F9 |
| `test(expenses): approve() rejects self-approval (F3 regression)` | F9 |
| `test(expenses): recordPayment() throws on missing GL mappings (F4 regression)` | F9 |
| `test(expenses): partial-payment path (F11)` | F9 |
| `test(expenses): expense-categories CRUD` | F9 |

### Sprint 3 — operational polish (1–2 days)

| Commit | Fix | Why |
|---|---|---|
| `fix(expenses): stats() via SQL groupBy (mirror reporting pattern)` | F7 | OOM protection |
| `fix(expenses): add Idempotency interceptor to controller class` | F8 | Double-click safety |
| `fix(expenses): re-read status inside pay() TX (F10 regression)` | F10 | Concurrency |
| `fix(expenses): support partial payments` | F11 | Schema supports it; service doesn't |
| `fix(expenses): throw on fallback expense account resolution` | F12 | Fail loudly |
| `chore(expenses): throttler on controller` | F13 | Rate-limit |

---

## What this audit did NOT do

- **No runtime exercise.** Per your `production ready` bar, the live-server smoke (every create/approve/pay/void, every stats query, every category CRUD) is a separate step.
- **No deep read of `recordPayment` callers** — POS refund uses similar patterns; verify the same best-effort skip doesn't propagate.
- **No web frontend audit** of `apps/web/src/pages/expenses/*` and `expense-categories/*`. APIs are the priority gap.
- **No Android audit** — Android focus was POS per branch name.

---

## Files referenced

**Module (6 files, 1,074 LoC):**
- `apps/api/src/modules/expenses/expenses.module.ts` (20 LoC — does NOT call `registry.register()`)
- `apps/api/src/modules/expenses/expenses.controller.ts` (92 LoC, 14 endpoints — ZERO `@RequirePermissions`)
- `apps/api/src/modules/expenses/expenses.service.ts` (653 LoC — 10 public methods)
- `apps/api/src/modules/expenses/expense-categories.controller.ts` (34 LoC, 5 endpoints — ZERO `@RequirePermissions`)
- `apps/api/src/modules/expenses/expense-categories.service.ts` (98 LoC — 4 public methods)
- `apps/api/src/modules/expenses/dto/expense.dto.ts` (177 LoC)

**Schema (`apps/api/prisma/schema.prisma`):**
- `ExpenseStatus` enum (4967) — DRAFT | APPROVED | REJECTED | POSTED | VOID | CANCELLED
- `ExpensePaymentStatus` enum (4976) — UNPAID | PARTIALLY_PAID | PAID
- `ExpensePaymentType` enum (4982) — CASH | CREDIT
- `ExpenseCategory` (4987) — soft-delete, `ledgerAccountId` (plain string, no FK)
- `Expense` (5008) — `Decimal(20,6)`, `categoryName` snapshot, `approvedById` (no FK)
- `ExpensePayment` (5044) — `Decimal(20,6)`, `journalEntryId` nullable, `status` raw string

**Cross-cutting:**
- `packages/shared/src/permissions.ts` — `expense:*` keys do NOT exist yet (must be added)
- `apps/api/src/kernel/module-loader/module-registry.service.ts` — module registration pattern to follow

---

**Saved:** `workspace/expenses-audit.md`. The 4 P0s (F1 RBAC, F2 pay bypass, F3 no maker-checker, F4 silent GL skip) are all narrow, focused fixes. F1 alone (permission keys + register + decorators) is a 2-hour commit. If you want the surface production-fastest, I can execute Sprint 1 in 2 days with focused commits and the new specs as the regression net.
