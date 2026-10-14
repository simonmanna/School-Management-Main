# Academics workflow review: Ugandan nursery and primary schools (2026-10-14)

**Question:** Is the Academics workflow production ready, easy to use, easy to understand, and a sensible process for Ugandan nursery and primary schools? If not, what is the plan to make it great?

**Scope:** "Academics" here means the whole academic cycle:

- set up the year
- allocate teachers
- plan lessons
- run continuous assessment and BOT/MOT/EOT exams
- approve marks
- produce term results and report cards
- promote pupils

It also covers the nursery (ECD) path. The sidebar sections involved are Academic Management, Teaching, Exams, Results & Reports, Academics, Nursery Day and Promote & Roll Over.

**Evidence:**

- **Code:** I read the working tree on `wave19-accounting-readiness`. It includes uncommitted Teaching/Exams changes from today's [teaching & assessment UX review](2026-10-14-teaching-assessment-ux-review.md). Another session was still editing `app-shell.tsx` while I worked, so line numbers there may shift.
- **Live app:** I ran the Sunrise demo, a nursery-plus-primary school with about 710 pupils. The web app ran from the working tree on `localhost:5186`; the API ran from `dist`, built at 12:27 today. I used it in a separate headless browser as:
  - the Director of Studies (`dos@`)
  - a P.5 class teacher (`teacher@`)
- **API checks:** I made API calls as DOS, Head Teacher, Deputy Head and Teacher to compare permissions and results data.
- **Printed report cards:** I downloaded the real class PDFs for P.5 Green and Top Class Red, Term 2 2026, and extracted their text.

**Not done:**

- full test suite
- a brand-new school built from empty in the browser
- tablet or phone check
- sessions with real Ugandan teachers

Today's teaching and assessment review is not repeated here. Its P0-1 to P0-10 are being fixed in the working tree, and I did not re-verify each one.

---

## 1. Verdict

**Not production ready for Ugandan nursery and primary schools yet. The engine is close; the day-to-day workflow and the printed outputs are not.**

- **The engine is strong:**
  - results are versioned and reproducible
  - mark approval separates who enters from who approves
  - amendments are kept on record
  - the PLE aggregate and ECD descriptors exist
  - nursery classes are not ranked
  - the nursery day screen (care log, collection, incidents, immunisation) is excellent
- **What a parent receives is not yet trustworthy:**
  - a nursery report card prints as a P7 PLE card
  - a primary card shows two different divisions
  - comments and the next-term date can't be filled in from the system
- **The workflow suits a secondary-school exams office and a configuration expert.** It does not suit a Director of Studies, class teachers and a nursery teacher:
  - there is no DOS role
  - teachers see about 55 menu links, including Purchasing and Fixed Assets
  - teacher allocation is a course-offering lifecycle tool
  - end-of-term work is repeated class by class

### Scorecard (1 = poor, 5 = ready)

| Area | Works correctly | Easy to use | Fits Uganda nursery/primary |
|---|---|---|---|
| Academic setup (year, terms, classes, subjects) | 3 | 2 | 3 |
| Teacher allocation | 3 | 1 | 2 |
| Curriculum, schemes of work, lesson plans | 3 | 2 | 2 |
| Continuous assessment and mark entry | 3 | 3 | 3 |
| Exams (BOT / MOT / EOT) | 4 | 3 | 3 |
| Term results (compute, approve, release) | 4 | 2 | 3 |
| Report cards (what parents receive) | **2** | 3 | **2** |
| Nursery (ECD) assessment and reporting | **2** | 2 | 3 |
| Promotion and year-end | 3 | 2 | 3 |
| Roles and navigation | 2 | **1** | **1** |

---

## 2. What is already strong (keep it)

