/**
 * Portal mirror of the server's LMS view envelope
 * (`apps/api/src/modules/school/lms/moodle/course/view-envelope.types.ts`).
 *
 * Copied rather than imported from the admin app: the two apps are separate
 * builds with deliberately different dependency sets, and `@erp/shared` carries
 * no view types. Keep all three in step — the point of the envelope is that the
 * client dispatches on `module.activityType` instead of sniffing the response
 * shape, so drift here reintroduces the guessing it replaced.
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
  /**
   * Null when the mark has not been APPROVED. Never render null as a zero —
   * "not released yet" and "scored nothing" must stay visually distinct, which
   * is the whole reason the server withholds it rather than sending 0.
   */
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

/** LMS capability strings this app checks. Mirrors `moodle/capabilities.ts`. */
export const CAP = {
  assignSubmit: 'mod/assign:submit',
  quizAttempt: 'mod/quiz:attempt',
  forumReplyPost: 'mod/forum:replypost',
  forumStartDiscussion: 'mod/forum:startdiscussion',
} as const;

/** Does the caller hold this capability on the course in view? */
export function can(capabilities: string[] | undefined, capability: string): boolean {
  return Boolean(capabilities?.includes(capability));
}

/**
 * How a mark reads to a learner or guardian.
 *
 * Centralised so no screen can accidentally render an unreleased mark as a
 * blank or a zero (LMS_DEPLOYMENT_READINESS.md §4).
 */
export function describeGrade(grade: ModuleGrade | null | undefined):
  | { kind: 'none' }
  | { kind: 'withheld' }
  | { kind: 'scored'; label: string; percent: number | null } {
  if (!grade) return { kind: 'none' };
  if (grade.score === null) return { kind: 'withheld' };
  return {
    kind: 'scored',
    label: `${grade.score} / ${grade.maxScore}`,
    percent: grade.percentage,
  };
}
