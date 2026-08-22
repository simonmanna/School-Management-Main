# LMS & Lesson Planning — Moodle-Shaped Architecture

> Design target: everything a teacher and student can do in Moodle, expressed in this
> codebase's idioms (Prisma + NestJS modular monolith + React), **without** duplicating the
> assessment/result spine we already have.
>
> Decision record: [ADR-014](../adr/ADR-014-lms-moodle-architecture.md).
> Status: design. Nothing below is implemented yet except where marked **EXISTS**.

---

## 1. The five layers

```
┌───────────────────────────────────────────────────────────────────────────────┐
│ L5  EXPERIENCE   student course page · teacher course mgmt · parent view       │
│                  gradebook view · reports · dashboards                         │
├───────────────────────────────────────────────────────────────────────────────┤
│ L4  ACTIVITY PLUGINS  mod_assign  mod_quiz  mod_forum  mod_resource  mod_page  │
│                       mod_url  mod_folder  mod_label  mod_lesson  mod_choice   │
│                       mod_feedback  mod_glossary  mod_wiki  mod_workshop       │
│                       mod_scorm  mod_lti  mod_h5p  mod_attendance              │
├───────────────────────────────────────────────────────────────────────────────┤
│ L3  COURSE SPINE   CourseOffering → CourseSection → CourseModule               │
│                    availability · completion · groups · enrolment              │
├───────────────────────────────────────────────────────────────────────────────┤
│ L2  PLANNING (ours, not Moodle's)  Curriculum → Topic → Unit → LearningObjective│
│                    LessonPlan (+workflow, templates, review, revisions)        │
│                    ScheduledLesson → LessonDelivery                            │
├───────────────────────────────────────────────────────────────────────────────┤
│ L1  PLATFORM   LmsContext/roles · kernel files · kernel events+audit ·         │
│                assessment spine (Assessment→StudentAssessment→ResultSet)       │
└───────────────────────────────────────────────────────────────────────────────┘
```

**Dependency rule:** L4 depends on L3 and L1 only. L4 plugins never import each other.
L3 never imports a specific plugin — it talks to them through `ActivityPlugin`.
Enforced by `dependency-cruiser` per ADR-011.

---

## 2. What already exists vs. what is new

| Concern | Today | Action |
|---|---|---|
| Teaching instance | `CourseOffering` **EXISTS** | Extend: `format`, `visible`, `groupMode`, `completionEnabled`, `startDate`, `endDate`, `summary` |
| Week/topic spine | — | **New** `CourseSection` |
| Activity placement | — | **New** `CourseModule` + `LmsActivityType` |
| Assignment | `Assignment`/`AssignmentSubmission` **EXISTS** (tied to `Assessment`) | Wrap as `mod_assign`; keep tables |
| Homework | `HomeworkAssignment`/`HomeworkSubmission` **EXISTS** | Fold into `mod_assign` via adapter; deprecate |
| Quiz | `QuestionBank`, `Question`, `QuestionOption`, `QuestionPaper`, `QuizAttempt`, `QuizResponse` **EXISTS** | Wrap as `mod_quiz`; add categories/versions/slots/overrides/behaviours |
| Forum | `Discussion`/`DiscussionPost` **EXISTS** | Wrap as `mod_forum`; add subscription, group mode, rating, forum types |
| Resource/file/url | `LearningResource` **EXISTS** (has `attaches` JSON) | Split into `mod_resource`/`mod_url`/`mod_folder`; keep as the content library |
| Gradebook | assessment spine **EXISTS** | Reuse. Add grade override/hide/lock + grade history |
| Competencies | `Competency`, `LearningObjective`, `…Evidence`, `…Progress` **EXISTS** | Emit evidence from plugins |
| Course progress | `StudentCourseProgress` **EXISTS** (nothing writes it properly) | Compute from `CourseModuleCompletion` |
| Permissions | global `school.read`/`school.write` | **New** context hierarchy |
| Files | `kernel/files` **EXISTS** | Add file-area addressing + context-based ACL |
| Lesson planning | full stack **EXISTS** | Add "publish plan → section" materialiser |

---

## 3. Data model

### 3.1 Context & capabilities (Moodle `context`/`role`/`role_assignments`)

The single most load-bearing new concept. Everything else hangs off it.