| Strength | Where |
|---|---|
| A new school gets the Uganda ladder Baby → Middle → Top → P1–P7, with ages, "promotes to" links, an ECD descriptor scale and PLE bands | `apps/api/src/modules/core/school-defaults.seed.ts` |
| Reporting is stage-aware. Nursery defaults to descriptors with no ranking, and a class list mixing nursery and primary pupils is refused | `result-run.service.ts:783-807` |
| Results are versioned with checksums, a readiness gate, an amendment chain and "mark final" | `results.tsx`, `result-run.service.ts` |
| Marks entry: keyboard entry, column paste, autosave, an offline banner, and absent/exempt kept separate from zero | `enter-marks.tsx`, `production-markbook.tsx` |
| Exam mark sheets are clearly labelled **Provisional** | `exam-results.tsx:144` |
| The report card designer is very configurable: blocks, columns, conduct grid, stamp, verification code | `report-card-settings.schema.ts` |
| Nursery Day covers care log, collection authorisation, incidents and immunisation | `early-years.tsx` |
| Schemes of work and lesson plans have an approval workflow and PDF export | `teaching-api.ts`, `lms/lesson-plans.tsx` |
| Exam operations (custody, invigilators, seating) and PLE registration/exports | `exam-operations.tsx`, `statutory.tsx` |

None of this needs rebuilding. The work is correctness of outputs, role-shaped screens and Uganda defaults.

---

## 3. Reference model: how a Ugandan nursery and primary school runs the academic year

This is typical practice. Confirm the details with the pilot schools.

| When | What happens | Who |
|---|---|---|
| Before Term I (Jan) | Calendar year = academic year. Three terms. Classes and streams. Class teacher per stream. Subject teachers for P4–P7. Timetable. | Head Teacher, **Director of Studies (DOS)** |
| Every term, week 1 | Schemes of work submitted, then lesson plans weekly. Beginning-of-term test (**BOT**). | Teachers → DOS / Deputy checks |
| Mid-term | Mid-term test (**MOT**). Many schools send a mid-term report or an SMS of results. | DOS compiles |
| End of term | End-of-term exam (**EOT**). DOS compiles mark sheets / merit lists per class. | DOS |
| Report day | Report card: marks per subject, often per exam (BOT/MOT/EOT columns), grade per subject (D1–F9), **aggregate and division** (P4–P7, often P1–P3 too on 4 subjects), **position "x out of y"**, class teacher comment, head teacher comment, next term start date, fees balance or next-term fees, signatures and stamp. | Class teacher, Head Teacher |
| End of Term III | Promotion decision on the year's performance plus judgement. Repeaters. P7 leavers sit PLE (UNEB). | Head Teacher, DOS |
| Nursery | NCDC Learning Framework learning areas. Developmental descriptors and narrative. **No marks, no positions, no divisions.** Daily care and collection matter more than exams. | Nursery teacher (+ attendant) |

Subjects by stage (school-specific, verify against current NCDC guidance):

- **Nursery:** NCDC ECD learning areas.
- **P1–P3 (thematic):** Literacy I, Literacy II, English, Mathematics/Numeracy, RE, and others. Many schools examine four of these.
- **P4:** transition year.
- **P5–P7:** English, Mathematics, Science, Social Studies (the four PLE subjects), plus RE and others.

The single most important academic user is the **DOS**. The most frequent users are **class teachers**. The most important output is the **report card**.

---

## 4. The current workflow as built

| Phase | Screens a school must use today | Friction |
|---|---|---|
| Setup | Academic Years · Terms · Grade Ladder & Levels · Classes · Streams · Subjects · Departments · School Settings · *Programmes & Classes (under Admissions & Enrollment)* · Staff · Class Teachers · *Curriculum & Courses / Teaching Allocation* · Exam types (inside Exams & Papers) · Assessment Weighting · Grading Scales · Report Card Design | About 16 screens across 4 sidebar sections. No terms, subjects, exam types or weighting are created for the school. The grading system can't be set anywhere in the UI (A1). |
| Each term | Generate or roll over course offerings → capture and **freeze class list per class** → create exams → choose classes → teachers enter marks → lock → approve → **work out results per class** → release per class → build report cards per class → release → print | Repeated class by class: Sunrise has 10 classes and 20+ streams, three times a year. Pickers can't tell which year a term belongs to (A8). |
| Year end | Term Results › Promotion *or* Students › Promote & Roll Over | Two unlinked paths. No annual result (A16). |
| Nursery | Nursery Day (care) + the generic assessments and markbook in percentages | No observation grid; the report prints as PLE (A3, A15). |

---

## 5. Findings

Severity:

- **P0:** parents or teachers get wrong information, or a core step is impossible.
- **P1:** a launch blocker for usability or Uganda fit.
- **P2/P3:** important or polish.

