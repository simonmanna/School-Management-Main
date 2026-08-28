# Fees & Payments — Full Data, Work & Process Flow (Frontend → Backend → DB)

**Purpose:** A troubleshooting map. If a fee/payment feature misbehaves, start at the layer where the symptom appears and walk the arrows backward until you hit the broken link.

**Stack:** `apps/web` (Vite + React + TanStack Query) → `apps/api` (NestJS, port 3001, global prefix `/api/v1`) → PostgreSQL (`schooldb-planet`). Money is UGX, Decimals to 6dp, Prisma.

---

## 0. The 4 layers (memorise this)

| # | Layer | Where | Key files |
|---|---|---|---|
| L1 | **Browser form** | `apps/web/src/pages/school/*.tsx` | `fees.tsx`, `fees-operations.tsx`, `fee-structures.tsx`, `fee-categories.tsx`, `finance-pages.tsx`, `fees-momo.tsx` |
| L2 | **API client (hooks)** | `apps/web/src/features/school/api.ts` | `useCollectPayment`, `useGenerateBilling`, `useMomo...`, etc. |
| L3 | **API controller/service** | `apps/api/src/modules/school/fees/*.ts` | `billing.controller.ts`, `billing.service.ts`, `advanced.service.ts`, `school-finance-query.service.ts` |
| L4 | **Kernel + Accounting + DB** | `apps/api/src/kernel/*`, `apps/api/src/modules/accounting/*`, Prisma `schema.prisma` | `PostingService`, `PaymentService`, `DocumentBuilderService`, `prisma/…/schema.prisma` |

**Request path:** `page.tsx` (form state) → `useX()` hook (TanStack `useMutation`) → `api.post('/school/...')` (axios, `lib/api.ts`, Bearer JWT + org header) → NestJS route guard → Controller → Service → `prisma.client.$transaction(...)` → DB tables; GL via `PostingService.post()`.

**Response path:** DB → Service returns DTO → Controller → JSON → axios → TanStack cache → `onSuccess` invalidates query keys → form re-renders.

---

## 1. Routing map (which URL → which page)

`apps/web/src/App.tsx` (lines ~487-506):

| URL | Page component | What it does |
|---|---|---|
| `/school/fees` | `SchoolFeesPage` (`fees.tsx`) | Tabs: Billing, Scholarships, Penalties, Refund, Sponsors, Credits, Aging, Arrears |
| `/school/fees/categories` | `SchoolFeeCategoriesPage` (`fee-categories.tsx`) | Fee Category CRUD |
| `/school/fees/structures` | `SchoolFeeStructuresPage` (`fee-structures.tsx`) | Fee Structure CRUD + publish |
| `/school/fees/schedules` | `SchoolFeeSchedulesPage` | Fee Schedule CRUD |
| `/school/fees/optional` | `SchoolOptionalFeesPage` | Per-student optional opt-in roster |
| `/school/fees/collect` | `SchoolFeesCollectPage` (`fees-operations.tsx`) | **Single + wizard collection** |
| `/school/fees/bulk-collect` | `SchoolBulkCollectPage` | Reporting-day class batch |
| `/school/fees/waivers` | `SchoolWaiversPage` | Waiver create/approve/apply |
| `/school/fees/waiver-categories` | `SchoolWaiverCategoriesPage` | Waiver templates |
| `/school/fees/defaulters` | `SchoolFeeDefaultersPage` | Defaulter list |
| `/school/fees/bad-debtors` | `SchoolBadDebtorsPage` | >90-day write-off |
| `/school/fees/receipts` | `SchoolReceiptsPage` | Receipt search/reverse |
| `/school/fees/clearance` | `SchoolFeeClearancePage` | Exam-clearance gate |
| `/school/fees/statement` | `SchoolFeeStatementPage` | Per-student term statement |
| `/school/fees/explain` | `SchoolBalanceExplainerPage` | "Why does this pupil owe this?" |
| `/school/fees/mobile-money` | `SchoolMobileMoneyPage` (`fees-momo.tsx`) | MTN/Airtel request + status |
| `/school/fees/cash-book` | `SchoolCashBookPage` | Daily cash custody |
| `/school/fees/budgeting` | `SchoolBudgetingPage` | Budget variance |
| `/school/fees/discounts` | `SchoolDiscountsPage` | Discount master |
| `/school/fees/overrides` | `SchoolFeeOverridesPage` | Per-pupil fee override (D3) |

