# LMS — Deployment Readiness

Status as of 2026-08-27. Covers the Moodle-shaped LMS, lesson planning, and their
join to exams / assessments / homework.

Related: [ADR-014](../adr/ADR-014-lms-moodle-architecture.md) ·
[LMS-MOODLE-ARCHITECTURE.md](./LMS-MOODLE-ARCHITECTURE.md)

---

## 1. What changed, and why it mattered

The LMS backend was already well-built. What it lacked was an identity model, a
display contract, and enforcement of settings it already stored.

### Security

| Defect | Effect before the fix |
|---|---|
| No student/guardian identity at all — `User` had no link to `StudentProfile` | Every student-scoped endpoint took `studentProfileId` from the URL and trusted it. The LMS capability guard's student branch was dead code. |
| `GET modules/:id/view?studentProfileId=` | Read any pupil's submissions and quiz attempts; ticked their completion. Omitting the parameter fell through to the **teacher** view and skipped the availability check. |
| `POST modules/:id/action/*` | Submitted work, and triggered grade sync, as another pupil. |
| `POST modules/:id/completion` | Marked a classmate's work complete. |
| `POST cbt/start`, `cbt/attempts/:id`, `/response`, `/submit` | Sat, read, and **answered into** another pupil's live exam attempt. |
| `portals` parent/student routes, incl. `POST parent/:id/pay` | Flat permission, no ownership check — any portal user could read any family's grades and fee balance, and start a payment. A code comment asserted an ownership rule the code never implemented. |
| `gradebook/user/:id`, `progress/:id`, `logs`, `activity-report`, `participation`, `outline`, `gradebook/cell`, `gradebook/override` | Unguarded per-pupil and per-course reads/writes. |
| Teacher-authored HTML rendered with `dangerouslySetInnerHTML`, no sanitizer in the repo | Stored XSS against every pupil in a course. |
| SCORM/H5P package delivery (new) | Zip-slip traversal — mitigated at introduction, not retrofitted. |

**Now:** `PortalIdentity` is the only permitted answer to "which pupil is this?",
resolved at login into a signed token claim. Nothing derives a subject from
request input. A guardian's children resolve live, so revoking a guardianship
takes effect immediately rather than at token expiry.

### Correctness

Three bugs found by fixing the stale exam suites, all in production code:

- **A rejected paper could never be re-approved.** `submit()` moved rows only from
  `draft`, but a rejection leaves them at `rejected` and nothing reset them. The
  service's own docstring promised "from `rejected` the enterer can resubmit";
  there was no such path, so those marks were stuck for good.
- **Optimistic concurrency did not exist.** `postMark` incremented `version` but
  never checked it, and `bulkUpsert` dropped the client's copy — so two teachers
  marking the same paper silently overwrote each other, last write winning. The
  docstring claimed the guard "lives inside postMark".
- **`saveMark` returned null for every saved mark.** It built its response from
  `bulkUpsert`'s `results`, a re-read of the frozen GradeEntry table that is never
  written — so the marks workspace blanked a mark the instant a teacher entered it.


- **Unreleased marks leaked.** `gradebook.userReport` served `effectiveScore`
  regardless of `approvalStatus`. Marks now reach a learner only once moderation
  has **approved** them, and an unreleased mark renders as "not released yet" —
  never as a blank or a zero.
- **`mod_assign` ignored its own settings.** `cutoffDate`, `maxAttempts`,
  `submissionTypes` and `blindMarking` were stored and unenforced.
- **`mod_scorm` ignored `gradingMethod` and `maxAttempts`** — re-opening a
  completed package overwrote a higher mark with a lower one.
- **`mod_workshop` ignored its phases** — peers could assess unfinished drafts.
- **H5P grade sync never fired** — it read `result['score.scaled']`, but xAPI
  nests the score as `result.score.scaled`.
- **`modules.add()` returned a stale row** — a gradable activity came back
  claiming `assessmentId: null`.
- **`sanitizeDto` destructured class instances** — a Prisma `Decimal` became
  `{ constructor, s, e, d }`, breaking course restore and rollover.

