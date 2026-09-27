# Student → Academics → Results Remediation Plan

Source: `docs/audit/2026-09-26-student-academics-assessment-flow-audit.md` (F01–F23, NO-GO).
Continues wave numbering after Wave 12. Target: supervised pilot decision after Phase 5 exit gate.

Spot-verified before planning (2026-09-26):
- `grade-bands.ts` — integer inclusive endpoints (80–89 / 90–100) → decimal gap (F01).
- `resolveBands` — falls back to `isDefault` scale before built-in ECD (F14).
- `result-run.service.ts:556`, `promotion-run.service.ts:330` — filter `status: 'published'` only (F16).

---

## Implementation status — 2026-09-26 (branch `fix/wave13-student-flow`, uncommitted)

All phases were built in one pass on one branch. Owner decisions (ADR-031): D1 rounding is configurable per scale, D2 absence/exemption handling and D4 class-teacher scope are school settings, and D5 policies can be scoped to a programme.

| Finding | Status | Where | Proof |
|---|---|---|---|
| F01 decimal band gap | Fixed | `result-computation.ts` `bandFor`/`validateBands`; `grading.service.ts` uses the same lookup; scale writes validated | unit `student-flow-wave13` (every boundary ±0.01, 89.5 → D2); integration `wave13-student-flow` F01 |
| F02 missing components/subjects | Fixed | kernel `ComponentStatus` (missing is never re-weighted); gate `MISSING_EVIDENCE`, `SUBJECT_MISSING`, `NO_SUBJECT_RESULTS` | unit F02; integration F01+F02 |
| F03 formative counted | Fixed | `Assessment.contribution`; kernel `componentMembers`; wizard/gradebook/legacy create | unit F03; `school-gradebook` spec rewritten to the new rule |
| F04 compute retires released | Fixed | released set kept; recompute needs an approved amendment; swap only on publish; requester ≠ approver | integration F04; `school-result-integrity` A3-amend |
| F05 stale publish | Fixed | approved-only input; publish re-derives the input checksum inside a locked transaction; approval shares the term advisory lock | integration F05 (`STALE_RESULTS`) |
| F06 roster term/scope | Fixed | `assertRosterFitsScope`; results UI lists only whole-class frozen lists for the term | integration F06 |
| F07 empty scope → all | Fixed | `DataScopeService.readableSeats`/`studentReadWhere` (empty = nobody) | integration F07 |
| F08 medical/NIN exposure | Fixed | medical record only with `school:medical:read`; NIN encrypted, masked, audited reveal endpoint | integration F08/F15 |
| F09 read ownership | Fixed | result detail/by-term/by-student/explain, roster members, emergency contacts scoped; readiness/amendment queues school-wide only | integration F09 |
| F10 attendance membership | Fixed | `assertEntriesBelongToRegister` (dated placement, stream, all-or-nothing, no relabel) | integration F10 |
| F11 stale course membership | Fixed | reconcile closes/moves/reopens memberships; withdrawal closes all; capture admits only compatible seats and always reconciles | integration F11 |
| F12 historical roster | Fixed | `capture(asOf)` defaults to term end for past terms | integration F12 |
| F13 admission mapping | Fixed | server-side `mapApplicationToPupil`; conflicting overrides need confirmation; conversion summary | unit F13 |
| F14 nursery on primary scale | Fixed | `resolveScale` never borrows across systems; mixed-programme lists refused; programme resolved for the term's year | unit F14; integration F14 |
| F15 partial profile save | Fixed | name/contact/NIN/photo in one student transaction; UI one request | integration F08/F15 |
| F16 locked disappears | Fixed | `releasedResultSetWhere()` in every reader | integration F16 |
| F17 50-row cap | Fixed (pupil list) | pager + class/stream filter + count; 350-pupil spec | integration `wave13-scale` |
| F18 two enrollment dialogs | Fixed | shared `EnrollApplicationDialog` | web build |
| F19 promotion population | Fixed | `termId` on the pupil list; promotion uses it | typecheck/build |
| F20 false empty states / cache | Fixed (pupils, promotion, placement preview, enrollment caches) | `QueryError`, broad invalidation | typecheck/build |
| F21 chronology | Fixed | ordered by date/sequence/created/id | kernel input sorted; checksum stable |
| F22 open-pupil link | Fixed | API returns `studentProfileId`; dialog reads it | build |
| F23 stream roster filter | Fixed | wizard filters snapshots by stream | build |