### P0: wrong outputs or impossible steps

**A1. A new primary school is graded on the secondary (UCE) system, and nothing in the UI can change it.**

- The schema default is `gradingSystem @default("UCE")` (`apps/api/prisma/schema.prisma:10851`).
- `getOrCreateProfile` creates `gradingSystem: 'UCE'` (`apps/api/src/modules/school/school.service.ts:43`).
- The seeded Lower and Upper Primary programmes have empty `config` (`school-defaults.seed.ts`), so `resolveReporting` falls back to the school system (`result-run.service.ts:786-792`).
- No web page writes `gradingSystem`. School Settings and Programmes have no such field; the DTO accepts it but nothing sends it.
- The demo hides this because the seed sets PLE directly (`prisma/seed-green-valley.ts:95`, `demo-green-valley/01-reference.ts:167,175`).
- **Effect:** best-8 UCE aggregates and divisions for P1–P7.

**A2. Class teacher and head teacher comments cannot be entered.**

- `useUpdateReportCardComment` exists (`apps/web/src/features/school/api.ts:5254`) but no page uses it.
- `POST /school/report-cards/comment` requires `school:exams:write` (`examinations.controller.ts:322-323`). Neither the Class Teacher nor the Head Teacher preset holds it.
- Every Ugandan report card carries both comments. Today they appear only in demo seed data.

**A3. The printed nursery report card is a PLE card.**

The Top Class Red, Term 2 2026 class PDF prints:

- a points column
- "Credit/Distinction" remarks
- **"DIVISION U"**
- **"NOT ELIGIBLE — Ungraded: no mark for english, science"**
- the D1–F9 grading key

The result set itself is correctly `ECD`. There are two causes:

- The PDF rebuild path calls `buildLayout(...)` without the reporting system (`report-card-pdf.service.ts:139`).
- The grading key always uses the school-wide system (`:143`).

Every card without a stored layout prints this way. That is every demo card today, so a prospective client sees it.

**A4. One printed card states two different results.**

From the P.5 Green, Term 2 2026 PDF:

- The header says "DIVISION / GRADE: —" while the summary says **"DIVISION II"**.
- Position and class size print "—".
- One row reads "Science 80% **C3** … **Distinction**", although the printed key says 80–89 = D2.

There are two sources of truth:

| Number on the card | Where it comes from |
|---|---|
| Division in the header | The stored result |
| Aggregate | Parsed back from a re-computed layout summary (`report-card-pdf.service.ts:178`) |
| Card's PLE aggregate | Matched on subject **names** by regex (`grading.service.ts:50-55`) |
| Term Results' aggregate | `Subject.isCore` (`result-computation.ts:402-420`) |
| Grade on a row | The stored result |
| Remark on a row | Re-banded from today's scale |

**A5. The "Core subject" tick doubles as the PLE aggregate flag.**

- Subjects admin labels `isCore` as "Core subject", which a school reads as *compulsory*.
- The engine builds the aggregate from the **best four of every `isCore` subject** (`result-computation.ts:403-411`).
- A school that ticks RE or Kiswahili as core gets aggregates and divisions from the wrong subjects.
- PLE uses exactly English, Mathematics, Science and Social Studies.

**A6. Lower primary (P1–P3) under PLE prints "Division U / Ungraded" for every pupil.**

- P1–P3 have no English/Maths/Science/SST "core" set, so `computePLEAggregate` returns ineligible and `divisionPLE` returns `U`.
- The demo avoids it only because `06-results.ts:327` writes result rows directly, with a division only for P7.
- So the demo's published results do not show what the engine would produce.

### P1: launch blockers for usability and Uganda fit

**A7. Teacher allocation is a course-offering lifecycle tool, not an allocation screen.**

- "Curriculum & Courses" shows a "Phase 2 academic context" badge. It has offering types, audience scopes, `DRAFT → STAFFED → ROSTER_READY → PUBLISHED → ACTIVE`, and a "TeacherAssignment migration" panel (`lms/course-offerings.tsx`).
- It is per term, class and subject: roughly 150+ offerings per term at Sunrise's size.
- The DOS (Exams Officer preset) cannot open it.
- The setup checklist's "Assign teachers" step links to `/school/timetable` (`setup-status.service.ts:122`).

