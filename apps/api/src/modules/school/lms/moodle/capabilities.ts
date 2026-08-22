/**
 * LMS capability vocabulary (ADR-014 §3.1). Names mirror Moodle's so the mental
 * model transfers: `lms/course:*`, `lms/grade:*`, `mod/<type>:*`.
 *
 * Capabilities are the FINE authorization gate, resolved against the context tree
 * (LmsRoleAssignment × LmsRoleCapability × LmsCapabilityOverride). They are distinct
 * from the coarse `school:*` permissions checked by @RequirePermissions at the
 * controller edge — a caller needs both.
 */
export const CAP = {
  // Course-level
  courseView: 'lms/course:view',
  courseManage: 'lms/course:manage',
  courseManageActivities: 'lms/course:manageactivities',
  courseViewHidden: 'lms/course:viewhiddenactivities',
  courseViewParticipants: 'lms/course:viewparticipants',
  courseManageGroups: 'lms/course:managegroups',
  courseEnrol: 'lms/course:enrol',
  courseAssignRoles: 'lms/course:assignroles',
  courseViewReports: 'lms/course:viewreports',
  courseBackup: 'lms/course:backup',

  // Gradebook
  gradeView: 'lms/grade:view',
  gradeViewAll: 'lms/grade:viewall',
  gradeEdit: 'lms/grade:edit',

  // Activity-generic
  activityView: 'lms/activity:view',
  completionOverride: 'lms/completion:override',

  // mod/assign
  assignSubmit: 'mod/assign:submit',
  assignGrade: 'mod/assign:grade',
  assignViewSubmissions: 'mod/assign:viewsubmissions',

  // mod/quiz
  quizView: 'mod/quiz:view',
  quizAttempt: 'mod/quiz:attempt',
  quizManage: 'mod/quiz:manage',
  quizGrade: 'mod/quiz:grade',
  quizPreview: 'mod/quiz:preview',

  // mod/forum
  forumView: 'mod/forum:view',
  forumStartDiscussion: 'mod/forum:startdiscussion',
  forumReplyPost: 'mod/forum:replypost',
  forumRate: 'mod/forum:rate',
  forumManage: 'mod/forum:manage',

  // mod/choice, feedback, wiki, glossary, workshop, lesson, scorm, lti, h5p — view/submit/manage
  modView: 'mod/activity:view',
  modSubmit: 'mod/activity:submit',
  modManage: 'mod/activity:manage',
} as const;

export type Capability = (typeof CAP)[keyof typeof CAP];

/** Every capability, for boot-time validation and role seeding. */
export const ALL_CAPABILITIES: string[] = Array.from(new Set(Object.values(CAP)));