The last two were found by the end-to-end integration test, not by review.

### Capability

Files, the learner surface, teacher authoring, notifications, calendar, reports,
backup/rollover, and the SCORM/H5P player. See §3.

---

## 2. Test coverage

| Suite | Tests | Covers |
|---|---|---|
| `lms-sanitize` | 16 | Stored XSS; class instances left intact |
| `portal-identity` | 17 | Claim construction, cross-family access |
| `lms-authz` | 14 | Impersonation, escalation-by-omission, availability |
| `lms-file-acl` | 17 | Submission privacy, course-content access |
| `lms-view-envelope` | 11 | Names, mark-release gate, completion |
| `lms-standards` | 18 | SCORM grading method/attempts, workshop phases |
| `lms-assign-rules` | 14 | Cut-off, attempts, blind marking |
| `lms-rollover` | 11 | Structure-only clone, availability remap |
| `lms-orphan-check` | 7 | Dangling `instanceId` detection |
| `lms-package-serve` | 8 | Zip-slip traversal, package ACL |
| **`school-lms-authz`** (DB) | 10 | CHECK constraint, live guardianship, tenancy |
| `lms-lti` | 16 | Replay refusal, subject binding, AGS rescaling, JWKS hygiene |
| **`school-lms-e2e`** (DB) | 13 | Add → submit → mark → approve → release → rollover |

**593 unit + 252 integration, all passing — 41/41 integration suites green.**

Fourteen integration suites were failing before this pass. None were LMS bugs:

- `RecurringService` (kernel) injected `DmsTypeResolver` from `modules/documents`,
  breaking the repo's own `kernel-must-not-import-modules` rule. The architecture
  linter missed it because the class appeared only in constructor TYPE position,
  so TypeScript emitted it as decorator metadata and dependency-cruiser saw no
  import. Ten suites could not construct a Nest graph because of it.
- Five test graphs omitted the `@Global` `DocumentsModule` the production app
  always registers.
- Two seeds predated `Document.documentTypeId` becoming required.
- Four school suites still asserted against `GradeEntry`, frozen by the B6 flip.

Fixing the last group surfaced three genuine production bugs — see §1.

---

## 3. Deployment checklist

### Required before first run

1. **Apply the migration.** `20260827200000_portal_identity` creates
   `PortalIdentity` with a CHECK constraint enforcing exactly one subject per row.
   ```bash
   pnpm --filter @erp/api exec prisma migrate deploy
   ```
2. **Provision portal accounts.** Students and guardians cannot log in until they
   have one. `POST /api/v1/school/portal-accounts/invite` creates an inactive
   account and emails a 7-day invite; the invitee sets their own password at
   `POST /api/v1/auth/accept-invite`. A registrar never sees a password.
   Requires the new `school:portal:accounts:write` permission — assign it
   deliberately, since it mints credentials that can read a family's grades and
   fee balance.
3. **Assign LMS roles.** The capability model is per-offering. A teacher with the
   coarse `school:courses:write` permission but no `editingteacher` role on a
   course can no longer edit it — this is the intended behaviour, but it will look
   like a regression if roles are not seeded.
4. **Set `SMTP_HOST`** or invites and notifications are logged, not delivered.
5. **Set `STORAGE_LOCAL_DIR`** (or the S3 driver) — LMS files and SCORM packages
   live there.

### Known gaps at deploy

- **Browser E2E of the signed-in LMS has not been run.** Routing, build and
  console health are verified; the logged-in journeys are covered by the DB-backed
  integration suite rather than a browser driver. Running it needs a real login,
  so it is a task for someone with credentials.
  **Update 2026-10-04:** the spec now exists but has not been RUN — see
  "Learner surface" below.
- **Three stale migration entries** (`lms_moodle_spine`,
  `lms_mod_assign_submission`, `gradeentry_readonly`) — the tables exist but the
  ledger does not record them, from an earlier `db push`. Reconcile before the
  next deploy; `migrate resolve --applied` would tidy it but would also mask real
  drift, so check first.
  **Update 2026-10-04:** checked against the `schooldb-planet` development
  database — all three rows are present and `finished_at` is set, so this was
  resolved at some point after 2026-08-27. Still prove it per environment with
  the prove-from-empty recipe in `apps/api/prisma/README.md` before trusting it
  elsewhere.