```prisma
enum LmsContextLevel { system organization category course activity user }

/// Materialised-path context tree. path = '/org-1/cat-3/course-88/cm-412/'
model LmsContext {
  id             String @id @default(uuid())
  organizationId String
  level          LmsContextLevel
  instanceId     String?          // CourseOffering.id, CourseModule.id, …
  parentId       String?
  path           String           // materialised, prefix-indexed
  depth          Int

  parent   LmsContext?  @relation("ctx", fields: [parentId], references: [id])
  children LmsContext[] @relation("ctx")
  roleAssignments LmsRoleAssignment[]
  overrides       LmsCapabilityOverride[]

  @@unique([organizationId, level, instanceId])
  @@index([organizationId, path])
}

/// Archetypes: manager, coursecreator, editingteacher, teacher (non-editing),
/// student, parent, observer, guest.
model LmsRole {
  id             String @id @default(uuid())
  organizationId String
  shortname      String            // 'editingteacher'
  name           String
  archetype      String
  sortOrder      Int      @default(0)
  /// Context levels this role may be assigned at.
  assignableAt   LmsContextLevel[]

  capabilities LmsRoleCapability[]

  @@unique([organizationId, shortname])
}

enum LmsPermission { inherit allow prevent prohibit }

model LmsRoleCapability {
  id         String @id @default(uuid())
  roleId     String
  capability String                        // 'mod/assign:grade'
  permission LmsPermission @default(inherit)

  role LmsRole @relation(fields: [roleId], references: [id], onDelete: Cascade)

  @@unique([roleId, capability])
}

model LmsRoleAssignment {
  id             String @id @default(uuid())
  organizationId String
  contextId      String
  roleId         String
  /// One of these two, never both. Staff and students are different principals here.
  userId           String?
  studentProfileId String?
  /// Which enrolment method created this, for auto-sync reconciliation.
  sourceComponent  String?    // 'enrol_roster' | 'manual' | 'enrol_self'
  createdAt        DateTime @default(now())

  context LmsContext @relation(fields: [contextId], references: [id], onDelete: Cascade)

  @@unique([contextId, roleId, userId, studentProfileId])
  @@index([organizationId, userId])
  @@index([organizationId, studentProfileId])
}

/// Per-context capability override (Moodle's "permissions in this context").
model LmsCapabilityOverride {
  id         String @id @default(uuid())
  contextId  String
  roleId     String
  capability String
  permission LmsPermission

  context LmsContext @relation(fields: [contextId], references: [id], onDelete: Cascade)

  @@unique([contextId, roleId, capability])
}
```

**Resolution algorithm** — `CapabilityService.hasCapability(principal, capability, context)`:

1. Split `context.path` into ancestor ids (`/org-1/cat-3/course-88/` → 3 ids).
2. Collect role assignments for the principal at any ancestor id.
3. Collect `LmsRoleCapability` defaults for those roles, then apply `LmsCapabilityOverride`
   rows ordered by ascending `depth` (nearer context wins).
4. Fold: `prohibit` beats everything; else nearest non-`inherit` wins; else deny.
5. Memoise per `(principal, courseContext)` for the request lifetime; invalidate the org's
   capability cache on any role/override write.

**Capability naming** mirrors Moodle so the vocabulary transfers:
`lms/course:manageactivities`, `lms/course:viewhiddenactivities`, `lms/grade:viewall`,
`lms/grade:edit`, `mod/quiz:attempt`, `mod/assign:submit`, `mod/assign:grade`,
`mod/forum:replypost`.

The existing global `school.*` permissions stay as the coarse gate at the controller level;
capabilities are the fine gate inside LMS handlers. A user needs both.

---

### 3.2 Course spine

