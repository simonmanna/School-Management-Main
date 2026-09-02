# Academics Phase 3 — Curriculum and teaching delivery

- **Status:** Implemented; school UAT sign-off pending
- **Date:** 2026-09-02
- **Implements:** ADR-020 (every lesson plan and timetable lesson references an offering)
- **Depends on:** Phase 1 (`ACADEMICS_PHASE_1.md`), Phase 2 (`ACADEMICS_PHASE_2.md`)

## 1. What Phase 3 establishes

Phase 2 made `CourseOffering` the teaching context. Phase 3 makes teaching *happen*
inside it, and makes what happened readable afterwards:

| Row | Owns | Grain |
|---|---|---|
| `SchemeOfWork` | The term teaching map | One per course offering |
| `SchemeOfWorkWeek` | One teaching week of that map | Scheme × week number |
| `SchemeOfWorkItem` | A planned piece of curriculum | Week × item, optionally an outcome |
| `LessonPlanOutcome` | Which outcomes a plan claims | Plan × outcome |
| `ScheduledLesson` | What the timetable said would happen | Offering × slot × date |
| `LessonDelivery` | What actually happened | Exactly one per scheduled lesson |
| `LessonDeliveryEvidence` | What the lesson produced | Delivery × evidence item |
| `LessonFollowUp` | What is still owed | Offering (optionally learner) |
| `CourseOfferingResource` | Materials the course carries | Offering × resource |

## 2. Canonical rules and where they are enforced

| Rule | Service | Database |
|---|---|---|
| A lesson plan belongs to a course offering | `LessonPlanningService.resolveOffering` | FK + `LessonPlan_offering_required_ck` (`NOT VALID`) |
| Subject, class, term and curriculum come from that offering | `resolveOffering` | — |
| A plan cannot be written into a closed or archived offering | `resolveOffering` | — |
| One lesson status, not two | — | legacy `LessonPlan.status` dropped |
| A scheme week is claimed only by plans on its own offering | `assertSchemeWeek` / `setPlanSchemeWeek` | FK |
| One scheme of work per offering | `SchemeOfWorkService.create` | `@@unique(courseOfferingId)` |
| A scheme week with plans cannot be deleted | `removeWeek` | — |
| One delivery per scheduled lesson | `LessonDeliveryService.deliver` (upsert) | `@@unique(scheduledLessonId)` |
| A partly delivered lesson states why | `deliver` | — |
| A cancelled lesson cannot be recorded as taught | `deliver` | — |
| Reflection and evidence require a delivery | `reflect`, `addEvidence` | — |
| A learner follow-up requires course membership | `createFollowUp` | — |
| Only an allocated teacher (or the departmental grant) may act | `TeachingAccessService` | — |

`courseOfferingId` stays nullable in the schema and is enforced by a `NOT VALID`
check constraint instead of `NOT NULL`. New and updated rows must carry an
offering; the six pre-Phase-3 plans that no offering matched stay readable and
are listed in `AcademicMigrationException` under migration run
`20260905000000_phase3_teaching_delivery`, rather than being deleted or given a
guessed context.

## 3. Scheduled versus delivered

`ScheduledLesson` is generated from the timetable — the timetable remains the
schedule authority, and generation is idempotent per (slot, date), so a teacher
can press it twice without doubling their week. A lesson stays **outstanding**
until a delivery says otherwise; nothing marks itself taught. Cancelled lessons
are reported separately from both sides of the ratio, so a week of school
closure does not read as a teacher who never turned up.

Attendance is referenced, never copied: a delivery records the register date and
period plus a cached present/absent count. `StudentAttendance` remains the
authoritative record and is not written from here.

## 4. Curriculum coverage

Coverage is a ladder, computed from typed rows only:

```
scheme item → lesson plan outcome → delivered lesson → assessed evidence
not_planned      planned                delivered          assessed
```

An outcome counts as delivered only when a plan claiming it was actually taught,
and as assessed when a `StudentOutcomeAchievement` reached `met`/`exceeded` or a
delivery attached evidence against it. Nothing is inferred from free text.

The subject-wide objective coverage on `/school/lp/curriculum-coverage` is kept
for heads of department; the per-course outcome view lives on
`/school/teaching/offerings/:id/coverage`.

## 5. Operations

The teacher workspace (`/school/teaching/:offeringId`) provides:

**Overview | Plan | Lessons | Assessments | Markbook | Learners**

- Overview — delivery ratio, scheme progress, curriculum coverage, and the list
  of things standing between the teacher and a closed week.
- Plan — the scheme of work (weeks, themes, planned periods, curriculum items and
  outcomes) and the course's learning resources.
- Lessons — the weekly teaching view: generate from the timetable, attach a plan,
  confirm delivery, record what was covered and why it differed, reflect, attach
  evidence, raise remedial follow-up.
- Assessments — work set on this course with marking progress, plus outcome
  coverage.
- Markbook — read-only marking progress per column; scores are still written only
  by the canonical marking service behind the mark screen.
- Learners — the course roster with attendance and per-learner follow-up.

`Assessment` does not yet carry an offering — that binding is Phase 4 (ADR-021,
ADR-023) — so the Assessments and Markbook tabs resolve the context the way the
rest of the system still does: subject + class + term, narrowed by section.

## 6. Permissions

Reading the workspace requires `school:lms:read`; writing requires
`school:lessonplans:own`. Neither grant alone decides anything: every route
resolves the caller to their `StaffProfile` and checks for an open
`CourseOfferingTeacher` allocation on that offering. `school:lessonplans:write`
is the departmental grant that works across a department's courses. A substitute
whose allocation has been end-dated loses write access without anybody editing a
role.

## 7. Verification

- `apps/api/test/unit/teaching-phase3.spec.ts` — 25 tests covering week maths,
  scheme progress, the scheduled/delivered ratio, the coverage ladder, and the
  service guards (offering required, contradictory subject, closed offering,
  cross-course scheme week, delivery/reflection/evidence order, roster-scoped
  follow-up).
- `apps/api/test/integration/school-teacher-ownership.spec.ts` — lesson plans now
  created through offerings; teacher-ownership boundaries unchanged.
- Prisma validation, API typecheck and web typecheck are required release gates.

## 8. Exit gate

A teacher can complete one entire week — timetable → scheduled lessons → plan →
delivery → attendance link → evidence → reflection → remedial follow-up —
without leaving the course workspace.
