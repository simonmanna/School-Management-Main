# School Admissions — Detailed Revised Plan (v3)

> **Status:** Architecture from v2 accepted. This v3 settles the four open decisions,
> adds the **stages-vs-conditions** separation, the **snapshot immutability** invariant,
> and a **strict Phase-1-first** implementation sequence (T1–T11, backend before UI).
> All items verified against the current code (`admissions.service.ts`,
> `admissions-portal.*`, `enrollment.service.ts`, `schema.prisma`).

---

## 0. Settled decisions (from review)

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| 1 | `exam_done → interviewed` | **Keep for V1; document** `interviewed` = "evaluation completed" | Avoids unnecessary FSM migration; verify consumers first |
| 2 | Evaluation sub-steps | **Configuration flags**, not top-level stages | Screening/interview/exam are activities inside Evaluation |
| 3 | Presets | **Presets + per-cycle customization** | Best UX; admins start from a preset, then tweak |
| 4 | Workflow scope | **AdmissionCycle only** | Sufficient for V1; defer Cycle+Class |

**Sequencing rule:** complete **Phase 1 (harden existing engine)** before any Phase 2
work. In particular, do **not** build workflow UI before the backend resolver (T7) and
enforcement (T8) exist.

---

## 1. Two distinct concepts (the central refinement)

### 1.1 Workflow stages — *which business stages this school requires*
Configured per `AdmissionCycle`. Answers:
> "Does this school require Evaluation / Decision / Offer / Applicant-Acceptance
> between Application and Enrollment?"

Stages: `APPLICATION → EVALUATION → DECISION → OFFER → APPLICANT_ACCEPTANCE → ENROLLMENT`.
Each stage: `enabled` + `required`. Evaluation additionally carries sub-step flags
(`screening`, `interview`, `exam`: each `required`/`optional`/`skip`).

### 1.2 Required conditions / eligibility — *what must be true before an operation runs*
**Not part of the workflow.** These are the safety gates, already implemented:
- Enrollment-required documents **verified**
- Application fee satisfied (when configured)
- Capacity available
- (Offer valid/accepted when the workflow routes through Offer)

The separation, exactly as the reviewer framed it:
```
Workflow config  →  "Which business stages are required?"
Eligibility       →  "What must be true before the operation can happen?"
```
So `Application → Enrollment` does **not** mean "nothing is checked" — the Enroll
operation still enforces verified docs / fee / capacity. The workflow only removes the
*business stages* (Decision, Offer, Acceptance), never the *conditions*.

### 1.3 How the Enroll button behaves (UI + backend contract)
```
Workflow resolver
   └─ ENROLLMENT is the next required stage?
         ├─ yes → show "Enroll" action
         │         └─ GET /eligibility
         │               ├─ Eligible   → enable Enroll, show no warnings
         │               └─ Blocked    → disable Enroll, show exact reasons
         └─ no  → do not show Enroll
```
**The backend independently re-runs the same eligibility inside `enroll()`.** The UI's
eligibility result is information only; it is never the security boundary.

---

## 2. Domain model (mirrors existing `ApprovalWorkflow` pattern)

### `AdmissionWorkflow`
```
id              String   @id @default(uuid())
organizationId  String
name            String
description     String?
isDefault       Boolean  @default(false)
active          Boolean  @default(true)
createdAt       DateTime @default(now())
updatedAt       DateTime @updatedAt
@@index([organizationId])
```

### `AdmissionWorkflowStage`
```
id           String  @id @default(uuid())
workflowId   String
organizationId String
stage        AdmissionStageEnum   // APPLICATION|EVALUATION|DECISION|OFFER|APPLICANT_ACCEPTANCE|ENROLLMENT
enabled      Boolean @default(true)
required     Boolean @default(true)
order        Int
// Evaluation-only sub-steps (ignored for other stages):
screening    EvaluationStepEnum @default(required)  // required|optional|skip
interview    EvaluationStepEnum @default(required)
exam         EvaluationStepEnum @default(required)
createdAt    DateTime @default(now())
@@unique([workflowId, stage])
@@index([organizationId, workflowId])
```
Enum `EvaluationStepEnum { required optional skip }`.