Also found and fixed while verifying:
- Exam marks posted through the ledger stayed `participation: missing`, so they never reached results; this was hidden because the gate did not check coverage. Posting a score now marks the learner present.
- Compute inserted result rows one at a time inside a 5 s transaction, which could not handle a full class. Rows are now bulk-inserted: 350 pupils compute in 3.9 s and publish in 3.1 s.
- The Wave 12 early-years tables had no cross-tenant FK guard, so the deploy preflight failed. Added migration `20260927120000_tenant_fk_guard_early_years`.

Phase 6 (browser): **passing** against SUNRISE with two real logins (admin + subject teacher), 2026-09-27. It covers application → decision/offer → enrolment (details carried from the application) → teacher sets a CAT and an exam paper and marks every learner → the admin approves (segregation of duty) → the exam is closed → the whole-class list is locked → results are worked out and released → report cards are built and released. A repeat run in the same term checks that released results cannot be recomputed without an amendment (F04). Prepare SUNRISE with `pnpm --filter @erp/api exec tsx ../../scripts/seed-sunrise-academics.ts`, which sets up Term 3 as current, grading scales, a CA 40% / exam 60% policy, a P.1 A Mathematics course, the teacher login and an open exam sitting.

Found and fixed by the browser run:
- The admission row menus left the page unresponsive after a decision dialog (the menus are now non-modal).
- The assessment wizard offered closed exam sittings, and sittings that already had this course's paper.
- A saved class list was not selected, so it could not be frozen, and every list showed "? members".
- A class report-card release stopped part-way at the first late-admitted pupil: some families got their cards and the rest did not, behind an error message. It now releases every card that can be released and counts the ones held back.
Phase 7 (production proof): the RLS/FK preflight passes (622 tables). A backup/restore drill was run: 30.8 MB dump in 50 s, restore in 144 s, migrations up to date and the preflight passing on the restored copy. Finance sign-off and a real-hardware load test are still open.
Phase 8: the chosen term is now remembered across results, promotion and class lists.

---

## Phase overview

| Phase | Wave | Theme | Findings | Size | Blocks |
|---|---|---|---|---|---|
| 0 | 13 | Policy decisions + test harness | — | S | everything |
| 1 | 14 | Grading & release correctness | F01, F16, F03, F21 | M | 2 |
| 2 | 15 | Result publication integrity | F02, F04, F05, F06 | L | 5 |
| 3 | 16 | Access & privacy (fail-closed) | F07, F08, F09, F10 | L | 5 |
| 4 | 17 | Membership & handoffs | F11, F12, F13, F14, F15 | L | 5 |
| 5 | 18 | Functional gaps + UX | F17–F20, F22, F23 | M | 6 |
| 6 | 19 | Browser acceptance (full chain) | Def. of Done §17 | M | pilot |
| 7 | 20 | Production proof (RLS, finance, restore) | Not-verified areas | M | go-live |
| 8 | 21+ | Enhancements (P4) | — | — | none |

Phases 3 and 4 can run parallel to Phase 2 (different modules). Phase 1 first: small, highest blast radius.

Every phase ends with: `npm run lint`, `typecheck`, affected unit + DB integration suites green, new regression specs for each finding, findings closed in audit doc.

---

## Phase 0 — Wave 13: Policy decisions + harness

Goal: remove ambiguity before code. Audit defers several fixes to "agreed school policy".

### 0.1 Owner decisions (record as ADRs in `docs/adr/`)

| # | Decision | Recommended default |
|---|---|---|
| D1 | Grade boundary + rounding | Band = highest `min` ≤ score (half-open). No rounding before banding; display rounds to 1 dp. Optional per-scale `roundBeforeBanding: 'none' \| 'half_up_int'`. |
| D2 | Absent vs missing vs exempt | Missing = blocks publish. Absent = counts as 0 unless excused. Exempt = excluded, weights renormalised, recorded on result. |
| D3 | Formative work | Never contributes to term total. Summative must bind to exactly one component. |
| D4 | Teacher read scope | Class teacher: own class (all streams? or own stream). Subject teacher: learners in own offerings for the active year only. |
| D5 | Lower-primary (P1–P3) learning-area weighting | School-configured policy per programme. |
| D6 | Application→pupil field ownership | Application is source; enrollment dialog shows values, overrides require explicit flag. |
| D7 | Released statuses | `published` + `locked` = released. Only amendment supersedes. |
| D8 | Elective membership on stream move | Compulsory: auto exit/enter. Elective: kept if offering exists in new stream, else flagged for Registrar. |

