/**
 * Client mirror of the server's view envelope
 * (`apps/api/src/modules/school/lms/moodle/course/view-envelope.types.ts`).
 *
 * Keep the two in step. The whole point of the envelope is that the client
 * dispatches on `module.activityType` instead of sniffing the response shape,
 * so a drift here reintroduces the guessing it replaced.
 */

export interface ModuleAvailability {
  available: boolean;
  reasons: string[];
  greyed: boolean;
}

export type CompletionState = 'incomplete' | 'complete' | 'complete_pass' | 'complete_fail';

export interface ModuleCompletion {
  mode: 'none' | 'manual' | 'automatic';
  state: CompletionState;
  rules: Record<string, unknown>;
  overridden: boolean;
}

export interface ModuleGrade {
  assessmentId: string;
  maxScore: number;
  /** Null when the mark is not yet APPROVED. Never render null as a zero. */
  score: number | null;
  percentage: number | null;
  submissionStatus: string | null;
  released: boolean;
}

export interface CourseModuleView {
  id: string;
  activityType: string;
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

export interface CourseHeader {
  id: string;
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

export type ViewerKind = 'staff' | 'student' | 'guardian';

export interface CoursePageView {
  course: CourseHeader;
  sections: CourseSectionView[];
  capabilities: string[];
  progress: { completed: number; tracked: number; percent: number } | null;
  viewingAs: { kind: ViewerKind; studentProfileId: string | null };
}

export interface ModuleViewEnvelope<TBody = any> {
  module: CourseModuleView;
  course: Pick<CourseHeader, 'id' | 'name' | 'subject' | 'className' | 'term'>;
  capabilities: string[];
  viewingAs: { kind: ViewerKind; studentProfileId: string | null };
  audience: 'student' | 'teacher';
  body: TBody;
}

/** LMS capability strings the UI checks. Mirrors `moodle/capabilities.ts`. */
export const CAP = {
  courseManage: 'lms/course:manage',
  courseManageActivities: 'lms/course:manageactivities',
  courseViewHidden: 'lms/course:viewhiddenactivities',
  courseViewParticipants: 'lms/course:viewparticipants',
  courseViewReports: 'lms/course:viewreports',
  gradeView: 'lms/grade:view',
  gradeViewAll: 'lms/grade:viewall',
  gradeEdit: 'lms/grade:edit',
  completionOverride: 'lms/completion:override',
  assignSubmit: 'mod/assign:submit',
  assignGrade: 'mod/assign:grade',
  quizAttempt: 'mod/quiz:attempt',
  quizManage: 'mod/quiz:manage',
  forumStartDiscussion: 'mod/forum:startdiscussion',
  forumReplyPost: 'mod/forum:replypost',
} as const;

/** Does the caller hold this capability on the course in view? */
export function can(capabilities: string[] | undefined, capability: string): boolean {
  return Boolean(capabilities?.includes(capability));
}
