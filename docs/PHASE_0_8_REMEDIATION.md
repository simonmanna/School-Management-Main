# Phase 0–8 production remediation (2026-09-23)

Fixes for the Phase 0–8 production-readiness audit. Finding IDs (F-xx) match the audit report.

## Deploy checklist (order matters)

1. **Database roles.** Run the script as the database superuser:
   `pnpm --filter @erp/api rls:setup-role`.
   It creates two runtime roles:
   - `app` (NOBYPASSRLS). Set it as `DATABASE_URL`.
   - `app_system` (BYPASSRLS). Set it as `SYSTEM_DATABASE_URL`.

   `docker-compose.prod.yml` refuses to start without both. The API also refuses to boot in production when:
   - it runs as a superuser, or
   - RLS is live but `SYSTEM_DATABASE_URL` is missing.
2. **Migrations**, run as the owner/migrator: `prisma migrate deploy`. The new migrations are:
   - `20260921145000_hr_accrual_payroll_inputs`: HR objects that previously existed only in `prisma/sql/*.sql` (clean-replay drift).
   - `20260923100000_rls_enable_all_org_tables`: RLS enabled and forced on every org-scoped table (F-02).
   - `20260923110000_tenant_fk_guard`: same-tenant trigger on every tenant-to-tenant foreign key (F-05).
   - `20260923120000_enrollment_suspension_until` (F-21).
   - `20260923130000_timetable_version` (F-14).
   - `20260923140000_staff_status_values` (F-31).
   - `20260923150000_role_grants_sod`: backfills the new grants into existing roles (F-22, F-24, F-32).
   - `20260923160000_subject_attributes` (F-28).
   - `20260923170000_teacher_assignment_integrity` (F-29).
   - `20260923180000_placement_name_snapshot` (F-39).
3. **Preflight:** `DATABASE_URL=<owner> node scripts/assert-db-constraints.mjs`. It fails if any org table lacks enabled+forced RLS, or any tenant FK lacks its guard trigger.
4. **Environment:**
   - `PERMISSIONS_FAIL_CLOSED=true`. This is already the default when `NODE_ENV=production`.
   - `PERMISSIONS_DB_LOOKUP=true`.

## What changed

| Area | Change |
|---|---|
| Build (F-04) | `PromotionRunService`/`Controller` rebuilt on enrollment + placement. Report rosters now read `EnrollmentRosterService` (placement history). Every reader of the dropped `Enrollment`, `Stream`, `ProgrammeGradeLevel` and `currentClassId` is removed. |
| RLS (F-01, F-02) | `PrismaService` sets `app.org_id` on every tenant statement: model and raw queries, non-transactional (batch `[set_config, op]`), batch transactions (prepended) and interactive transactions. `raw` uses the system role. Login and cron fan-out use `raw`. |
| Tenant FKs (F-05) | DB trigger `enforce_same_org_fk` on all 570+ tenant-to-tenant FKs. It is invisible to Prisma drift. |
| AuthZ (F-03, F-06, F-07) | Role assignment and user administration may not exceed the actor's own grants. Every undecorated route is now decorated, and the route ledger is empty. The guard re-reads the account on each request: a deactivated account gets 401 on its next request, and `tenant.permissions` is refreshed from the DB. Refresh-token reuse revokes the whole token family. |
| Academic year (F-08, F-09) | `setCurrent`/`isCurrent` can no longer reopen CLOSED or ARCHIVED years. `assertYearWritable` (FOR SHARE) guards enrollment, placement, cohort, term, offering and assignment writes. Closing a year takes FOR UPDATE on the year row. Terms must fall inside their year and must not overlap. |
| Enrollment (F-16–F-23) | New enrollments can only start as PENDING or ACTIVE. Status changes are compare-and-set. Reactivation needs `school:enrollment:reactivate`. Suspensions carry `suspendedUntil` and are lifted automatically. Promotion and repeat move forward only and close at the old year's end. The profile status is projected from the latest year. A repeated identical move is a no-op. Enrollment controllers honour `Idempotency-Key`. |
| Placement (F-19, F-39, F-40) | Closed or archived cohorts and inactive classes are refused. The effective date is kept within the term. Class and section names are snapshotted on each placement. Concurrent moves return 409. Historical `asOf`/term lookups include learners who later left, and suspended learners stay on rosters. |
| Students (F-12, F-17, F-25) | A learner with history cannot be deleted. Membership statuses can only be set through the enrollment. Likely duplicates (same name + date of birth) are refused unless `allowDuplicate` is set. A parent is reused across siblings. Admissions re-use a confirmed existing pupil and block while an identity match is still open. |
| Admissions (F-24) | New grant `school:admissions:decide`. The interview, offer and fee sub-grants are now enforced. Enrolling an applicant also needs `school:enrollment:write`. |
| Staff (F-10, F-30, F-31) | Staff status now has an FSM, with new values `resigned` and `inactive`. Leaving (status change, or HR offboarding via `hr.employee.offboarded`) disables the login and revokes its sessions. It also end-dates allocations, unassigns live lessons and clears class-teacher roles. None of this changes any historical record. A staff member with history cannot be deleted. |
| Timetable (F-14, F-15, F-41) | One advisory lock per organisation serialises timetable writes. Conflict checks now cover multi-period spans on both slots, whole class vs section, and rotation cycles. The teacher must be allocated or assigned. Bulk batches are checked against themselves. Every change appends a `TimetableVersion`, readable through `GET /school/timetable/class/:id/history` and `/as-of`. |
| Subjects (F-28, F-29) | Subjects gain `isActive`, `displayOrder` and `academicLevelId`, and a subject in use is retired rather than deleted. TeacherAssignment uniqueness now uses NULLS NOT DISTINCT, and its FK is Restrict instead of Cascade. |
| Config (F-26, F-27) | `PATCH /school/profile` is validated (DTO). Currency and timezone live on the Organization. `GET /school/terminology` is added, plus a School Settings page (web). Key labels use `useTerminology()`. |
| Files (F-32) | Medical documents need `school:medical:read`. Applicant documents need `school:admissions:write`. HR files need `hr:read`. |
| Errors | Database rule violations (unique, FK, tenant guard, placement overlap) now return 4xx instead of 500. |
| Web (F-13, F-36) | Promotion filters on the server by placement. Student screens are normalised from `currentClass`/`currentSection`. Routes are gated by the menu's permission. |

## Verification

- `tsc --noEmit` (API, including tests): 0 errors.
- Clean replay of all migrations on an empty database, then `prisma migrate diff`: empty.
- `assert-db-constraints.mjs` on the replayed database: RLS on all org tables, FK guard complete.
- `test/integration/rls-app-role.spec.ts` + `src/kernel/prisma/rls.spec.ts` under the real `app` and `app_system` roles: pass.
- `test/integration/school-production-invariants.spec.ts` (26 tests: historical placement, 40/41 capacity + override, closed years, FSM races, tenant FK, duplicates, timetable conflicts, staff leaving, promotion): pass.
- CI provisions the RLS roles and runs the RLS specs against them.
