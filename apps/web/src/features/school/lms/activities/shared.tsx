import type { FC } from 'react';
import {
  BarChart, BookA, BookOpen, CalendarCheck, ClipboardList, ExternalLink, File, FileText,
  Folder, GraduationCap, Link as LinkIcon, ListChecks, MessageSquare, MessagesSquare,
  Package, Puzzle, Type, Users, type LucideIcon,
} from 'lucide-react';
import type { CourseModuleView, ModuleViewEnvelope } from '../types';

/**
 * The activity UI plugin contract (ADR-014 §6), mirroring the backend
 * `ActivityPlugin`. One entry per activity type; the course page and the activity
 * page never switch on `activityType` themselves — they look it up here.
 */
export interface ActivityUiPlugin {
  type: string;
  label: string;
  icon: LucideIcon;
  /** Rendered on the course page under the activity row, when it has something to add. */
  Card?: FC<{ cm: CourseModuleView }>;
  /** The learner's view of the activity. */
  StudentView: FC<ActivityViewProps>;
  /** The teacher's view: submissions, attempts, moderation. */
  TeacherView: FC<ActivityViewProps>;
}

export interface ActivityViewProps {
  view: ModuleViewEnvelope;
  /** Run a plugin verb (`submit`, `startDiscussion`, …) and refresh. */
  run: (action: string, dto?: Record<string, unknown>) => Promise<void>;
  busy: boolean;
}

/** Icon per activity type, shared by the palette, the course rows and the shell. */
export const ACTIVITY_ICONS: Record<string, LucideIcon> = {
  page: File,
  resource: FileText,
  url: LinkIcon,
  label: Type,
  folder: Folder,
  assign: ClipboardList,
  quiz: ListChecks,
  forum: MessagesSquare,
  choice: BarChart,
  glossary: BookA,
  wiki: BookOpen,
  lesson: GraduationCap,
  feedback: MessageSquare,
  workshop: Users,
  scorm: Package,
  lti: ExternalLink,
  h5p: Puzzle,
  attendance: CalendarCheck,
};

export function iconFor(type: string): LucideIcon {
  return ACTIVITY_ICONS[type] ?? File;
}

/** "Due Fri 5 Sep, 16:00" — or null when the activity has no deadline. */
export function formatDue(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString(undefined, {
    weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}

/** Past the deadline, and the student has not submitted. */
export function isOverdue(cm: CourseModuleView): boolean {
  if (!cm.dueAt) return false;
  if (cm.grade?.submissionStatus && cm.grade.submissionStatus !== 'assigned') return false;
  return new Date(cm.dueAt).getTime() < Date.now();
}

/**
 * One-line "what is this for" per activity type, plus the Moodle-style grouping
 * the activity chooser lays out.
 *
 * A palette of 18 bare labels forces a teacher to guess what "Lesson" or "H5P"
 * does; the chooser shows this text next to each tile so the choice is readable
 * rather than remembered. Keep an entry here for every registered type — an
 * unlisted type still appears, under "Other", with no blurb.
 */
export const ACTIVITY_GROUP: Record<string, 'Content' | 'Activities' | 'Collaboration' | 'External'> = {
  page: 'Content', resource: 'Content', url: 'Content', label: 'Content', folder: 'Content', lesson: 'Content',
  assign: 'Activities', quiz: 'Activities', choice: 'Activities', feedback: 'Activities', attendance: 'Activities',
  forum: 'Collaboration', wiki: 'Collaboration', glossary: 'Collaboration', workshop: 'Collaboration',
  scorm: 'External', lti: 'External', h5p: 'External',
};

export const ACTIVITY_BLURB: Record<string, string> = {
  page: 'A single formatted web page of notes, images or embedded media.',
  resource: 'A file pupils download — a worksheet, PDF or slide deck.',
  url: 'A link out to a website, kept alongside the rest of the course.',
  label: 'A heading or note placed between activities to break the page up.',
  folder: 'A set of files shown as one collapsible item.',
  lesson: 'Branching pages with questions that decide what a pupil sees next.',
  assign: 'Work handed in online — text, files or both — then marked and fed back.',
  quiz: 'Auto-marked questions drawn from the question bank, with attempts and timing.',
  choice: 'A single question with options; use it for a quick poll or a sign-up.',
  feedback: 'An anonymous or named survey with your own questions.',
  attendance: 'Register-taking attached to the course rather than the timetable.',
  forum: 'Threaded discussion. Announcements, Q&A, or open debate.',
  wiki: 'Pages the class edits together, with a history of every change.',
  glossary: 'A shared list of terms and definitions pupils can add to.',
  workshop: 'Peer assessment: pupils submit, then mark each other against criteria.',
  scorm: 'A packaged SCORM course that reports its own completion and score.',
  lti: 'An external tool launched with LTI 1.3; grades come back automatically.',
  h5p: 'Interactive content — drag-and-drop, hotspots, interactive video.',
};

export function blurbFor(type: string): string | null {
  return ACTIVITY_BLURB[type] ?? null;
}

export function groupFor(type: string): string {
  return ACTIVITY_GROUP[type] ?? 'Other';
}
