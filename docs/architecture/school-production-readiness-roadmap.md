# School Management — Production-Readiness Assessment & Phased Roadmap

> Status: assessment + roadmap (no code changes). Companion to
> [`school-vertical-flow.md`](./school-vertical-flow.md) and
> [`school-frontend-backend-flow.md`](./school-frontend-backend-flow.md).
> Findings verified against source as of 2026-08-13.

## Context

The school system is a **vertical ported onto a mature multi-vertical ERP core**
(POS, accounting, invoicing, inventory). The backend is far more complete than the
frontend: services, FSMs, GL posting, idempotency and tests are largely in place,
but several fully-built backend workflows have no UI, three chargeable services
never reach the ledger, and a handful of **money-path bugs** make the core not yet
financially production-safe.

Three product decisions frame the roadmap:

- **Enrollment** — build a dedicated admissions UI, but keep the existing direct
  "Admit student" create path as primary. The two remain unlinked (no forced funnel).
- **Chargeable services (P5)** — build a **generic billing engine** that all charge
  sources (tuition, transport, meals, exams, registration, other) feed into → AR → GL.
  Reuse the existing `Document` / `PostingService` ledger; the engine is a new
  *charge-normalization* layer, not a new ledger.
- Priority 4 (web milestones) is already delivered; not re-planned here.

## How this was assessed

Three parallel exploration passes over `apps/api/src/modules/**`, `apps/web/src/**`,
`apps/api/prisma/schema.prisma`, `apps/api/test/**`, and `docs/architecture/*`. The
three sharpest P1 findings were then **verified directly in source**
(`billing.service.ts`, `penalty-cron.worker.ts`).

## Maturity snapshot

| Domain | Ready | State |
|---|---|---|
| Money spine (fees/billing/penalties/payments/allocation/library-fine) | ~85% | Hardened, idempotent, Decimal, double-entry, GL-posted, tested — **except the 3 verified bugs below** |
| GL / CoA / journals / cash-session | ~85% | Mature single-writer posting; balanced double-entry; cash rec ties to trial balance |
| Foundation / people / admissions / academics / attendance / exams / grades / report cards | ~75% | Complete transactional services + FSMs + unit tests; **admissions & year/term setup have no UI** |
| Reporting / portals | ~60% | Works but computed live (N+1 risk); `SchoolDashboardCache` unused; no portal web pages |
| Transport / hostel / cafeteria billing | ~30% | Data model + CRUD exist; **fees never posted to AR/GL** — biggest functional hole |
| Web frontend | ~55% | 7 solid wired screens; ~half the domains have no UI; **zero frontend tests** |
| Bank reconciliation / statements / installments / discounts | ~40% | Least mature finance features (see P1.4–P1.7) |

---

## Priority 1 — Make the core financially production-safe

Flow: **Fees → Billing → AR → Payment → Allocation → Cash → GL → Statement → Reconciliation.**
Payment / Allocation / Cash / GL are already production-grade (single payment writer,
Decimal allocation loop, balanced posting, cash rec tied to trial balance). The gaps
are in **Billing, Statement, Reconciliation**, plus two money-integrity bugs.

### P1.1 — Atomic invoice → GL post — **CRITICAL (verified)**

`apps/api/src/modules/school/fees/billing.service.ts` `generateForTerm` (L145–277):
the `Document` is created and committed inside one `$transaction`; the GL
`posting.post()` (L250) and promote-to-`posted` (L263) run **outside** it on
`this.prisma.client`. If the GL post throws, the invoice is left committed as `draft`;
on rerun the dedupe `findFirst` (L146) returns `_skipped` because it doesn't check
`status` — **the invoice never posts to the GL**. The comment at L228–230 asserts the
opposite and is wrong.

- Fix: wrap create + line build + GL post + promote in **one** `$transaction`. The
  `generatePenaltyRun` path (L328–522) is the correct template — copy its shape.
- Make the dedupe `status`-aware: an existing `draft` / unposted `school_fee`
  document must be **re-posted**, not skipped.
- Accept: killing the process between insert and post leaves no committed-but-unposted
  invoice; rerun reconciles. Add an integration test that injects a post failure and
  asserts rerun posts to GL.

### P1.2 — Decimal money everywhere in billing — **(verified)**

Float `Number` math leaks into ledger-bound values: scholarship/discount (L118–134),
subtotal/discountTotal reduce (L231–232), penalty `outstanding * value/100`
(L385–389), and `people/student.service.ts` `statement()` totals.

- Fix: use `dec` / `round` / `ZERO` from `apps/api/src/kernel/common/money.ts`
  (already imported here and used correctly in the allocation loop) for every value
  that re-enters a `Decimal(20,6)` column.
- Accept: unit-test billing/penalty amounts against Decimal fixtures with values that
  expose float drift (e.g. repeated `33.335`); statement totals match
  `sum(amountResidual)` exactly.

