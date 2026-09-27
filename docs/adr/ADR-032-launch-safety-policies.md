# ADR-032 — Launch safety policies (attendance, sensitive records, cash custody, identity, finance reopen, mobile money)

Status: accepted (2026-09-27, owner decision). Source: production-readiness audit `docs/audit/2026-09-27-school-production-readiness-audit.md` F01, F05, F07, F08, F09, F13; plan `docs/AUDIT_REMEDIATION_PLAN_2026-09-27.md` Phase 0.

## Decisions

| # | Question | Decision | Where it lives |
|---|---|---|---|
| P1 | How a late mark counts | **No platform default.** School must choose during setup: late contributes `1.0` or `0.5` of a session, exactly once. Excused absence in/out of denominator is also a school choice. Until the school has chosen, any rate that depends on the choice (a period with a late mark) is not computed — it is shown as not set, never guessed. Periods with no late marks still have a rate. Excused absences are a separate status flag (`isExcused`). Never clamp a rate to 100. | `SchoolProfile.attendanceLateContribution`, `SchoolProfile.attendanceExcusedInDenominator`, `AttendanceStatusConfig.isExcused`; one calculator `attendance/attendance-rate.ts` |
| P2 | Who reads nursery health/immunisation and safeguarding incidents | Head teacher, designated safeguarding lead / nurse, **and the assigned class teacher for their own pupils only** (seat from `readableSeats()`). Unassigned, other-class and former teachers read nothing. Guardian phone numbers follow contact permission. | `school:medical:read` (immunisation/health; now also on the Class Teacher preset) and `school:incidents:read` (safeguarding log), both limited to the caller's pupils by `DataScopeService` and the global `PupilScopeGuard` |
| P3 | Cash custody at the fee desk | **Both modes, per-school setting.** `drawer`: cash receipts require an open cash session and create a drawer movement; close reconciles expected vs counted. `cashbook`: no sessions; reconciliation reports cash as "untracked custody", never as zero variance. | `SchoolProfile.cashCustodyMode` (`drawer` \| `cashbook`) |
| P4 | Likely-duplicate pupil | Every admission path (quick register, create, import, transfer-in) runs the same likely-match check inside `admit()`, serialized per identity, and returns 409 with matches. Application conversion uses its own identity-match review (confirm/dismiss each candidate), which is that decision. Without a date of birth, the same name in the same class is a likely match. Registering anyway needs `school:students:override_duplicate`, a reason, and is audited. No name+DOB uniqueness constraint. | `StudentAdmissionService.findLikelyDuplicates` |
| P5 | Reopening a financially closed term | Holder of the period-close grant (`PERMISSIONS.school.closePeriod`), **not the person who closed it** (maker-checker), reason required, audited; reopen and close take the exclusive term-close lock. Every financial mutation checks the term gate inside its own posting transaction. | `TermFinancialClose` |
| P6 | Live MTN/Airtel collection | **Excluded from launch.** Capability off, UI hidden. Recording an externally confirmed MoMo receipt stays available. F13 rework (UUID reference, polling/callback, provider sandbox) is post-launch. | capability flag |

## Consequences

- Attendance setup gains a mandatory policy step; reports show "policy not set" rather than a number until it is chosen.
- Early-years services must call the shared pupil-scope helper; no route implements its own teacher-scope logic (invariant I-013).
- Fee collection UI branches on `cashCustodyMode`; both modes need D09 evidence.

## Alternatives considered

- Platform default for late (1.0) — rejected by owner: schools differ, and a silent default is what produced F08.
- Health/safeguarding restricted to head + DSL only — rejected: class teachers need own-pupil context for daily care.
- Single cash mode — rejected: small nurseries may run without drawer sessions.