**A8. Term pickers don't show the year.**

- Term Results and Report Cards list `Term 3, Term 2, Term 1` three times, in the order 2027, 2025, 2026 (seen live).
- Picking the first "Term 3" picks 2027.
- Results could be computed or printed for the wrong year.

**A9. A teacher's Enter marks screen opens on a class they don't teach, and shows nothing.**

- The P.5 English teacher landed on P.1 / Literacy I (Luganda).
- `GET /school/marks/subjects` and `/sheet` returned **403**, and the page stayed blank with no message.
- The class and subject pickers list the whole school.
- From My Teaching, the "Exam papers to enter" rows go to `/school/enter-marks` without the paper preselected (`teaching.tsx:126`).

**A10. The exam mark sheet (merit list) is not a Ugandan primary merit list.**

- It ranks on total marks (`marks-workspace.service.ts:590`) and prints an overall "Grade" from the average.
- There is no per-subject grade, aggregate or division.
- Example from P.5, Mid Term III: Patrick Kato scored 92/83/90/88 and shows **"D2, position 1"**. A Ugandan sheet would show D1 D2 D1 D2, **aggregate 6, Division I** (default bands), ranked by aggregate.
- **Effect:** schools will keep doing this in Excel.

**A11. The report card leaves known facts blank and loses the exam breakdown.**

- "Next term begins: ______" is a blank line (`report-card-pdf.service.ts:991`).
- The fees balance is a blank line (`:927`); `feesBalance: null` (`:537`).
- The "Assessment scores" column printed "—".
- Component columns are labelled by *kind*, so BOT, MOT and EOT all print as "Exam" (`report-card-template.service.ts:386`).
- PLE headers are fixed at "CA / End of Term" (`:408`).

**A12. There is no Director of Studies role.**

- The demo maps the DOS to **Exams Officer**. That preset cannot:
  - set up classes or subjects
  - allocate teachers
  - approve marks
  - review lesson plans
  - promote pupils
- Yet it sees Orders, Suppliers, Products, Fixed Assets and Cafeteria POS.
- Head Teacher and Deputy each hold part of the DOS job.

**A13. The navigation buries the academic work.**

- The P.5 teacher sees about 55 links, including:
  - Revenue, Purchasing, Inventory and Fixed Assets
  - Cafeteria POS and Meal Finance
  - Admissions Analytics and Campuses
  - 8 Advanced LMS items (the flag is on in this build)
- Causes:
  - Items with no permission gate: `/orders`, `/suppliers`, `/products`, `/uom`, `/fixed-assets` (`app-shell.tsx:533,544,633-634,656`).
  - Meals items gated only by `school:read` (`:610-618`).
  - Lesson Plans needs `school:lessonplans:write` (`:395`), but teachers hold `:own`, so teachers can't see Lesson Plans at all.

**A14. Nursery assessment is percentage-based.**

- ECD descriptors are read off 0–100 percentages.
- Rubric scoring exists only in the one-child-at-a-time "Submissions & rubric" inbox for assignments (`assessment-mark.tsx:45`).
- There is no class grid of children × learning areas with "Confident / Developing / Beginning / Support".

### P2: important

**A15. Term-end chores repeat for every class.**

- Each class list must be captured and frozen by hand (`assessment-ops.tsx`).
- Results are worked out one class list at a time (`results.tsx:149-182`).
- Results are released one class at a time.
- There is no "all classes" action for the term.

**A16. Promotion is split, and there is no annual result.**

- Students › Promote & Roll Over (a manual grid that ignores results) and Term Results › Promotion (decisions drawn from results) are not linked.
- There is no class-level annual result (Term III only, or the average of three terms) to base promotion on.
- Competency & Annual works per pupil only, and its picker loads only the **first 100 pupils** (`competency-report.tsx:14`). Most of a 710-pupil school is unreachable.

**A17. There are no pupil reports for BOT or MOT, and no results SMS.** Only the term report exists. Ugandan schools commonly send mid-term results to parents.

**A18. The lesson plan form doesn't follow the Ugandan format.**

- It has: title, objectives, materials, activities, resources, assessment, topic, subtopic.
- It is missing:
  - theme and sub-theme (P1–P3 thematic)
  - subject and language competences
  - methods
  - lesson steps (introduction / development / conclusion)
  - duration and number of pupils
  - teacher self-evaluation

