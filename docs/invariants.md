# Business invariant registry

Source: audit 2026-09-27, plan `docs/AUDIT_REMEDIATION_PLAN_2026-09-27.md`, policies ADR-032.

A green test suite is not proof. An invariant is **held** only when every column below is filled and its evidence file exists. D-specs must fail on the pre-fix commit (`8252c54`) before they pass.

Status: `open` → `enforced` (code) → `proven` (integration + evidence) → `certified` (independent re-audit, Phase 5.1).

## Identity

| ID | Invariant | Enforcing code | Unit | Integration | Browser | Evidence | Status |
|---|---|---|---|---|---|---|---|
| I-001 | A likely duplicate never silently creates another pupil, on any admission path | | | D07 | D07 | | open |
| I-002 | A pupil has at most one active placement per term | DB exclusion constraint (preflight) | | existing placement suites | | preflight | enforced |
| I-003 | A financial document has exactly one authoritative pupil | | | D04 | | | open |

## Authorization

| ID | Invariant | Enforcing code | Unit | Integration | Browser | Evidence | Status |
|---|---|---|---|---|---|---|---|
| I-010 | A teacher reads no pupil outside their assignment, through any entry point (list, detail, report, export, search, history, attachment, notification) | `DataScopeService.readableSeats()` | | D01, D02 | | `docs/audit/authz-inventory.md` | open |
| I-011 | Removing an assignment removes access on the next request | | | D01 (former teacher) | | | open |
| I-012 | Health, immunisation and safeguarding records need explicit permission plus own-pupil scope (ADR-032 P2) | | | D01 | | | open |
| I-013 | No student-data endpoint implements its own interpretation of teacher scope | shared pupil-scope helper | | authz inventory | | `docs/audit/authz-inventory.md` | open |

## Finance

| ID | Invariant | Enforcing code | Unit | Integration | Browser | Evidence | Status |
|---|---|---|---|---|---|---|---|
| I-020 | One approved adjustment has exactly one economic effect (one journal, one residual change) | | | D03 | | | open |
| I-021 | A financially closed term accepts no posting through any path | | | D05 | | `docs/audit/posting-inventory.md` | open |
| I-022 | Adjustment pupil equals invoice pupil | | | D04 | | | open |
| I-023 | Every cash receipt has a custody representation (drawer movement) or appears as variance / untracked custody | | | D09 | D09 | | open |
| I-024 | Cashbook day boundaries follow the school time zone; the requested date is the reported date | | | F21 spec | | | open |

## Attendance

| ID | Invariant | Enforcing code | Unit | Integration | Browser | Evidence | Status |
|---|---|---|---|---|---|---|---|
| I-030 | One attendance session contributes exactly once, per the school's ADR-032 P1 policy | | | D08 | | | open |
| I-031 | Every rate lies in 0–100 because the arithmetic is correct, never because it is clamped; all consumers agree | | | D08 | | | open |

## Nursery

| ID | Invariant | Enforcing code | Unit | Integration | Browser | Evidence | Status |
|---|---|---|---|---|---|---|---|
| I-040 | Every release records who collected, under what authority, which pupil, when, and who released | | | D06 | D06 | | open |
| I-041 | A current canPickup guardian is released without an override | | | D06 | D06 | | open |

## Operations

| ID | Invariant | Enforcing code | Unit | Integration | Browser | Evidence | Status |
|---|---|---|---|---|---|---|---|
| I-050 | The production artifact builds from a clean clone and boots with NOBYPASSRLS roles | | | D11 | D10 | | open |
| I-051 | Recovery is proven by a real restore of database and files, not an archive listing | | | D12 | | | open |
