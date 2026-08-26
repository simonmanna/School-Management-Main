# School Admissions — Revised Implementation Plan (v2)

> Merges two inputs:
> **(A)** the independent code review (5 concerns — mostly already satisfied, 1 real gap)
> **(B)** the configurable-workflow requirement: schools must be able to go
>   `Application → Enrollment` directly, or skip any subset of
>   `Evaluation → Decision → Offer → Applicant Acceptance`, while **safety gates
>   (documents / offer / fee / capacity / FSM legality) are never skippable.**
>
> Verified against the actual code (`admissions.service.ts`, `admissions-portal.*`,
> `enrollment.service.ts`, `schema.prisma`). The codebase already has an
> `ApprovalWorkflow`/`ApprovalWorkflowStep` model (schema ~L4260–4363) — the new
> `AdmissionWorkflow` should mirror that proven shape.

---

## 0. Core architecture principle

```
                 ADMISSION WORKFLOW (config)
                          │
            "Which stages are REQUIRED for this cycle?"
                          │
                          ▼
                   Workflow Resolver
            (next required stage · permitted actions)
                          │
                          ▼
              ┌──────────────────────────┐
              │  Existing FSM (safety)    │  ADMISSION_TRANSITIONS — always checked
              │  + Eligibility gates      │  docs / offer / fee / capacity — always enforced
              └────────────┬─────────────┘
                           ▼
                    Domain Operation → Persistence + Audit
```

- **The workflow config controls the *process* (which stages are required).**
- **The FSM + eligibility gates control *safety* (whether a transition is legal and
  whether the applicant is ready).** Configuration can skip *stages*; it can **never**
  skip *gates*.
- Do **not** let admins configure raw transitions (e.g. `draft → enrolled`). Configure
  **stages** only. The resolver decides the next permitted action from the required
  stages, not from free-form button wiring.

---

## 1. Domain model (mirrors `ApprovalWorkflow`)

### `AdmissionWorkflow`
```
id, organizationId, name, description, isDefault (bool), active (bool)
```

### `AdmissionWorkflowStage`
```
workflowId, stage, enabled (bool), required (bool), order (int)
@@unique([workflowId, stage])
```
`stage ∈ { APPLICATION, EVALUATION, DECISION, OFFER, APPLICANT_ACCEPTANCE, ENROLLMENT }`

### Evaluation sub-steps (keep FSM stable — model as flags, not new stages)
Add to `AdmissionWorkflowStage` (or a sibling `AdmissionWorkflowEvalStep`):
```
stage = 'EVALUATION'  →  screening: required|optional|skip
                          interview: required|optional|skip
                          exam:      required|optional|skip
```
Rationale: the underlying FSM statuses (`screening`, `interview_scheduled`,
`exam_scheduled`, `scored`) stay in the model; the workflow only marks them
*not required this cycle*. This honours review item #5 ("don't delete underlying
statuses when a stage is disabled").

### Assignment & immutability (review proposal #16 — critical)
- `AdmissionCycle.workflowId` (FK) — **the cycle owns the workflow.**
- `AdmissionApplication.workflowId` — **snapshot at creation** (copy from the cycle,
  falling back to the org default). Once set, it does not change when the org default
  or cycle workflow is later edited. This prevents retroactively altering an
  in-progress application.
- Resolver reads `application.workflowId` (snapshot) so historical apps keep their
  process even after config changes.

### Presets (seed on first run / per org)
- 🟢 **Simple**: `APPLICATION` req · `EVALUATION` off · `DECISION` off · `OFFER` off ·
  `APPLICANT_ACCEPTANCE` off · `ENROLLMENT` req → `Application → Enrollment`
- 🔵 **Standard**: App req · Eval(req, all sub-steps optional) · Decision req · Offer
  req · Acceptance req · Enrollment req → full standard path
- 🟣 **Selective**: App req · Eval(req, screening+interview+exam **required**) ·
  Decision req · Offer req · Acceptance req · Enrollment req

---

## 2. Stage-completion semantics (resolver inputs)

| Stage | Considered complete when (FSM status) |
|-------|----------------------------------------|
| APPLICATION | `submitted` (or `documents_pending` → resolved) |
| EVALUATION | `scored`, **or** all *enabled* eval sub-steps satisfied (if exam required → `scored`; if interview required → `interviewed`; etc.) |
| DECISION | `accepted` \| `waitlisted` \| `rejected` |
| OFFER | `offer_issued` |
| APPLICANT_ACCEPTANCE | `offer_accepted` |
| ENROLLMENT | `enrolled` |

The resolver answers: *"Given this application's status and its (snapshot) workflow,
what is the next **required** stage, and what action(s) may the UI show now?"*

---

## 3. Workflow resolver (new service)

`getAdmissionWorkflow(application)` → returns ordered stages + which are complete.
`nextRequiredStage(application)` → first required stage not yet complete.
`permittedActions(application)` → the concrete buttons available now:
- If next required stage is `ENROLLMENT` → show **Enroll Student** (even if status is
  merely `submitted`). Enrollment still runs the full eligibility gate.
- If `OFFER` is required but `APPLICANT_ACCEPTANCE` is not → after `offer_issued`, the
  next required stage is `ENROLLMENT` (skip acceptance).
- Normal review/FSM actions remain available within a stage.

