# Academics Phase 2 — CourseOffering and academic context

## Delivered boundary

`CourseOffering` is now the canonical teaching context between Phase 1 placement and all
teaching/assessment consumers. The physical model is retained for migration safety, while
its meaning now covers subject, learning-area, competency, school-wide, co-curricular,
remedial, and club/house offerings.

The new API is mounted at `/school/course-offerings`. The earlier
`/school/lp/course-offerings` surface remains temporarily available for legacy callers; the
web application now uses only the canonical API.

## Invariants

- Academic year, term, programme, cohort, section and stream are tenant-scoped and must
  agree with one another.
- `SUBJECT`, `LEARNING_AREA`, and `REMEDIAL` require a subject in a published curriculum
  version for the selected cohort/year.
- `COMPETENCY` requires a competency definition.
- `CO_CURRICULAR` and `CLUB_OR_HOUSE` require an activity definition.
- A Stream cannot be paired with another class or Section.
- Compulsory rosters derive from `StudentEnrollment → EnrollmentPlacement` and preserve
  explicit opt-outs.
- Elective, remedial, manual, opt-out and withdrawal decisions are effective-dated
  `CourseEnrollment` rows.
- A responsible teacher is required before `STAFFED`; a roster before `ROSTER_READY`;
  and all readiness checks before `PUBLISHED`.
- Lesson timetable slots require a matching offering. Break/free slots remain exempt.
- Teacher allocations support lead, co-teacher, assistant and time-bounded substitute
  roles. The final responsible allocation cannot be ended on an operational offering.

## Lifecycle

`DRAFT → STAFFED → ROSTER_READY → PUBLISHED → ACTIVE → CLOSED → ARCHIVED`

Setup states may step backward where safe. Published and active offerings never return to
draft. Closing records an effective end timestamp.

## Operations

The Curriculum & Courses workspace provides:

- filtered offering register and readiness indicators;
- typed offering generation wizard;
- teacher allocation and course roster management;
- compulsory roster synchronization and explicit elective/remedial membership;
- bulk creation from published curriculum versions;
- `TeacherAssignment` migration preview/execution;
- archive and term/year rollover.

The migration is expand-first. Legacy offering rows receive stable codes, names, dates and
uppercase statuses; legacy teacher roles are mapped to the new allocation vocabulary.
`TeacherAssignment` is not deleted and remains a compatibility source until reconciliation
and a full production cycle satisfy ADR-027.

## Verification

Phase 2 unit coverage checks publication gates, legal lifecycle transitions, custom-roster
semantics and cross-year enrollment rejection. Prisma validation, API typecheck and web
typecheck are required release gates.
