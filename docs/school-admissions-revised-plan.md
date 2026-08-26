# School Admissions — Revised Specification & Production Checklist

> Revision of the Student Applications & Admissions plan, incorporating the
> independent review. Each review item was verified against the **actual code**
> (`admissions.service.ts`, `admissions-portal.*`, `enrollment.service.ts`), not
> assumed. Items marked **FIX** are not yet implemented; items marked **CONFIRMED**
> are already satisfied by the current implementation and only need to be
> documented/tested.

---

## 0. Review-item verdicts (verified against code)

| # | Concern | Verdict | Evidence | Work |
|---|---------|---------|----------|------|
| 1 | Document requirement semantics (`kind`/`gate`/`code`/`label`/`required`) | **CONFIRMED** | `AdmissionRequirement` model + `missingSubmitRequirements()` (`admissions.service.ts:475`) | none |
| 2 | Two gates: submit vs enroll | **CONFIRMED** | `submitApplication` routes to `documents_pending` when missing (`admissions.service.ts:459-466`); `checkEligibility` separate (`admissions.service.ts:1703`) | none |
| 3 | Attachment ≠ verification | **CONFIRMED** | `ApplicationDocument.verified`; `verifyDocument` requires reason on reject | none |
| 4 | Enrollment gate (offer + docs + fee + seat) | **CONFIRMED** | `checkEligibility` (`admissions.service.ts:1703-1750`) | none |
| 5 | Terminology: "every button is an FSM transition" | **FIX (docs)** | Offer + enroll have their own endpoints/guards, not `/review` | update spec wording |
| 6 | Portal security (P0) | **CONFIRMED (document/test)** | `randomBytes(32)` token, hashed, resolves one `applicationId` (`admissions-portal.service.ts:26-84`) | add invariant test |
| 7 | Enrollment atomicity (P0) | **CONFIRMED** | single `$transaction`; `enrollNewStudent(input, tx)` threads `tx` (`enrollment.service.ts:84-173`) | none |
| 8 | Capacity concurrency (P0) | **FIX (real gap)** | `occupied` is a derived `count`, no lock (`admissions.service.ts:1803-1814`); two concurrent enrolls can both pass | seat-reservation counter |
| 9 | "Fee settled" definition (P1) | **CONFIRMED (clarify)** | only the application fee: `app.fee && !app.fee.paid` or `!app.fee && feeStatus==='pending'` (`admissions.service.ts:1725-1726`) | document rule |
| 10 | `exam_done → interviewed` (P1) | **DECIDE (modeling)** | `STATUS_MAP.exam_done = 'interviewed'` (`admissions.service.ts:94`) | inspect + clarify/refactor |

**Net:** of the 5 headline concerns, 4 are already implemented correctly; only
**#8 capacity concurrency** is a genuine code gap, and **#5/#10** are wording/modeling
decisions. The reviewer's instinct on P0 security/atomicity was right to raise, but
the code already satisfies them — they need documentation + a regression test, not a rewrite.

---

## 1. Document requirement engine (CONFIRMED — keep)

No change. Requirements are configured per org via `Admissions Config → Requirements`
(`kind ∈ {document, field, fee}`, `gate ∈ {submit, enroll}`, `code`, `label`, `required`).
`AdmissionRequirement` drives both gates. Keep the separation between *requirement
configuration* and *application document workflow*.

## 2. Submit gate (CONFIRMED — keep)

`submitApplication` (`admissions.service.ts:448`):
- status must be `draft`.
- `missingSubmitRequirements()` resolves required `gate='submit'` requirements for the
  cycle/class. Any missing **document** (type not attached) or **field** (value empty)
  → route to `documents_pending` instead of `submitted`.
- Returns `{ status, missing[] }` so the UI can show exactly what is outstanding.

## 3. Verification ≠ attachment (CONFIRMED — keep)

`ApplicationDocument`: `Missing → Attached → Verified`, plus `Attached → Rejected`
(with required reason). The `ApplicationDocuments` panel exposes attach (upload via
platform File service) + verify/reject. Server enforces reject-reason.

