import { Link, useParams } from 'react-router-dom';
import {
  ArrowLeft, CheckCircle2, Circle, Clock, FileText, Lock,
} from 'lucide-react';
import { useAuthStore, useActiveStudent } from '@/stores/auth.store';
import { useCoursePage } from '@/lib/portal-api';
import type { CourseModuleView, CourseSectionView } from '@/lib/lms-types';
import { Card, CardContent, Skeleton, Empty, PageTitle, Badge } from '@/components/ui';
import { SafeHtml } from '@/components/safe-html';
import { courseListPath, modulePath, type PortalKind } from '@/lib/learner-paths';
import { activityLabel, activityIcon, formatDue } from './_activity';

/**
 * One course, as a learner (or a guardian reading over their shoulder).
 *
 * The server decides what belongs on this page: availability, completion and
 * the progress figure all arrive resolved for whoever is asking, and hidden
 * activities never appear in the payload at all. So this screen renders the
 * envelope and does no filtering of its own — any "should they see this?" logic
 * added here would be a second, weaker copy of a rule the API already applies.
 */
export default function StudentCourse() {
  const { id = '' } = useParams();
  const kind = useAuthStore((s) => s.portal?.kind);
  const active = useActiveStudent();
  // A pupil is their own subject and must not name one; a guardian must.
  const asStudent = kind === 'guardian' ? active?.studentProfileId : undefined;

  const { data, isLoading, isError, error, refetch } = useCoursePage(id, asStudent);
  const backTo = courseListPath(kind);

  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-28" />
        <Skeleton className="h-28" />
      </div>
    );
  }

  if (isError) {
    const status = (error as any)?.response?.status;
    return (
      <div className="space-y-3">
        <BackLink to={backTo} />
        <Empty
          title={status === 403 ? 'This course is not open to you' : 'This course could not be loaded'}
          hint={status === 404 ? 'It may have been removed.' : undefined}
        />
        {status !== 403 && status !== 404 && (
          <button className="text-sm text-primary underline" onClick={() => void refetch()}>
            Try again
          </button>
        )}
      </div>
    );
  }

  if (!data?.course) return <Empty title="This course could not be loaded" />;

  const { course, sections, progress } = data;
  const subtitle = [course.subject, course.className, course.term].filter(Boolean).join(' · ');

  return (
    <div className="space-y-4">
      <BackLink to={backTo} />
      <PageTitle sub={subtitle || undefined}>{course.name}</PageTitle>

      {course.summary && (
        <Card>
          <CardContent>
            <SafeHtml html={course.summary} />
          </CardContent>
        </Card>
      )}

      {progress && progress.tracked > 0 && (
        <Card>
          <CardContent className="space-y-2">
            <div className="flex items-baseline justify-between">
              <span className="text-sm font-medium">Your progress</span>
              <span className="text-sm tabular-nums text-muted-foreground">
                {progress.completed} of {progress.tracked} done
              </span>
            </div>
            <div
              className="h-2.5 w-full overflow-hidden rounded-full bg-muted"
              role="progressbar"
              aria-valuenow={progress.percent}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Course progress"
            >
              <div className="h-full rounded-full bg-primary" style={{ width: `${progress.percent}%` }} />
            </div>
          </CardContent>
        </Card>
      )}

      {sections.length === 0 ? (
        <Empty
          icon={<FileText className="h-8 w-8" />}
          title="Nothing has been added yet"
          hint="Your teacher has not put any work in this course so far."
        />
      ) : (
        sections.map((section) => (
          <Section key={section.id} section={section} courseId={course.id} kind={kind} />
        ))
      )}
    </div>
  );
}

function BackLink({ to }: { to: string }) {
  return (
    <Link to={to} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
      <ArrowLeft className="h-4 w-4" />
      Back
    </Link>
  );
}

function Section({
  section,
  courseId,
  kind,
}: {
  section: CourseSectionView;
  courseId: string;
  kind: PortalKind;
}) {
  const heading = section.name?.trim() || `Topic ${section.sectionNo}`;
  const blocked = section.availability && !section.availability.available;

  return (
    <section className="space-y-2">
      <div className="flex items-center gap-2 pt-1">
        <h2 className="text-base font-semibold">{heading}</h2>
        {blocked && (
          <Badge variant="outline" className="gap-1">
            <Lock className="h-3 w-3" />
            Locked
          </Badge>
        )}
      </div>

      {section.summary && (
        <Card>
          <CardContent className="py-3">
            <SafeHtml html={section.summary} />
          </CardContent>
        </Card>
      )}

      {/* The server sends the reason, which is the useful part: "available from
          Monday" tells a child what to do, "locked" does not. */}
      {blocked && section.availability!.reasons.length > 0 && (
        <p className="px-1 text-xs text-muted-foreground">{section.availability!.reasons.join(' · ')}</p>
      )}

      {section.modules.length === 0 ? (
        <p className="px-1 pb-2 text-sm text-muted-foreground">Nothing here yet.</p>
      ) : (
        <ul className="space-y-2">
          {section.modules.map((cm) => (
            <li key={cm.id}>
              <ActivityRow cm={cm} courseId={courseId} kind={kind} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ActivityRow({
  cm,
  courseId,
  kind,
}: {
  cm: CourseModuleView;
  courseId: string;
  kind: PortalKind;
}) {
  const Icon = activityIcon(cm.activityType);
  const locked = Boolean(cm.availability && !cm.availability.available);
  const done = Boolean(cm.completion && cm.completion.state !== 'incomplete');
  const due = formatDue(cm.dueAt);
  const overdue = Boolean(cm.dueAt && !done && new Date(cm.dueAt) < new Date());

  // `label` is a plain text row for mod_label: it is the content, not a link.
  if (cm.activityType === 'label') {
    return (
      <Card>
        <CardContent className="py-3">
          <SafeHtml html={cm.intro ?? cm.name} />
        </CardContent>
      </Card>
    );
  }

  const inner = (
    <Card className={locked ? 'opacity-60' : undefined}>
      <CardContent className="flex items-center gap-3 py-3">
        <Icon className="h-5 w-5 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{cm.name}</p>
          <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
            <span>{activityLabel(cm.activityType)}</span>
            {due && (
              <span className={overdue ? 'font-medium text-destructive' : undefined}>
                {overdue ? `Overdue — was due ${due}` : `Due ${due}`}
              </span>
            )}
          </p>
        </div>
        {locked ? (
          <Lock className="h-5 w-5 shrink-0 text-muted-foreground" aria-label="Locked" />
        ) : done ? (
          <CheckCircle2 className="h-5 w-5 shrink-0 text-[hsl(var(--success))]" aria-label="Done" />
        ) : cm.dueAt ? (
          <Clock className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
        ) : (
          <Circle className="h-5 w-5 shrink-0 text-muted-foreground/40" aria-hidden />
        )}
      </CardContent>
    </Card>
  );

  // A locked activity still shows, greyed, because knowing the work exists is
  // the point of a course outline — but it is not a link until it opens.
  if (locked) return inner;

  return (
    <Link to={modulePath(kind, courseId, cm.id)} className="block">
      {inner}
    </Link>
  );
}
