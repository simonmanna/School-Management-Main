# School Management System — Re-audit #3 (business scenarios) + Wave 9 plan

## Context
- This is the third audit. The first (2026-09-24, NO-GO, 12 P0) led to Waves 1–7, all merged to main @ `0ebc279`. The second found CONDITIONAL with 0 P0, which led to Wave 8 (uncommitted on `fix/wave8-reaudit`).
- This pass adds the **business-scenario layer** the reviewer asked for: promotion edge cases, withdrawal, returning learner, bounced payment, overpayment/refund, closed term/year. It also reviews the Wave 8 diff.
- The audit was read-only: no code changed, no DB writes.
- Evidence: 3 parallel code traces, plus spot checks of the top findings (marked ✔ = I re-read the code myself).

## Build/runtime (this session, working tree incl. Wave 8)
| Command | Result |
|---|---|
| api / web / portal `tsc --noEmit` | exit 0 ×3 |
| unit: wave8-reaudit, web-api-contract, allocation-reversal-ledger, refund-request | 4 suites, 41 tests pass |
| full unit + integration | not re-run: integration writes to `schooldb-planet`. Last green: 75 suites (Wave 8) |

## A. Verdict: **CONDITIONAL → NOT pilot-ready until Wave 9a lands**
- The happy path works end to end: configure → admit → fee → pay → enrol → place → teacher/parent see → reports.
- Normal billing (bill 300k → pay 100k → pay 200k → 0) is correct from invoice through GL, statement and portal.
- The failure paths still break: a bounced payment, a refund against an allocated payment, and a batch resubmit. So do some lifecycle edges: a learner marked "complete", a suspended learner, a closed year.
- There is also a new family-portal data leak.

## B. Scenario results
| Scenario | Status | Breaks at |
|---|---|---|
| P3 North 2026 → P4 North 2027 (normal) | OK | History kept, no duplicate student, run-twice safe, concurrent-safe, closed target refused |
| …learner already "Mark year complete" | BROKEN | Excluded: `PLACEMENT_HOLDING_STATUSES` has no COMPLETED (`promotion-run.service.ts:73-78, 211-218`) ✔ |
| …suspended at rollover | PARTIAL | Suspension silently ends |
| …North missing in 2027, >1 stream | PARTIAL | Dry run says OK; execute fails "choose one"; UI can't pick a stream or override capacity |
| …holiday between years | PARTIAL | No current class in portal/lists/billing until Term 1 starts (known, deferred) |
| Portals page "Rollover" tab | BROKEN | Reads `r.plan.length`; API returns promote/repeat/graduate/skip. Execute commits, then shows "failed", with no confirm step (`apps/web/src/pages/school/portals.tsx:331-336`) ✔ |
| Withdrawal | OK / PARTIAL | Can't withdraw before the first placement start date; existing invoices untouched |
| Suspension → auto-return | PARTIAL | Suspended pupils never invoiced: billing filters `status:'active'` (`billing.service.ts:101`, `billing-run.service.ts:40`) ✔ |
| Returning learner | OK | Reuses the StudentProfile. Duplicate risk if the application has no DOB (suspected) |
| Admissions → conversion | OK | Atomic, convert-twice blocked. **But the admission fee stays on the `ADM-PAYER` account and never reaches the student's statement or portal** |
| Year lifecycle | PARTIAL | Multiple ACTIVE years allowed. A current term can sit in a PLANNING year. `set-current` bypasses the lifecycle permission. Results, assessments and attendance-correct are writable in a CLOSED year |
| Pay 300k in parts → 0 | OK | Dashboard counts withdrawn pupils' debt; the class report does not |
| Overpay → refund → 2nd refund | OK / BROKEN | Second refund blocked OK. The refundable amount subtracts converted credit twice. Cash refund approved by a different person fails the drawer check |
| Bounced payment reversal | BROKEN | One reversing JE (OK), but a credit funded by that payment stays spendable and refundable. Mobile-money record stays `succeeded` |
| Batch class collect | BROKEN | No per-row idempotency key. After a partial failure the form keeps the posted rows, so resubmitting double-posts them (`fees-operations.tsx:320-367`) ✔ |
| Collect from family with closed-term arrears | BROKEN | Oldest-first allocation hits the closed invoice and throws. Mobile-money callbacks fail forever: money received but not recorded |
| Parent A → child B | OK on `/school/portals/*` | **LEAK via LMS** (below) |
| Staff offboarding | OK / RISK | New clash trigger may reject the teacher-unassign UPDATE, so offboarding rolls back and the outbox retries forever |