> **Gotcha (see §7):** `fees.tsx` HIDES the "Discounts" and "Installments" tabs on purpose — those rows are not yet consumed by billing. Don't hunt for a missing tab there; it's at `/school/fees/discounts`.

---

## 2. THE CANONICAL FLOWS

### FLOW A — Billing a term (invoice generation)

**Trigger:** Bursar clicks "Generate" on `/school/fees` → Billing tab → `useGenerateBilling`.

```
[L1] fees.tsx BillingTab
        └─ form: { termId, classId? }
[L2] useGenerateBilling()  →  POST /api/v1/school/billing/generate
[L3] BillingController  @Post('generate')   (school/billing)
        └─ BillingService.generateForTerm(dto)
           1. controls.assertTermOpen(termId)            ← A4.1: throw if TermFinancialClose='closed'
           2. load active students (currentClassId filter)
           3. load FeeSchedules for term → FeeStructure + FeeStructureVersion
           4. BATCH load assignments / scholarships / discounts / optionalFees
           5. for each student:
              pricedComponents(feeStructure)               ← MUST be status='published' AND currentVersionId set
                • if no published version → push {reason:'unpriceable_structure'}, SKIP student (NOT error)
              computeLines(...)                            ← discounts/scholarships/optional gating/proration
              billStudentTransaction(s, schedule, ...)
                └─ $transaction:
                   a. findExisting Document(sourceType='school_fee', reference='TERM-<termId>')
                        • if exists → {_skipped:true} (idempotent, no 2nd invoice)
                   b. documentBuilder.createDocument('sales_invoice', lines)   ← Document + DocumentLine
                   c. groupForPosting → journalLines (Dr AR / Cr Revenue + Tax)
                   d. posting.post({journalCode:'SALES', ...})                  ← GL JournalEntry written
                   e. document.update(status='posted', journalEntryId, paymentStatus='not_paid')
                   f. sequence.next('schoolfeeinvoice:...') → SchoolFeeInvoice.create (1:1 with Document)
                   g. event SchoolFeeInvoicePosted
[L4] Tables written (one $transaction):
        Document (+DocumentLine), JournalEntry(+JournalLine ×N), SchoolFeeInvoice
```

**Key DB tables:** `Document` (financial truth), `DocumentLine`, `JournalEntry`/`JournalLine` (GL), `SchoolFeeInvoice` (1:1 link), `FeeStructure`/`FeeStructureVersion`/`FeeItem`.

**Troubleshooting A:**
- *"Generate returns count 0 / nothing billed."* → Check the FeeStructure has `status='published'` **and** a `currentVersionId` pointing at a `FeeStructureVersion` that has `FeeItem` rows. `pricedComponents` returns null otherwise and the student is silently skipped (reason `unpriceable_structure`). **This is the #1 cause.**
- *"Two invoices for the same pupil."* Should be impossible: unique index `Document_org_partner_source_reference_key` (org, partner, sourceType, sourceId, reference) where reference=`TERM-<termId>`. If you see dupes, the migration `20260824120000_fees_integrity_constraints` is not applied to this DB.
- *"Error: term financially closed."* → `TermFinancialClose` row exists with `status='closed'`. Reopen via `POST /school/finance/terms/:termId/reopen` (maker-checker: reopener ≠ closer).
- *"GL not posted / invoice stuck draft."* → `journalEntryId` on Document stays null. Check `PostingService`/`Journal` seed (`SALES` journal must exist). Check `AccountMapping` for `accounts_receivable`.

---

### FLOW B — Collecting a payment (cash/bank/card/MoMo)

**Trigger:** `/school/fees/collect` → `SchoolFeesCollectPage` (`fees-operations.tsx`) → `useCollectPayment`.

