# Business invariant registry

Source: audit 2026-09-27, plan `docs/AUDIT_REMEDIATION_PLAN_2026-09-27.md`, policies ADR-032.

A green test suite is not proof. An invariant is **held** only when every column below is filled and its evidence file exists. D-specs must fail on the pre-fix commit (`8252c54`) before they pass.

Status: `open` → `enforced` (code) → `proven` (integration + evidence) → `certified` (independent re-audit, Phase 5.1).

## Identity

| ID | Invariant | Enforcing code | Unit | Integration | Browser | Evidence | Status |
|---|---|---|---|---|---|---|---|
| I-001 | A likely duplicate never silently creates another pupil, on any admission path | `StudentAdmissionService.admit` → `assertNotLikelyDuplicate` (advisory lock); duplicate dialog in the students page | | `wave14-identity-attendance.spec.ts` D07 | | | enforced |
| I-002 | A pupil has at most one active placement per term | DB exclusion constraint (preflight) | | existing placement suites | | preflight | enforced |
| I-003 | A financial document has exactly one authoritative pupil | `FinanceControlsService.pupilOfDocument` (adjustments derive the pupil) | | `wave14-finance-integrity.spec.ts` D04 | | `docs/audit/posting-inventory.md` | enforced |

## Authorization

| ID | Invariant | Enforcing code | Unit | Integration | Browser | Evidence | Status |
|---|---|---|---|---|---|---|---|
| I-010 | A teacher reads no pupil outside their assignment, through any entry point (list, detail, report, export, search, history, attachment, notification) | `PupilScopeGuard` (global), `DataScopeService.readableSeats()`, report `filterRows` | `pupil-scope-guard.spec.ts` | `wave14-child-data-scope.spec.ts` D01/D02 | | `docs/audit/authz-inventory.md` | enforced |
| I-011 | Removing an assignment removes access on the next request | seats read per request from DB | | `wave14-child-data-scope.spec.ts` (former teacher) | | | enforced |
| I-012 | Health, immunisation and safeguarding records need explicit permission plus own-pupil scope (ADR-032 P2) | `school:medical:read` / `school:incidents:read` + DataScopeService | | `wave14-child-data-scope.spec.ts` D01 | | | enforced |
| I-013 | No student-data endpoint implements its own interpretation of teacher scope | `PupilScopeGuard`; `npm run authz:check` | `pupil-scope-guard.spec.ts` | | | `docs/audit/authz-inventory.md` | enforced |

## Finance

| ID | Invariant | Enforcing code | Unit | Integration | Browser | Evidence | Status |
|---|---|---|---|---|---|---|---|
| I-020 | One approved adjustment has exactly one economic effect (one journal, one residual change) | `approveAdjustment` row locks in tx; `postingKey`; unique `FeeAdjustment.journalEntryId` | | `wave14-finance-integrity.spec.ts` D03 | | | enforced |
| I-021 | A financially closed term accepts no posting through any path | `term-close-gate.ts` shared/exclusive advisory lock; gates inside every posting tx | | `wave14-finance-integrity.spec.ts` D05 | | `docs/audit/posting-inventory.md` | enforced |
| I-022 | Adjustment pupil equals invoice pupil | `createAdjustment` | | `wave14-finance-integrity.spec.ts` D04 | | | enforced |
| I-023 | Every cash receipt has a custody representation (drawer movement) or appears as variance / untracked custody | `cashCustodySession`; `reconcileOperationalCash`; `CashDeskService` | | `wave14-finance-integrity.spec.ts` D09 | fee desk drawer bar | | enforced |
| I-024 | Cashbook day boundaries follow the school time zone; the requested date is the reported date | `dailyCashBook` via `school-time.ts` | | `wave14-finance-integrity.spec.ts` F21 | | | enforced |

## Attendance

| ID | Invariant | Enforcing code | Unit | Integration | Browser | Evidence | Status |
|---|---|---|---|---|---|---|---|
| I-030 | One attendance session contributes exactly once, per the school's ADR-032 P1 policy | `attendance/attendance-rate.ts` (`bucketOf`, `summarizeAttendance`) used by pupil summary, class report, reports, portal, report card | calculator property test | `wave14-identity-attendance.spec.ts` D08 | | | enforced |
| I-031 | Every rate lies in 0–100 because the arithmetic is correct, never because it is clamped; all consumers agree | same | | `wave14-identity-attendance.spec.ts` D08 | | | enforced |

## Nursery

| ID | Invariant | Enforcing code | Unit | Integration | Browser | Evidence | Status |
|---|---|---|---|---|---|---|---|
| I-040 | Every release records who collected, under what authority, which pupil, when, and who released | `PickupService.release`; DB check `PickupEvent_authority_named_check` | | `wave14-child-data-scope.spec.ts` D06 | | | enforced |
| I-041 | A current canPickup guardian is released without an override | `PickupService.release` (`studentGuardianId`); gate UI passes collector explicitly | | `wave14-child-data-scope.spec.ts` D06 | | | enforced |

## Operations

| ID | Invariant | Enforcing code | Unit | Integration | Browser | Evidence | Status |
|---|---|---|---|---|---|---|---|
| I-050 | The production artifact builds from a clean clone and boots with NOBYPASSRLS roles | Dockerfile.api (Prisma asserted from apps/api; pg client 16; nested .env excluded from context); prod compose same-origin API + aligned flags | | image build (Phase 4) | D10 external device — Phase 5.2 | | enforced (host boot pending) |
| I-051 | Recovery is proven by a real restore of database and files, not an archive listing | `BackupService.runScheduledRestoreTest` (scratch restore, manifest + ledger checks, weekly cron); live-DB overwrite guard | | `wave14-restore-drill.spec.ts` | | `docs/operations/backup-and-restore.md` | enforced (host drill pending) |
