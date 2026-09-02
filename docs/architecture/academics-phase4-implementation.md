# Phase 4 — unified assessments and homework

Status: implemented in the working tree; local verification performed. **Not deployed, and not school UAT sign-off.** Phase 3 teaching integration is retained and regression-tested. Phase 5 examination/result operations and Phase 6 portal redesign remain separate phases.

## Staff workflow

1. Open **Academics → Assessment Board**, or Assessments within a teaching course.
2. Create an assessment using the course/purpose, delivery/scoring, and frozen-audience wizard. Published/active offerings must have a current responsible teacher. Official `CourseEnrollment` supplies the snapshot, not `StudentProfile.currentClassId`.
3. Review the draft, then publish. Publication validates the frozen roster and any published policy revision, and creates the canonical learner rows.
4. Use the Markbook for points, participation and comments, or the submission inbox for received work, rubric criteria and observation checklists. Zero is a mark; missing work is not zero. Non-scoring participation clears the score.
5. Save drafts explicitly. Submit only after every frozen-roster learner has an outcome. Submitted/approved marks are read-only. An independent approver may approve or return the batch with a reason; returned marks can be corrected and resubmitted.
6. Authorized assessment managers/approvers release feedback and marks separately. Approval alone does not release them.

The old gradebook and homework web routes redirect to the board. Their legacy mutation endpoints, including the lesson-plan homework shortcuts, return HTTP 410. Legacy tables remain for provenance, reconciliation and a later contract release; they are not deleted. Inactive legacy service helpers remain for migration-era compatibility, not new application writers.

Non-subject offerings (for example school-wide/competency activities) can own assessments without fabricated subject/class IDs. Exam papers still require a subject/class and use `ExamSchedule`. Non-subject evidence does not become an invented subject-result column.

## Integrity and authorization

- `Assessment.courseOfferingId` and `rosterId` bind the teaching context and immutable audience. Board counts and marking rows use that audience even after a learner moves class.
- `Assignment` and `AssignmentSubmission` provide delivery/attempt evidence for all non-exam kinds. `StudentAssessment` and `MarkEntry` remain the grade store. LMS module creation prepares a canonical draft and frozen course roster; staff publish it in the board before grading.
- Published policies/components are immutable at both service and database boundaries. Forking creates independent component IDs; existing assessments retain their original component references. Legacy policies already referenced by non-draft assessments are frozen by migration without changing their weights.
- Course allocations are effective-dated. Staff with organization-wide entry grants can enter marks; owner-scoped teachers must be allocated to the course. Approval and release have separate grants. Student/guardian submission authorization uses the verified portal identity and live guardian relationships.
- The database rejects mutations to frozen roster members. Bulk saves lock rows in deterministic order; row versions and approval status are claimed atomically before ledger changes. Approval acquires the same row locks.
- Submission attempts enforce the open/due/close window, late policy, maximum attempts and approval locks. Rubric grading validates every criterion exactly once against the assignment's rubric; unrelated criteria and out-of-range scores are rejected transactionally.
- A new attempt invalidates the previous draft grade while retaining the prior attempt's raw score/rubric snapshot. Assessed outcome links feed the Phase 3 coverage view only for their own course; term-wide evidence from unrelated learners no longer affects that course's coverage.

## Bulk draft protocol

`POST /school/assessment-board/:id/marks`

```json
{
  "rows": [
    { "studentProfileId": "...", "marks": 18, "participation": "present", "comment": "Evidence reviewed", "expectedVersion": 2 }
  ]
}
```

Send a stable `Idempotency-Key` header (maximum 160 characters). A batch accepts 1–500 distinct learners. All rows commit or all roll back. The response contains saved rows and new versions. Do not assume versions increment by exactly one; reuse the returned version.

- Exact retry: the transaction's response ledger returns the original response without another mark/history write.
- Reused key with changed payload: HTTP 409, no changes.
- Stale row: HTTP 409 with `code: MARK_VERSION_CONFLICT` and current learner/version/value/participation/comment information. Compare first, choose server or local values, then create a new save operation.
- Browser draft key: `school:assessment-draft:v1:<organization>:<user>:<assessment>`. Draft cells and the exact pending request/key are persisted before the request. A lost reply retains the operation. Only an already-requested save may retry on reconnection; publication, submission and release never auto-replay.
- The UI warns when local storage is unavailable, protects pending operations from editing, restores recovered drafts, and permits explicitly discarding unsent local edits. Local storage contains learner work: use trusted devices and clear browser data on decommissioning/shared-device handover.

## Migration and reconciliation

Migration: `20260906000000_phase4_unified_assessment`.

