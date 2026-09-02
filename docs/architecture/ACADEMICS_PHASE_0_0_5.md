# Academics and Assessment — Phase 0 / 0.5 Baseline

- **Status:** Implemented engineering baseline; domain sign-off pending
- **Date:** 2026-09-02
- **Owners:** Engineering, QA, school product owner
- **Scope boundary:** No Phase 1 enrollment/placement schema is introduced here.

## Exit-gate status

| Gate | Evidence | Status |
|---|---|---|
| Build and typecheck | `pnpm verify` | Automated |
| Academic unit/integration suite | `pnpm test:academics`; `.github/workflows/ci.yml` | Automated |
| Open handles visible | Academic job uses `--detectOpenHandles`, never `--forceExit` | Automated |
| Current-state inventory | `pnpm academics:inventory` | Automated snapshot |
| No unknown mark writer | Generated write-site list + classification register below | Review required on every diff |
| Data volumes and quality | `prisma/phase0_5/01_academic_preflight.sql` | Run per environment |
| Backup restoration | `docs/operations/ACADEMIC_BACKUP_RESTORE_REHEARSAL.md` | Operator evidence required |
| Staging parity | `docker-compose.staging.yml` and parity checklist | Deploy/operator evidence required |
| Domain decisions | ADR-018 through ADR-027 | School, QA and engineering sign-off required |

## Feature freeze

Until Phase 0.5 sign-off, changes under these paths are limited to defect fixes, tests,
inventory, migrations and work explicitly required by the accepted ADRs:

- `apps/api/src/modules/school/{academics,assessment,examinations,lms,people}`
- `apps/web/src/pages/school` academic, assessment, exam, result and LMS screens
- academic models in `apps/api/prisma/schema.prisma`

Pull requests must state the applicable ADR and whether they add a new academic read or
write path. Advanced Moodle-shaped LMS features are off unless both
`ENABLE_ADVANCED_LMS=true` and `VITE_ENABLE_ADVANCED_LMS=true`; the API flag is authoritative.
Core course offerings, lesson planning, assignments and assessments stay enabled.

## KEEP / MERGE / MIGRATE / DEPRECATE / DELETE register

| Current concept | Decision | Canonical destination | Retirement condition |
|---|---|---|---|
| `Enrollment` | MIGRATE | `StudentEnrollment` + `EnrollmentPlacement` | Reconciled backfill and one successful term |
| `EnrollmentHistory` | MERGE | placement/status events | All actor/reason/timestamp data mapped |
| `StudentProfile.currentClass/Section/StreamId` | DEPRECATE | current-placement projection | All consumers moved; compatibility window complete |
| `Section` | KEEP | annual-cohort section | Same-cohort validation enabled |
| `Stream` | KEEP | optional section child | grouping-mode migration complete |
| `CourseOffering` | KEEP | Learning Offering | broaden in place |
| `CourseOfferingTeacher` | KEEP | responsible staff membership | — |
| `TeacherAssignment` | MIGRATE | `CourseOfferingTeacher` | parity and ownership tests pass |
| `CourseEnrolment` | KEEP | course membership | enrollment-derived sync established |
| `AcademicRoster` | KEEP | frozen assessment/result snapshot | rename only if later ADR requires |
| `AssessmentPolicy` | KEEP | immutable published version | mutation guards installed |
| `Assessment` | KEEP | all assessed evidence | offering + frozen roster required to publish |
| `StudentAssessment` | KEEP | learner mark/participation truth | — |
| `MarkEntry` / `MarkAdjustment` | KEEP | append-only mark ledger | — |
| `HomeworkAssignment` | MIGRATE | `Assignment` | submission/score/attachment parity |
| `HomeworkSubmission` | MIGRATE | `AssignmentSubmission` | submission/attempt parity |
| `GradeEntry` | DEPRECATE | assessment spine | already DB read-only; delete after one production cycle |
| Exam paper operations | KEEP | `Exam` / `ExamSchedule` + assessment link | — |
| LMS gradebook | MERGE | canonical assessment adapter | no independent score writes |
| `ResultSet` | KEEP | published immutable truth | — |
| `ReportCard` | MIGRATE | `ReportDocument` | PDFs reproducible and provenance reconciled |
| Legacy academic pages | DEPRECATE | canonical workspaces | redirects + adoption telemetry complete |

`DELETE` is intentionally empty in Phase 0.5. Deletion is forbidden until mapping,
reconciliation, read-only cutover and a successful production term are evidenced.