```
[L1] fees-operations.tsx (Collect wizard: step 1 student, step 2 amount/method, step 3 allocation)
        form: { studentProfileId, amount, paymentMethod, cashSessionId?,
                externalReference?, externalReferenceType?, allocations?, convertOverpaymentToCredit? }
[L2] useCollectPayment()  →  POST /api/v1/school/payments/collect
[L3] BillingController @Post('collect')  (school/payments)
        └─ SchoolPaymentService.collect(dto)
            └─ $transaction:
               1. load student → partnerId
               2. IDEMPOTENCY: findFirst Payment(externalReference, type, direction='inbound')
                    • if found → return {replayed:true, payment, allocations}  (no double charge)
               3. choose allocations:
                    • explicit allocations[]  → validate each doc is POSTED_FEE_WHERE, cap at residual
                    • explicit documentIds[]  → settle each in full
                    • none → OPEN_FEE_WHERE oldest-first auto-fill up to amount
               4. controls.assertDocumentsPeriodOpen(allocations' docIds)   ← every touched doc's TERM must be open
               5. payments.createReceipt({...allocations})                  ← THE single payment writer
                    ├─ Payment row + PaymentAllocation rows
                    ├─ Document.amountResidual / paymentStatus updated
                    ├─ CashMovement (if cash + open session)
                    ├─ GL: Dr Cash/Bank / Cr AR  (PostingService)
                    └─ audit row
               6. OVERPAYMENT: if unallocated>0 && convertOverpaymentToCredit
                    → advanced.createCredit({source:'overpayment', sourcePaymentId})
                       └─ GL: Dr AR / Cr Fee-Credit Liability
                       → payment.update(decrement unallocatedAmount)        ← entitlement uniqueness
               7. event SchoolFeePaymentRecorded
            • CATCH P2002 on externalReference → re-read committed Payment, return replayed:true
[L4] Tables: Payment, PaymentAllocation, Document(residual), CashMovement, JournalEntry/Line, FeeCredit(optional)
```

**Troubleshooting B:**
- *"Payment counted twice after a MoMo retry."* Should be impossible — `Payment_org_externalref_direction_key` unique index. If it happens, the index is missing in this DB (apply integrity migration). Note: replay safety keys on `externalReference`, NOT `reference` (narration like "CASH" is not unique).
- *"Allocated to a cancelled invoice."* `POSTED_FEE_WHERE` excludes `draft`/`cancelled`. If a payment settled a cancelled doc, check the constant in `fee-document.constants.ts`.
- *"Settled a closed term's invoice."* `assertDocumentsPeriodOpen` walks `SchoolFeeInvoice.termId` → `TermFinancialClose`. If a Term-2 payment settled a Term-1 (closed) invoice, this guard failed — check `SchoolFeeInvoice` rows actually have `termId` populated.
- *"Cash not on Z-report."* `cashSessionId` must be passed AND a session must be open (`CashSessionService`). Without it, no `CashMovement` is written.
- *"Overpayment not available as credit next term."* `convertOverpaymentToCredit` must be true (default true in batch, but the single-collect form has a checkbox). Credit lands in `FeeCredit` with `source='overpayment'`, `sourcePaymentId` set.

---

### FLOW C — Waiver (forgive receivable)

```
[L1] /school/fees/waivers → create → approve → apply
[L2] useCreateWaiver / useApproveWaiver / useApplyWaiver
[L3] AdvancedFinanceController  school/finance
        createWaiver → AdvancedFinanceService.createWaiver (status 'pending')
        approveWaiver(id) → maker-checker (approver ≠ creator) → status 'approved'
        applyWaiver(id)  → $transaction:
           1. status must be 'approved' (else throw "must be approved")
           2. oldest-first open docs, reduce amountResidual, amountWaived += take  (amountPaid UNTOUCHED)
           3. assertDocumentsPeriodOpen(settled)
           4. posting.post GL: Dr Waiver Expense / Cr AR
           5. waiver.applied=true (or partial if short)
[L4] Tables: Waiver, Document(residual, amountWaived), JournalEntry/Line
```
**Troubleshooting C:** *"Waiver applied but balance unchanged."* → `applyWaiver` skips if not `approved`. *"amountPaid went up."* → should NOT; if it does, you're on an old dist — `amountPaid` is reserved for real receipts only (P0-3). Rebuild dist.

