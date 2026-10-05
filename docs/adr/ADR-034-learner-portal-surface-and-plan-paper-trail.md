# ADR-034: The Learner's LMS Surface Lives in the Portal, and Plans Leave a Paper Trail

- **Status:** Proposed
- **Date:** 2026-10-04
- **Relates to:** [ADR-014](./ADR-014-lms-moodle-architecture.md) (Moodle-shaped LMS),
  [ADR-026](./ADR-026-lms-academic-core-boundary.md) (LMS as a consumer of the academic core),
  [ADR-016](./ADR-016-messaging-broadcasts-and-transports.md) (transports)

## Context

The Moodle-shaped LMS was built through P0–P8 and then switched off behind
`ENABLE_ADVANCED_LMS`, so it had never been used by a pupil. Turning it on exposed
three gaps that are about *reach*, not about the engine:

1. **A learner had nowhere to do the work.** `apps/web` holds the course page, the
   activity page and the quiz runner, but `apps/web` is the staff application —
   pupils and guardians sign in to `apps/portal`, whose only LMS screen was a
   read-only list of course names and due dates. Homework could be set and could
   not be handed in.
2. **A guardian had no view of learning at all.** `school/lms/my/*` already
   accepted `asStudent` for a guardian naming their own child, so the data path
   existed; nothing consumed it.
3. **A lesson plan could not be printed.** Ugandan schools are inspected on
   paper: a head of department signs a plan and an inspector asks for the term's
   scheme. The planning suite was complete on screen and had no way onto A4.

A fourth problem was a mismatch rather than a gap: the portal's `MyCourse` and
`DueItem` types claimed fields (`courseOfferingId`, `progressPercent`,
`submitted`) that the server does not send, so the course list rendered
"undefined%".

## Decision

**The learner's and guardian's LMS surface belongs to `apps/portal`, built on the
same server endpoints as the staff surface.** No learner-only API is added. The
portal calls `GET school/lms/courses/:id`, `GET school/lms/modules/:id/view`,
`POST school/lms/modules/:id/action/:action`, `POST school/lms/files/:id/url` and
the CBT attempt routes — all of which already resolve the subject from the
token's portal claim and treat `asStudent` as a request to be checked, never an
assertion to be trusted.

Consequences of that choice, made explicit:

- **The view envelope is mirrored, not imported.** `apps/portal/src/lib/lms-types.ts`
  copies the envelope types rather than importing the admin app's, because the two
  builds keep deliberately different dependency sets and `@erp/shared` carries no
  view types. Three copies now exist (server, web, portal) and must move together.
- **Course screens mount under two path prefixes.** `RequireAudience` keeps a
  guardian out of `/student/*` entirely, so the same components are mounted at
  `/student/courses/*` and `/parent/learning/courses/*`. Every link is built by
  `apps/portal/src/lib/learner-paths.ts` so neither tree can hard-code the other's
  URLs.
- **A guardian's surface is read-only, and the server enforces it.** Submitting
  work, ticking completion and sitting a quiz are each refused server-side for a
  guardian principal; the portal simply does not draw the controls.
- **Mark release is honoured in one place.** `describeGrade()` in the portal's
  LMS types returns `none | withheld | scored`, so no screen can render an
  unreleased mark as a blank or a zero. This is the client half of the invariant
  whose server half is the three readers named in
  `docs/architecture/LMS_DEPLOYMENT_READINESS.md` §4.
- **Rich text is sanitised twice, and embeds are allowlisted on both sides.** The
  API sanitises on write with a short iframe host allowlist. Both clients now
  re-sanitise on render and drop any iframe whose `src` is not an allowlisted
  https player — previously the web client added `iframe` to DOMPurify's
  allowlist with no source check, which would have let a row that reached the
  database by another path frame anything at all.

**A lesson plan and a scheme of work render to PDF server-side, with `pdfkit`.**
Not the browser-side `jspdf` used for list exports: a document that goes into an
inspection file must come out the same whoever prints it, and must not depend on
what an operator's browser does with a web font. The plan is read through
`LessonPlanningService.getLessonPlan`, so its tenancy and shape rules apply
rather than a second loose query.