### Assignment & snapshot (immutability)
- `AdmissionCycle.workflowId  String?` (FK → `AdmissionWorkflow`)
- `AdmissionApplication.workflowId  String?` — **snapshot at creation** (copy from the
  cycle; fall back to the org's `isDefault` workflow; if none, fall back to built-in
  `Standard`).
- Resolver reads `application.workflowId` (snapshot). Historical apps keep their process
  even after the cycle/org default changes.
- **Invariant (new, hard):** *Once an application is created, its workflow snapshot
  determines its required stages for its entire lifecycle, unless an explicit
  administrative migration is performed.* Changing cycle/org config never retroactively
  alters an in-progress application.

### Presets (seeded per org on first run)
| Preset | Stages enabled/required | Resulting path |
|--------|------------------------|----------------|
| 🟢 Simple | App req · Eval **off** · Decision off · Offer off · Acceptance off · Enroll req | `Application → Enrollment` |
| 🔵 Standard | App req · Eval(req, all sub-steps optional) · Decision req · Offer req · Acceptance req · Enroll req | `Application → Decision → Offer → Acceptance → Enrollment` |
| 🟣 Selective | App req · Eval(req, screening+interview+exam **required**) · Decision req · Offer req · Acceptance req · Enroll req | `Application → Screening → Interview → Exam → Decision → Offer → Acceptance → Enrollment` |

> Note the Standard preset in this plan drops the optional Evaluation from the *required*
> path (offer/acceptance is the meaningful gate for most schools); Selective makes eval
> sub-steps mandatory. Both are tunable per cycle.

---

## 3. Stage-completion map (resolver inputs)