```prisma
enum CourseFormat { weeks topics single_activity social flexible }
enum GroupMode    { none separate visible }

// EXTENDS the existing CourseOffering
model CourseOffering {
  // … existing: organizationId, academicYearId, termId, subjectId, classId,
  //   sectionId, curriculumId, status, teachers[], scheduledLessons[], …
  format               CourseFormat @default(weeks)
  numSections          Int          @default(14)
  startDate            DateTime?
  endDate              DateTime?
  summary              String?
  summaryFormat        String       @default("html")
  visible              Boolean      @default(true)
  groupMode            GroupMode    @default(none)
  forceGroupMode       Boolean      @default(false)
  completionEnabled    Boolean      @default(true)
  showGradesToStudents Boolean      @default(true)
  categoryId           String?

  sections   CourseSection[]
  modules    CourseModule[]
  enrolments CourseEnrolment[]
  groups     LmsGroup[]
}

/// Optional browse tree above offerings (department / stage / subject area).
model CourseCategory {
  id             String @id @default(uuid())
  organizationId String
  parentId       String?
  name           String
  path           String
  depth          Int
  sortOrder      Int    @default(0)

  @@index([organizationId, path])
}

/// Moodle course_sections. sectionNo 0 = "General" (always visible, no dates).
model CourseSection {
  id               String @id @default(uuid())
  organizationId   String
  courseOfferingId String
  sectionNo        Int
  name             String?
  summary          String?
  visible          Boolean   @default(true)
  /// Availability tree, see §3.4. null = always available.
  availability     Json?
  /// For format=weeks, the Monday of the week this section covers.
  weekOf           DateTime?
  /// Ordered CourseModule ids. Denormalised so drag-and-drop reorder is one write,
  /// exactly like Moodle's course_sections.sequence.
  sequence         String[]  @default([])

  courseOffering CourseOffering @relation(fields: [courseOfferingId], references: [id], onDelete: Cascade)
  modules        CourseModule[]

  @@unique([courseOfferingId, sectionNo])
  @@index([organizationId])
}

/// Registry of installed activity types (Moodle's `modules` table).
model LmsActivityType {
  id        String  @id @default(uuid())
  name      String  @unique          // 'assign' | 'quiz' | 'forum' | …
  label     String
  icon      String
  /// Feature flags read by the spine so it never special-cases a plugin.
  gradable               Boolean @default(false)
  supportsGroups         Boolean @default(false)
  supportsCompletionAuto Boolean @default(true)
  hasSubmissions         Boolean @default(false)
  visible                Boolean @default(true)
  sortOrder              Int     @default(0)
}

enum CompletionMode { none manual automatic }

/// Moodle course_modules — the spine row for every placed activity.
model CourseModule {
  id               String @id @default(uuid())
  organizationId   String
  courseOfferingId String
  sectionId        String
  activityType     String              // → LmsActivityType.name
  /// Polymorphic FK into the per-type instance table. Integrity enforced by the
  /// plugin layer + a nightly orphan sweep (documented trade-off, ADR-014).
  instanceId       String
  idnumber         String?             // external/report key
  sequence         Int       @default(0)
  visible          Boolean   @default(true)
  /// Shown greyed on the course page with the unmet condition, vs. hidden entirely.
  visibleOnPage    Boolean   @default(true)
  availability     Json?
  groupMode        GroupMode @default(none)
  groupingId       String?
  completionMode   CompletionMode @default(manual)
  /// { view?, requireGrade?, minGrade?, submit?, forumPosts?, forumReplies?, expectedBy? }
  completionRules  Json      @default("{}")
  /// Set when gradable: the single Assessment this module owns. Marks NEVER live here.
  assessmentId     String?   @unique
  openAt           DateTime?
  dueAt            DateTime?
  cutoffAt         DateTime?
  createdAt        DateTime  @default(now())
  updatedAt        DateTime  @updatedAt
  deletedAt        DateTime?

  courseOffering CourseOffering @relation(fields: [courseOfferingId], references: [id], onDelete: Cascade)
  section        CourseSection  @relation(fields: [sectionId], references: [id], onDelete: Cascade)
  completions    CourseModuleCompletion[]

  @@index([organizationId, courseOfferingId])
  @@index([activityType, instanceId])
  @@index([organizationId, dueAt])
}
```

---

### 3.3 Enrolment, groups, completion

