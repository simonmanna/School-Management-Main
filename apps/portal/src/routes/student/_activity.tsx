import {
  BarChart, BookA, BookOpen, CalendarCheck, ClipboardList, ExternalLink, File, FileText,
  Folder, GraduationCap, Link as LinkIcon, ListChecks, MessageSquare, MessagesSquare,
  Package, Puzzle, Type, Users, type LucideIcon,
} from 'lucide-react';

/**
 * Activity presentation shared by the learner's course page and activity page.
 *
 * The icon table mirrors the admin app's
 * (`apps/web/src/features/school/lms/activities/shared.tsx`) so an activity
 * looks the same to a teacher and to the child doing it. The labels are the
 * learner-facing wording — a pupil is told "Homework", not "mod_assign".
 */

const ICONS: Record<string, LucideIcon> = {
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

const LABELS: Record<string, string> = {
  page: 'Lesson page',
  resource: 'File to download',
  url: 'Link',
  label: 'Note',
  folder: 'Files',
  assign: 'Homework',
  quiz: 'Quiz',
  forum: 'Discussion',
  choice: 'Quick question',
  glossary: 'Word list',
  wiki: 'Class pages',
  lesson: 'Guided lesson',
  feedback: 'Survey',
  workshop: 'Peer marking',
  scorm: 'Activity',
  lti: 'External activity',
  h5p: 'Interactive activity',
  attendance: 'Register',
};

export function activityIcon(type: string): LucideIcon {
  return ICONS[type] ?? File;
}

export function activityLabel(type: string): string {
  return LABELS[type] ?? 'Activity';
}

/** "Fri 5 Sep, 16:00" — or null when the activity has no deadline. */
export function formatDue(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}