## Old-to-new mapping and backfill order

| Old source | New target | Stable key / rule |
|---|---|---|
| `Enrollment` | `StudentEnrollment` | organization + learner + academic year/programme |
| enrollment class/section/stream | `EnrollmentPlacement` | enrollment + term + effective-from; never overwrite |
| profile current placement | compatibility projection | newest effective placement at `now()` |
| `TeacherAssignment` | `CourseOfferingTeacher` | term + class/group + subject + staff |
| class eligibility | `CourseEnrollment` | offering + enrollment; explicit elective/opt-out wins |
| `AcademicRosterMember` | assessment roster member | snapshot member and captured placement unchanged |
| `HomeworkAssignment` | `Assignment` | existing `assessmentId`; one-to-one |
| `HomeworkSubmission` | `AssignmentSubmission` | assignment + learner + attempt |
| `GradeEntry` | `Assessment` + `StudentAssessment` + `MarkEntry` | exam schedule + learner; existing backfill script |
| `ReportCard` | `ReportDocument` | learner + result-set revision + report type + template version |

Backfills run in dependency order: programmes/cohorts → enrollments → placements →
offerings/teachers → course enrollments → assignments → reports. Each is dry-run first,
idempotent, tenant-scoped, tagged with a migration run id and followed by reconciliation.
Unmapped records enter a visible exception queue; no script silently discards a row.

## Rollback plan

1. Put academic APIs in maintenance/read-only mode and drain background jobs.
2. Save the reconciliation output and take a named pre-migration backup.
3. Run the idempotent backfill against staging restored from that backup.
4. If a gate fails before cutover, remove only rows tagged with that migration run id.
5. If a gate fails after write cutover, disable the new writer and restore the full
   pre-migration database snapshot. Never down-migrate published academic facts.
6. Run `03_rollback_checks.sql`, compare counts/checksums and re-enable the legacy
   read-only view only after incident approval.

## Permission matrix

| Capability | Teacher | Class teacher | HOD | Exam officer | Head teacher | Administrator | Accountant | Student/guardian |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| View assigned offering/roster | own | class | department | exam scope | all | all | no | released own |
| Draft and enter marks | own | own | own | exam scope | no | no | no | no |
| Submit marks | own | own | department | exam scope | no | no | no | no |
| Return/moderate marks | no | scoped | department | exam scope | all | no | no | no |
| Approve marks | no self-approval | no self-approval | department | exam scope | all | no | no | no |
| Publish results | no | no | recommend | prepare | approve/publish | no | no | no |
| Amend published result | request | request | recommend | request | approve | no | no | no |
| Manage enrollment/placement | no | view class | view | view candidates | view | yes | view clearance only | own released |
| View detailed marks | own courses | class pastoral | department | exam scope | all | configuration only | no | released own |

Every row is additionally tenant-scoped. Offering ownership, class responsibility,
department and portal-subject scope are checked server-side; global permission strings alone
do not grant access to every learner.

## Event and audit catalogue

| Event | Producer | Required durable facts | Consumers |
|---|---|---|---|
| `EnrollmentCreated` | enrollment | learner, programme/year, actor, request id | placement/course sync |
| `PlacementChanged` | enrollment | old/new grouping, effective dates, reason, actor | roster eligibility, timetable |
| `CourseOfferingPublished` | academics | type, audience, curriculum version, responsible staff | timetable/LMS |
| `AssessmentPublished` | assessment | offering, policy version, roster checksum | learners/notifications |
| `MarksSubmitted` | marking | assessment, row count, submitter, input checksum | approval queue |
| `MarksReturned` | marking | reason, reviewer, affected rows | marker |
| `SchoolMarksApproved` | marking | approver, assessment, row count | readiness gate |
| `ResultSetPublished` | result run | revision, input/output checksum, publisher | reports/portal/promotion |
| `ResultAmended` | result run | old/new revision, request/evidence, approvers | reports/portal |
| `ReportDocumentPublished` | reporting | result revision, template version, payload checksum | portal/archive |

All write audits persist organization, entity/id, action, actor id, request id, before/after
facts and timestamp. Background jobs use a documented system actor and correlation/run id.
Credentials, tokens, health data and free-form evidence content must not enter logs.

## Sign-off

Schema implementation for Phase 1 is blocked until all ten ADRs have named approvals from:

- Engineering lead
- QA lead
- A teacher or exam officer
- A school administrator or head teacher

Sign-off records belong in the release ticket, with the ADR commit hash. “Proposed” is not
equivalent to approved.