**Backend enforcement hook:** before applying any transition in `applyReview`,
`issueOffer`, `acceptOffer`, `enroll`, validate:
```
FSM-legal (ADMISSION_TRANSITIONS)                          AND
workflow-allows-this-progress (no REQUIRED stage skipped)  AND
eligibility gates pass (docs/offer/fee/capacity)
```
If an operation would jump a *required* stage (e.g. enroll from `submitted` when
`OFFER` is required), reject with `409 / 400` naming the skipped required stage.

---

## 4. Non-configurable system invariants (NEVER skippable)

Regardless of workflow config, the backend enforces:
1. Enrollment requires a valid application.
2. Enrollment-required documents **must be verified**.
3. Capacity is **never exceeded** (see §6 fix).
4. Application-fee requirement satisfied **when configured** (app fee only, not term balance).
5. Portal: applicant can only act on their own application (token-scoped).
6. Every consequential action is audited.
7. Enrollment promotion is atomic (single transaction).
8. FSM transition legality (`ADMISSION_TRANSITIONS`) is always checked.

---

## 5. Carried-over review fixes (from v1)

| Item | Verdict | Work |
|------|---------|------|
| Portal security (P0) | CONFIRMED safe (hashed magic-link token scoped to one appId) | add isolation test + document |
| Enrollment atomicity (P0) | CONFIRMED (single `$transaction`, `tx` threaded) | document |
| Fee "settled" (P1) | CONFIRMED = application fee only | document rule |
| Terminology | FIX (docs) | update summary line |
| `exam_done → interviewed` (P1) | DECIDE | inspect consumers; Option A (document `interviewed`="evaluation complete") or Option B (add `evaluated` status) |
| **Capacity concurrency (P0)** | **REAL GAP** | **seat-reservation counter (see §6)** |

### §6 Capacity concurrency fix (the only true code gap)
`occupied` is a derived `Enrollment.count` read with no lock → two concurrent enrolls
into a 1-seat class both pass. Fix: add `claimedSeats` to `AdmissionCapacity` and
reserve atomically inside `enroll()`'s transaction:
```ts
const reserved = await tx.admissionCapacity.updateMany({
  where: { id: cap.id, claimedSeats: { lt: cap.capacity - cap.reservedCapacity } },
  data: { claimedSeats: { increment: 1 } },
});
if (reserved.count === 0) throw new BadRequestException('No seat available');
```
(Prefer over a raw `FOR UPDATE` for portability.) Recompute UI `available` as
`capacity − reserved − claimedSeats`. Decrement on enrolment reversal.

---

## 7. Phase plan

### Phase 1 — Stabilize (review items)
1. **Capacity seat-reservation** (§6) — implement + concurrency E2E.
2. Portal isolation test (token A ≠ app B).
3. Enrollment atomicity test (already true; lock it in).
4. Document fee-eligibility rule + terminology fix.
5. Decide `exam_done → interviewed` (Option A/B).

### Phase 2 — Configurable workflow
- **T1 Domain model:** `AdmissionWorkflow`, `AdmissionWorkflowStage` (+ eval flags),
  `AdmissionCycle.workflowId`, `AdmissionApplication.workflowId` (snapshot). Prisma
  migration + idempotent Ddl.
- **T2 Presets:** seed Simple / Standard / Selective per org.
- **T3 Resolver service:** `getAdmissionWorkflow`, `nextRequiredStage`,
  `permittedActions`, `validateWorkflowProgress`.
- **T4 Backend enforcement:** call the resolver inside `applyReview` / `issueOffer` /
  `acceptOffer` / `enroll`; reject skipped-required-stage transitions.
- **T5 UI — Admission Workflow Settings** (Settings → School → Admissions Workflow):
  the 6 stages with required/optional/skip toggles + eval sub-step flags; Save;
  "use preset" (Simple/Standard/Selective) + custom. Assign workflow on the
  Admission Cycle form (org default preselected).
- **T6 UI — pipeline reflects resolver:** `admissions.tsx` / `applications.tsx` /
  `application-form.tsx` render buttons from `permittedActions(application)` instead of
  the hardcoded `NEXT_ACTIONS[status]`. Direct-Enroll button appears whenever
  `ENROLLMENT` is the next required stage.
- **T7 Snapshot on create:** `POST /school/admissions` snapshots
  `workflowId` from the cycle (or org default).

---

## 8. Verification (E2E on `:3011`)

Reuse the existing admissions + docs E2E, plus:
1. **Simple workflow:** `submitted → enroll` directly (no offer). Assert eligibility
   still enforces verified docs / fee / capacity (skip a gate → `400`).
2. **Selective workflow:** full path `submit → eval(screen+interview+exam) → decision →
   offer → accept → enroll`.
3. **Skip guard:** Simple workflow but attempt `enroll` when `OFFER` is required
   (reconfigure) → `400` naming the skipped stage.
4. **Immutability:** change org default workflow after an app is created → app keeps its
   snapshotted workflow (resolver returns the original stage set).
5. **Capacity concurrency:** 2 parallel enrolls into a 1-seat class ⇒ exactly 1
   succeeds.
6. **Portal isolation:** token A cannot read/act on app B.

---

## 9. Open decisions (need your call)

1. **`exam_done → interviewed`** — Option A (document `interviewed` = "evaluation
   complete") vs Option B (add `evaluated` status). *Recommend inspect consumers first.*
2. **Eval sub-steps as flags vs stages** — *Recommend flags under `EVALUATION` stage
   (keeps FSM stable).*
3. **Presets + custom** — ship 3 presets and allow per-cycle custom toggle (recommended)
   vs free-form only.
4. **Workflow scope** — per `AdmissionCycle` (recommended) vs also per
   `AdmissionCycle + Class` (defer; resolver can support later).
