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
| **`school-lms-e2e`** (DB) | 13 | Add → submit → mark → approve → release → rollover |

Unit total: **577 passing** (was 457 before this work). Two pre-existing failures
remain, unrelated to the LMS: `exam-projection` (imports a service that no longer
exists) and one `school-dto-validation` attendance case.

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

- **LTI 1.3 launches are not issued.** Tool registrations store correctly, but
  OIDC login, JWT signing and AGS passback need a key-management story this
  installation does not have. The UI says so plainly rather than failing at launch.
- **`mod_lesson` branching, `mod_wiki` version history and `mod_glossary`** store
  and display but have no deeper workflow (no branch navigation state, no diff view).
- **Three stale migration entries** (`lms_moodle_spine`,
  `lms_mod_assign_submission`, `gradeentry_readonly`) — the tables exist but the
  ledger does not record them, from an earlier `db push`. Reconcile before the
  next deploy; `migrate resolve --applied` would tidy it but would also mask real
  drift, so check first.
- **Browser E2E of the signed-in LMS has not been run.** Routing, build and
  console health are verified; the logged-in journeys are covered by the DB-backed
  integration suite rather than a browser driver.

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