- **S3 storage is not implemented.** `FilesService` throws at construction when
  `STORAGE_DRIVER=s3` (`apps/api/src/kernel/files/files.service.ts`), so LMS
  files and SCORM packages live on local disk and the API is therefore
  single-host until that driver is written. A second API replica would serve
  404s for files uploaded to the other one.

### Learner surface (ADR-034), 2026-10-04

Until this pass a pupil had nowhere to do the work: the course page, activity
page and quiz runner existed only in `apps/web`, the staff app, while pupils and
guardians sign in to `apps/portal` — whose only LMS screen was a read-only list
of course names. Homework could be set and could not be handed in.

- `apps/portal` now has the course page, the activity page (read, download, hand
  in, tick complete) and the quiz runner, plus a guardian `Learning` tab. These
  call the same `school/lms/*` endpoints as the staff app; no learner-only API
  was added.
- A browser spec for those journeys is at `apps/portal/e2e/lms-learner.spec.ts`
  with a Playwright config beside it. **It has not been run** — it needs real
  pupil and guardian portal accounts:
  ```bash
  E2E_PUPIL_EMAIL=... E2E_PUPIL_PASSWORD=... \
  E2E_GUARDIAN_EMAIL=... E2E_GUARDIAN_PASSWORD=... \
    pnpm --filter @erp/portal exec playwright test
  ```
  Mint the accounts from the admin app's **Portals & Promotion Gate** screen and
  seed a course with `apps/api/prisma/seed-lms-demo.ts` (idempotent).
- A bug fixed on the way: the portal's `MyCourse`/`DueItem` types claimed fields
  the API does not send (`courseOfferingId`, `progressPercent`, `submitted`), so
  the pupil's course list rendered "undefined%". The server returns the course
  header spread with `progress`.
- Both clients now re-sanitise rich text on render and drop any iframe whose src
  is not an allowlisted https player. The web client previously added `iframe` to
  DOMPurify's allowlist with no source check.

### Turn-on, verified 2026-10-04

- The API boots with `ENABLE_ADVANCED_LMS=true` and `LmsMoodleModule` mounts:
  `GET school/lms/courses` answers 401 rather than 404, and `ActivityRegistry`'s
  boot validation (every `LmsActivityType` row has a live plugin, and the
  reverse) passes without the loud failure it is designed to raise.
- **Role grants are the blocker to watch.** `SCHOOL_ROLE_PRESETS` are seeded with
  `update: {}` (`prisma/seed.ts`), so a role seeded before a permission key
  existed never gains it. In the development database:
  - `Head Teacher` (4 organizations) and `Deputy Head` hold
    `school:courses:write` and `school:courses:enrol` but **not**
    `school:lms:read`. Every LMS controller gates on `school:lms:read` first, so
    their course-management grant is dead and every LMS screen 403s.
  - Some `Class Teacher` and `Subject Teacher` roles lack
    `school:courses:teach`, which their preset now carries.
  - Two `Student`/`Parent` roles lack `school:portal:self`, so those tenants'
    portal users cannot read `school/lms/my/*` at all.
  A grant migration is needed per the precedent of
  `20261003100000_admissions_read_grant`. It had not been written at the time of
  this note.
- **`StartAttemptDto.studentProfileId` is required by validation** even though the
  controller substitutes a pupil's own id and refuses anyone else's. A client that
  posts only `{ paperId }` gets a 400 before the controller runs — which is what
  `useCbtStartAttempt` in `apps/web` does, so the staff app's quiz-sitting path is
  broken for a pupil. The portal sends the learner's own id from the portal
  context, which the server then re-checks.

### Evidence from this pass