**A19. New-school setup misses academic essentials.**

- No three terms, NCDC subjects or learning areas, BOT/MOT/EOT exam types or default weighting are created.
- The year placeholder is "2025/2026"; Uganda uses the calendar year (`academic-years.tsx:77`).
- The class placeholder is "S1 Red" (`classes.tsx`).
- Labels are generic: "Terms / Semesters", "Classes / Grades".
- The setup checklist has no academic-readiness steps: grading system, exam types, weighting, class teachers, report design.

### P3: polish

- **A20.** The workflow rail ticks steps as done by position, not by real state, and shows teachers "Create exam ✓ Choose classes ✓" (`exam-workflow.tsx:44`).
- **A21.** Pasting marks relies on row order. There is no import by admission number and no printable blank score sheet.
- **A22.** My Teaching › My courses shows past terms' courses unsorted (Term 3, Term 1, Term 2 of the same subject).

---

## 6. Target workflow

### Roles (presets)

| Role | Owns |
|---|---|
| **Head Teacher** | Final approval, results release, head teacher comments, promotion decisions, everything read-only |
| **Director of Studies** (new) | Subjects, timetable, teacher allocation, exams, weighting and grading, compiling and approving marks, results, report cards, lesson plan review |
| **Deputy Head** | As DOS minus results release, or a school-chosen split |
| **Class Teacher** | Register, own-class marks, **class teacher comments**, conduct ratings, own-class report preview |
| **Subject Teacher** | Marks for allocated class/subject papers, schemes of work and lesson plans |
| **Nursery Teacher** (new) | Care log, collection, observations grid, nursery comments |

### Screens

```
TEACHER HOME (one screen)
  Today: register to take · papers to mark (own only, preselected) · comments to write · plans due · returned items

DOS "TERM BOARD" (one screen per term)
  Grid: class × exam (BOT/MOT/EOT) → % marks entered · locked · approved
  Row actions: chase teacher · lock · approve
  Term column: results worked out / released · report cards built / commented / released / printed
  Bulk: "Lock class lists" · "Work out all results" · "Release all" · "Build & print all"

SETUP (wizard once, then plain pages)
  Year & terms → classes & streams → subjects per level → teacher allocation matrix → exams & weighting → grading per level → report design
```

### The term, end to end

1. **Week 1.** DOS confirms the allocation matrix, which is copied from last term. Class lists are captured automatically from placements.
2. Teachers submit the scheme of work, then weekly lesson plans. DOS/Deputy approve.
3. **BOT, MOT, EOT.** DOS creates the exam from a template. All its classes are applied in one step.
4. Teachers enter marks from Teacher Home. Class teachers chase gaps from their class view.
5. DOS uses the Term Board to lock and approve marks. After each exam it prints the merit list (aggregate, division, position) and optionally sends an exam report or SMS to parents.
6. **End of term.** "Work out all results" freezes the class lists automatically.
   - Class teachers write comments in a grid, with a comment bank.
   - The head teacher comments in bulk, with suggestions by division.
   - Then: release all, build and print all.
   - Cards carry the next-term date and fees.
7. **End of Term III.** An annual result is produced, then the promotion list with recommendations, then the head decides, then the decisions are applied and the year rolls over in one path. P7 leavers are graduated.
8. **Nursery.** The daily care screen stays as it is. The termly observation grid feeds the ECD report: descriptors and narrative, with no marks or positions.

---

## 7. Enhancement plan

Sizes are rough: **S** ≈ 1–2 days, **M** ≈ 3–5 days, **L** ≈ 1–2 weeks of focused work.

### Phase 0: make every printed and released result correct (do first)