---

### FLOW D — Fee Credit (overpayment / advance / refund carry-forward)

```
[L1] /school/fees/credits → create or "apply to open invoices"
[L2] useCreateFeeCredit / useApplyCredits
[L3] AdvancedFinanceService
        createCredit → FeeCredit row + GL Dr AR / Cr Fee-Credit Liability
        applyCredits(studentProfileId) → $transaction:
           1. load active, non-expired credits + open docs oldest-first
           2. for each doc: take = min(creditRemaining, docResidual)
              • Document.amountResidual -= take  (amountPaid UNTOUCHED)
              • posting.post GL: Dr Fee-Credit Liability / Cr AR
              • FeeCreditAllocation.create (typed)
           3. ATOMIC drawdown: feeCredit.updateMany({where:{id, remaining:{gte:take}}, data:{decrement:take}})
              • if claimed.count≠1 → throw "drawn down by another transaction" (concurrency guard)
[L4] Tables: FeeCredit, FeeCreditAllocation, Document, JournalEntry/Line
```
**Troubleshooting D:** *"Credit applied twice / spent twice."* → the conditional `updateMany` decrement is the guard (FINANCIAL_INVARIANTS §Concurrency). If a credit paid out twice, either the migration's behaviour regressed or you bypassed `applyCredits` with a raw write.

---

### FLOW E — Refund (payout to guardian)

```
[L1] /school/fees → Refund tab → useRefundFee
[L2] useRefundFee  → POST /api/v1/school/payments/refund
[L3] SchoolPaymentService.refundFee(dto)
        └─ $transaction:
           1. replay guard on externalReference (direction='outbound')
           2. if allocatedPaymentId → reverseAllocation first (restores AR)
           3. breakdown = finance.refundableBreakdown(partnerId, studentId)
              • total = MAX(unallocated cash, credits) — never SUM (P0-6)
           4. if wanted > refundable → throw "exceeds refundable entitlement"
           5. draw down credits ATOMICALLY (updateMany decrement, like D)
           6. payments.createCustomerRefund → GL Dr AR / Cr Cash|Bank
           7. if credit-funded: compensate GL Dr Fee-Credit Liability / Cr AR
[L4] Tables: Payment(outbound), PaymentAllocation(reversal), FeeCredit(drawn), JournalEntry/Line
```
**Troubleshooting E:** *"Refund of 0 owed student succeeds / pays out cash from nothing."* → `refundableBreakdown` must return >0. If it paid out, the cap logic or the `FeeCredit` drawdown failed. **This was a real P0-6 bug; confirm you're on current dist.**

---

### FLOW F — Mobile Money (MTN / Airtel) live

```
[L1] /school/fees/mobile-money → useRequestMomoPayment
[L2] useRequestMomoPayment → POST /api/v1/school/mobile-money/:provider/request
[L3] MobileMoneyController → MobileMoneyService
        requestToPay: normalise phone → provider.requestToPay (fetch to MTN/Airtel API)
                     → MobileMoneyRequest.create({providerRef, status:'pending'})
        callback (provider → POST /school/mobile-money/:provider/callback, raw body for HMAC):
                     verifySignature → parseCallback → if succeeded:
                     SchoolPaymentService.collect({studentProfileId, amount, externalReference: providerRef, ...})
                     → MobileMoneyRequest.update(status='succeeded', paymentId)
[L2] useMomoRequests (polls every 10s) shows status pending→succeeded
[L4] Tables: MobileMoneyRequest, Payment, PaymentAllocation, Document, JournalEntry
```
**Troubleshooting F:** *"MoMo request created but never collects."* → callback URL must reach the API; check provider webhook config + `MTN_MOMO_*` env vars; signature verify needs the RAW body (controller reads raw). *"Double collect on retry."* → `providerRef`→`externalReference` unique index. *"Availability shows false."* → env vars unset (MTN_MOMO_BASE_URL etc.).