```prisma
enum EnrolMethod { roster_sync manual self cohort guest }
enum EnrolStatus { active suspended }

/// How people get into a course. Separate from what role they hold (Moodle's split).
model CourseEnrolmentMethod {
  id               String @id @default(uuid())
  organizationId   String
  courseOfferingId String
  method           EnrolMethod
  enabled          Boolean @default(true)
  /// self: { key?, maxEnrolled?, startDate?, endDate? }   cohort: { cohortId }
  config           Json    @default("{}")
  defaultRoleId    String?
  sortOrder        Int     @default(0)

  @@unique([courseOfferingId, method])
}

model CourseEnrolment {
  id               String @id @default(uuid())
  organizationId   String
  courseOfferingId String
  methodId         String
  studentProfileId String?
  userId           String?
  status           EnrolStatus @default(active)
  startedAt        DateTime?
  endsAt           DateTime?
  lastAccessAt     DateTime?

  courseOffering CourseOffering @relation(fields: [courseOfferingId], references: [id], onDelete: Cascade)

  @@unique([courseOfferingId, studentProfileId, userId])
  @@index([organizationId, studentProfileId])
}

model LmsGroup {
  id               String @id @default(uuid())
  organizationId   String
  courseOfferingId String
  name             String
  description      String?
  enrolmentKey     String?

  members        LmsGroupMember[]
  courseOffering CourseOffering @relation(fields: [courseOfferingId], references: [id], onDelete: Cascade)

  @@unique([courseOfferingId, name])
}

model LmsGroupMember {
  id               String @id @default(uuid())
  groupId          String
  studentProfileId String?
  userId           String?

  group LmsGroup @relation(fields: [groupId], references: [id], onDelete: Cascade)

  @@unique([groupId, studentProfileId, userId])
}

/// A named set of groups an activity can be restricted to.
model LmsGrouping {
  id               String   @id @default(uuid())
  organizationId   String
  courseOfferingId String
  name             String
  groupIds         String[] @default([])

  @@unique([courseOfferingId, name])
}

enum CompletionState { incomplete complete complete_pass complete_fail }

model CourseModuleCompletion {
  id               String @id @default(uuid())
  organizationId   String
  courseModuleId   String
  studentProfileId String
  state            CompletionState @default(incomplete)
  viewed           Boolean  @default(false)
  /// Set only when a human ticked it (manual mode) — audit who.
  overriddenById   String?
  completedAt      DateTime?
  updatedAt        DateTime @updatedAt

  courseModule CourseModule @relation(fields: [courseModuleId], references: [id], onDelete: Cascade)

  @@unique([courseModuleId, studentProfileId])
  @@index([organizationId, studentProfileId])
}

/// Course-level criteria; the rolled-up result feeds StudentCourseProgress.
model CourseCompletionCriteria {
  id               String @id @default(uuid())
  organizationId   String
  courseOfferingId String
  /// 'activity' | 'grade' | 'date' | 'self' | 'all_activities'
  criteriaType     String
  courseModuleId   String?
  minGrade         Decimal? @db.Decimal(5, 2)
  byDate           DateTime?
  /// 'all' | 'any' across this course's criteria.
  aggregation      String   @default("all")
}
```

`StudentCourseProgress.progressPct` **EXISTS** and becomes the derived output:
`complete modules ÷ completion-tracked modules`, recomputed on every completion write
(debounced per student per course).

---

### 3.4 Availability tree (Moodle's availability API, verbatim shape)

Stored on `CourseSection.availability` and `CourseModule.availability`:

```jsonc
{
  "op": "&",                       // & | | | !& | !|
  "showc": [true, false],          // per condition: show greyed vs. hide entirely
  "c": [
    { "type": "date",       "d": ">=", "t": "2026-09-01T00:00:00Z" },
    { "type": "completion", "cm": "<courseModuleId>", "e": 1 },   // 0 incomplete 1 complete 2 pass 3 fail
    { "type": "grade",      "assessmentId": "<id>", "min": 50, "max": null },
    { "type": "group",      "id": "<groupId>" },
    { "type": "grouping",   "id": "<groupingId>" },
    { "type": "role",       "roles": ["student"] },
    { "type": "profile",    "field": "gradeLevel", "op": "isequalto", "v": "S3" }
  ]
}
```

`AvailabilityService.evaluate(tree, ctx)` returns
`{ available: boolean, reasons: string[], showGreyed: boolean }`.
Condition handlers are a registry keyed by `type` — adding a condition is additive.
Evaluated **server-side always**; the client only renders the returned `reasons`.

---

### 3.5 Grade bridge — the rule that keeps one truth

```
CourseModule (gradable)
   └─ 1:1 ─► Assessment              (EXISTS: componentId, subjectId, classId, termId,
                                       maxScore, weightInComponent, sourceType, sourceRef)
                 └─ fan-out ─► StudentAssessment      (EXISTS: the mark, per student)
                                    └─► ResultProcessingRun → StudentTermResult (EXISTS)
```

- Extend `enum AssessmentSourceType` with `lms_activity` (keep `assignment`, `quiz` for
  existing rows; the adapter maps old → new).
- `Assessment.sourceRef = CourseModule.id`. The existing
  `@@unique([organizationId, sourceType, sourceRef])` makes creation idempotent — reuse it.
- Publishing a gradable module = create `Assessment` (status `draft`) → on publish, fan the
  roster into `StudentAssessment`. Same code path assignments already use.
- Grading inside a plugin writes `StudentAssessment` **through the assessment service**, never
  directly. The plugin stores only its artefact (submission text, attempt responses).

New, because Moodle has it and the spine does not:

```prisma
model AssessmentGradeOverride {
  id                  String  @id @default(uuid())
  organizationId      String
  studentAssessmentId String  @unique
  overriddenScore     Decimal @db.Decimal(8, 2)
  reason              String?
  overriddenById      String
  createdAt           DateTime @default(now())
}

model StudentAssessmentHistory {
  id                  String   @id @default(uuid())
  organizationId      String
  studentAssessmentId String
  oldScore            Decimal? @db.Decimal(8, 2)
  newScore            Decimal? @db.Decimal(8, 2)
  source              String   // 'plugin' | 'manual' | 'override' | 'import' | 'recompute'
  changedById         String?
  changedAt           DateTime @default(now())

  @@index([organizationId, studentAssessmentId])
}
```

Plus flags on `Assessment`: `hiddenFromStudents Boolean`, `lockedAt DateTime?`
(Moodle's grade-item hidden/locked).

---

### 3.6 Question engine upgrades (`mod_quiz`)

Existing: `QuestionBank`, `Question`, `QuestionOption`, `QuestionPaper`, `QuizAttempt`,
`QuizResponse`, `cbt-marking.ts`. Missing the Moodle parts that matter:

```prisma
/// Question categories form a tree OWNED BY A CONTEXT — a course-level bank is invisible
/// to other courses, an org-level bank is shared. This is why §3.1 comes first.
model QuestionCategory {
  id             String @id @default(uuid())
  organizationId String
  contextId      String
  parentId       String?
  name           String
  path           String
  sortOrder      Int    @default(0)

  @@index([organizationId, contextId])
}

/// Moodle 4.x question versioning: edits create a version; live attempts keep theirs.
model QuestionVersion {
  id         String   @id @default(uuid())
  questionId String
  version    Int
  status     String   // draft | ready | hidden
  snapshot   Json     // stem, options, feedback, answers at this version
  createdAt  DateTime @default(now())

  @@unique([questionId, version])
}

/// A slot in a quiz: a fixed question, or a random draw from a category.
model QuizSlot {
  id                String @id @default(uuid())
  organizationId    String
  quizId            String                  // → ModQuiz.id
  page              Int     @default(1)
  slotNo            Int
  questionId        String?
  questionVersionId String?
  randomCategoryId  String?
  randomIncludeSub  Boolean  @default(false)
  randomTags        String[] @default([])
  maxMark           Decimal  @default(1) @db.Decimal(8, 2)
  requirePrevious   Boolean  @default(false)

  @@unique([quizId, slotNo])
}

/// Per-user / per-group time and attempt overrides (Moodle quiz overrides).
model QuizOverride {
  id               String @id @default(uuid())
  organizationId   String
  quizId           String
  studentProfileId String?
  groupId          String?
  openAt           DateTime?
  closeAt          DateTime?
  timeLimitSec     Int?
  attemptsAllowed  Int?

  @@index([quizId])
}
```

**Question behaviours** (`deferredfeedback`, `immediatefeedback`, `interactive` — multi-try
with hints and penalty, `adaptive`, `manualgraded`) are a **code registry**, not tables:
a `QuestionBehaviour` interface with `process(step)` and `grade(attemptState)`.
`QuizResponse` gains `stepData Json` to hold behaviour state (tries used, penalty accrued).

**Question types** are also a code registry (`QuestionType` interface: `render`,
`gradeResponse`, `validate`, `export`): `multichoice`, `truefalse`, `shortanswer`,
`numerical`, `matching`, `essay` (manual), `cloze`, `ddwtos`, `calculated`, `ordering`.
`Question.type` is already a string — no migration needed to add types.

Quiz settings live on the instance table: `gradingMethod` (highest|average|first|last),
`attemptsAllowed`, `timeLimitSec`, `navMethod` (free|sequential), `shuffleQuestions`,
`shuffleAnswers`, `reviewOptions` (JSON matrix: during / immediately after / later / after
close × marks, feedback, right answer, general feedback), `overallFeedback` bands.

---

### 3.7 Files

Reuse `kernel/files`. Add addressing so an activity's files are ACL'd by context:

```prisma
model LmsFile {
  id             String @id @default(uuid())
  organizationId String
  fileId         String   // → kernel/files
  contextId      String   // LmsContext — drives who may read it
  component      String   // 'mod_assign' | 'mod_resource' | 'question'
  fileArea       String   // 'submission' | 'content' | 'intro' | 'feedback'
  itemId         String   // submission id / instance id
  filePath       String @default("/")
  fileName       String
  sortOrder      Int    @default(0)

  @@index([organizationId, component, fileArea, itemId])
}
```

Download is always mediated: `GET /school/lms/files/:id` → resolve `contextId` → capability
check → stream. No direct object-store URLs for student work.

---

### 3.8 Logging & reports

One standard event row (Moodle's standard log), written by the plugin base class so no plugin
can forget:

```prisma
model LmsEvent {
  id               String @id @default(uuid())
  organizationId   String
  eventName        String   // 'mod_quiz.attempt_submitted'
  component        String
  action           String   // viewed | created | updated | submitted | graded | deleted
  target           String   // course_module | attempt | post | submission
  contextId        String
  courseOfferingId String?
  courseModuleId   String?
  objectId         String?
  userId           String?
  studentProfileId String?
  other            Json     @default("{}")
  createdAt        DateTime @default(now())

  @@index([organizationId, courseOfferingId, createdAt])
  @@index([organizationId, studentProfileId, createdAt])
}
```

Powers, with no extra tables: activity report, participation report, live logs, "students who
have not viewed X", engagement heat map, last-access-per-student. Emitted on the kernel event
bus (ADR-003) so notifications and analytics subscribe rather than poll.

---

## 4. The activity plugin contract

The core of the whole design. A new activity type = one folder, zero spine changes.

```ts
// apps/api/src/modules/school/lms/plugins/activity-plugin.interface.ts

export interface ActivityPlugin<TInstance = unknown> {
  /** Matches LmsActivityType.name, e.g. 'quiz'. */
  readonly type: string;

  readonly features: {
    gradable: boolean;
    hasSubmissions: boolean;
    supportsGroups: boolean;
    supportsCompletionAuto: boolean;
    /** Completion rule keys this plugin understands. */
    completionRuleKeys: string[];
  };

  /** Create the per-type instance row. Returns its id for CourseModule.instanceId. */
  createInstance(ctx: PluginCtx, dto: unknown): Promise<{ instanceId: string }>;
  updateInstance(ctx: PluginCtx, instanceId: string, dto: unknown): Promise<void>;
  deleteInstance(ctx: PluginCtx, instanceId: string): Promise<void>;

  /** What a student sees. Availability + capability are already applied by the spine. */
  viewForStudent(ctx: PluginCtx, cm: CourseModule, studentProfileId: string): Promise<unknown>;
  /** What a teacher sees (submission list, attempt list, …). */
  viewForTeacher(ctx: PluginCtx, cm: CourseModule): Promise<unknown>;

  /** Grade shape for the Assessment the spine creates. Only if features.gradable. */
  gradeDefinition?(instanceId: string): Promise<{ maxScore: number; gradingMode: string }>;

  /** Called by the spine when it needs a fresh completion verdict. */
  evaluateCompletion?(
    ctx: PluginCtx, cm: CourseModule, studentProfileId: string,
  ): Promise<CompletionState>;

  /** Objective evidence this activity produced — feeds LearningObjectiveEvidence. */
  emitEvidence?(
    ctx: PluginCtx, cm: CourseModule, studentProfileId: string,
  ): Promise<EvidenceRow[]>;

  /** Backup/restore + course rollover. */
  exportInstance(instanceId: string, opts: { includeUserData: boolean }): Promise<Json>;
  importInstance(ctx: PluginCtx, payload: Json): Promise<{ instanceId: string }>;
}
```

Registration follows ADR-005: each plugin exports a manifest; `ActivityRegistry` collects them
at boot, validates that every `LmsActivityType` row has a live plugin (and vice versa), and
fails loudly otherwise.

**Spine responsibilities (never a plugin's):** capability check, availability evaluation, group
filtering, `Assessment` creation and mark writes, completion persistence, event logging, file
ACL. A plugin that writes `StudentAssessment` directly is a review reject.

### Plugin roster & mapping

| Plugin | Instance table | Reuses |
|---|---|---|
| `mod_assign` | `ModAssign` | existing `Assignment` + `AssignmentSubmission` (+ rubric service) |
| `mod_quiz` | `ModQuiz` | existing `QuestionPaper` / `QuizAttempt` / `QuizResponse` + §3.6 |
| `mod_forum` | `ModForum` | existing `Discussion` / `DiscussionPost` + subscriptions, ratings |
| `mod_resource` | `ModResource` | `LearningResource` (file) |
| `mod_url` | `ModUrl` | `LearningResource` (link) |
| `mod_folder` | `ModFolder` | `LmsFile` set |
| `mod_page` | `ModPage` | rich-text body |
| `mod_label` | `ModLabel` | inline text on the course page (no own page) |
| `mod_lesson` | `ModLessonPage`, `ModLessonBranch` | branching content — new |
| `mod_choice` | `ModChoice`, `ModChoiceAnswer` | quick poll — new |
| `mod_feedback` | `ModFeedback…` | anonymous surveys — new |
| `mod_glossary` | `ModGlossaryEntry` | new |
| `mod_wiki` | `ModWikiPage`, `ModWikiVersion` | new |
| `mod_workshop` | `ModWorkshop…` | peer assessment — new, Phase 8 |
| `mod_scorm` | `ModScorm`, `ScormTrack` | SCORM 1.2 / 2004 runtime — Phase 8 |
| `mod_lti` | `ModLti` | LTI 1.3 tool consumer — Phase 8 |
| `mod_h5p` | `ModH5p` | H5P player + xAPI capture — Phase 8 |
| `mod_attendance` | — | thin wrapper over the **existing** attendance module |

---

## 5. API surface

Prefix `/api/v1/school/lms`. Existing `school/lp/*` and `school/homework/*` routes stay and are
deprecated over one release.

```
Courses & structure
  GET    /courses                        ?termId&classId&subjectId&teacherId&mine=true
  GET    /courses/:id                    → course page payload (sections + modules,
                                            availability + completion resolved for caller)
  PATCH  /courses/:id/settings
  POST   /courses/:id/sections
  PATCH  /sections/:id                   name, summary, visible, availability
  POST   /sections/:id/move              { toSectionNo }
  POST   /courses/:id/modules            { activityType, sectionId, ...instanceDto }
  PATCH  /modules/:id                    spine fields
  PATCH  /modules/:id/instance           delegated to plugin.updateInstance
  POST   /modules/:id/move               { sectionId, sequence }
  POST   /modules/:id/duplicate
  POST   /modules/:id/visibility         { visible, visibleOnPage }
  DELETE /modules/:id

Activity delivery (spine → plugin)
  GET    /modules/:id/view               plugin.viewForStudent | viewForTeacher by capability
  POST   /modules/:id/action/:action     plugin-defined verbs (submit, start-attempt, post…)

Enrolment, groups, roles
  GET    /courses/:id/participants       ?roleId&groupId&status
  POST   /courses/:id/enrol              manual enrol
  POST   /courses/:id/enrol/sync         re-run roster_sync
  PATCH  /enrolments/:id                 status / dates
  POST   /courses/:id/groups             + /groups/:id/members
  POST   /courses/:id/roles              assign role at course context
  GET    /courses/:id/permissions        effective capabilities for the caller (drives UI)

Completion & progress
  POST   /modules/:id/completion         manual tick { studentProfileId?, state }
  GET    /courses/:id/completion-report  matrix: students × modules
  GET    /courses/:id/progress/:studentProfileId

Gradebook (thin views over the assessment spine — no new truth)
  GET    /courses/:id/gradebook          grader report
  PATCH  /courses/:id/gradebook/cell     { studentAssessmentId, score } → assessment service
  POST   /courses/:id/gradebook/override
  GET    /courses/:id/gradebook/export   csv / xlsx
  POST   /courses/:id/gradebook/import

Question bank
  GET    /question-categories            ?contextId
  POST   /question-categories
  POST   /questions                      (existing, extended: categoryId + versioning)
  POST   /questions/:id/version
  POST   /quiz/:id/slots                 fixed + random slots, pages, marks

Reports
  GET    /courses/:id/logs               ?from&to&userId&action
  GET    /courses/:id/activity-report
  GET    /courses/:id/participation      ?moduleId&action=viewed|posted
  GET    /courses/:id/outline

Backup / rollover
  POST   /courses/:id/export             { includeUserData }
  POST   /courses/import                 { targetOfferingId, bundle }
  POST   /courses/rollover               { fromTermId, toTermId, offeringIds[] }

Lesson-planning bridge (extends existing school/lp)
  POST   /lesson-plans/:id/publish-to-course   { courseOfferingId, sectionNo }
  GET    /courses/:id/plan-coverage            plan objectives vs. delivered modules
```

---

## 6. Frontend information architecture

Moodle's screens, mapped to routes under `apps/web/src/pages/school/lms/`.

```
/school/lms
  /courses                      Course browser (category tree · my courses · all)
  /courses/:id                  ◄ THE course page (Moodle course view)
      left drawer   course index: sections → activities, completion ticks
      main          section list, drag-drop in edit mode, activity cards
      right         upcoming due, recent activity, teacher actions
  /courses/:id/participants     enrolled users, roles, groups, filters, bulk actions
  /courses/:id/grades           grader report (teacher) / user report (student & parent)
  /courses/:id/reports          logs · activity · participation · completion matrix
  /courses/:id/settings         format, sections, completion defaults, groups, enrolment
  /courses/:id/question-bank    category tree, questions, versions, import/export

  /modules/:id                  activity page — plugin-rendered body + common chrome
                                (description, due date, completion tick, grade, files)

  /my                           student dashboard: timeline, courses, due soon
  /teacher                      teacher dashboard (EXISTS — extend with needs-grading)
  /lesson-plans …               planning suite (EXISTS: plans, templates, coverage,
                                scheduled lessons, mastery)
```

**Edit mode** is the Moodle idiom worth copying exactly: one toggle flips the whole course page
into drag-and-drop with "Add an activity or resource" per section. Everything is inline — no
separate admin screen for course structure.

**Component contract on the web side** mirrors the backend plugin:

```ts
export interface ActivityUiPlugin {
  type: string;
  icon: LucideIcon;
  Card: FC<{ cm: CourseModuleView }>;          // course-page row
  StudentView: FC<{ cm: CourseModuleView }>;
  TeacherView: FC<{ cm: CourseModuleView }>;
  SettingsForm: FC<{ cm?: CourseModuleView }>; // add/edit dialog
}
```

Registered in one `activityRegistry` map; the course page never switches on `activityType`.

Existing pages (`lesson-plans`, `templates`, `scheduled-lessons`, `discussions`, `homework`,
`mastery`, `coverage`, `course-offerings`) stay; `discussions` and `homework` become plugin
views reachable from a course page as well as standalone.

---

## 7. Phased delivery

Each phase ends shippable. Nothing after Phase 1 requires re-migrating Phase 1.

| Phase | Scope | Exit criterion |
|---|---|---|
| **P0 — Foundations** | `LmsContext`, `LmsRole`, capability resolver + cache, seed 8 archetype roles, capability guard decorator | A teacher assigned `editingteacher` on one offering can edit only that offering |
| **P1 — Course spine** | `CourseSection`, `CourseModule`, `LmsActivityType`, `ActivityRegistry`, course-page API + UI with edit mode | Teacher builds a 14-week course of empty sections and reorders modules |
| **P2 — First plugins** | `mod_resource`, `mod_url`, `mod_page`, `mod_label` (non-gradable — proves the contract cheaply) | Students open a course and consume content |
| **P3 — Adapters** | `mod_assign` over existing `Assignment`; `mod_forum` over existing `Discussion`; `HomeworkAssignment` → `mod_assign` migration + dual-read | Existing homework/discussion data appears as course modules; marks still land in the assessment spine |
| **P4 — Enrolment, groups, completion** | enrolment methods + roster sync, groups/groupings, `CourseModuleCompletion`, progress rollup into `StudentCourseProgress` | Course page shows per-activity ticks and a real progress bar |
| **P5 — Availability + gradebook views** | availability tree + evaluator + UI builder; grader report, user report, override, hide/lock, CSV in/out | "Release week 3 only after the week-2 quiz ≥ 50%" works end to end |
| **P6 — Quiz depth** | question categories/versions, slots incl. random, behaviours, overrides, review options, overall feedback | A randomised, immediate-feedback quiz with 2 attempts, highest counts |
| **P7 — Planning bridge + reports** | publish lesson plan → section/modules; plan-coverage report; `LmsEvent` reports; badges | HOD sees plan-vs-delivered coverage per offering |
| **P8 — Standards & scale** | `mod_scorm`, `mod_lti` 1.3, `mod_h5p` + xAPI, `mod_workshop`, `mod_lesson`, backup/restore, term rollover | Rollover clones a term's courses without user data |

---

## 8. Cross-cutting rules

1. **One truth per fact.** Marks → assessment spine. Attendance → attendance module.
   Schedule → timetable. The LMS *references*; it does not copy.
2. **The spine never switches on `activityType`.** Any `if (type === 'quiz')` outside a plugin
   folder is a bug.
3. **Capability + availability are server-side.** The client renders what the server says is
   permitted; it never decides.
4. **Every mutation emits an `LmsEvent`.** Written by the plugin base class, not by hand.
5. **Tenancy.** Every new table carries `organizationId` and is registered with the existing
   Prisma tenancy extension. Contexts are org-rooted; a path never crosses orgs.
6. **Soft delete** (`deletedAt`) on everything a teacher can delete; the course recycle bin is
   a filtered read, matching Moodle's behaviour.
7. **Idempotency.** Module publish, roster sync, rollover and grade fan-out all take an
   idempotency key — reuse the existing kernel primitive.

## 9. Explicit non-goals

- Pluggable blocks / themes / a plugin marketplace.
- Moodle `.mbz` file-format compatibility (our bundle is JSON; import-from-Moodle would be a
  separate converter, if ever).
- Guest access without an account.
- Replacing the timetable, attendance or fees modules with LMS equivalents.