| # | Work | Fixes | Size |
|---|---|---|---|
| 0.1 | **Reporting policy per programme in the UI.** <br>• Nursery = ECD, no ranking. <br>• Lower Primary = marks and position, plus an option for aggregate/division on chosen subjects. <br>• Upper Primary = PLE. <br>• Default the school to PLE, not UCE. <br>• Migrate existing orgs. <br>• Add a "Grading for each level" step to the setup checklist. | A1, A6 | M |
| 0.2 | **Explicit aggregate subjects per programme.** <br>• Replace the `isCore` overload with a per-programme list of the subjects that count (for example ENG/MTC/SCI/SST for P4–P7; LIT1/LIT2/ENG/MTC if a school wants P1–P3 aggregates). <br>• Keep `isCore` meaning *compulsory* only. <br>• Validate exactly four. | A5, A6 | M |
| 0.3 | **One source of truth on the card.** <br>• The card prints only stored result fields: grade, points, remark, aggregate, division, position, class size. <br>• Remove the subject-name regex aggregate. <br>• Snapshot the grading key with the result set. <br>• Pass the reporting system on PDF rebuild. <br>• Add golden PDF-text tests for ECD, lower primary and PLE cards. | A3, A4 | M |
| 0.4 | **Comments.** <br>• Class-teacher comment grid per class: pupils down the page, mean/division visible, comment bank by performance band, apply to selected. <br>• Head teacher bulk pass with suggestions. <br>• New permission `school:reports:comment`, scoped to own class for class teachers and held by Head/DOS. | A2 | M |
| 0.5 | **Auto-fill the card.** <br>• Next term start date, from the next term record. <br>• Fees balance and next-term fees, from the fees module, each a toggle in Report Card Design. <br>• Optional "requirements for next term" list. | A11 | S |
| 0.6 | **BOT/MOT/EOT columns.** <br>• Label component columns by exam type name. <br>• Configurable PLE column headers. | A11 | S |
| 0.7 | **Term labels everywhere** as "2026 · Term 3", sorted by year, defaulting to the current term. One shared `<TermSelect>`. | A8 | S |
| 0.8 | **Rebuild Sunrise results through the real engine** instead of writing result rows directly, so the demo shows real behaviour. Regenerate the demo report cards through Build all. | A3, A6 demo risk | M |

**Phase 0 is done when:** a fresh school created from empty, plus Sunrise, prints correct ECD, P2 and P6 cards with no contradictory numbers; golden tests cover each card type; and the P.5 merit list and P.5 card agree on aggregate and division.

### Phase 1: role-shaped workflow (biggest ease-of-use gain)

| # | Work | Fixes | Size |
|---|---|---|---|
| 1.1 | **Presets:** add Director of Studies and Nursery Teacher; review Head Teacher (full results desk). Remove DOS → Exams Officer from the demo. | A12 | S |
| 1.2 | **Navigation diet:** <br>• Gate every ungated item. <br>• Hide finance/inventory/assets/meals POS from teaching roles. <br>• Add a per-role module set. <br>• Target: teacher ≤ 12 links, DOS ≤ 25. <br>• Give teachers Lesson Plans via `:own`. | A13 | M |
| 1.3 | **Teacher Home:** <br>• Pickers limited to the teacher's own allocations. <br>• Deep links arrive with exam/class/subject preselected. <br>• Add "comments to write" and "register to take". <br>• Show current-term courses only. | A9, A22 | M |
| 1.4 | **Teacher allocation matrix:** <br>• Rows = class/stream, columns = subjects, cells = teacher, plus a class teacher column. <br>• "Copy from last term". <br>• Generates offerings behind the scenes. <br>• Move the offering lifecycle to an "Advanced" tab. <br>• Fix the setup checklist link. | A7 | L |
| 1.5 | **DOS Term Board:** <br>• One page for exam × class progress, approvals, results and report-card status. <br>• Bulk actions with a preview of what will happen and a per-class result list. | A15 | L |
| 1.6 | **Automatic class lists:** <br>• Capture from placements at term start. <br>• Freeze automatically when results are worked out, with a "changes since capture" reconcile prompt. <br>• Keep manual control under Advanced. | A15 | M |

**Phase 1 is done when:** the DOS runs a full term from the Term Board without visiting more than 5 other screens, and a teacher's whole week (register, marks, plans, comments) happens from Teacher Home.

### Phase 2: Uganda fit

