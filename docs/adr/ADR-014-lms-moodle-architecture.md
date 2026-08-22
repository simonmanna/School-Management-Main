# ADR-014: Moodle-Shaped LMS Architecture

- **Status:** Proposed
- **Date:** 2026-08-21
- **Relates to:** ADR-005 (module registration), ADR-011 (vertical extension contract),
  ADR-003 (event bus), ADR-004 (multi-tenancy), ADR-006 (audit logging)

## Context

The school vertical already ships an LMS slice: `CourseOffering`, `LessonPlan` (+ objectives,
activities, resources, differentiation, reflection, review workflow), `ScheduledLesson`,
`LessonDelivery`, `Discussion`, `HomeworkAssignment`, `LearningResource`, a CBT question bank
with `QuizAttempt`/`QuizResponse`, and a competency/mastery chain
(`LearningObjective` → `LearningObjectiveEvidence` → `LearningObjectiveProgress`).

What it does **not** have is Moodle's delivery model. Today a course offering is a container
with a timetable and a plan; it is not a *navigable learning space* a student opens and works
through. Missing, specifically:

1. **Course sections** — no week/topic spine inside an offering.
2. **Pluggable activity modules** — homework, quiz, forum and resource are four unrelated
   tables with four unrelated UIs, not instances of one `CourseModule` contract.
3. **Context hierarchy + capabilities** — permissions are global (`school.read`/`school.write`),
   so "teacher of *this* offering" cannot be expressed.
4. **Availability (restrict access)** — no conditional release.
5. **Completion tracking** — `StudentCourseProgress.progressPct` exists but nothing computes it
   from per-activity completion.
6. **Enrolment methods and groups** — participation is implied by class roster only.

## Decision

**Adopt Moodle's structural model — `context` → `course` → `section` → `course_module` →
activity plugin — and reject Moodle's gradebook, blocks framework and file subsystem.**

### Adopted from Moodle (copy the shape)

| Moodle | Here | Why |
|---|---|---|
| `context` / `role_assignments` / `role_capabilities` | `LmsContext`, `LmsRoleAssignment`, `LmsCapabilityOverride` | Only way to scope a role to one offering. Materialised path + ALLOW/PREVENT/PROHIBIT resolution. |
| `course_sections` | `CourseSection` | Weekly/topic spine. Lesson plan `weekOf` maps onto a week section. |
| `modules` + `course_modules` | `LmsActivityType` registry + `CourseModule` | One spine row per placed activity; `activityType` + `instanceId` points at the per-type table. |
| activity module plugin API | `ActivityPlugin` Nest contract, registered per ADR-005 manifest | Adding `mod_wiki` is a new folder, not a schema migration of the spine. |
| availability API | `availability` JSON tree on `CourseSection`/`CourseModule` | Conditional release: date, grade, completion, group, role. |
| completion API | `CourseModuleCompletion`, `CourseCompletion` | Feeds the existing `StudentCourseProgress`. |
| `enrol` plugins + `user_enrolments` | `CourseEnrolmentMethod` + `CourseEnrolment` | Separates *how* someone got in (roster sync / manual / self) from *what role* they hold. |
| groups / groupings | `LmsGroup`, `LmsGroupMember`, `LmsGrouping` | Separate-groups forums, group assignments, differentiated release. |
| question categories, versions, behaviours, quiz slots | `QuestionCategory`, `QuestionVersion`, `QuizSlot`, `QuizOverride` | The existing bank is flat; Moodle's tree + versioning is the right target. |
| logstore standard log | `LmsEvent` on the kernel event bus | Powers participation/activity reports. |
| backup / restore (`.mbz`) | `CourseBundle` export/import JSON | Year rollover is the school-critical case. |

### Rejected from Moodle (deliberately)

- **The gradebook** (`grade_items` / `grade_categories` / `grade_grades` / aggregation
  strategies). We already have a stricter one: `AssessmentComponent` → `Assessment` →
  `StudentAssessment` → `ResultProcessingRun` → `StudentTermResult`. Duplicating it would
  create two truths for a mark. **Rule: a grade-bearing `CourseModule` owns exactly one
  `Assessment` row** (`sourceType`, `sourceRef = courseModuleId`) and never stores marks itself.
- **The blocks framework.** Pluggable per-page block placement is a CMS feature schools do not
  use. A fixed course index + fixed dashboard cards replaces it.
- **Moodle's flat `course`.** Our `CourseOffering` is keyed by
  `(year, term, subject, class, section)` — strictly better for a school than Moodle's
  category-and-shortname convention. Keep it. `CourseCategory` is added only as an optional
  browse tree.
- **Moodle's file-in-DB draft areas.** Reuse `kernel/files` with a `fileArea`/`itemId`
  addressing convention instead.

### Where we go beyond Moodle

Moodle has **no lesson planning**. Ours stays the pedagogical layer *above* delivery:

```
LessonPlan (what I intend to teach, HOD-approved)
    │  publish
    ▼
CourseSection (week N)  →  CourseModule[]  (what students actually see and do)
    │                          │
    ▼                          ▼
ScheduledLesson/Delivery   Assessment → StudentAssessment (marks)
    │                          │
    └──────────► LearningObjectiveEvidence ◄──────┘
                        ▼
              LearningObjectiveProgress (computed mastery)
```

`LessonPlan.weekOf` → `CourseSection` of the same week. Publishing a plan materialises its
`LessonPlanActivity` rows into `CourseModule` rows. Mastery evidence is emitted by *any*
activity plugin that grades, so competency reporting comes free.

## Consequences

**Positive**
- One activity contract instead of N bespoke features; new activity types are additive.
- Per-offering role scoping unblocks real teacher/TA/observer permissions and parent read-only.
- Conditional release + completion give the student-facing progress UX that is currently absent.
- Marks keep a single home; report cards and promotion need no change.

**Negative / trade-offs**
- `CourseModule.instanceId` is an untyped polymorphic FK (as in Moodle). Referential integrity
  is enforced in the plugin layer + a nightly orphan check, not by the database.
- Migrating `HomeworkAssignment`, `Discussion` and `LearningResource` under the spine is a
  breaking change for their current pages; done via adapters in Phase 3, dual-read for one release.
- The capability resolver is on the hot path of every LMS request; requires per-request caching.

## Alternatives considered

- **Embed real Moodle and integrate via LTI/webservices.** Rejected: two identity stores, two
  gradebooks, two roster syncs, and PHP in the deployment story for a product whose selling
  point is being one system.
- **Keep growing bespoke features (a forum table, a quiz table, a homework table…).** Rejected:
  that is the current state, and the fifth feature costs the same as the first.