### 0.2 Test harness

1. Add `test/fixtures/green-valley.ts`: Baby/Middle/Top + P1–P7, two streams (North/South), year + 3 terms, curricula, offerings, teachers, Registrar/Teacher/HeadTeacher/ExamsOfficer/Bursar/Parent users.
2. Add role-session helper for HTTP-level integration tests (supertest + real JWT per role) — required for F07–F10 proofs.
3. Convert the 11 audit probes (`var/student-flow-audit-probes.json`) into failing specs under `apps/api/test/regression/student-flow/` — one file per finding. They must go red now, green when fixed.
4. Add CI job running integration suites as the `app` DB role (not superuser) — seeds Phase 7 RLS proof.

**Exit:** ADRs merged, all F-specs exist and fail for the right reason.

---

## Phase 1 — Wave 14: Grading & release correctness

Small, isolated, highest impact. Ship first.

### F01 (P0) Continuous grade bands
Files: `assessment/grade-bands.ts`, `assessment/result-computation.ts:215`, grading-scale write path.
1. Replace inclusive-range lookup in `bandFor` with: sort bands by `min` desc, pick first where `score >= min`. `max` becomes display-only.
2. Remove "last band on no match" fallback → throw `InvalidGradingScaleError`.
3. Add `validateScale(bands)`: covers 0, top ≥ 100, no duplicate `min`, monotonic. Enforce on GradingScale create/update and in `resolveBands`.
4. Apply D1 rounding option.
5. Same logic for ECD descriptors.
- **Test:** each boundary at `b−0.01`, `b`, `b+0.01`; 0; 100; 89.5 → D2; 79.99 → C3. Through result compute + report render.

### F16 (P1) Locked results stay authoritative
1. Add `RELEASED_RESULT_STATUSES = ['published','locked'] as const` + `releasedResultWhere()` in assessment module.
2. Replace every `status: 'published'` result-set reader: `latestPublished`, `promotion-run.service.ts:330`, report generation, portal/parent reads, aggregates/ranks. Grep: `rg "status: 'published'" apps/api/src`.
- **Test:** publish → lock → report provenance, parent view, rank, promotion recommendation identical.

### F03 (P1) Formative vs summative contribution
1. Migration: `Assessment.contribution` enum `FORMATIVE | SUMMATIVE` (default FORMATIVE when `componentId` null). Greenfield — no backfill beyond this default.
2. DB check: `contribution = 'SUMMATIVE'` ⇒ `componentId IS NOT NULL`.
3. Kernel (`result-computation.ts:242`): include only SUMMATIVE with exact `componentId` match. Delete kind-based matching.
4. Wizard (`assessment-form.tsx:114`): explicit toggle; summative requires component select.
5. Update gradebook test that expects kind-join.
- **Test:** add/remove/change formative → term total unchanged; one assessment contributes to exactly one component.

### F21 (P2) Deterministic chronology
1. `buildInput` (`result-run.service.ts:636`): `orderBy: [{ dueDate: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }]`.
- **Test:** insert out of date order; `last` aggregation picks latest by date.

**Exit:** F01/F03/F16/F21 specs green; golden result arithmetic suite updated and green.

---

## Phase 2 — Wave 15: Result publication integrity

Core redesign: compute produces drafts; only publish/amend changes released authority.

### F04 Compute never retires released results
1. `compute` (`result-run.service.ts:118`): create new ResultSet with status `computed` alongside live one. Never archive `published`/`locked`.
2. If a released set exists for scope → new set requires linked approved `ResultAmendment`; otherwise reject with `AmendmentRequired`.
3. Supersede (archive old + promote new) happens only inside publish/amend-publish transaction.
- **Test:** compute-only role cannot change released state; failed amendment leaves old set live; parent never sees gap.

### F05 Freshness-checked publish
1. `buildInput`: only approved `MarkEntry` rows (current version).
2. Persist `inputChecksum` on ResultSet = hash(sorted approved mark ids+versions, policy id+version, roster id, bands hash, exemption set).
3. Publish transaction: lock result set row (`SELECT … FOR UPDATE`), rerun gates inside tx, recompute input checksum, compare → mismatch = `StaleResultSet` ("recompute required").
4. Mark approval/correction for a term with computed set → flag set `stale` (event), UI shows banner.
- **Test:** change mark after compute → publish blocked; concurrent approve + publish → no stale totals released.