---

### FLOW G — Bank / MoMo statement import (B4)

```
[L1] /school/fees → (import screen) → useImportBatch (in finance-pages)  → POST /api/v1/school/finance/imports
[L3] PaymentReconciliationController @Post('') → PaymentReconciliationService.importBatch
        • fileHash dedup (reject identical re-upload)
        • match rows by admission number in narration → confidence high/medium/low/none
        • PaymentImportBatch + PaymentImportRow (externalRef unique per org)
     confirmRow(batchId, rowId) → payments.collect({externalReference: row.externalRef, externalReferenceType:'import_row'})
[L4] Tables: PaymentImportBatch, PaymentImportRow, Payment, Document, JournalEntry
```
**Troubleshooting G:** *"Row stuck 'unmatched'."* → no admission number found in narration → manual assign via confirmRow with studentProfileId. *"LOW confidence never posts."* → by design; fuzzy name matches require human assignment.

---

### FLOW H — Reconciliation / Balance / Clearance (read paths)

All READ-ONLY, all funnel through **`SchoolFinanceQueryService`** — the ONE canonical calculator.

| UI | Hook | Endpoint | Service method |
|---|---|---|---|
| Student balance | `useStudentBalance` | `GET /school/finance/students/:id/balance` | `studentBalance` |
| Ledger | `useStudentLedger` | `GET /school/finance/students/:id/ledger` | `studentLedger` |
| Statement | `useTermStatement` | `GET /school/finance/statement/:id` | (query) |
| Explain | `useBalanceExplainer` | `GET /school/finance/explain/:id` | `explainBalance` |
| Clearance | `useFeeClearance` | `GET /school/finance/clearance/student/:id` | `feeClearance` |
| AR⇄GL | (finance-pages) | `GET /school/finance/reconciliation/ar-gl` | `reconcileCurrentArToGl` |
| Credit liab | — | `GET /school/finance/reconciliation/credit-liability` | `reconcileCreditLiability` |
| Cached drift | — | `GET /school/finance/reconciliation/cached-projections` | `reconcileCachedProjections` |
| Operational cash | — | `GET /school/finance/reconciliation/operational-cash` | `reconcileOperationalCash` |
| Defaulters | `useFeeDefaulters` | `GET /school/finance/fee-defaulters` | `feeDefaulters` (raw SQL) |
| Bad debt | `useBadDebtors` | `GET /school/finance/bad-debtors` | `badDebtors` |
| Aging | `useFeeAging` | `GET /school/finance/aging` | `aging` |

**Balance identity (memorise for any "numbers don't add up" ticket):**
```
balance = billed − collected − waived − credited + adjusted
where collected = SUM(PaymentAllocation)  ← NEVER Document.amountPaid
```
`reconcileCachedProjections` compares `Document.amountPaid`/`amountWaived`/`FeeCredit.remaining` against their subledger and lists any drift. **If you see drift, treat it as a real accounting bug, not noise.**

---

## 3. The GL (Accounting) integration — where money becomes ledger

