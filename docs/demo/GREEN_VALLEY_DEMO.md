# Green Valley Primary School — client demo

> **Fictional.** Green Valley Primary School, Kampala does not exist. Every
> name, admission number, mark, guardian and phone number in this dataset is
> invented for demonstration. Nothing here describes a real school, learner or
> member of staff.

A Ugandan nursery-and-primary school with a working year in it: ~900 pupils,
two years of enrolment history, a full 2026 of assessment and published
results, LMS courses with real content, and the planning paper trail an
inspector asks for.

---

## 1. Seeding it

Two commands, both idempotent — run them as often as you like, including in
front of a client.

```bash
# 1. The structure: levels, grades, classes, streams, years, terms.
pnpm --filter @erp/api db:seed:green-valley

# 2. The fill: people, enrolment, teaching, assessment, results, LMS, planning.
pnpm --filter @erp/api db:seed:green-valley-demo
```

The fill takes a few minutes (it writes ~900 pupils and their histories).

**For the LMS to be visible** the Advanced LMS flag must be on — it is
`false` by default:

| Where | Setting |
|---|---|
| `apps/api/.env` | `ENABLE_ADVANCED_LMS=true` |
| `apps/web/.env` | `VITE_ENABLE_ADVANCED_LMS=true` |
| `apps/portal/.env` | `VITE_ENABLE_ADVANCED_LMS=true`, `VITE_ORG_CODE=GREENVALLEY` |

The API flag is authoritative; the two `VITE_` mirrors only decide whether the
navigation shows. Restart the API after changing it — `nest start --watch`
reloads on file changes, not on environment changes.

Overridable when seeding: `DEMO_STAFF_PASSWORD`, `DEMO_PORTAL_PASSWORD`.

---

## 2. Logins

Organization code at the staff login: **`GREENVALLEY`**

| Email | Who | Password | Use it to show |
|---|---|---|---|
| `head@greenvalley.demo` | Head Teacher | `Staff@2026` | Approvals, published results, school-wide analytics |
| `deputy@greenvalley.demo` | Deputy Head | `Staff@2026` | Academic oversight, lesson-plan approval |
| `dos@greenvalley.demo` | Director of Studies | `Staff@2026` | Exams, marks approval, results runs |
| `bursar@greenvalley.demo` | Bursar | `Staff@2026` | Finance side (fees are **not** seeded — see §6) |
| `registrar@greenvalley.demo` | Registrar | `Staff@2026` | Admissions, enrolment, placements |
| `teacher@greenvalley.demo` | P5 North class teacher | `Staff@2026` | **The teacher story.** Owns their stream's register, one core subject, and the built-out LMS course for it |
| `mtc@greenvalley.demo` | Mathematics teacher | `Staff@2026` | Subject-teacher scope: only their own classes |
| `eng@greenvalley.demo` | English teacher | `Staff@2026` | A second subject teacher, for separation of duties |
| `sci@greenvalley.demo` | Science teacher | `Staff@2026` | — |

Portal logins (`apps/portal`, no organization code — it is baked into the build):

| Email | Who | Password |
|---|---|---|
| `pupil@greenvalley.demo` | A P5 North pupil | `Portal@2026` |
| `parent@greenvalley.demo` | Their guardian, with **two** children | `Portal@2026` |

The guardian has a second child in P2 North, so the child picker has something
to pick.

---

## 3. What is in the data, and why

### The school

| | |
|---|---|
| Nursery | Baby, Middle, Top Class — 7 streams, 23 pupils each |
| Primary | P1–P7 — 23 streams, 32 pupils each |
| Streams | North / South / East / West |
| Years | 2025 **closed**, 2026 **active**, 2027 planning |
| Terms | Three a year; the term containing today is the current one |
| Currency | UGX · Timezone Africa/Kampala |

### How classes are staffed

Nursery and lower primary are taught by the class teacher — one adult, all day,
which is how those classes run. Upper primary is specialist, **except** that each
stream's class teacher also takes one core subject to their own stream. That last
detail is not decoration: without it a "class teacher" has a register, a
report-card comment and no lessons, and their *My Courses* screen is empty.

Staff logins are joined to their person through HR (`HrEmployee.userId` →
`partnerId` → `StaffProfile`), which is the only path `EmployeeIdentityService`
accepts. A login without that row gets a working password and no classes.

