/**
 * The envelope every activity view and course-page row is wrapped in (L1.1).
 *
 * Why this exists: `module.service.view()` used to return the plugin's raw payload
 * with no discriminator, so the web client had to guess the activity type by
 * duck-typing the response shape —
 *
 *   if (view.discussions !== undefined) return 'forum';
 *   if (view.slotCount !== undefined) return 'quiz';
 *
 * — and fell back to dumping `JSON.stringify(view)` on screen for every type it
 * could not recognise. With a stable envelope the client dispatches on
 * `module.activityType` and renders a real component, and common chrome (title,
 * due date, grade, completion tick, availability reason) is rendered once by the
 * shell rather than reimplemented per activity.
 *
 * `capabilities` is the other half: the server states what this caller may do and
 * the client renders accordingly. The client never decides permission.
 */

export interface ModuleAvailability {
  available: boolean;
  /** Human-readable unmet criteria, e.g. "Not available until 1 September". */
  reasons: string[];
  /** Show it greyed with the reason, rather than hiding it entirely. */
  greyed: boolean;
}

export interface ModuleCompletion {
  mode: 'none' | 'manual' | 'automatic';
  state: 'incomplete' | 'complete' | 'complete_pass' | 'complete_fail';
  /** Rule keys the plugin evaluates, so the UI can explain what is required. */
  rules: Record<string, unknown>;
  overridden: boolean;
}

export interface ModuleGrade {
  assessmentId: string;
  maxScore: number;
  /**
   * Null until the mark is APPROVED through moderation — not merely entered.
   * Null also means "not released", never "scored zero"; the UI must say so.
   * Per-activity feedback is not here: it belongs to the plugin body, which is
   * where the submission and its teacher comment live.
   */
  score: number | null;
  percentage: number | null;
  /** Where the student's work stands: assigned | submitted | graded | … */
  submissionStatus: string | null;
  released: boolean;
}

/** One activity as it appears in a section list. Enough to render a card, no more. */
export interface CourseModuleView {
  id: string;
  activityType: string;
  /** Resolved from the plugin's instance row — CourseModule has no name column. */
  name: string;
  intro: string | null;
  icon: string;
  visible: boolean;
  sectionId: string;
  sequence: number;
  openAt: string | null;
  dueAt: string | null;
  cutoffAt: string | null;
  gradable: boolean;
  availability: ModuleAvailability | null;
  completion: ModuleCompletion | null;
  grade: ModuleGrade | null;
}

export interface CourseSectionView {
  id: string;
  sectionNo: number;
  name: string | null;
  summary: string | null;
  visible: boolean;
  weekOf: string | null;
  availability: ModuleAvailability | null;
  modules: CourseModuleView[];
}

/** Identity of the course itself, composed for display. */
export interface CourseHeader {
  id: string;
  /** e.g. "Mathematics — S2 Blue (Term 1)". CourseOffering has no name column. */
  name: string;
  subject: string | null;
  className: string | null;
  term: string | null;
  academicYear: string | null;
  format: string;
  summary: string | null;
  visible: boolean;
  completionEnabled: boolean;
  showGradesToStudents: boolean;
  startDate: string | null;
  endDate: string | null;
}

export interface CoursePageView {
  course: CourseHeader;
  sections: CourseSectionView[];
  /** Effective capabilities for the caller. Drives every affordance in the UI. */
  capabilities: string[];
  /** Present when the caller is (or is viewing as) a student. */
  progress: { completed: number; tracked: number; percent: number } | null;
  viewingAs: { kind: 'staff' | 'student' | 'guardian'; studentProfileId: string | null };
}

/** A single activity page: common chrome plus the plugin's own payload. */
export interface ModuleViewEnvelope<TBody = unknown> {
  module: CourseModuleView;
  course: Pick<CourseHeader, 'id' | 'name' | 'subject' | 'className' | 'term'>;
  capabilities: string[];
  viewingAs: { kind: 'staff' | 'student' | 'guardian'; studentProfileId: string | null };
  /** Which of the plugin's two views produced `body`. */
  audience: 'student' | 'teacher';
  body: TBody;
}