- **Migrations reproduce the schema.** Prove-from-empty per
  `apps/api/prisma/README.md`: fresh database → `prisma migrate deploy` (183
  migrations) → `prisma migrate diff --from-url <probe> --to-schema-datamodel`
  → `No difference detected.`
- **Unit:** 17 LMS and lesson-planning suites, 236 tests, green — including four
  new ones: `lms-forum-moderation` (22), `lms-course-template` (21),
  `lms-notify-guardian` (13), `lesson-plan-week-generate` (18),
  `lesson-plan-pdf` (10).
- **Integration (DB-backed):** `school-lms-{authz,e2e,grade-bridge,teacher-identity}`
  plus `academics-foundation` and `school-assessment-core` — 6 suites, 44 tests,
  green.
- **Guards:** `web-api-contract`, `route-permission-coverage`,
  `permission-catalog-drift`, `tenancy-registration` all green.
- **`pnpm lint:arch`** has one violation, `core/organizations.service.ts →
  accounting/posting/fiscal-period.service.ts`. It is **pre-existing**,
  introduced by commit 7c08a3a (wave18 fiscal close, 2026-09-30), and unrelated
  to the LMS.
- **`pnpm academics:inventory:check`** fails until the regenerated inventory is
  committed; the regeneration is the fix. It records +1 model
  (`LmsCourseTemplate`), +11 endpoints and +3 jobs.
- `student-import.spec.ts` fails intermittently under a full-suite run (an
  ExcelJS test against a 5 s timeout) and passes in isolation in ~180 ms. Not an
  LMS suite and not a regression.

### LTI 1.3

Implemented as a platform: OIDC login initiation, RS256-signed `id_token`,
published JWKS, and an AGS score sink.

- Signing keys are **per organization** and generated on first use; the private
  key is AES-256-GCM encrypted at rest. `POST lti/keys/rotate` mints a new key and
  retires the old one without deleting it, so a launch signed moments earlier
  still verifies against the cached JWKS.
- Set `LTI_ISSUER` (or `PUBLIC_BASE_URL`) to the installation's public origin —
  tools key their registration on the issuer, so changing it later re-registers
  every tool.
- Register each tool with: issuer, client id, deployment id, its OIDC login URL,
  and our JWKS at `/api/v1/school/lms/lti/.well-known/jwks.json`.
- An incoming AGS score is **rescaled** against the activity's own maximum: a tool
  reporting 95/100 for work marked out of 20 lands as 19.

### Running the integration suite

`test:integration` now caps Jest at 4 workers. Without it the suite fails
wholesale on a developer machine: each suite compiles a full Nest module graph and
opens its own database connections, and ~41 of them in parallel exhausts both
memory and Postgres `max_connections` (100 here). The failures look like real test
failures but are resource exhaustion — the same suites pass in a smaller batch.
This was a pre-existing property of the suite, not specific to the LMS specs.

```bash
pnpm --filter @erp/api test:integration          # whole suite, capped
pnpm --filter @erp/api exec jest --testPathPattern "test/integration/school-lms" --forceExit
```

### Post-deploy verification

Then, as a real pupil account: open **My learning**, enter a course, download a
file, submit homework, sit a quiz, and confirm the mark stays hidden until it is
approved.

---

## 4. Operational notes

- **Nightly jobs.** `lms-orphan-check` (02:00) reports course modules whose
  instance row has vanished — it reports only; repair is an explicit, audited
  call. `lms-due-reminders` (07:00) notifies pupils about work due within 24
  hours, skipping anyone who has already submitted.
- **Mark release is the invariant to protect.** Three readers enforce it
  (`view-envelope.service`, `gradebook.userReport`, `LearnerService.recentGrades`)
  and a fourth deliberately withholds it (`LmsNotifyService.notifyGraded` sends no
  score until approval). A new reader of `StudentAssessment.effectiveScore` must
  make the same check.
- **`MarkingService.postMark` remains the only writer of a mark.** The LMS grade
  bridge routes through it; nothing else may write `StudentAssessment.score`.
- **Rollover carries structure only** — no cohort, submissions, marks or dates —
  and refuses a target that already has activities, so re-running is safe.