### Curriculum — three different things in one school

This is deliberate, and it is the bit that shows the system is not hard-coded
to one way of teaching:

- **Nursery** is assessed **developmentally**. Its six learning areas report
  against the ECD descriptors — *Confident, Developing, Beginning, Support* —
  and a nursery report card carries **no aggregate, no division and no
  position**, because reporting a class position for a four-year-old would be
  wrong rather than merely unusual.
- **Lower primary (P1–P3)** runs the **thematic curriculum**: Literacy I in the
  local language, Literacy II in English, and Numeracy.
- **Upper primary (P4–P7)** is subject-based and ends at the **PLE**. Only the
  four examinable subjects — English, Mathematics, Science, Social Studies —
  carry into the aggregate. RE, Kiswahili, ICT, PE, Music and Art are taught
  and timetabled but **not** aggregated; adding them would misreport a pupil
  against the national standard. P7 report cards show the **aggregate and
  division** (Division 1–4 / Ungraded).

### What the seed actually produces

Verified on a clean rebuild (and identical on a re-run — see §5):

| | |
|---|---|
| Pupils | 897 |
| Staff | 50 (5 leadership, 15 subject teachers, 30 class teachers) |
| Guardian links | 898 |
| Enrolments / placements | 1 729 / 5 187 |
| Course offerings | 630 (3 terms x 30 streams x their subjects) |
| Timetable slots | 722 published, clash-free |
| Assessment papers | 618 — 514 graded, 80 being marked, 24 not started |
| Pupil marks | 17 874 — 15 692 approved, 2 182 awaiting approval |
| Published result sets | 30 |
| Report cards | 2 626 |
| LMS course pages | 1 470 week sections across 210 live courses |
| LMS activities | 276 in the 12 built-out courses |
| Quiz questions | 32, with real answers |
| Homework handed in | ~1 350 |
| Lesson plans | 72 — 36 approved, 24 submitted, 12 draft |
| Schemes of work | 12, with weeks and curriculum items |
| Scheduled lessons | 360, with 300 deliveries recorded |
| Attendance | 13 455 entries over 15 school days |

### The academic year, as it actually stands

| Term | State | What a client sees |
|---|---|---|
| 2025 Term 3 | Historical | Term results and report cards only — what an imported history looks like |
| 2026 Term 1 | Published | Marks → approved → results computed → report cards published |
| 2026 Term 2 | Published | Same, complete |
| 2026 Term 3 | **Live** | Continuous assessment approved; **the end-of-term exam is part-marked on purpose** |

That last row is the most useful thing in the dataset. Roughly half the Term 3
exam papers are marked and **awaiting approval**, a quarter are approved, and
the rest are untouched. So you can show:

- a real **approval queue** with work in it;
- **"not released yet"** on a pupil's screen — a mark that exists but has not
  been moderated does not reach the child or the parent;
- **results not ready** for a term still running.

---

## 3a. Verified working

Every persona below was driven through the real API with a real login (no forged
tokens), against the seeded GREENVALLEY tenant:

| Call | Result |
|---|---|
| pupil → my courses / due / released marks / badges | 8 courses, 5 due, 10 marks, 3 badges |
| pupil → open a course | *Primary 5 North — ENG*, 7 weeks, 23 activities, **57.1% done** |
| pupil → open a quiz | *Nouns and pronouns*, paper attached, `audience=student` |
| guardian → portal context | 2 children |
| guardian → child's courses | 7 courses |
| guardian → **another family's child** | **403 refused** |
| teacher → my courses | 3 courses |
| teacher → lesson plans | 12 draft / 24 submitted / 36 approved |
| head → pupils on roll | 897 |

**If the LMS 403s after a re-seed, restart the API.** `CapabilityService` caches
resolved capabilities in memory and invalidates them when the application writes
a role — a seed writes straight to the database, so the running process keeps
serving its old answer. Restarting is the whole fix.

## 4. A demo that works — suggested run

### A. The registrar's view (5 min) — `registrar@`

1. **School → Students.** ~900 pupils, searchable, with admission numbers.
2. Open one. **Class and stream are not fields on the pupil** — they come from
   the placement history. Show the history: three terms this year, three last
   year, and only the current term's row open.
3. **Enrolment → Placements.** Point out the repeaters and transfers-in: about
   3% repeated, about 2% joined from another school.

