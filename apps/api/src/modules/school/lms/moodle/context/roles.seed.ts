import type { LmsContextLevel } from '@prisma/client';
import { CAP, ALL_CAPABILITIES } from '../capabilities';

export interface RoleArchetypeDef {
  shortname: string;
  name: string;
  archetype: string;
  sortOrder: number;
  assignableAt: LmsContextLevel[];
  /** Capabilities defaulted to `allow`. Manager takes every capability. */
  allow: string[];
}

const teacherManage = [
  CAP.courseView,
  CAP.courseManageActivities,
  CAP.courseViewHidden,
  CAP.courseViewParticipants,
  CAP.courseManageGroups,
  CAP.courseEnrol,
  CAP.courseViewReports,
  CAP.courseBackup,
  CAP.gradeView,
  CAP.gradeViewAll,
  CAP.gradeEdit,
  CAP.activityView,
  CAP.completionOverride,
  CAP.assignGrade,
  CAP.assignViewSubmissions,
  CAP.quizView,
  CAP.quizManage,
  CAP.quizGrade,
  CAP.quizPreview,
  CAP.forumView,
  CAP.forumStartDiscussion,
  CAP.forumReplyPost,
  CAP.forumManage,
  CAP.modView,
  CAP.modManage,
];

const studentDo = [
  CAP.courseView,
  CAP.activityView,
  CAP.gradeView,
  CAP.assignSubmit,
  CAP.quizView,
  CAP.quizAttempt,
  CAP.forumView,
  CAP.forumStartDiscussion,
  CAP.forumReplyPost,
  CAP.forumRate,
  CAP.modView,
  CAP.modSubmit,
];

/** The eight Moodle archetypes (ADR-014 §3.1). Seeded per organization, idempotently. */
export const ROLE_ARCHETYPES: RoleArchetypeDef[] = [
  {
    shortname: 'manager',
    name: 'Manager',
    archetype: 'manager',
    sortOrder: 1,
    assignableAt: ['organization', 'category', 'course'],
    allow: ALL_CAPABILITIES,
  },
  {
    shortname: 'coursecreator',
    name: 'Course creator',
    archetype: 'coursecreator',
    sortOrder: 2,
    assignableAt: ['organization', 'category'],
    allow: [CAP.courseView, CAP.courseManage, CAP.courseManageActivities, CAP.courseBackup, CAP.gradeViewAll],
  },
  {
    shortname: 'editingteacher',
    name: 'Teacher',
    archetype: 'editingteacher',
    sortOrder: 3,
    assignableAt: ['course', 'activity'],
    allow: [CAP.courseManage, ...teacherManage],
  },
  {
    shortname: 'teacher',
    name: 'Non-editing teacher',
    archetype: 'teacher',
    sortOrder: 4,
    assignableAt: ['course', 'activity'],
    allow: [
      CAP.courseView,
      CAP.courseViewParticipants,
      CAP.courseViewReports,
      CAP.gradeView,
      CAP.gradeViewAll,
      CAP.activityView,
      CAP.assignGrade,
      CAP.assignViewSubmissions,
      CAP.quizGrade,
      CAP.forumView,
      CAP.forumReplyPost,
      CAP.modView,
    ],
  },
  {
    shortname: 'student',
    name: 'Student',
    archetype: 'student',
    sortOrder: 5,
    assignableAt: ['course', 'activity'],
    allow: studentDo,
  },
  {
    shortname: 'parent',
    name: 'Parent / Guardian',
    archetype: 'parent',
    sortOrder: 6,
    assignableAt: ['course'],
    allow: [CAP.courseView, CAP.gradeView, CAP.activityView, CAP.forumView, CAP.modView],
  },
  {
    shortname: 'observer',
    name: 'Observer',
    archetype: 'observer',
    sortOrder: 7,
    assignableAt: ['organization', 'category', 'course'],
    allow: [CAP.courseView, CAP.activityView, CAP.gradeViewAll, CAP.courseViewReports, CAP.forumView, CAP.modView],
  },
  {
    shortname: 'guest',
    name: 'Guest',
    archetype: 'guest',
    sortOrder: 8,
    assignableAt: ['course'],
    allow: [CAP.courseView, CAP.activityView],
  },
];