## C. Findings register (new or still open)
### P0 — fix before any pilot (4)
1. **Portal IDOR.** Parent and Student presets hold `school:lms:read` (`packages/shared/src/permissions.ts:1078,1097`).
   - `GET school/lp/reporting/objective-mastery?studentProfileId=<any>` and `…/course-progress` are unscoped (`lms-execution.service.ts:346-362`, controller `:93-102`). ✔
   - Discussion create/post take `authorId`/`createdById` from an `any` body, so anyone can post as anyone.
   - No global "family-only principals stay on portal routes" guard exists. ✔
2. **Bounced payment keeps its credit.** `reversePayment` never cancels the SchoolCredit whose `sourcePaymentId` is the reversed payment. The credit stays spendable and refundable, so cash can go out for money never received. ✔ (no credit handling in `allocation-reversal.service.ts`)
3. **Refund reverses another family's allocations.** `refundFee` with `allocatedPaymentId` loads allocations by `paymentId` only, with no check that the payment belongs to the refunded payer or student (`billing.service.ts:1549-1573`). ✔
4. **Batch collect double-post on resubmit** (see B). Severity P0 because it creates duplicate receipts in normal desk use.

### P1 — critical (13)
5. Closed-term arrears block all collection, including mobile-money callbacks (`billing.service.ts:1203-1227`). **Needs your decision.**
6. Cash refund approval fails the drawer-owner check (`payment.service.ts:331`); without a drawer, the payout never reaches the Z-report.
7. The refundable amount double-subtracts converted credit (`school-finance-query.service.ts:964-994` vs `billing.service.ts:1335`).
8. Generic `POST /payments/:id/void` hard-deletes allocations and drawer movements and skips the term-close check (`invoicing-workflows.initializer.ts:281,307`). Only Admin can call it.
9. `POST /credits` takes an unvalidated body, so a Head Teacher alone can mint credit (a waiver with no second person) (`advanced.controller.ts:127-132`). **Needs your decision** on two-person control.
10. `rejectAdjustment` has no status check, so a posted adjustment can be flipped to rejected (`finance-controls.service.ts:177-186`).
11. COMPLETED learners are excluded from promotion and rollover (B).
12. The Portals rollover tab commits, then reports failure, with no confirm step (B).
13. Suspended pupils are never invoiced. **Needs your decision** (recommended: bill them).
14. Results, gradebook and assessments are writable in a CLOSED year (`result-run.service.ts:94-125`, `gradebook.service.ts`, `assessment.service.ts`). Attendance `correct` has no guard (`student-attendance.service.ts:118-134`).
15. Teacher data scope has several gaps:
    - It is class-only, not section; homeroom `classTeacherId` is ignored.
    - Timetable and assignment sources never expire; they have no year filter or end date (`data-scope.service.ts:110-130`).
    - Guardian, enrollment and placement reads skip data scope entirely: `guardian.service.ts:187`, `enrollment.controller.ts:154-255` (guardian phone numbers are exposed).
16. The admission fee is never linked to the student after conversion (`admission-fee.service.ts`, `admissions.service.ts:951`).
17. Wave-8 migration `20260925110000` can make offboarding fail permanently on data that now violates the rule. It has no pre-check.

### P2 — important (grouped)
- **Finance:**
  - billing run ignores a term closed mid-run;
  - a cancelled invoice blocks re-billing (`billing.service.ts:725`, no status filter);
  - the mobile-money record is not updated on reversal;
  - the cash book uses the server time zone and includes non-fee receipts;
  - adjustments don't check that the invoice belongs to the pupil;
  - the Bursar can post through generic `/payments`;
  - cash receipts never reach the Z-report (web sends no `cashSessionId`).
- **Lifecycle:**
  - can't withdraw before the first placement starts;
  - promotion UI can't pick a stream or override capacity;
  - multiple ACTIVE years allowed;
  - a current term can sit in a PLANNING year;
  - "current"-basis reports ignore the selected year;
  - a class-scoped teacher with no classes gets school-wide reports (`data-scope.service.ts:84`).
- **Security:**
  - `GET school/documents` and `GET /files` have no entity scope;
  - staff suspension keeps a school-wide login;
  - `staff:write` can terminate a staff record linked to an Admin, which locks the Admin out;
  - a suspended organisation's sessions keep refreshing;
  - workers still run for suspended organisations.
- **Contract:**
  - the portal's Courses and Due pages call `school/lms/my/*`, which is not mounted in prod (`ENABLE_ADVANCED_LMS=false`);
  - the contract spec covers only `apps/web/src/features`, not `pages` or the portal.