### B. The teacher's view (10 min) — `teacher@`

1. **Teaching → My courses.** Only their own classes — the data scope is real.
2. **Academics → Lesson Plans.** Plans in *every* state: approved for weeks
   gone by, **submitted and waiting** for this week, draft for next week. Open
   an approved one — objectives, five timed activities, assessment, two tiers of
   differentiation, and a reflection written *after* the lesson.
3. Click **Print** on a plan → a server-rendered PDF for the inspection file.
4. **Scheduled Lessons → Print scheme of work** → the term's scheme by week.
5. **Academics → Advanced Courses → P5 North Mathematics.** Six weeks of real
   topics (Fractions → Data handling), each with lesson notes, a worksheet, a
   video, homework, and a quiz in weeks 2 and 5.
6. **Marking workbench** — homework handed in, some late, waiting to be marked.

### C. The pupil and parent (5 min) — `pupil@` then `parent@`

1. Pupil → **Courses**. Real progress percentages, not zeros.
2. Open a course → a week → **lesson notes**, then **homework**: type an answer
   and hand it in.
3. Open a **quiz** → sit it. One question per screen, answers save as you go,
   real primary-level questions with real answers.
4. Show a mark that reads **"Not released yet"** — the moderation gate, from the
   child's side.
5. Sign in as `parent@` → **Learning**. Per-child progress, what is coming up,
   and **only released** marks. Switch children.

### D. The head teacher (5 min) — `head@`

1. **Results → Report Cards.** Open a published 2026 Term 2 card. Note the
   position and, for P7, the division.
2. Open a **nursery** card: descriptors, no position, no aggregate.
3. **Approvals.** The Term 3 marks waiting on them.
4. **Analytics.** Attendance rates over the last three weeks (persistent
   absentees, not noise), and curriculum coverage: planned versus delivered.

---

## 5. Things worth saying out loud

- **Everything is deterministic.** Marks come from a seeded generator keyed on
  the pupil, so a given child is consistently strong or weak across subjects and
  across terms — and a screenshot you took last week still matches the screen
  today. This was checked: two consecutive runs produced **identical counts
  across all twenty metrics**, and the second took 36s against 162s for the
  first.
- **Class means sit around 57%**, spread roughly 20–95%, which is a believable
  Ugandan primary distribution. P7 runs a little higher, as a class that has
  been drilled for the PLE does.
- **One truth per fact.** A mark shown in the LMS is the same row the report
  card uses; the LMS never stores its own grade. Course membership is a
  projection of official enrolment, not a second register.
- **The marks gate is real.** Only an *approved* mark reaches a pupil or a
  guardian — in the portal, in the gradebook, and in notifications.

---

## 6. What is deliberately **not** in this dataset

Say so plainly if a client asks, rather than hunting for a screen:

- **Fees, invoices and payments.** The finance modules work, but this seed is
  scoped to Academics and the LMS. `bursar@` can sign in; there is nothing
  owing. (`prisma/seed-school-demo.ts` and the fees seeds cover that side for a
  different tenant.)
- **Uploaded files.** Worksheet and resource activities exist with their titles,
  but a seed cannot upload bytes — attach a real PDF live, which also
  demonstrates the upload.
- **Exam operations** (venues, seating, invigilators, custody), **transport,
  hostel, library, meals, HR and payroll.** All exist in the product; none is
  seeded here.
- **2027.** Present as a planning year with no data, which is what a school
  setting up next year looks like.

---

## 7. Resetting

The seed is idempotent, so re-running is the normal way to repair a demo
someone clicked too hard. To start completely clean, delete the organization and
re-run both seeds:

```sql
-- Destructive. The GREENVALLEY tenant only.
DELETE FROM "Organization" WHERE code = 'GREENVALLEY';
```

This was tested: the delete succeeds and cascades, and both seeds then rebuild
the tenant from nothing in about three minutes.

One thing to know if you ever wipe and rebuild: the demo's question banks are
keyed on `(organization, name)`, not on a fixed id, precisely so that a rebuilt
tenant gets its own. An earlier version used fixed ids, the old rows survived
the wipe pointing at the deleted organization, and every quiz then failed to
start with *"Paper has no questions to sit"*. If you see that message, check for
orphaned `QuestionBank` rows whose `organizationId` no longer exists.