### P1.3 — Tenant-safe penalty cron — **CRITICAL (verified)**

`apps/api/src/modules/school/fees/penalty-cron.worker.ts` `tick()` (L77–105) loops
every org but **never establishes `TenantContext`**, while `generatePenaltyRun` reads
`this.tenant.organizationId` (billing.service.ts L322). The comment (L84–88) claims
context is set "explicitly" — it is not. The cron path either crashes (undefined org)
or crosses tenants.

- Fix: run each org's schedules inside the tenant ALS scope
  (`TenantContextService.runWith(org.id, …)` or equivalent) before calling
  `generatePenaltyRun`. Correct the misleading comment.
- Accept: integration test drives `tick()` across ≥2 orgs and asserts penalties land
  in the right org only.

### P1.4 — Statements (partial → production)

`people/student.service.ts` `statement()` is float, display-only;
`Guardian.receivesStatements` is unused; no running-balance document or delivery
pipeline.

- Build a proper running-balance account statement (opening balance, dated
  charges/payments, closing balance) in Decimal; add a formal statement document +
  optional PDF (reuse the `report-card-pdf.service.ts` pdfkit pattern).
- Wire `Guardian.receivesStatements` to a delivery path via the existing
  `communication` module + event bus.

### P1.5 — Bank reconciliation hardening (thin)

`accounting/treasury/bank-reconciliation.service.ts`: exact-amount ±3-day greedy
match only; `importStatement` is a non-transactional per-line loop; **no GL clearing
entry on match**; `unmatch` not org-scoped; no partial/many-to-one matching; no
bank-charge/interest handling.

- Make `importStatement` transactional; post a GL clearing entry on match; org-scope
  `unmatch`; add partial/split + many-to-one matching and bank-charge lines.
- (Cash reconciliation is already strong — no change.)

### P1.6 — Cash-session "best-effort" GL divergence

`accounting/treasury/cash-session.service.ts` `recordGlSkip` swallows a missing
account mapping (logged + audited) rather than failing the drawer write — till and GL
can silently diverge until mappings are back-filled.

- Add a monitoring/back-fill process (report of skipped GL postings + a re-post job)
  so divergence is visible and closeable. Keep the non-blocking write behaviour by
  design.

### P1.7 — Discounts & installments (unfinished)

`Discount` entity is CRUD'd but **never applied** by billing (only `Scholarship` +
per-student `customDiscount` are). `InstallmentPlan` is data-only (JSON), with no
engine to split/enforce installment invoices.

- Apply `Discount` in `generateForTerm`. Build an installment generator/enforcer
  (split a term charge into scheduled Documents with due dates; feed the penalty
  engine).

**P1 exit criteria:** a term can be billed, partially paid, penalised, statemented and
reconciled with GL tie-out at every step; process kills never leave orphaned/unposted
money; cron is tenant-isolated; no float touches a ledger column.

---

## Priority 2 — Complete admissions

Backend is **fully built** (`admissions.service.ts` FSM
`submitted → under_review → exam_scheduled → accepted → enrolled`, duplicate guard,
entrance-exam scoring, document upload/verify, atomic `enroll()`), with unit +
integration tests. The gap is entirely **frontend** — no page, no hooks, no nav.

- Build `apps/web/src/pages/school/admissions.tsx`: applications list + filters;
  application detail with FSM action buttons (review / schedule exam / accept / reject
  / withdraw); entrance-exam score entry; document upload + verify; **enroll** action
  calling `POST /school/admissions/enroll`.
- Add admissions hooks to `apps/web/src/features/school/api.ts` and a nav entry in
  `apps/web/src/components/layout/app-shell.tsx` (gate on the existing admissions
  permission).
- **Keep the direct "Admit student" path** (`students.tsx` → `POST /school/students`)
  as-is; the two flows stay unlinked per decision. Note in UI copy that direct-create
  bypasses application provenance.
- `WaitingList` is currently a dead model — decide: surface a waitlist branch in the
  accept flow + UI, or defer with a tracking note.
- Tests: extend the existing `school-admissions-attendance` integration; add a web
  smoke for the enroll wiring.

**P2 exit criteria:** an operator can run a real applicant end-to-end
(apply → review → exam → documents → accept → enroll) entirely in the app.

---

## Priority 3 — Finish academic lifecycle

Backend for Attendance / Exams / Grades / Report Cards / Promotion / Rollover is
**complete and tested**. Remaining work is mostly UI plus two backend items.