**A week of plans is drafted from what the school has already decided.**
`POST school/lp/lesson-plans/generate-week` reads the week's `ScheduledLesson`
rows and the matching `SchemeOfWorkWeek`, and leaves one DRAFT `LessonPlan` per
lesson, carrying the scheme's outcome and objective links so coverage reporting
counts it. It is idempotent by construction — a scheduled lesson that already
has a plan is skipped — which needs no new constraint, because
`ScheduledLesson.lessonPlanId` is already the one place that link lives. It
drafts; it never approves, and it never attributes a plan to the head of
department who pressed the button rather than the teacher who will teach it.

Materialising the lessons themselves stays with `POST school/teaching/week/generate`,
the timetable's own generator. Generating plans for a week with no lessons fails
with a message naming that step rather than silently creating nothing.

**Reuse is a named export, not a new entity.** What the spec's `Course` layer was
actually reaching for is reuse — a teacher rebuilding the same fourteen weeks
every January. `LmsCourseTemplate` stores the structure-only JSON bundle that
`CourseBackupService.export` already produced for rollover, so a template is a
NAMED EXPORT of a course rather than a second source of course naming:

- It carries no cohort, no submissions and no marks, by construction: the
  exporter omits user data unless asked, and saving a template never asks.
- It carries no dates either, because `import` drops them — last term's deadlines
  would show every activity as overdue on day one.
- `code` is the operator-facing identity, so re-saving under the same code
  replaces that template instead of leaving a teacher two "P5 Mathematics" to
  choose between. A seed can therefore be re-run.
- Applying one delegates to `import`, which refuses a target that already has
  activities — so it cannot silently double a course.
- `CourseOffering.coverImageFileId` is the one course-identity field the spec
  lists that was genuinely missing. It is a `File` reference rather than a URL so
  a picture a teacher uploads obeys the same ACL as the rest of the course
  content. A template's picture travels to a course that has none; it never
  overwrites one the course already has.

**Guardians receive the pupil's LMS notices, under the same release gate.**
Due-soon reminders and graded notices fan out to the guardians resolved live from
`StudentGuardian` — live, so revoking a guardianship stops the notices at once
rather than at token expiry. The release rule is computed once and both messages
are built from it, so a pupil's notice and a guardian's cannot disagree about
whether a mark exists. The channel is `in_app` only: escalating a reminder to SMS
or WhatsApp needs the consent ledger (ADR-016) and a decision about who pays for
the message, so it is deliberately not done here.

## Consequences

- A pupil can open a course, read a page, download a file, hand in homework and
  sit a quiz from a phone. A guardian can see progress, what is coming, and marks
  that have actually been released.
- Three copies of the view envelope are a standing drift risk. A change to
  `view-envelope.types.ts` must be carried to both clients; the existing
  `lms-view-envelope` spec guards the server's half only.
- The spec's `Subject → Course → Course Offering` shape is **not** adopted as a
  third entity. `CourseOffering` already carries the course identity the spec
  lists (name, code, summary, dates, format, sections, category) and
  `Curriculum`/`CurriculumSubject`/`Topic`/`Unit`/`LearningObjective` already is
  the year-independent per-grade layer. A third naming truth would only create
  drift between them.
- AI drafting of plans and questions is deliberately **not** built. The shape it
  would take is a `generate-week`-like endpoint that returns an unsaved draft for
  the teacher to accept, so that no generated text is ever stored without a
  human having approved it. It needs a provider decision and a key before it is
  worth writing.

## Alternatives considered

- **Letting pupils sign in to `apps/web`.** Rejected: the staff app eager-loads
  ~290 pages into one ~6 MB chunk, which is not survivable on Ugandan mobile
  data, and its 24-section rail is the wrong shape for a child on a phone.
- **A learner-only API under `school/lms/learner/*`.** Rejected: it would be a
  second implementation of availability, completion and mark-release, and the
  existing endpoints are already subject-resolved from the token.
- **Rendering plan PDFs in the browser.** Rejected for the paper-trail reason
  above.
- **Generating approved plans rather than drafts.** Rejected: a generated plan
  nobody has read is exactly the thing an inspection is meant to catch.