| # | Work | Fixes | Size |
|---|---|---|---|
| 2.1 | **"New Ugandan school" setup wizard:** <br>• Calendar year and three terms with editable dates. <br>• NCDC subjects and learning areas per level, as editable rows. <br>• Exam types BOT, MOT, EOT and Mock (P7). <br>• Weighting presets: EOT 100% / MOT 40 + EOT 60 / BOT 20 + MOT 30 + EOT 50. <br>• Editable grading bands. <br>• "Uganda Primary" and "Uganda Nursery" report templates. <br>• Fix the placeholders and labels. | A19 | L |
| 2.2 | **Merit list per exam:** <br>• Per-subject grade, aggregate and division. <br>• Rank by aggregate, then total. <br>• Division summary (Div I: n …). <br>• Subject means by teacher and stream comparison. <br>• Printable on A4 landscape. | A10 | M |
| 2.3 | **Exam reports and SMS:** <br>• Per-pupil BOT/MOT report from the exam (clearly provisional, or after locking). <br>• SMS template, e.g. "Kato P.5 MOT: Agg 6, Div I, Pos 1/91". | A17 | M |
| 2.4 | **Nursery observation grid:** <br>• Children × learning-area competences, with tap-to-set descriptors. <br>• Termly narrative per learning area. <br>• Tablet-first. <br>• Feeds the ECD card; no percentages shown to the teacher. | A14 | L |
| 2.5 | **Annual result and a single promotion path:** <br>• Annual rule per programme (Term III only / average of 3 terms / weighted). <br>• Class promotion list with recommendation → head decides → apply → rollover. <br>• Retire the separate manual grid, or make it the "exceptions" step. <br>• Fix the 100-pupil picker. | A16 | L |
| 2.6 | **Ugandan lesson plan and scheme-of-work templates:** themes/sub-themes for P1–P3, competences, methods, lesson steps, self-evaluation, NCDC topic lists per subject. | A18 | M |

**Phase 2 is done when:** a pilot nursery-and-primary school sets up from the wizard in under 1 hour, and DOS, class teacher and nursery teacher complete one full term without Excel.

### Phase 3: polish and proof

| # | Work | Size |
|---|---|---|
| 3.1 | Plain-language pass on the remaining jargon (offering, roster, freeze, component, policy revision); show the reason for every disabled button | M |
| 3.2 | State-based workflow rail, hidden for roles that don't do those steps | S |
| 3.3 | Marks import by admission number (CSV/Excel), plus printable blank score sheets per class and subject | M |
| 3.4 | Tablet/phone pass for registers, marks and the nursery grid; verify offline queue replay | M |
| 3.5 | **Role journey tests (e2e):** DOS term, class teacher week, head release, nursery teacher term, using a fresh school, not seed shortcuts | L |
| 3.6 | **Pilot:** one nursery-and-primary school for one term, with time-on-task targets (below) | — |

**Time-on-task targets for the pilot:**

| Task | Target |
|---|---|
| Teacher enters 40 marks for one paper | ≤ 3 min |
| Class teacher writes 40 comments with the bank | ≤ 15 min |
| DOS produces, prints and releases the whole school's report cards after marks are approved | ≤ 30 min |
| New school academic setup with the wizard | ≤ 1 hour |
| Nursery teacher records a termly observation for one class | ≤ 20 min |

### Suggested order

Phase 0 (all) → 1.1, 1.2, 1.3 → 2.2, 2.1 → 1.4, 1.5, 1.6 → 2.4, 2.5 → 2.3, 2.6 → Phase 3 → pilot.

Phase 0 plus 1.1–1.3 is the minimum before showing the product to a school as "ready". Phase 0.8 matters before any further client demos.

---

## 8. Decisions needed from the owner

1. **Lower primary (P1–P3):** print aggregate and division on four chosen subjects, or marks and position only? Default per school?
2. **Positions:** print "position x out of y" for P1–P7 by default? Nursery stays unranked.
3. **Annual promotion rule:** Term III result, average of three terms, or weighted? Is there a pass mark or division threshold for automatic "promote"?
4. **Fees on report card:** show balance and next-term fees by default? Should withholding report cards from pupils with unpaid fees be supported (a common practice), or deliberately left out?
5. **Mid-term reports:** full per-pupil reports, SMS summary only, or both?
6. **Grading bands:** ship the current 90/80/70/65/60/50/40/35 bands as the default, or a different common school scale? (UNEB does not publish one mark-to-grade table for school tests.)
7. **DOS vs Deputy:** a separate DOS preset (recommended), or merge into Deputy Head?
