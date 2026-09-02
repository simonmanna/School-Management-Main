# Phase 8 — pilot and production rollout runbook

Status: **procedure, not a record.** Nothing in this document has been executed. It exists so that
the first school to go live follows a sequence somebody thought about in advance, and so that each
step has a written way to tell whether it worked.

Read alongside:
- [Phase 6](../architecture/ACADEMICS_PHASE_6.md), [Phase 7](../architecture/ACADEMICS_PHASE_7.md)
- [Backup and restore rehearsal](ACADEMIC_BACKUP_RESTORE_REHEARSAL.md)
- [ADR-027 — legacy academic retirement](../adr/ADR-027-legacy-academic-retirement.md)

---

## 0. The standing deployment hold

**Do not run `prisma migrate deploy` against a school's database until §1 is complete.** The
inspected working database has no `_prisma_migrations` table, so the repository's migration chain is
not recorded as applied there. Deploying onto it would either re-run migrations against objects that
already exist or skip ones that do not.

This hold has stood since Phase 4 and is not lifted by anything in Phases 6–8.

## 1. Establish the migration baseline

Once per target database, before anything else.

1. **Back up.** `pg_dump -Fc` to a file outside the server, and record the size and SHA-256.
2. **Restore that backup to a scratch database** and confirm it opens. A backup that has not been
   restored is a hope, not a backup.
3. On the scratch copy, determine which migrations are already reflected in the schema. Every
   migration in `apps/api/prisma/migrations` is written to be idempotent
   (`CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`, `DO $$ … EXCEPTION WHEN
   duplicate_object`), which makes this survivable but does not make it correct to guess.
4. `prisma migrate resolve --applied <migration>` for each one already present.
5. `prisma migrate deploy` on the scratch copy. It must complete with no pending migrations left.
6. Compare the scratch copy's schema against `schema.prisma` (`prisma migrate diff`). Expect empty.
7. Only then repeat 4–5 against the real database, from the same backup point.

**Exit:** `prisma migrate status` reports no pending migrations, and `migrate diff` against the
schema is empty.

## 2. Seed the mixed Uganda test school

The plan's Phase 0 dataset, on staging — not on the school's database. It must contain, at minimum:

- Classes P1, P3, P5, P7 and S1, S3, S4, S6, with sections and (on at least one class) streams.
- A late admission after assessments began; a transfer between classes; a repeater; a withdrawn
  learner who must remain visible in an old result.
- An absent learner and an exempt assessment, so aggregation is exercised on both.
- A team-taught offering and a school-wide competency offering.
- Homework, a CAT, a project, a practical and an exam paper in one term.
- A published result set, and an amendment producing revision 2.
- S3/S4 candidates with candidate numbers and an Activity of Integration, for the CA readiness board.

`pnpm seed:school` is the starting point; the movement cases above must be created deliberately.

## 3. Rehearse the whole term on staging

Run a full cycle against the seeded school **before any real school touches it**. Each step names
what proves it worked.

| # | Step | Proof |
| --- | --- | --- |
| 1 | Place learners; move one mid-term | Placement history reconstructs every learner's class for any date; the old placement is end-dated, not overwritten |
| 2 | Generate course offerings; allocate teachers | Every active offering has an audience and responsible staff |
| 3 | Teach a week: scheme, lesson plan, delivery, register | The teacher completes it without leaving their workspace |
| 4 | Set and mark homework, a CAT and a project | Every mark lands in `StudentAssessment`; legacy endpoints return 410 |
| 5 | Submit and approve marks as two different people | Approval by the marker is refused |
| 6 | Run an examination end to end (all ten steps) | The gate names each blocker; custody chain verifies |
| 7 | Compute, approve and publish a result set | Readiness gate passes; `ResultSet` carries both checksums |
| 8 | Generate report cards | `ReportDocument` pins result set, revision, template version and payload checksum |
| 9 | Amend one mark through the amendment workflow | Revision 2 exists; **revision 1 is byte-identical to before** |
| 10 | Open the CA readiness board for S4 | Blocked candidates are named with a reason |
| 11 | Produce and download the CA file | Run record carries the checksum; blocked candidates are absent from the file |
| 12 | Sign in as a guardian | Only their own child; nothing unapproved; message history present |