| Stage | Complete when (FSM status) |
|-------|----------------------------|
| APPLICATION | `submitted` (or `documents_pending` resolved) |
| EVALUATION | `scored`, **or** all *enabled* eval sub-steps satisfied (exam-required ⇒ `scored`; interview-required ⇒ `interviewed`; screening-required ⇒ `screening` done; optional/skip sub-steps don't block) |
| DECISION | `accepted` \| `waitlisted` \| `rejected` |
| OFFER | `offer_issued` |
| APPLICANT_ACCEPTANCE | `offer_accepted` |
| ENROLLMENT | `enrolled` |

---

## 4. Workflow resolver (backend, T7)

New `AdmissionsWorkflowService` (or methods on `AdmissionsService`):

```
getWorkflowForApp(app) → AdmissionWorkflow        // from app.workflowId
stages(workflow) → ordered Stage[]                // with enabled/required + eval flags
completion(app) → Map<Stage, boolean>            // using §3 map
nextRequiredStage(app) → Stage | null            // first required stage not complete
permittedActions(app) → ActionSpec[]             // concrete buttons for current status,
                                                  //   gated by nextRequiredStage
validateProgress(app, targetStage) → void        // throws if a REQUIRED stage between
                                                  //   current and target is skipped
```

`permittedActions` replaces the hardcoded `NEXT_ACTIONS[status]` (in
`admission-status.ts`) *for button rendering*. It still returns review/offer/enroll
actions, but only those consistent with the next required stage. Example: if
`OFFER`/`ACCEPTANCE` are disabled, after `submitted` the next required stage is
`ENROLLMENT`, so `permittedActions` returns `{ action: 'enroll' }` (subject to
eligibility) instead of `review`/`issue_offer`.

### Backend enforcement hook (T8)
Inside `applyReview` / `issueOffer` / `acceptOffer` / `enroll`, **before** the FSM
transition:
```
1. FSM-legal?        (ADMISSION_TRANSITIONS)            → else 400/409
2. Workflow-progress? (validateProgress: no REQUIRED
   stage skipped)                                      → else 409 naming skipped stage
3. Eligibility gates (docs/offer/fee/capacity)          → else 400 with reasons
```
Order matters: legality → workflow → gates. This guarantees a school cannot configure
away a safety rule, and cannot jump a required stage.

---

## 5. Non-configurable invariants (never skippable)

1. Enrollment requires a valid application.
2. Enrollment-required documents **must be verified**.
3. Capacity is **never exceeded** (Phase-1 fix).
4. Application-fee requirement satisfied **when configured** (app fee only, not term balance).
5. Portal: applicant acts only on their own application (token-scoped).
6. Every consequential action is audited.
7. Enrollment promotion is atomic (single transaction).
8. FSM transition legality (`ADMISSION_TRANSITIONS`) always checked.
9. **(NEW)** Workflow configuration cannot invalidate an existing application — its
   snapshot is authoritative unless an explicit migration is run.

---

## 6. Phase 1 — Harden the existing engine (DO FIRST)

### P1.1 Capacity concurrency (the only true code gap)
`occupied` is a derived `Enrollment.count` read with no lock → two concurrent enrolls
into a 1-seat class both pass. Fix in `enroll()` (inside its `$transaction`):
- Add `claimedSeats Int @default(0)` to `AdmissionCapacity`.
- Before `enrollNewStudent`, atomically reserve:
  ```ts
  const reserved = await tx.admissionCapacity.updateMany({
    where: { id: cap.id, claimedSeats: { lt: cap.capacity - cap.reservedCapacity } },
    data: { claimedSeats: { increment: 1 } },
  });
  if (reserved.count === 0) throw new BadRequestException('No seat available');
  ```
- UI `available` = `capacity − reservedCapacity − claimedSeats`.
- On enrolment reversal (withdraw/cancel), decrement `claimedSeats` in the same tx.

### P1.2 Concurrency E2E (`:3011`, schooldb-planet)
- capacity = 1, **2 simultaneous** `POST /enroll` → exactly **1** `enrolled`, **1** `400 no seat`.
- capacity = 2, **3 simultaneous** → exactly **2** succeed, **1** fails.

### P1.3 Portal isolation test
- Issue token for Application A; `GET …/portal/application?token=A` → 200.
- Same token used against any path that would resolve Application B → 403/404 (by
  construction the token only resolves A; assert no B data leaks).

### P1.4 Enrollment rollback test
- Force a failure mid-`enroll()` (e.g. throw after `StudentProfile.create`).
- Assert **full rollback**: no `Partner`, `StudentProfile`, `Enrollment`,
  `StudentGuardian`, `StudentStatusHistory` rows; application remains `offer_accepted`.
- (Confirms the existing `$transaction` + threaded `tx` actually rolls back — locks in
  the P0 atomicity claim with a test.)

Phase 1 is "done" only when P1.1–P1.4 are implemented and green.

---

## 7. Phase 2 — Configurable workflow (T1–T11, backend before UI)

```
T1  AdmissionWorkflow schema          (model + migration/DDL)
T2  AdmissionWorkflowStage schema     (model + eval flags + enum)
T3  Evaluation configuration          (eval-flag reading in resolver/completion)
T4  Workflow presets                  (seed Simple/Standard/Selective per org)
T5  Cycle → workflow assignment       (AdmissionCycle.workflowId + cycle form field)
T6  Application workflow snapshot     (POST /admissions copies workflowId from cycle/default)
T7  Workflow resolver                 (getWorkflowForApp, completion, nextRequiredStage,
                                      permittedActions, validateProgress)
T8  Backend enforcement               (hook resolver into applyReview/issueOffer/
                                      acceptOffer/enroll; reject skipped-required-stage)
T9  UI action resolver                (admissions.tsx / applications.tsx / application-form.tsx
                                      render from permittedActions; Enroll enabled per §1.3)
T10 Workflow settings UI              (Settings → School → Admissions Workflow)
T11 E2E workflow tests                (see §9)
```
**Rule:** no UI (T9/T10) before T7/T8 exist. The backend defines "next stage" first.

### T10 UI — Admission Workflow Settings (final V1 target)
```
Admission Workflow
Workflow: [Standard Admission ▾]           For: [2026 Term 1 Admissions ▾]
┌──────────────────────────────────┐
│ ☑ Application                    │
├──────────────────────────────────┤
│ ☑ Evaluation                     │
│    ☑ Screening                    │
│    ☑ Interview                    │
│    ☐ Entrance Examination         │
├──────────────────────────────────┤
│ ☑ Decision                       │
├──────────────────────────────────┤
│ ☑ Offer                          │
├──────────────────────────────────┤
│ ☑ Parent Acceptance              │
├──────────────────────────────────┤
│ ☑ Enrollment                     │
└──────────────────────────────────┘
[Use preset: Simple | Standard | Selective]   [Save Workflow]
```
Presets pre-fill the toggles; admin customizes; Save writes the org workflow + assigns
it to the selected cycle.

---

## 8. Endpoint / code changes checklist

**Backend**
- `schema.prisma`: `AdmissionWorkflow`, `AdmissionWorkflowStage`, `AdmissionCapacity.claimedSeats`,
  `AdmissionCycle.workflowId`, `AdmissionApplication.workflowId`; migration + idempotent DDL.
- `admissions.service.ts`: `enroll()` seat-reservation (P1.1); snapshot on create (T6);
  enforcement hook (T8).
- `admissions-portal.service.ts`: already token-scoped (confirm test P1.3).
- New `admissions-workflow.service.ts`: resolver (T7) + preset seed (T4).
- `admissions.controller.ts` / config controller: `GET/PUT /school/admissions/workflows`,
  `POST /school/admissions/workflows/assign` (or via cycle update), `GET /school/admissions/:id/workflow`.

**Frontend**
- `api.ts`: `useAdmissionWorkflow`, `useAdmissionWorkflowStages`, `useAssignWorkflow`,
  `useApplicationWorkflow` hooks.
- `admission-status.ts`: `NEXT_ACTIONS` becomes a fallback; `permittedActions(app)` from
  resolver drives buttons.
- `admissions.tsx` / `applications.tsx` / `application-form.tsx`: render from
  `permittedActions`; Enroll enabled per eligibility (§1.3).
- **New** `Settings → School → Admissions Workflow` page (T10) with preset picker.
- Application-form / cycle form: workflow assignment field.

---

## 9. Verification matrix (E2E on `:3011`)

| # | Test | Expected |
|---|------|----------|
| 1 | Capacity = 1, 2 parallel enroll | 1 enrolled, 1 `400 no seat` |
| 2 | Capacity = 2, 3 parallel enroll | 2 enrolled, 1 `400` |
| 3 | Portal token A → app B | 403/404, no leak |
| 4 | Enroll mid-failure | full rollback; app stays `offer_accepted` |
| 5 | Simple workflow: `submitted → enroll` | enrolled **only if** eligibility passes; skip a gate → `400` |
| 6 | Selective workflow: full path | submit → eval(screen+interview+exam) → decision → offer → accept → enroll |
| 7 | Skip guard: OFFER required, attempt enroll from `submitted` | `409` naming skipped stage |
| 8 | Snapshot immutability: change cycle workflow after app created | app keeps original required stages |
| 9 | Standard preset: `decision → offer → acceptance → enroll`, no eval | path works; eval sub-steps optional |
| 10 | Eligibility UI vs backend: disable Enroll when `GET /eligibility` BLOCKED; backend still blocks if client bypasses | both agree; backend authoritative |

Reuse the existing admissions + document-attach E2E as the baseline; add 1–10 as a new
`school-admissions-workflow.e2e` suite.

---

## 10. Explicit instruction set (hand this to the implementing agent)

> **1.** Keep `exam_done → interviewed` for V1; document `interviewed` as
> "evaluation completed" after verifying its consumers. Do **not** add `evaluated`.
> **2.** Keep evaluation sub-steps as configuration flags, not top-level stages.
> **3.** Use presets + per-cycle customization.
> **4.** Scope workflows to `AdmissionCycle` for V1; defer Cycle+Class.
> **5.** Implement **Phase 1 hardening first** (capacity concurrency + concurrency /
> portal-isolation / rollback E2E), then Phase 2 T1–T11 **backend before UI**.
> **6.** Never let workflow config skip a safety gate (docs/offer/fee/capacity/FSM);
> enforce via resolver + re-run eligibility in `enroll()`.
> **7.** Snapshot `workflowId` on application creation; never retro-classify in-progress
> applications when cycle/org config changes.