### P3
- Floating-point discount math and fractional shillings.
- Graduation is dated "now"; there is no alumni record.
- The suspension worker swallows closed-year errors.
- A year can close with pending enrollments.
- `toStreamId` dead code in `promotion-decisions.tsx`.
- Concurrent refresh can mint two tokens.
- A failed-send dedupe reset can send a duplicate SMS.
- SMS transport registers even when the flag is off.
- `setup-status` is readable by any `school:read` holder.
- `school:academicyear:lifecycle` has no risk label.

### Wave-8 diff: verified OK
- Role-grant migration is idempotent.
- Refund approval is atomic.
- Administrator role is protected.
- SMS without a provider → `failed`.
- Workers get per-tenant context.
- Library route-order fix and `/partners` URL fix both match real routes.

## D. Business decisions needed before coding (not settled by this audit)
1. **Closed-term arrears:** stay collectible (payment allocates past the closed term into credit or open invoices), or blocked?
2. **Bounced payment that funded a credit that was already spent or refunded:** reverse what remains and raise a receivable for the rest?
3. **Suspended pupils:** billed as normal?
4. **Two-person control** for Head Teacher reversal, reallocation and manual credit? Should Administrators refund in a single step?
5. **Rounding:** whole UGX at line level?
6. **Withdrawal:** pro-rate or credit issued invoices, or leave them as is?

## E. Plan — Wave 9 (branch `fix/wave9-scenarios` off `fix/wave8-reaudit` once Wave 8 is committed)
**9a — pilot blockers (P0 + P1 items with no decision needed)**
1. **Portal LMS scope.**
   - Add `@ScopedToStudent` (reuse `scoped-to-student.guard.ts`) or a data-scope filter to every `school/lp/*` and `school/lms/*` route that takes `studentProfileId`/`courseOfferingId`.
   - Derive `authorId` from `tenant.userId`; type the discussion DTOs.
   - Sweep every controller reachable with `lmsRead`, `studentPortal` or `portalSelf` for ID params.
2. **`reversePayment`:** in the same transaction, cancel or reduce unspent credits with `sourcePaymentId = payment.id`. The spent part is handled per decision D2. Also mark the MoMo request reversed.
3. **`refundFee`:** assert that the `allocatedPaymentId` payment's `partnerId` and student match the refund target before reversing.
4. **Batch collect:**
   - one idempotency key per row (reuse `use-attempt-key.ts` pattern, `idempotency.service.ts`);
   - server dedupe on (batchKey, studentProfileId);
   - web drops posted rows from the draft.
5. Fix `rejectAdjustment` (only `pending` can be rejected). Validate `POST /credits` with a DTO; `sourcePaymentId` must be owned by the payer and decrement `unallocatedAmount`.
6. Fix the refundable double-subtract (7). Pass the drawer-mismatch override on the approval payout, or record against the approver's session (6).
7. Void route: refuse fee-invoice payments; route them to `reversePayment`.
8. **Promotion:**
   - include COMPLETED enrollments whose year is closed or whose status is completed;
   - fix the `portals.tsx` rollover tab: use `counts` and a confirm dialog, or remove the tab and link to `/school/promotion`.
9. Add the closed-year guard (`academic-year-guard.ts`) to result-run, gradebook, assessment writes and attendance `correct`.
10. **Data scope:**
    - apply `DataScopeService` to guardian, enrollment and placement reads;
    - add section and homeroom sources;
    - filter timetable and assignment sources to the current year.
11. Migration 17: add a pre-check script that lists rows violating the new clash rule. Offboarding sets `teacherPartnerId = NULL` via a path the trigger skips: the trigger only needs to re-check when the teacher is set non-null.
12. Admission fee → on conversion, re-point the invoice, payment and allocations to the student's payer. Alternatively, have the statement query include the linked `ADM-PAYER` account.

**9b — decided 2026-09-25 (D1–D4)**
- D1: closed-term arrears stay collectible. A payment allocation settling a closed-term invoice is allowed (it books no new revenue and changes no term figures). The term-close check applies only to postings that create revenue or adjustments. Mobile-money callbacks must succeed.
- D2: on a bounce, void any unspent credit funded by that payment. The spent or refunded part re-opens as a receivable on the family account (Dr AR / Cr credit liability or cash as appropriate). AR↔GL variance must stay 0.
- D3: suspended pupils are billed normally. Billing filters change to include `suspended` (`billing.service.ts:101`, `billing-run.service.ts:40`).
- D4: maker-checker for Head Teacher reversal, reallocation and manual credit, reusing the `refund-request.service.ts` request/approve pattern. The Administrator single-step override stays, but is audit-logged.
- Still open: D5 rounding, D6 withdrawal invoices. Ask before implementing those.

