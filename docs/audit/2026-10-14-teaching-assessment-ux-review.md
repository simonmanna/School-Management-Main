# Teaching & Assessment — UX / IA / functional review (2026-10-14)

Scope: the "Teaching & Assessment" sidebar section (`apps/web/src/components/layout/app-shell.tsx`, 19 items) and every page it reaches, plus the API routes those pages call. Three passes: teacher daily pages; setup + examinations; results + role visibility. Read against the working tree on `wave19-accounting-readiness` (including the uncommitted gradebook/teaching edits).

## Verdict

The section is **hard to navigate and hard to understand**, and several core flows are **broken or unreachable for the default roles**.

- One 19-item section serves four audiences at once: a teacher marking work, the academic lead setting up weighting/grading, the exams office running papers, and the head publishing results. It also holds a school-wide report catalogue.
- Nav labels rarely match the page heading a user lands on, and three pages have near-identical names.
- Ten defects block or silently corrupt real work (P0 list below).

## How easy is it to navigate?

| Problem | Evidence |
|---|---|
| Four audiences in one menu | Teacher (My Teaching/Assessments/Gradebook), setup (Assessment Structure/Grading Scales/Cohorts & Rubrics), exams office (4 items), results (7 items) |
| Nav label ≠ page heading | Assessments → "Assessment Board"; Assessment Structure → "Assessment policies"; Exam Scheduling → "Exams & Marks"; Compute & Publish Results → "End of term results"; Report Documents → "Report cards"; Exam Results → "Results"; Report Centre → "Reports"; Cohorts & Rubrics → "Class lists, rubrics & assignments" |
| Look-alike names | `/school/exam-ops` "Exam Operations" vs `/school/exam-operations` "Examination operations" vs `/school/assessment-ops`. Candidates and question papers are split across both exam pages |
| One concept, four names | cohort / roster / class list / frozen snapshot |
| Wrong progress bar | The 7-step **exam** stepper appears on Approvals (which covers all assessment kinds) and on Exam Results (highlights "Enter marks") |
| No setup guidance | Prerequisites (term → course offering → policy totalling 100% → grading scale → frozen class list → exam types) are only reported on the Results readiness check, at the very end |
| Broad visibility | Six items need only `school:read`, so librarians, nurses and wardens see Gradebook, Certification, Exam Results |
| Unreachable page | Course workspace `/school/teaching/:offeringId` has no link in (see P0-1) |
| Same route twice | `/school/course-offerings` is both "Teaching Allocation" and "Curriculum & Courses" |

## How easy is it to understand?

- **Jargon shown to users:** offering, roster, freeze, frozen snapshot, canonical learner record, component, policy revision, fork, output checksum, coverage, moderation, custody, "P2-B / CBC strands".
- **Raw values shown:** `activity_of_integration`, `mcq_single`, `published`, `grading`, `requested`, `applied`, `school:reports:read`.
- **Raw JSON as a UI:** CBT answer options, UNEB subject grades, competency transcript, certificate verification.
- **Two meanings of "Draft":** board stage "Draft" = assessment not published; mark status `draft` = saved but not submitted.
- **Silent states:** a teacher with no allocations sees five zeros and green ticks (reads as "all done"); a failed API call shows "Pick a teacher" or "Nothing here yet"; "Publish assessment" is greyed out with no reason when the class list isn't frozen.

## Is the functionality properly built?

### P0 — broken or blocked