Every fee mutation ends at **`PostingService.post(request, tx)`** (the ONE writer of `JournalEntry`/`JournalLine`, ADR-009). It:
1. requires ≥2 lines,
2. enforces double-entry (`validateLines`),
3. checks `FiscalPeriod` is open (`fiscalPeriod.assertOpen`),
4. resolves FX rate, applies rounding tolerance to a rounding account,
5. writes `JournalEntry` + `JournalLine` (with `partnerId` on AR legs — that's what makes per-student AR⇄GL reconciliation possible).

**Accounts touched by fees:**
| Account code | Meaning | Hit by |
|---|---|---|
| `FEE-AR` / org AR | Accounts Receivable | every invoice (Dr), every payment/waiver/credit (Cr) |
| Revenue (per product) | Tuition/Lab/… income | invoice (Cr) |
| `FEE-WAIVER` | Waiver Expense | waiver apply (Dr) |
| `FEE-ADJ-INC` / `FEE-ADJ-EXP` | Adjustment income/expense | fee adjustment |
| `FEE-CR` | Fee Credit Liability | createCredit (Cr), applyCredit/refund (Dr) |
| Cash / Bank | Asset | payment receipt (Dr) |

**Troubleshooting GL:** *"AR⇄GL variance ≠ 0."* Run `GET /school/finance/reconciliation/ar-gl` — it returns `perStudent` rows with `variance`. A prepayment (unallocated inbound) legitimately makes GL AR negative vs subledger; the identity is `GL = subledger − unallocated`. Any other variance = a missed GL post. *"Journal not posting."* → `SALES`/`CASH`/`GEN` journals + `AccountMapping` (`accounts_receivable`, `default_cash`) must be seeded.

---

## 4. Concurrency & idempotency — the safety nets (read before blaming "random" bugs)

| Protection | Mechanism | Failure symptom if absent |
|---|---|---|
| One invoice per pupil/term | DB unique index `Document_org_partner_source_reference_key` | duplicate invoices under concurrent "Generate" |
| One payment per MoMo/bank txn | DB unique index `Payment_org_externalref_direction_key` | double collection on provider retry |
| One credit drawdown per (credit,doc) | unique `FeeCreditAllocation_credit_document_key` | credit spent twice |
| One reversal per allocation | unique `PaymentAllocationReversal_allocation_key` | AR restored twice |
| Atomic credit decrement | `feeCredit.updateMany({where:{id, remaining:{gte:take}}, data:{decrement}})` | race pays out one credit twice |
| Period control | `assertTermOpen` / `assertDocumentsPeriodOpen` | posting into closed term |

All of these **require the migration `20260824120000_fees_integrity_constraints` to be applied**. Verify with:
```sql
SELECT indexname FROM pg_indexes
WHERE tablename='Document' AND indexname LIKE '%source_reference%';
SELECT indexname FROM pg_indexes
WHERE tablename='Payment' AND indexname LIKE '%externalref%direction%';
```

---

## 5. File → responsibility quick index

**Frontend (`apps/web/src`):**
- `pages/school/fees.tsx` — hub tabs (billing/scholarships/penalties/refund/sponsors/credits/aging/arrears)
- `pages/school/fees-operations.tsx` — **collection wizard** (single + bulk entry points)
- `pages/school/fee-structures.tsx` / `fee-categories.tsx` / `optional-fees.tsx` — catalog CRUD UIs
- `pages/school/finance-pages.tsx` — reconciliation, imports, cash book, budgeting, defaulters
- `pages/school/fees-momo.tsx` — mobile money UI
- `features/school/api.ts` — **ALL hooks** (the contract between UI and API; mirrors DTOs)
- `lib/api.ts` — axios instance, Bearer JWT + org header injection

**Backend (`apps/api/src/modules/school/fees`):**
- `billing.controller.ts` / `billing.service.ts` — generate, penalty-run, collect, refund, collect-batch
- `advanced.service.ts` — sponsorship, waiver, fee credit, aging, defaulters, bad-debt, waiver-categories
- `school-finance-query.service.ts` — balance/ledger/statement/explain/clearance/reconciliation (canonical reads)
- `finance-controls.service.ts` — FeeAdjustment (maker-checker), TermFinancialClose
- `allocation-reversal.service.ts` — allocation reversal
- `mobile-money.service.ts` / `mobile-money.controller.ts` — MTN/Airtel
- `payment-reconciliation.service.ts` — B4 import
- `catalog.service.ts` / `catalog.controller.ts` — FeeStructure/Schedule/Assignment/OptionalFee/Discount/Scholarship/Installment/FeeCategory CRUD
- `billing-run.service.ts` / `billing-run.controller.ts` — resumable per-item billing job
- `fee-document.constants.ts` — `SCHOOL_FEE_SOURCE_TYPES`, `ACTIVE_FEE_STATUSES`, `POSTED_FEE_WHERE`, `OPEN_FEE_WHERE` (the lifecycle filters)
- `dto.types.ts` — `CollectFeePaymentDto`, `GenerateBillingDto`, `RefundFeeDto`

**Accounting (`apps/api/src/modules/accounting`):**
- `posting/posting.service.ts` — the one GL writer
- `invoicing/payment/payment.service.ts` — `createReceipt` / `createCustomerRefund` (single payment writer)
- `invoicing/document/document-builder.service.ts` — `createDocument` + `groupForPosting`

**DB (`apps/api/prisma/schema.prisma`):** `FeeStructure`, `FeeStructureVersion`, `FeeItem`, `FeeSchedule`, `StudentFeeAssignment`, `StudentOptionalFee`, `FeeCategory`, `Discount`, `Scholarship`, `Waiver`, `FeeCredit`, `FeeCreditAllocation`, `SchoolFeeInvoice`, `MobileMoneyRequest`, `PaymentImportBatch/Row`, `TermFinancialClose`, `FeeAdjustment`, `Document`, `DocumentLine`, `Payment`, `PaymentAllocation`, `PaymentAllocationReversal`, `JournalEntry`, `JournalLine`.

---

## 6. Common symptom → first place to look

| Symptom | Likely layer | Check |
|---|---|---|
| Generate bills 0 pupils | L3/L4 | FeeStructure not `published` or no `FeeStructureVersion`+`FeeItem` |
| Duplicate invoice | L4 | integrity migration missing |
| Double payment on MoMo retry | L4 | `externalReference` unique index missing |
| Waived/credited counted as paid | L3 | old dist; `amountPaid` must stay untouched (P0-3) |
| Refund paid with no entitlement | L3 | `refundableBreakdown` cap; old dist (P0-6) |
| Invoice draft, no GL | L3/L4 | `SALES` journal / `accounts_receivable` mapping missing |
| "Term financially closed" | L3 | `TermFinancialClose` row; reopen (maker-checker) |
| AR⇄GL variance | L3/L4 | `reconcileCurrentArToGl().perStudent`; missed GL post or prepayment |
| Balance ≠ statement ≠ ledger | L3 | all three must read `SchoolFinanceQueryService`; if they differ, a cached column drifted |
| MoMo request never collects | L3 | callback URL/env/secret; raw-body HMAC |
| Discounts/Installments tab missing | L1 | intentionally hidden in `fees.tsx`; use `/school/fees/discounts` |
| Cash not on Z-report | L3 | `cashSessionId` + open `CashSession` required |

---

## 7. Two intentional "gotchas" the code documents (don't file these as bugs)

1. **Discounts & Installments tabs hidden** in `f�ees.tsx` — the billing engine doesn't yet consume those rows, so the tab was hidden to stop staff configuring dead policy. They're reachable at `/school/fees/discounts` etc., but changing them does not change billing until that wiring lands (ADR/A5).
2. **Sponsorship gated off** — a sponsor is not yet a real payer (collections still hit the student's AR), so `paidBySponsor` is always 0 and the cap is not enforced. This is by design (the controller hides it in Phase 5); don't treat it as broken.

---

## 8. How to reproduce any flow against the live API (curl, for debugging)

```bash
# auth
TOKEN=$(curl -s -X POST http://localhost:3001/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"<email>","password":"<pw>","organizationCode":"<ORG>"}' | grep -o '"accessToken":"[^"]*"' | cut -d'"' -f4)
H="Authorization: Bearer $TOKEN"

# generate term billing
curl -s -X POST "http://localhost:3001/api/v1/school/billing/generate" -H "$H" \
  -H 'Content-Type: application/json' -d '{"termId":"<termId>"}'

# collect a payment
curl -s -X POST "http://localhost:3001/api/v1/school/payments/collect" -H "$H" \
  -H 'Content-Type: application/json' \
  -d '{"studentProfileId":"<id>","amount":400000,"paymentMethod":"cash","convertOverpaymentToCredit":true}'

# student balance (canonical)
curl -s "http://localhost:3001/api/v1/school/finance/students/<id>/balance" -H "$H"

# AR⇄GL reconciliation
curl -s "http://localhost:3001/api/v1/school/finance/reconciliation/ar-gl" -H "$H"
```
