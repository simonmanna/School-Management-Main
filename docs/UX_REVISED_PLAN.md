# Revised School Workflow & UX Plan (v2)

> Goal: keep the strong backend (atomic create, transactional enrollment, append-only mark
> ledger, approval + publish separation) but make the **frontend hide that complexity** behind
> task- and role-oriented journeys. The database stays sophisticated; the UI becomes obvious.
>
> Grounded in the actual code as of 2026-08-30:
> - Nav: `apps/web/src/components/layout/app-shell.tsx` (`NAV_SECTIONS`)
> - Student 360: `apps/web/src/pages/school/student-360.tsx` (tabs, NO "Academics")
> - Create: `students.tsx` → `POST /school/students`; Enroll: `enrollment.service.ts`
> - Marking: `marking.service.ts` + `apps/web/src/pages/school/{gradebook,enter-marks,assessments}.tsx`
> - Approvals: `apps/web/src/pages/school/approvals.tsx` (`school:approveGrades`)
> - Results: `result-run.service.ts` + `apps/web/src/pages/school/exam-results.tsx`
> - Promotion: `apps/web/src/pages/school/promotion.tsx` (`usePromoteStudent`, `useRollover`)

---

## 0. What is ALREADY right (do not touch)

- **Teaching & Assessment** leads with `Assessments` (not a numbered wizard) — teacher lands where they work. ✅
- **Approvals** is its own screen gated by `school:approveGrades`; teachers cannot approve own marks. ✅
- **Enrollment** is transactional and syncs `currentClassId`. ✅
- **Marks** use `MarkEntry` rounds + append-only `MarkAdjustment`; `effectiveScore` is always derived. ✅
- Nav is **permission-gated** already (`PERMISSIONS.school.*`), so role differences are partly free.

The gap is three concrete things, not a backend rewrite.

---

## 1. Student 360: add an **Academics** tab (highest-value, lowest-risk)

Today `student-360.tsx` tabs are:
`Profile | Portal | Fees | Attendance | Documents | Medical | Library | Meals | Transport | Activities`
— but NO academic picture. For a parent/teacher/admin the academic summary is the #1 thing.

**Add tab `Academics`** (place it 2nd, right after Profile) showing, per term:
```
2026 · Term 2
P4 A
  Mathematics   78%
  English       84%
  Science       71%
  SST           80%
[ Term 1 | Term 2 | Term 3 ]
```
- Data already available: `useStudent(id)` (currentClass), `useReportCards(id)` (`api.ts:1315`),
  and `MarkEntry`/`StudentAssessment` aggregates behind `result-run.service.ts`.
- Reuse the existing `ResultSet`/`ReportCard` shape — no new backend endpoint needed for the summary;
  if a lightweight per-term subject% isn't exposed, add `GET /school/students/:id/academics` that reads
  approved `StudentAssessment.effectiveScore` grouped by term+subject.

**Why:** this is the review's single strongest point and the cheapest win. One tab, reads existing data.

---

## 2. Two create paths — keep Advanced, add **Quick Register & Place**

The review is correct: a secretary thinks "register this child in P4", not
"create StudentProfile then Enrollment".

**Keep** the current `Students → + Add Student` (name, DOB, guardian, category…) as the
*Advanced* path (no class yet). It already works.

**Add** a one-step **"Quick Register & Place"** action on the Students list:
```
Name | Admission No | DOB | Gender | Guardian | Class | Section | Stream | Term | Roll No
[ Save & Enroll ]
```
- Frontend: a dialog in `students.tsx` that calls `POST /school/students` then
  `POST /school/enrollments` (or reuse Admissions' `enrollNewStudent` which already does both
  atomically in one tx — expose it as a direct "register" endpoint if not already).
- Backend: `enrollment.service.ts:85 enrollNewStudent()` already creates Partner+Profile+Enrollment
  + guardian links in one transaction. Wrap it behind `POST /school/students/register` for the UI.
- Result: one operation, pupil appears placed in P4 A, no second screen.

**Labeling:** never show "Enrollment record". Say **"Current Academic Placement"** (see §5).

---

## 3. Results: add a **Readiness Gate** before Publish

Today `exam-results.tsx` only checks `examId && classId`. The review's readiness concept is the
right guard.