**9c — P2 grouped** as in §C, then P3.

Each item gets a regression spec, following house style (comments cite the audit ID).

## F. Verification
1. Typecheck api/web/portal with `tsc --noEmit` at `--max-old-space-size=8192`, and build shared first.
2. Lint: 0 errors.
3. Run targeted unit specs, then the full unit suite in the background.
4. New integration spec `wave9-scenarios.spec.ts` on `schooldb-planet`:
   - bounced 500k cheque with 200k credit → credit void, AR↔GL variance 0;
   - refund with a foreign `allocatedPaymentId` → 400;
   - batch resubmit → no duplicates;
   - COMPLETED P3 → P4 promoted;
   - closed-year result-run → 403/400;
   - parent A calls objective-mastery for B → 403;
   - promotion without North in 2027 → clear error at dry run.
5. Extend `web-api-contract.spec.ts` to `apps/web/src/pages` and `apps/portal/src`.
6. Re-run the Green Valley browser scenario end to end:
   - login as admin (user types the password);
   - admit → fee → pay → enrol → teacher sees P4 North → parent sees child and fee;
   - dashboard totals = AR↔GL.
7. Then re-audit once more for CONDITIONAL → GO.

---

## G. Wave 9 status (2026-09-25, uncommitted on `fix/wave8-reaudit`)

| ID | Status | Change | Spec |
|---|---|---|---|
| P0-1 portal LMS IDOR | FIXED | LMS reporting narrowed to the family's own pupils; post/discussion author = caller | unit `wave9-scenarios` |
| P0-2 bounced receipt keeps credit | FIXED (D2) | `reversePayment` voids funded credits, reverses their drawdowns, raises a `school_payment_recovery` charge for cash already refunded; refuses outbound payments | unit `allocation-reversal-ledger`, integration `wave9-scenarios` |
| P0-3 refund reverses another family | FIXED | `allocatedPaymentId` must be a live inbound receipt of the pupil's payer | unit `fees-phase0-hardening`, integration |
| P0-4 batch double-post | FIXED | per-row `externalReference` key (`import_row`), posted rows dropped from the form | integration |
| P1-5 closed-term arrears | FIXED (D1) | collect no longer refuses closed-term invoices; revenue/adjustment paths still guarded | integration |
| P1-6 cash refund approval | FIXED | approval payout may use the requester's drawer | unit `refund-request` |
| P1-7 refundable double-subtract | FIXED | refundable = unallocated + refundable credits | unit, integration |
| P1-8 generic void | FIXED | refuses school-fee receipts | — |
| P1-9 `POST /credits` | FIXED (D4) | typed DTO; overpayment credit must draw down the payer's receipt; maker-checker; web form sent rejected sources, now fixed | unit |
| P1-10 reject posted adjustment | FIXED | only `pending_approval`, CAS | unit |
| P1-11 COMPLETED not promoted | FIXED | rollover + single promote include year-completed learners | unit |
| P1-12 Portals rollover tab | FIXED | replaced by link to Promotion page | — |
| P1-13 suspended not billed | FIXED (D3) | `BILLABLE_STUDENT_STATUSES = active, suspended` | — |
| P1-14 closed-year writes | FIXED | guard on result-run, gradebook columns, assessment CRUD/transition, attendance correct | unit |
| P1-15 teacher scope | PARTIAL | homeroom + stream class-teacher sources; guardian/enrollment/placement/roster reads scoped. Timetable source still has no year (TimetableSlot has no term — product decision) | unit |
| P1-16 admission fee on student | FIXED | enrolment moves fee + sole-purpose receipts to the pupil, GL transfer keeps per-account AR identity | covered by admission suites |
| P1-17 clash trigger vs offboarding | FIXED | migration `20260925120000`: UPDATE re-checked only when it claims something new | integration `wave8-reaudit` |
| D4 maker-checker | DONE | `FinanceCorrectionRequestService`; routes return `pending_approval` / `applied`; corrections card on Fees → Refund | unit |
| Contract spec | EXTENDED | now scans `web/src/pages` + `portal/src` for `/school/*` | unit `web-api-contract` |

Still open: D5 rounding, D6 withdrawal invoices, all P2/P3 (§C), MoMo record on reversal (needs decision: provider-side money did arrive).