The expand/migrate script adds nullable canonical links, adopts only unambiguous course matches, and uses only an explicitly bound frozen legacy assignment roster. It does **not** invent a historical roster from current class membership. Legacy homework/submission IDs are retained on canonical rows. Conflicting or unmapped evidence becomes an `AcademicMigrationException`, never a silent overwrite or deletion.

Local rehearsal against a separate database copy on 2026-09-02 found:

| Check | Result |
| --- | ---: |
| Existing learner assessment records preserved | 2,938 / 2,938 |
| Existing scored records with identical score, maximum, percentage and approval status | 2,730 / 2,730 |
| Legacy homework records mapped automatically | 18 / 19 |
| Legacy submissions requiring explicit mapping | 18 |
| Historical course/frozen-roster binding exceptions | 1,015 |
| Total unresolved exceptions | 1,034 |

All 18 unmapped submissions belong to the legacy homework record with no assessment link. Their original evidence is retained. These are real data-resolution tasks, not a successful production migration claim.

Use **Assessment operations → Reconciliation** or `GET /school/assessment-board/reconciliation` (optional `sourceEntity` filter). The response reports unresolved totals and up to 200 records. A historical assessment workspace offers explicit context repair; every existing learner must be included. Closed/archived historical offerings can be reconciled by authorized staff. `POST /school/assessment-board/legacy-homework/:id/reconcile` maps verified homework evidence to a published target; mismatched contexts, missing learners and different canonical scores stop the transaction. Both actions require a reason and are audited.

Rehearsal command:

```powershell
pnpm academics:phase4:rehearse
node scripts/academic-phase4-rehearsal.cjs --verify
node scripts/academic-phase4-rehearsal.cjs --test test/integration/school-assessment-phase4.spec.ts
```

The script accepts only a localhost source, takes a `pg_dump`, restores to a new `school_phase4_rehearsal_<timestamp>` database, applies only this migration there, and emits `var/academics-phase4-rehearsal.json`. The original database is never migrated by this command. Test runs disable outbox batch dispatch. Rehearsal databases/dump archives are retained for inspection; the generated report contains their exact paths/names, not credentials.

**Deployment hold:** the inspected local source database did not have the repository's migration chain recorded as applied. Do not run a blind `prisma migrate deploy` against that existing database. First establish and review its baseline, back up the real target, rehearse the exact final migration on a copy, resolve exceptions for the rollout cohort, and obtain school UAT approval. A fresh database with the normal migration chain uses the standard deployment process.

Rollback is deployment rollback plus restoration from the verified pre-migration backup when needed. Keep the added tables/columns and legacy provenance during investigation; do not roll back by dropping learner evidence. Once staff have entered canonical marks, reconcile/export those changes before any backup restoration.

## Verification and acceptance

- Backend typecheck, production frontend build, and architecture dependency check were run.
- Final scoped run: **8 suites, 107 tests passed** against the rehearsed database. An additional academic-FSM/portal-surface/LMS run passed 43 tests (overlaps the scoped suite).
- The final expanded Phase 4 database suite passed **26 tests**, including the added Phase 3 coverage and resubmission-grade invalidation checks.
- Core Phase 4 integration: all assessment kinds; non-subject observations; frozen membership; cross-tenant/unallocated rejection; atomic range validation; idempotent replay; concurrent saves; maker-checker; return/resubmit; separate releases; policy immutability/fork; submission identity/attempts; rubric versions/evidence; historical context repair.
- Existing unified-assessment and roster/late-penalty/rubric tests were updated for the canonical contracts. Phase 3 teaching and mark recomputation tests were rerun.
- Browser interaction fixture: `/test/phase4-preview.html` under the Vite development server. It uses synthetic learners and an in-memory API, not a production login. Explicit-save gating, lost-response retry, conflict comparison/keep-local and the three wizard steps were inspected interactively. Real database behavior is tested separately by the integration suite.
- The existing route-permission-coverage ledger test reports 15 gaps in unrelated notification/income/other routes. This is a repository-wide pre-existing gate and is not silently waived or changed here. The full unrelated ERP suite was not certified.
- The production build retains existing large-bundle/dynamic-import warnings. Integration shutdown can report an existing outbox-worker disconnect warning; assertions still complete.

Run the scoped suite with `pnpm test:academics:phase4` against an explicitly selected test database. CI includes this suite after the existing academic integration gate.

Before rollout, school staff must still exercise the teacher/approver workflow with their actual role assignments, historical roster exceptions, intended absence policy, real submission files, representative class sizes, and a real disconnected/reconnected device. Record approval separately from implementation completion.
