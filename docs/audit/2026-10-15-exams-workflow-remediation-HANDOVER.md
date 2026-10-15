# Exams workflow remediation — handover (2026-10-15)

Base: `main` @ `4e301fb`. **All changes are uncommitted in the working tree.** Nothing pushed.
Context: the exams workflow map (from code reading) found gaps G1–G10. The owner chose "Full Phases 1–7".
The plan with diagrams is in `C:\Users\Simon\.claude\plans\give-me-the-current-peppy-thimble.md`.

## 1. Status at a glance

| Phase | Scope | Status |
|---|---|---|
| 1 | G1: workspace marks → submit → approve → term results | **Done + tested** |
| 2 | G3: mark version 409 loop | **Done + tested** |
| 3 | G6: SMS/slips must not expose unapproved marks | **Done + tested** |
| 4 | G2 + G7 (part): workspace exam runs the lifecycle; close locks the real lock; legacy publish/close retired | **Done + tested** |
| 5 | G4 + G5: one grading rule per class; merit list honours `rankOn` | **Done + tested (unit)** |
| 6 | G8: report-document reissue + stale-revision guard | **Done + tested** |
| 7 | End-to-end tests | API integration done; **browser journey NOT done** |

Verification run (2026-10-15):
- `tsc --noEmit`: api clean, web clean (use `NODE_OPTIONS=--max-old-space-size=8192`).
- Unit tests: 2653 pass. 3 fail in `wave9-scenarios` (LMS P0-1); these failed before this work too.
- Integration (27 exam/assessment/result/portal suites): 261 pass. 1 fails, `wave10-handoffs` H2 (hard-coded date); this failed before this work too.
- ESLint on changed files: 0 errors (warnings only, the existing `any` style).
- Integration DB: local `schooldb_wave19_test`. Already migrated with `prisma migrate deploy`. No new migrations were added.

## 2. What changed (by file)

### API
- `assessment/marking.service.ts`
  - `markingApproval(dto, opts?)` has a new option, `opts.entryAuthorised`. It skips `assertMayMarkAssessment` for submit/resubmit when the caller has already authorised the user by teaching allocation. Exam papers have no `teacherPartnerId`.
  - Submit and resubmit now both move `draft|rejected → submitted`, so a corrected paper is sent whole.
- `examinations/marks-workspace.service.ts`
  - **New `submitPaper({examId,classId,subjectId})`.** It runs these steps in order:
    1. Calls `assertMayEnterExamPaper` and `assertExamOpen`.
    2. Mints the assessment if it is missing.
    3. On first submit, captures, freezes and binds a **paper-scoped roster** (`scopeType: 'subject'`, classId+subjectId) through `AcademicRosterService`. It deliberately does NOT use the class term list, which stays the Term Board's.
    4. Requires every roster member to have a mark or a resolved participation. Otherwise it returns 400 `PAPER_INCOMPLETE` with `missing[]`.
    5. Calls `markingApproval(..., {entryAuthorised:true})`.
    - If two submits race, the first binder wins and the loser's roster is soft-deleted.
  - `sheet()`:
    - `version` now comes from `StudentAssessment.version`. It used to come from legacy `GradeEntry.version` (that was G3).
    - Adds `rejectionReason`.
    - The grade now comes from the class profile.
  - `saveMark()`: calls `assertExamOpen` (closed/archived exam → 409). The returned grade now uses the class profile, not the school-wide system (G4).
  - `grid()`:
    - Per-paper `approvalStatus`, plus `approvedPaperCount` and `approved`.
    - `reporting.rankOn` is exposed. Positions are null when `rankOn === 'none'`, and `meanPercent` ranking is honoured (G5).
  - `exams()`: adds `submittedPaperCount`, `approvedPaperCount` and `lifecycleState`.
  - New helpers: `approvalPerPaper`, `gradeOfForClass`, `assertExamOpen`, `bindPaperRoster`, `namesOf`.
