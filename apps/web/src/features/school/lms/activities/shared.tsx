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