| # | Defect | Where |
|---|---|---|
| 1 | Course workspace unreachable: "My courses" panel removed from My Teaching; workspace's own list is dead code; "All my courses" loops back | `pages/school/teaching.tsx`, `teaching/workspace.tsx:51-90` |
| 2 | Teachers cannot save exam marks: `POST /school/marks/entry` needs `enterGrades`, teacher presets hold `ownGrades`. "Lock paper" shown to everyone | `marks-workspace.controller.ts:68`, `enter-marks.tsx:326` |
| 3 | Head Teacher / Deputy cannot open Compute & Publish (`results:compute` gate), yet they are the only presets holding amendment approval, promotion decision and document release | `app-shell.tsx:320`, route guard `:677-693` |
| 4 | Removing a class-list member always 404s: web sends POST, API is DELETE | `features/school/api.ts:4805` vs `assessment.controller.ts:290` |
| 5 | Grading Scales: nav gate `manageAssessments`, every write needs `manageExams` → Deputy Head 403 on save | `examinations.controller.ts:221-234` |
| 6 | Exam marks may silently not count: UI can't set `AssessmentComponent.examTypeId`; mint lookup unfiltered; results only fall back when the policy has exactly one exam component (Mid-term 30% + End-of-term 70% drops exam marks) | `assessment.tsx`, `assessment-mint.service.ts:53`, `result-computation.ts:287` |
| 7 | Certificate revoke reason always recorded as `'error'` (state has no setter); revoke/void have no confirmation | `certification.tsx:103,118` |
| 8 | Gradebook blank for class-scoped teachers: defaults to school's first class, `@ScopedToClass` refuses, no error branch | `gradebook.tsx:40`, `gradebook.controller.ts:23` |
| 9 | Report Centre "Related screens" — three broken links fall through to `/` | `reports/index.tsx:48-50` |
| 10 | CBT unusable for teachers: nav `authorCbt` (no teacher preset), banks need `manageQuestionBank`, "Take / proctor" needs `takeCbt` (students only) | `cbt.controller.ts`, `app-shell.tsx:297` |

### P1/P2 — design and consistency

- **Two report-card systems.** Results › Report cards (ReportDocument, tied to a ResultSet version) and `/school/report-cards` (legacy ReportCard, served to the portal). Releasing from the legacy page doesn't update the document record, so the document panel can say "not released" while parents can see the card. A card built from live marks is a non-releasable preview, but the UI just says "Draft".
- **Exam Results** computes live positions from unapproved marks with its own ranking; pass mark hardcoded at 50%. Positions can disagree with released results.
- **Two weightings:** exams display "counts X%" from `ExamType.weight`; term results use component weights.
- **Two promotion entries:** Results › Promotion vs `/school/promotion`.
- **Dead buttons** for `school:read` users: Lock marks (Exam Results), every Certification action.
- **Irreversible actions without confirmation:** Mark final, Freeze class list, delete grading scale, revoke/void certificate. Return reason uses `window.prompt`.
- **Lifecycle gaps:** board has no "Released" stage; `grade`/`archive` transitions have no UI.
- **Grading bands:** validation rejects contiguous bands that the help text recommends; new bands default to 0–100.
- **Pickers:** exam pickers on both exam-ops pages list every exam ever; class picker on Assessments lists every class.
- **"Returned to me"** repeats once per student; approval tile counts all classes but links to a class-filtered board.
- **Data model debt (later):** `GradeEntry` legacy dual-write, `Exam.status` vs `lifecycleState`, `ExamSchedule` unique on exam+class+subject blocks Paper 1/Paper 2.

## Role visibility (default presets, before changes)

| Role | Items seen | Notes |
|---|---|---|
| Class / Subject Teacher | 7 | No CBT; exam marks link 403s |
| Deputy Head | 11 | Sees Grading Scales but can't save; no Compute & Publish |
| Exams Officer | 18 | Everything but Approvals; can't approve amendments by design |
| Head Teacher | 9 | No Compute & Publish or Report Documents despite holding publish permissions |
| Librarian / Nurse / Warden / Transport | 6 | Only `school:read` items |

## Recommended information architecture

```
Teaching                     Exams                        Results & Reports
  My Teaching                  Exams & Papers               Term Results
  Assessments                  Exam Day                     Report Cards
  Gradebook                    Exam Mark Sheets             Report Card Design
  Approvals                    National Submissions         Competency & Annual
  Quizzes                                                   Certification

Academic Management › Assessment setup:  Assessment Weighting · Grading Scales · Class Lists & Rubrics
Report Centre → its own place (school-wide, not results)
```

Rules: every nav label equals the page heading; pages used by several roles use any-of permissions and gate each action inside; every moved route keeps a redirect.

## Plan

| Wave | Content |
|---|---|
| 0 | Fix P0-1 … P0-10 |
| 1 | Split nav into Teaching / Exams / Results & Reports; move setup; merge the two exam-ops pages; match headings; setup checklist; cross-links; correct steppers |
| 2 | Plain-language pass, enum labels, replace JSON editors, confirmations, disabled-button reasons, "Released" stage, term filters, grading band validation, provisional banner on Exam Mark Sheets |
| 3 | Sync legacy report cards ↔ report documents; drop `ExamType.weight` display; single promotion entry |