| Item | Type | Detail |
|---|---|---|
| Attendance period mode + reports | Frontend | Backend has `periodId` + weekly/per-student rate endpoints (migration `20260813140000_period_attendance`); UI does daily register only. Add period selector + attendance analytics pages. |
| Single-student promotion | Frontend | `usePromoteStudent` hook exists; only cohort rollover is surfaced. Add UI to promote/repeat/graduate individuals. |
| Foundation admin (year/term) | Frontend | Year/Term CRUD + set-current controllers exist but no page — operators can't configure terms that rollover & report cards depend on. Build a foundation settings screen. |
| Report-card publish/release | Backend + FE | `ReportCard.publishedAt` / `pdfUrl` exist and the UI shows a `published` badge, but **no publish endpoint** — add publish/release-to-portal, wire the badge to real state. |
| Test hardening | Tests | Add integration `grade → approve → report-card → PDF` against a real DB; add coverage for `report-card-pdf.service.ts`. |

**P3 exit criteria:** full lifecycle runnable in-app: attend (daily+period) → assess →
grade → approve → generate + **publish** report card → promote/rollover, with terms
configured from the UI.

---

## Priority 5 — Integrate all chargeable services (generic billing engine)

Target: **Tuition · Transport · Meals · Exams · Registration · Other → Generic billing
engine → AR → GL.** Today only **library** posts to the ledger (overdue fine →
`Document(sales_invoice)` → GL). Transport/hostel carry `monthlyFee` / `feeProductId`
that never bill; cafeteria is a private prepaid wallet with no `Payment` / `Document`
/ GL.

Build a **generic charge/billing engine** as a new normalization layer over the
existing ledger (reuse `DocumentBuilderService` + `PostingService` — no new accounting
code):

1. **ChargeSource abstraction** — a common interface each source implements to emit
   periodic charges `{partnerId, productId, amount, period, sourceType}`. Register
   tuition, transport, hostel, meals, exams, registration, other, and (refactored)
   penalty/library as sources.
2. **Engine** — batches due charges into `Document(sales_invoice)` posted to the
   shared AR/GL, with the same idempotency discipline as `generateForTerm` (dedupe key
   per source+period; wrap create+post atomically per P1.1).
3. **Transport / hostel** — emit recurring monthly charges from `Route.monthlyFee` /
   `Room.monthlyFee`; retire the dangling `feeProductId` columns into real invoice
   lines.
4. **Cafeteria** — model meal charges through the engine; treat the wallet as
   **prepayment/credit** so top-ups write `Payment` + `Document` + GL and are
   reconcilable against cash/bank (fixes the off-books wallet).
5. **Consolidation (optional)** — migrate existing tuition/penalty billing to register
   as charge sources of the same engine, so there is one code path to AR/GL.

**P5 exit criteria:** every chargeable service produces a GL-posted, AR-visible,
reconcilable invoice; treasury/reconciliation reports include service revenue; no
revenue stream is off the books.

---

## Cross-cutting (schedule alongside phases)

- **G1 dead workflow engine** — the 5 registered `WorkflowDefinition`s are never
  invoked; every vertical hand-rolls its FSM. Enforcement works, so low priority:
  decide adopt the kernel `WorkflowService` vs formally retire the definitions. Do
  *not* let this block P1–P5.
- **RLS dormant** — policies exist on all 67 school tables but RLS is not enabled by
  default; isolation relies on the app-side Prisma extension. Ops task: enable the RLS
  role (`pnpm rls:setup-role`) in production for defense-in-depth.
- **Perf / G4** — `SchoolDashboardCache` unused; dashboards computed live (N+1 at
  scale). Populate the cache or accept and document the limit.
- **Testing skew** — strong on money + FSMs, **zero frontend tests**. Add web
  smoke/integration for every new UI (P2 admissions, P3 foundation/attendance/promotion).

---

## Suggested sequencing

1. **P1.1 + P1.3 first** (the two CRITICAL verified bugs) — smallest, highest
   risk-reduction, unblock trustworthy billing.
2. **P1.2** (Decimal) — pairs naturally with P1.1 since both touch `billing.service.ts`.
3. **P1.4–P1.7** (statements, bank rec, cash-GL monitoring, discounts/installments) —
   complete the finance surface.
4. **P2 admissions UI** — independent of finance; can run in parallel by a frontend track.
5. **P3 academic UI + report-card publish** — parallelizable with P2.
6. **P5 generic billing engine** — last and largest; depends on P1.1's atomic-post
   pattern being settled (the engine reuses it).

## Verification strategy (per phase, when built)

- **P1** — extend `apps/api/test/integration/school-happy-path.spec.ts` and add a
  billing-atomicity failure/rerun integration test; run `cash-reconciliation.spec.ts`
  to confirm treasury still ties to trial balance; Decimal unit tests for drift.
- **P2/P3 frontend** — run the web app via the dev-server/preview workflow, drive the
  new screens (admissions enroll, foundation term setup, report-card publish) and
  confirm against the API network traffic; add web smoke tests.
- **P5** — per-source `charge → invoice → GL` tie-out integration tests; confirm
  reconciliation and revenue reports include the new sources.