**Exit:** step 9 produced a new revision without altering the old one, and step 12 showed no
unreleased mark.

## 4. Parallel run

For one pilot class, for one term:

- Teachers enter marks in the new workflow only.
- The school independently calculates the expected totals the way it does today.
- QA compares **every learner's every subject**, not a sample.
- Differences are explained before go-live, one by one. "Rounding" is an explanation only when the
  rounding mode is named and matches the school's stated policy.
- **No old system remains an undocumented write path.** If marks are still being entered anywhere
  else, the parallel run is measuring two systems, not validating one.

## 5. Pilot order

Widen only when the previous ring has completed a full cycle without a data defect.

1. Internal staff sandbox.
2. One teacher, one non-exam class.
3. One complete Primary class.
4. One Lower Secondary class.
5. One examination cycle.
6. One result and report-card cycle.
7. Whole school.

## 6. Go-live gate

Every line must be true, with a name and a date against it.

- [ ] `pnpm --filter @erp/api exec tsc --noEmit` clean; web and portal typechecks clean.
- [ ] `test:academics`, `test:academics:phase4`, `test:academics:phase5` green against a real database.
- [ ] `route-permission-coverage` and `role-presets` green.
- [ ] Migration rehearsal (§1) completed **twice** on a restored copy.
- [ ] Backup restored and opened; restore time recorded.
- [ ] Reconciliation (§4) has zero unexplained differences.
- [ ] Permission matrix reviewed against the school's actual staff list and signed off by the head teacher.
- [ ] Roles provisioned from the presets, then **checked**: the exam officer can open the exam console; the bursar cannot read a mark.
- [ ] Teachers trained on marking, submission and the meaning of "approved".
- [ ] Head teacher and exam officer trained on publication, amendment and the CA board.
- [ ] Support escalation contacts published to staff.
- [ ] Rollback tested (§7).
- [ ] No critical or high-severity defect open.

Known-open at the time of writing, and to be re-checked at the gate:
`report-definition-canon.spec.ts` (see [Phase 7 §7](../architecture/ACADEMICS_PHASE_7.md)). It does
not touch the mark or result chain, but a school relying on the affected reports should know they
are the ones that query the database directly.

## 7. Rollback

Rollback is **restore from backup**, not a down-migration. The Phase 1–6 migrations are additive and
carry no `DOWN`; reversing them by hand mid-term risks the placement history that everything else
projects from.

Therefore:
1. Take a backup immediately before the deploy and verify it restores.
2. Note the exact time of the deploy.
3. To roll back: stop the API, restore the pre-deploy backup, restart on the previous build.
4. **Everything entered after the deploy is lost.** That is the cost, and it is why the deploy
   window must be outside teaching hours and short.

If teaching hours have passed and marks were entered, do not restore. Fix forward.

## 8. Hypercare — first two weeks

- Daily: failed-job review (`ResultProcessingRun` with `errorCount > 0`, notification failures).
- Daily: audit anomaly review — approvals by the person who entered, amendments, permission changes.
- Same-day response to any lost-access or mark-entry incident, ahead of all other work.
- No non-essential releases.
- End-of-week session with the school: what took longer than it should have.

Keep `ACADEMIC_REMINDERS_ENABLED=false` for the first week. Let staff meet the system before it
starts contacting them.

## 9. Environment flags for a pilot school

| Flag | Pilot value | Why |
| --- | --- | --- |
| `ENABLE_SCHOOL` | `true` | |
| `PERMISSIONS_DB_LOOKUP` | `true` (default) | Revocation is immediate; a role change during hypercare must take effect at once |
| `ACADEMIC_REMINDERS_ENABLED` | `false` week 1, then `true` | |
| `ACADEMIC_REMINDER_CHANNEL` | `in_app` | SMS costs the school money |
| `DUNNING_CRON_ENABLED` | `false` until fees are reconciled | An automated fee chase during a data-migration week is the fastest way to lose a family's trust |
| `LOG_LEVEL` | `info` | |
| Advanced LMS, CBT, SCORM, LTI, badges | off | Keep them off until the school completes one successful term |
