/**
 * Where the course screens live for each audience.
 *
 * The learner's course page and activity page are the same components for a
 * pupil and for a guardian reading their child's work, but they cannot share
 * one URL: `RequireAudience` keeps a guardian out of `/student/*` entirely. So
 * both trees mount the same lazy components and every link is built from here
 * rather than hard-coded, which is what stopped a guardian's "open the course"
 * link bouncing them back to their own landing page.
 *
 * Sitting a quiz has no guardian path on purpose — the API refuses it, so there
 * is no screen to send them to.
 */

export type PortalKind = 'student' | 'guardian' | 'staff' | undefined;

function base(kind: PortalKind): string {
  return kind === 'guardian' ? '/parent/learning' : '/student/courses';
}

/** The list a "back" link should return to. */
export function courseListPath(kind: PortalKind): string {
  return kind === 'guardian' ? '/parent/learning' : '/student/courses';
}

export function coursePath(kind: PortalKind, courseId: string): string {
  return kind === 'guardian' ? `${base(kind)}/courses/${courseId}` : `${base(kind)}/${courseId}`;
}

export function modulePath(kind: PortalKind, courseId: string, moduleId: string): string {
  return `${coursePath(kind, courseId)}/modules/${moduleId}`;
}

/** Only a pupil sits a quiz. */
export function quizPath(moduleId: string): string {
  return `/student/quiz/${moduleId}`;
}
