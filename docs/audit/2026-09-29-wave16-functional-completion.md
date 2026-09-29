# Wave 16 — Functional completion (response to the 2026-09-29 "functional audit")

Branch `wave16-functional-completion`, on top of Wave 15 (`ad07f2b`).

## 1. The audit, checked against the code

About 40 % of the audit's findings were already satisfied. Each was verified in code before any work was planned.

| Audit item | Verdict | Evidence |
|---|---|---|
| P0-1 RLS unverified per table | **Already done** | Catalog DO-loop `20260923100000_rls_enable_all_org_tables`; CI gate `scripts/assert-db-constraints.mjs` (622 tables); `rls-app-role.spec.ts` |
| P0-2 Invoice double-billing on version bump | **Already guarded** | `Document_org_partner_source_reference_key` (partner × schedule × TERM) is version-blind. Regression test added; index added to the preflight |
| P0-3 Attendance partial indexes "dropped by migrate diff" | **False** | Prisma ignores partial indexes, so there is no drift. They are now preflight-guarded, and a race spec was added |
| P0-4 Report-card PDF never tested | **Partly false** | `report-card-pdf-render.spec.ts` already rendered PDFs. Gap closed: DB path plus text content |
| P1-3 Rank/GPA not tested | **False** | `class-rank.spec.ts`, golden specs. The duplicate unused implementation was removed |
| P1-6 Section required when subdivided | **False** | `enrollment/subdivision.ts` |
| Hostel "stub only" | **False** (API existed) | UI was missing. A real bug was found: see §3 |
| Library fines absent | **False** | `Borrowing.fineAmount` plus a fine invoice |
| Bulk announcement composer missing | **False** | `communication/broadcasts`, `messaging.tsx` |
| Portal token → admin routes | **Covered** | `portal-role-surface.spec.ts`: family roles hold only self-scoped grants |

## 2. What was built

| Track | Item | Commit |
|---|---|---|
| A | CI schema-drift gate; preflight guards raw-SQL indexes; drifted `AssessmentPolicy(programmeId)` index declared | 866a9da |
| A | Penalty `cronDate` uses the school's local day, not UTC | 866a9da |
| A | Attendance alerts: early-departure bug fixed; alert on the Nth consecutive absence; weekly below-threshold sweep per class threshold | 866a9da |
| A | Real-DB specs: MoMo callback → Payment → allocation; daily-register race; report card PDF from a published result set | 866a9da |
| B | Leaving/transfer certificate (snapshotted, refused if the pupil is still enrolled, one live per pupil, PDF + verify link) | bf69616 |
| B | Monthly class register (P/L/E/A grid); promotion list grouped by class | bf69616 |
| B | Fee receipts: A5 + 80 mm thermal; reprints stamped as copies; parent family-copy download | bf69616 |
| B | UNEB/statutory export as xlsx (text cells, same checksum) | bf69616 |
| C | Public online application + magic link + document upload; always-on `/apply` | 162e7f5, 8279c2c |
| C | Parent pick-up requests (pending until the office approves; requester cannot approve; gate refuses pending) | 162e7f5 |
| C | Parent transport view; mobile statement cards | 162e7f5, bf69616 |
| D | Scheduled reports (runs as the creator, one per slot, emailed as an attachment) | cdce130 |
| D | Library fine per day configurable | cdce130 |
| D | Custom fields validated at the API and rendered on admit / pupil record / application | 40e52ba |
| D | Hostel UI; rubric scoring in the teacher portal; teacher home (registers, marks due) | 40e52ba |

## 3. Defects found that the audit missed

1. **Hostel beds were single-use forever.** `HostelAllocation.bedId @unique` refused any second allocation after checkout. Replaced with partial unique indexes: one active allocation per bed and one per pupil.
2. **The portal register was broken.** The teacher dashboard's `classes` are teaching assignments. The register used the assignment id as a class id, which returned 403 and an empty roster. This was seen in the browser.
3. **The online application was unreachable.** It sat behind `VITE_SITE_CONTENT_READY`. `/apply` now always works.
4. **The web certificate page never showed serials or codes.** The client read `serial`/`code`; the API sends `serialNumber`/`verificationCode`.
5. **The early-departure alert tested `isAbsent`.** Real early departures never alerted.

## 4. Verification

- Unit: 141 suites, 2 461 tests pass. Typecheck is clean for api, web and portal. Lint shows 0 errors.
- New or extended integration specs: `mobile-money-callback`, `wave16-attendance-unique`, `wave16-documents`, `wave16-public-admissions`, `wave16-parent-portal`, `wave16-hostel`, plus additions to `school-fees-concurrency`, `school-result-integrity`, `school-reporting`, `school-exam-phase5` and `school-statutory-phase6`.
- Local DB: `prisma migrate diff --exit-code` reports no difference; `assert-db-constraints.mjs` passes.
- Browser (local previews): `/apply` renders and its options endpoint returns 200. The teacher portal home, My classes and Register load the real class and roster.
- Admin web pages (hostel, certificates, receipts, schedules) were **not** clicked through. The seeded demo admin was locked out locally. They are covered by typecheck and integration specs only.

## 5. Deliberately not done / open

- An invoice void-and-rebill path after a fee-structure change. The Document key refuses the re-bill, which is safe but manual.
- Custom fields are not required on the quick "register & place" path, and are not rendered on guardian forms.
- Parent–teacher conferences were skipped by owner decision.
- The emailed application link still opens the web app's `/apply/track`. It works, and now supports upload; the portal `/apply?token=` also works.