### F06 Roster/scope validation
1. Compute validates `roster.termId === termId`, year, class, section, and `roster.scope` compatible with requested result scope.
2. Class-scope results require a complete class roster (members = effective placements at term reference date, Phase 4 F12).
3. UI (`results.tsx:120`): roster selector filtered by term + scope.
- **Test:** wrong term, wrong class, subject-roster-as-class, incomplete audience → rejected before any write.

### F02 Required coverage gate
1. New `ResultCoverageService.expected(scope, term)`: required subjects from curriculum for programme/class; required components from applicable policy; per learner exemptions (D2).
2. Kernel: no renormalisation for missing required components (only for recorded exemptions per D2).
3. Publication gate: per learner × subject × component → `present | absent | exempt | missing`. Any `missing` = blocking conflict listed in readiness checklist.
4. Late admission: expected components limited to those after enrollment date (policy flag).
- **Test:** missing exam, absent subject, empty results, late admission, exemption → documented outcome; incomplete cannot publish.

**Exit:** Audit §17 steps 6 + 8 pass at service/DB level.

---

## Phase 3 — Wave 16: Access & privacy (parallel with Phase 2)

### F07 Fail-closed scope
1. Introduce `type ReadScope = { kind: 'all' } | { kind: 'restricted'; classIds: string[]; sectionIds: string[] }`.
2. `placement-lookup.service.ts:118`, `student.service.ts:98`: restricted + empty → `{ id: { in: [] } }` (no rows). Never `{}`.
3. Grep all helpers returning `{}` on empty arrays: `rg "length \? .* : \{\}" apps/api/src/modules/school`.
- **Test:** unassigned teacher → 0 pupils via list, search, export, direct id.

### F08 Minimal projections
1. `studentListSelect` / `studentDetailSelect(perms)`: exclude `medicalRecord` unless `school:medical:read`.
2. Move NIN from `customFields` to protected column (same handling as application NIN); strip from general responses and logs.
3. Export uses same projection.
- **Test:** school-read w/o medical-read → no medical payload anywhere; logs contain no NIN.

### F09 Ownership on every child-specific read
1. Central `StudentAccessPolicy` (`assertCanReadStudent`, `assertCanReadClass`, `scopeForUser(termId)`), reusing marking ownership logic.
2. Apply to: `assessment.controller.ts:374` result reads, `result-integrity.service.ts:23`, `roster.service.ts:173`, `emergency-contact.controller.ts:12`, report downloads.
3. Result detail with `studentProfileId` → filter term-results array too.
4. Teacher scope: honour section (D4), filter timetable assignments by active year.
5. Bursar: finance-only reads; no result traversal.
- **Test:** role-matrix HTTP spec (harness 0.2): each role × other class/family → 403/empty.

### F10 Attendance membership validation
1. `student-attendance.service.ts:46`: in tx, load placements effective at attendance date for class/section; reject any entry not matched (whole batch rolls back).
2. Existing record with different class → reject (correction flow only), no silent relabel.
- **Test:** out-of-class, pre-admission, post-withdrawal, transferred, foreign tenant → rejected; batch atomic.

**Exit:** role × resource matrix green for Admin, HeadTeacher, Registrar, ExamsOfficer, Class/Subject Teacher, Bursar, Parent, Student.

---

## Phase 4 — Wave 17: Membership & handoffs (parallel with Phase 2)

### F11 Dated course membership
1. Ensure `CourseEnrollment` has `effectiveFrom`/`effectiveTo` + `source` (`auto_compulsory | elective | manual`). Migration if missing.
2. `course-roster-reconcile.ts:95`: on placement change → close auto-compulsory memberships not valid for new class/section (`effectiveTo = moveDate`), open new ones; electives per D8.
3. Withdrawal (enrollment status transition) closes all open memberships.
4. `assessment-workflow.service.ts:41` capture: include only members with compatible placement at capture date; remove offering-class fallback.
5. Replace "self-heal only when empty" with full diff reconcile (add missing, close stale), respecting opt-outs.
- **Test:** North→South, class transfer, withdraw, readmit → new captures exact; old frozen assessments unchanged.

### F12 Historical roster capture
1. `roster.service.ts:43` `capture(termId, asOf)`; default `asOf` = term end for past terms, today for current.
2. Pass `asOf` into `studentWhere`/`attach`; status evaluated at `asOf` (include later-withdrawn pupils).
- **Test:** move + withdraw after Term 1 → rebuild Term 1 = historical members.