## 4. Enrollment gate (CONFIRMED — keep, clarify fee)

`checkEligibility` (`admissions.service.ts:1703`) blocks `enroll()` unless ALL hold:
1. `status === 'offer_accepted'`
2. offer on file, not withdrawn, not expired
3. **all required documents `verified`** (`d.required && !d.verified` → blocked)
4. **application fee settled** — see §9 for the precise definition
5. a seat is available — see §8 for the concurrency fix

The same `checkEligibility` backs `GET /school/admissions/:id/eligibility` (information)
**and** is re-run inside `enroll()` (authority). UI eligibility is never the security boundary.

## 5. Terminology fix (FIX — docs only)

Replace the summary line:

> ~~Every button is a single guarded FSM transition.~~

with:

> **Every status-changing action is enforced by a backend domain operation. Review
> actions use the guarded FSM (`POST /review`); offer and enrollment operations
> (`POST /offer`, `/offer/accept`, `/offer/decline`, `/enroll`) have their own
> guards and transactional rules. The backend is the authority and rejects any
> illegal transition regardless of what the UI shows.**

## 6. Portal security (CONFIRMED — add invariant + test)  [P0]

Current design (`admissions-portal.controller.ts`, `admissions-portal.service.ts`):
- `@Public()` routes (`GET application`, `POST offer/accept`, `POST offer/decline`,
  `POST :id/link`) are authorized **solely by a magic-link `token`** (query param).
- Token = `randomBytes(32)` raw, stored as `tokenHash = sha256(raw)`; resolved by
  re-hashing. Unguessable (256-bit), and `resolveToken` returns **exactly one**
  `{ organizationId, applicationId }`. Every operation re-derives the applicationId
  from the token — **never trusts a caller-supplied `applicationId`**.
- Therefore Applicant A cannot read/upload/accept B's application: they have no B token.

**Action (not a code change, a guarantee + test):**
- Add a regression test asserting: a valid token for app A returns 403/404 when used
  against an endpoint that would leak app B (negative test with a different app id in
  the path after token resolution is impossible by construction — assert the resolved
  applicationId is bound).
- Document the invariant in the spec: *"Public portal ops are bound to an unguessable
  per-application credential; the applicationId is never taken from the request body
  or path as authorization."*

## 7. Enrollment atomicity (CONFIRMED — document)  [P0]

`enroll()` (`admissions.service.ts:656`) runs inside `prisma.client.$transaction`.
`enrollNewStudent(input, tx)` (`enrollment.service.ts:84`) accepts the **same `tx`**
and performs, atomically:
`StudentPartner.create → StudentProfile.create → Enrollment.create →
StudentStatusHistory.create → StudentGuardian.create(s) → (caller) promoteGuardians +
applyReview('enroll')`. Any failure ⇒ full `ROLLBACK`. Idempotency: one active
enrollment per `(applicationId, termId)` is guarded inside the tx.

**Action:** document this guarantee in the spec; no code change.

## 8. Capacity concurrency (FIX — real gap)  [P0]

**Problem.** `resolveCapacity` computes `available = capacity - reserved - occupied`,
where `occupied = Enrollment.count(active)`. In `enroll()`, `checkEligibility(tx, …)`
reads this count **inside** the transaction but takes **no row lock**. With one seat
free, two admins clicking Enroll concurrently can both read `available=1`, both pass
the gate, both `Enrollment.create` ⇒ **over-admission**.

**Fix (concurrency-safe seat reservation).** Add a `claimedSeats` counter (or use the
existing `AdmissionCapacity` row) and reserve atomically under the enroll transaction:

1. In `enroll()`, after `checkEligibility` but before `enrollNewStudent`, perform a
   **conditional update** on the `AdmissionCapacity` row:
   ```ts
   const reserved = await tx.admissionCapacity.updateMany({
     where: { id: cap.id, claimedSeats: { lt: cap.capacity - cap.reservedCapacity } },
     data: { claimedSeats: { increment: 1 } },
   });
   if (reserved.count === 0) throw new BadRequestException('No seat available');
   ```
   `updateMany` with a `where` on the counter is atomic at the DB row level, so two
   concurrent transactions serialize — the second finds `claimedSeats` already at the
   limit and fails. (Alternatively: `tx.admissionCapacity.findFirst({ where:{id}, lock:{mode:'update'} })`
   in Prisma 6, then assert `available >= 1`.)
2. On successful enrollment the `claimedSeats` stays incremented (it represents a
   committed seat). `countOccupied` remains the source for "currently enrolled";
   `available` should be reported as `capacity - reserved - claimedSeats` so the UI
   reflects real-time claims.
3. If enrollment is later reversed (withdraw/enrolment cancelled), decrement
   `claimedSeats` in the same reversal transaction.

**Verification:** a concurrency E2E — two parallel `POST /enroll` into a class with
capacity 1 and two `offer_accepted` apps — must yield exactly one `enrolled` and one
`400 no seat available`.

## 9. "Fee settled" precise definition (CONFIRMED — document)  [P1]

`checkEligibility` blocks on fee **only** when an application fee was actually charged:
- `app.fee` exists and `!app.fee.paid` ⇒ blocked ("application fee outstanding")
- no `app.fee` record **but** `app.feeStatus === 'pending'` ⇒ blocked
- no fee record and `feeStatus` not pending ⇒ **not** blocked (schools that don't
  charge an application fee are never blocked by an absent record)

This is the **application/admission fee**, deliberately **not** the term-fee balance.
Enrollment eligibility must NOT require `termBalance === 0`. Document this explicitly
so it is not "assumed complete" later.

## 10. `exam_done → interviewed` (DECIDE — modeling)  [P1]

`STATUS_MAP.exam_done = 'interviewed'` (`admissions.service.ts:94`) means completing an
exam routes the application to `interviewed`. Semantically that reads as "exam done ⇒
interview done," which is wrong unless `interviewed` is interpreted broadly as
*"evaluation completed."*

**Decision required before finalizing:**
- **Option A (keep, document):** define `interviewed` = "evaluation stage complete
  (interview and/or exam done)." Minimal risk; just rename the label/meaning in
  `admission-status.ts` and document it. No schema change.
- **Option B (refactor):** introduce an explicit `evaluated` status between exam/scoring
  and the decision, so `exam_done → evaluated` and `complete_interview → evaluated`,
  leaving `interviewed` strictly for interviews. Cleaner domain model; small FSM +
  UI `NEXT_ACTIONS` update.

Recommended: **inspect how `interviewed` is consumed** (reports, dashboards, the
committee view). If nothing assumes "an interview actually happened," take Option A;
otherwise Option B. This is the only item that may need a schema/FSM change.

---

## 11. Revised implementation checklist

| Task | Type | Status |
|------|------|--------|
| Document requirement engine | keep | done |
| Submit gate → `documents_pending` | keep | done |
| Verification ≠ attachment + reject reason | keep | done |
| Enrollment gate (offer+docs+fee+seat) | keep | done |
| Portal token scoping | confirm + test | **to add test** |
| Enrollment atomicity | confirm + doc | **to document** |
| **Capacity seat-reservation (concurrency)** | **FIX** | **to implement** |
| Fee rule precise definition | confirm + doc | **to document** |
| `exam_done → interviewed` modeling | decide | **to inspect/decide** |
| Terminology summary line | docs | **to update** |

## 12. Verification plan (post-change)

1. Re-run the live admissions E2E (cycles, nationalities, app CRUD, review reason
   enforcement, duplicate detection, document attach/verify) on `:3011`.
2. **New:** portal isolation test — token A cannot act on app B.
3. **New:** capacity concurrency test — 2 parallel enrolls into a 1-seat class ⇒
   exactly 1 succeeds.
4. `GET /eligibility` shows `BLOCKED` with the specific missing item (doc/fee/seat)
   for each failure mode; `enroll()` returns the same message on the same input.