- `examinations/marks-workspace.controller.ts`: new `POST /school/marks/submit`. It is guarded by `school:read`; ownership is checked in the service.
- `examinations/exam-results-messaging.service.ts`: results SMS now requires **every paper approved**, not just locked. The preview returns `approved` and `approvedPaperCount`.
- `examinations/exam-operations.service.ts`
  - Moving forward to `in_progress` calls `bindPapersToCandidates`. That gives each paper an assessment and a frozen roster built from the frozen candidate snapshot (that class's entries). The roster is created, members are inserted, then it is frozen; a DB trigger forbids adding members to a frozen roster.
  - Closing now also sets `Assessment.lockedAt`, which is the lock `postMark` actually checks.
  - `AssessmentMintService` is now injected here.
- `examinations/examinations.controller.ts`: `POST /school/exams/:id/publish|close` now return **410 Gone** and point to the lifecycle endpoint. They had no UI caller, and they made `status` and `lifecycleState` drift apart. The `ExamService.publish/close` methods still exist but are unreachable over HTTP.
- `examinations/report-document.service.ts`
  - `issueOne`: on reissue it temporarily unpublishes the released card, regenerates it, and restores it if generation fails (G8).
  - `publish`: refuses documents whose result set is no longer released or whose revision doesn't match. Returns 400 `RESULTS_NO_LONGER_RELEASED`.

### Web
- `features/school/api.ts`:
  - `useSubmitPaper()`.
  - Type additions: `MarkSheetStudent.rejectionReason`, `ResultGrid.approved`/`approvedPaperCount`/subject `approvalStatus`, `WorkspaceExam.submittedPaperCount`/`approvedPaperCount`/`lifecycleState`, `ResultsSmsPreview.approved`/`approvedPaperCount`.
- `pages/school/enter-marks.tsx`:
  - New **Submit / Resubmit for approval** button.
  - Badges: Waiting for approval / Approved / Returned. A returned paper shows a banner with the reason.
  - Inputs are read-only when a row is submitted or approved.
  - The `versions` state is reset whenever the sheet reloads (the client half of G3).
  - A 409 is handled differently for `MARK_VERSION_CONFLICT` (a rival edit) than for a state change.
- `pages/school/exam-workspace.tsx`:
  - New `ExamStatus` cell: Closed / Approved / With approver / "Marks in — submit" / In progress / Not started.
  - The exam's lifecycle label is shown under its name.
- `pages/school/exam-results.tsx`: shows "N of M papers approved"; a ✓ on approved paper columns.
- `pages/school/_components/exam-results-extras.tsx`: the SMS dialog is gated on approval; pupil slips print "PROVISIONAL" until every paper is approved.

### Tests
- `test/unit/marks-workspace.spec.ts`:
  - The constructor now takes the `rosters` stub.
  - New tests for `submitPaper` (5), sheet version (G3), and no positions for lower primary (G5).
- `test/integration/school-exam-workspace.spec.ts`:
  - G3 reload/edit/conflict.
  - Submit binds a paper roster.
  - A submitted paper is read-only.
  - Separation of duties on approve.
  - Return → correct → resubmit → approve.
  - SMS refused while papers are unapproved and allowed once approved.
  - Fixed a stale assertion: an unranked pupil's position is `null`, not `0`, since 4e301fb.
- **New** `test/integration/school-exam-paths.spec.ts` covers:
  - A workspace exam goes through draft → … → candidates_locked → in_progress, which binds the candidate roster, then marking.
  - Unapproved marks are absent from compute; approved marks appear (80/45).
  - Close locks the assessment and the workspace refuses marks.
  - A published report document can be reissued.

### Unrelated working-tree change (not mine)
- `.claude/launch.json` adds a `web-dev-2` config on :5187. It was already modified before this session; it is the user's change.

## 3. How to run

```bash
cd apps/api
export DATABASE_URL=$(grep -h "^DATABASE_URL" .env | sed 's/^DATABASE_URL=//; s/"//g; s#/schooldb-planet#/schooldb_wave19_test#')
NODE_OPTIONS=--max-old-space-size=12288 npx jest --selectProjects integration --runInBand --testPathPattern "school-exam|school-assessment|school-result|school-grade"
NODE_OPTIONS=--max-old-space-size=8192 npx jest --selectProjects unit --testPathPattern marks-workspace
NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit -p tsconfig.json
```
Gotchas:
- On Windows, bash heredocs mangle non-ASCII text, and many files are CRLF. Edit with the Edit tool, or with python scripts written via the Write tool that preserve newline style (see `patchlib` pattern: read with `newline=''` and convert LF to CRLF when the file uses CRLF).
- The `--testPathPattern` flag is required. A bare positional path ran the whole unit suite.

## 4. Remaining work (next agent)

### Must do before calling it done
1. **Browser journey (Phase 7).** API :3003 is the user's built `dist`. Rebuild it (`pnpm --filter @erp/api build`) and restart it only with the user's OK. Web via `preview_start web-dev` (:5186) or `web-dev-2` (:5187). On Sunrise:
   - teacher enters marks → Submit
   - `/school/approvals` as DOS → approve, and separately reject → teacher sees the reason → resubmit
   - workspace status column changes
   - merit list shows "N of M approved"
   - SMS dialog is blocked until all papers are approved
   - Term Board compute includes the marks
   - release → parent portal shows the card
   
   Login: use the Sunrise seed accounts (see the memory `wave13-student-flow` / `e2e-workflow-audit`); the agent may enter local test creds only.
2. **Commit** in logical commits once the user asks:
   - (a) submit + version fix
   - (b) SMS/slips approval gate
   - (c) lifecycle binding + legacy retire + close lock
   - (d) grading/rankOn
   - (e) report-document reissue
   
   Don't include `.claude/launch.json` unless the user wants it.

### Still open gaps (need owner decisions or are follow-ups)
- **G9 Paper 1 / Paper 2:** `ExamSchedule @@unique([examId,classId,subjectId])` blocks multi-paper subjects. This is a schema change, and `sourceRef` mapping plus result aggregation per component need review. **Owner decision.**
- **G7 ResultSet states:**
  - `draft`, `computing` and `approved` are never used.
  - There is no "review/approve results" step; `results:approve` only gates amendments.
  - Decide: add a DOS-review → head-approve step before publish, or drop the states. ADR-024 assumed review/approve. **Owner decision.**
- **ExamType.weight** is dead (it is set to 0 by the dialog). Hide it or remove it from the UI. Weighting lives on `AssessmentComponent.examTypeId`.
- **UACE**: no division logic (points only). Confirm with the owner whether one is needed.
- **G10**:
  - `/school/enter-marks` has no front-end route gate; only the API protects it. Add a nav/route permission covering `grades:own|grades:write|exams:write`.
  - Nobody subscribes to `SchoolResultsPublished` / `SchoolReportDocumentPublished`, so families are not notified automatically. Wire it to the notifications service, respecting `receivesResults` and dedupe keys.
- `SchoolMarksApproved` is emitted outside its transaction (`marking.service.ts` approve branch). Switch to `publishInTx`.
- Workspace "Choose classes" (`apply-classes`) does not create `ExamRegistration` rows. Path B users still register candidates in Run an Examination. Consider an "register all applied classes" shortcut.
- `ExamService.publish/close` service methods are now dead code. Delete them in a cleanup.
- `MarksWorkspaceService` still injects `GradingService`, which is now unused. Remove it if lint/tsc ever complains.
- Approvals page (`/school/approvals`): verify in the browser that workspace papers appear with readable title/subject/class. Their `teacherPartnerId` is null, so the "submitted by" column will be empty. Consider showing `submittedById`'s user name.

## 5. Design decisions taken (and why)
- **Paper-scoped roster at submit time, not the class term list.** Freezing the class term list on the first mid-term paper would exclude pupils admitted later in the term from all term results. Path B uses the frozen candidate snapshot instead, because that is literally who sat.
- **Approval, not lock, gates anything that leaves the school** (SMS, slips watermark). The office can set a lock on unapproved marks.
- **Legacy exam publish/close → 410.** Same precedent as the legacy gradebook writes. It removes the second way to change exam state.
- **Reissue unpublishes the card only for the regeneration** and restores it on failure. A reissue with a reason is the deliberate act the card's guard asks for.