### F13 Application→pupil mapping
1. `admissions.service.ts:916`: build profile from stored application (nationality, residence/boarding, `studentCategoryId`, identifiers); DTO values = overrides.
2. Override differing from application requires `confirmOverrides: true` (D6).
3. Response includes `conversionSummary` (fields carried, overridden).
4. Web (`admissions.tsx:184`, `applications.tsx:111`) stop sending biography; show summary.
- **Test:** boarder + category + nationality + guardians + docs + identifier retained; conflicting override without confirm rejected.

### F14 Stage-compatible scales
1. GradingScale: add `system` (or programme/stage relation). Migration sets from name.
2. `resolveBands(system)`: scale for system → built-in for system. Default scale used only if its `system` matches. Never PLE for ECD.
3. Programme resolution filters annual enrollment to requested year.
4. Mixed-programme roster → reject result scope (no school-wide fallback).
- **Test:** combined school: Baby/Middle/Top descriptors, no points/rank; P1–P7 PLE; historical promotion doesn't change past nursery reports.

### F15 Atomic profile save
1. Extend student-domain `PATCH` (`student.service.ts:210`) to all permitted biography/contact fields in one tx.
2. Add `POST /school/students/:id/photo`.
3. `student-360.tsx:182`: single call; drop Partner API usage.
- **Test:** real Registrar saves all fields + photo; forced failure → all-or-nothing; refresh matches message.

**Exit:** Audit §17 steps 2–3 pass at service/DB level.

---

## Phase 5 — Wave 18: Functional gaps + UX

| ID | Work | Test |
|---|---|---|
| F17 | Server pagination + search + total count on pupils list and reference selectors (rosters > 200). Shared `usePagedQuery`. | 350 pupils, roster 250; reach page 2+ in UI. |
| F18 | Extract one `EnrollDialog` component used by Admissions + Applications; terms filtered by applicant year; class change clears section. | Every entry point shows only eligible terms. |
| F19 | Promotion population from enrollment/result scope for selected term; separate "result-based" vs "administrative" rollover labels. | Closed-year cohort; later move doesn't alter historical promotion list. |
| F20 | `error`/`retry` states on all list pages; enrollment preview surfaces failure; enrollment mutation invalidates enrollment, placement, course-roster, students, admissions keys. | Simulated 403/500/offline → error state, never "no students". |
| F22 | Normalise enroll response in `api.ts:1249` → `studentProfileId`; "Open pupil" link. | Link always works. |
| F23 | Roster selector filters by section (`assessment-form.tsx:62`). | North offering never offers South snapshot. |

**Exit:** all F-specs green; audit re-run shows 0 P0/P1/P2 open.

---

## Phase 6 — Wave 19: Browser acceptance

1. Repair existing Playwright journey (application creation is a form not dialog; add explicit assessment publish before marking; require second account for maker/checker).
2. Encode audit §17 steps 1–10 as one Green Valley spec using real role accounts.
3. Mobile viewport + keyboard/a11y pass on admissions, markbook, results readiness, report card.
4. Ordinary-staff dry run: Registrar, Teacher, Head Teacher complete journey without dev help; log friction.

**Exit:** full journey green twice consecutively on clean DB; no manual DB fixes.

---

## Phase 7 — Wave 20: Production proof

1. Run full suite as non-superuser `app` role → prove RLS tenant isolation; two-school cross-read matrix.
2. Clean migration deploy from empty DB + from last snapshot.
3. Backup → restore drill; verify result checksums + report provenance after restore.
4. Finance chain (invoice→payment→receipt→balance→ledger), including category/boarding fees from F13 — separate sign-off.
5. Load test: 1,000 pupils, term compute + publish, concurrent mark entry.

**Exit:** supervised pilot decision (owner sign-off).

---

## Phase 8 — Wave 21+: Enhancements (P4)

- Role-specific "next task" landing page.
- Saved school/term context.
- Bulk completion guidance in markbook.
- Clear split: "assessment released to learners" vs "term results released".
- Optional modules (library, transport, boarding) — audit before enabling.

---

## Sequencing

```text
Phase 0 ─► Phase 1 ─┬─► Phase 2 ─┐
                    ├─► Phase 3 ─┼─► Phase 5 ─► Phase 6 ─► Phase 7 ─► pilot
                    └─► Phase 4 ─┘
```

## Risks

- F04/F05 change result state machine → update wave10 publish-contract spec deliberately, not by loosening.
- F03/F14 migrations alter schema semantics → greenfield, no backfill; reseed fixtures.
- F09 central policy touches many controllers → land policy + tests first, then apply per controller in small commits.