Add a `GET /school/results/readiness?termId=&classId=` (or extend `result-run.service.compute`)
returning:
```
✓ Assessments configured      (Assessment rows exist for the class/term)
✓ Marks entered               (StudentAssessment rows present for all enrolled)
✓ Marks approved              (status = approved, not draft)
✓ Students enrolled           (Enrollment count == roster)
✓ Academic roster frozen      (AcademicRoster.frozenAt set)
✓ Result calc completed       (ResultSet exists)
42 / 42 students ready
```
- Block `Publish` until all green; if not, show `⚠ 3 students missing Mathematics marks → [View]`.
- This is mostly aggregation over tables that already exist — no schema change.

---

## 4. Teacher marking: keep the simple surface, expose Draft/Submit state

Teacher screen (`gradebook.tsx` / `enter-marks.tsx`) already shows a marksheet. Make the
state explicit and non-technical:
```
MATHEMATICS — P4 A
Status: Draft
[ Save Draft ]   [ Submit for Approval ]
```
- `MarkEntry`/`StudentAssessment.status` already carries draft/submitted/approved.
- Admin side `approvals.tsx` already lists "Marks Awaiting Approval" with teacher + student count
  and Review/Approve/Return. That matches the review exactly — keep it, just ensure the teacher
  sees their own "Submitted" state.

No new backend; this is copy/labels around existing `school:enterGrades` + `school:approveGrades`.

---

## 5. Naming: hide the class/placement duality from users

DB has `Enrollment` + `StudentProfile.currentClassId` (cache). Users must not see both as concepts.

- **Student profile** shows: `Current Academic Placement → 2026 Term 2 · P4 A`
- **Separate area** "Enrollment History" lists term-by-term placements.
- **Display class concisely** (review §10): `P4 A` (sections only), `P4 A — East` (with stream),
  `P4` (neither). Add a `formatClass(class,section,stream)` helper in `web/src/lib` and use everywhere
  instead of raw `currentClassId`.

---

## 6. Promotion is already built — surface it in the yearly cycle

`promotion.tsx` + `usePromoteStudent`/`useRollover` exist. Wire it into the journey:
```
Results → Publish → [Promote P4→P5] → Choose Sections/Streams → Confirm
```
- Ensure promotion preserves `streamId` (review §12) — verify `usePromoteStudent` carries it; if not,
  it's a one-line fix in the DTO.
- Make "New Academic Year → Rollover" the obvious next step after promotion.

---

## 7. Role-adaptive landing (lightweight, permission-driven)

Nav is already permission-gated, so the same `NAV_SECTIONS` already hides things per role. To make
it feel role-oriented without duplicating screens:
- **Teacher:** the existing `My Teaching` (`/school/teaching`) is the teacher home — keep, and make
  its cards link to Attendance → Marking → Submit, in that order.
- **Finance officer:** Fees section already exists with its own dashboard; fine as-is.
- **Parent:** handled by the separate `apps/portal` (already role-scoped: parent/student/teacher).
- No new dashboards required — just order and label.

---

## Execution order (recommended)

| # | Change | Files | Backend needed? | Risk |
|---|--------|-------|-----------------|------|
| 1 | Academics tab on Student 360 | `student-360.tsx`, maybe `+ GET /students/:id/academics` | small endpoint or reuse ReportCard | Low |
| 2 | Quick Register & Place dialog | `students.tsx`, `+ POST /students/register` (wrap `enrollNewStudent`) | wrap existing svc | Low |
| 3 | Results readiness gate | `exam-results.tsx`, `+ GET /results/readiness` | aggregation endpoint | Med |
| 4 | Draft/Submit labels on marking | `gradebook.tsx`/`enter-marks.tsx` | none | Low |
| 5 | `formatClass` + placement wording | `web/src/lib`, student-360, enroll UI | none | Low |
| 6 | Promotion stream preservation + yearly flow | `promotion.tsx`, DTO | verify/carry `streamId` | Low |

All six are **frontend-led**; only #1 and #3 add small read-only endpoints. No schema migration
required. This delivers the review's intent — "obvious UI, sophisticated DB" — without touching the
transactional/audit backbone that already scores 8.5–9/10.
