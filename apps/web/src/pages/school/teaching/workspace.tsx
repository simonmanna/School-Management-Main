import { useEffect } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, BookMarked, CalendarRange, ClipboardList, GraduationCap, LayoutDashboard, Users } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useMyCourses, useWorkspaceOverview } from '@/features/school/teaching-api';
import { EmptyState, Picker, useStickyState } from '../_components/exam-workflow';
import { OverviewTab } from './overview-tab';
import { PlanTab } from './plan-tab';
import { LessonsTab } from './lessons-tab';
import { AssessmentsTab } from './assessments-tab';
import { MarkbookTab } from './markbook-tab';
import { LearnersTab } from './learners-tab';

const TABS = [
  { value: 'overview', label: 'Overview', icon: LayoutDashboard },
  { value: 'plan', label: 'Plan', icon: BookMarked },
  { value: 'lessons', label: 'Lessons', icon: CalendarRange },
  { value: 'assessments', label: 'Assessments', icon: ClipboardList },
  { value: 'markbook', label: 'Markbook', icon: GraduationCap },
  { value: 'learners', label: 'Learners', icon: Users },
] as const;

export function courseLabel(course: { name: string; subject?: { name: string } | null; classCohort?: { schoolClass?: { name: string } } | null; section?: { name: string } | null; stream?: { name: string } | null }) {
  const where = [course.classCohort?.schoolClass?.name, course.section?.name, course.stream?.name].filter(Boolean).join(' · ');
  return where ? `${course.subject?.name ?? course.name} — ${where}` : course.subject?.name ?? course.name;
}

/**
 * One course, one screen.
 *
 * The exit gate for Phase 3 is that a teacher completes a week — timetable to
 * delivery to evidence to follow-up — without leaving this workspace, so every
 * tab acts in place rather than sending the teacher off to a settings page.
 */
export function SchoolTeachingWorkspacePage() {
  const { offeringId } = useParams();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') ?? 'overview';

  const { data: courses = [], isLoading: loadingCourses } = useMyCourses();
  const { data: overview, isLoading, error } = useWorkspaceOverview(offeringId);
  const [, setLastCourse] = useStickyState('teaching.lastCourse');

  useEffect(() => {
    if (offeringId) setLastCourse(offeringId);
  }, [offeringId, setLastCourse]);

  if (!offeringId) {
    return (
      <div className="space-y-4 p-6">
        <h1 className="text-xl font-semibold">My teaching</h1>
        {loadingCourses ? (
          <p className="text-sm text-muted-foreground">Loading your courses…</p>
        ) : courses.length === 0 ? (
          <EmptyState title="No courses allocated" hint="You are not the responsible teacher on any active course offering yet." />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {courses.map((course) => (
              <button
                key={course.id}
                onClick={() => navigate(`/school/teaching/${course.id}`)}
                className="rounded-lg border p-4 text-left transition hover:border-primary hover:bg-accent/40"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="font-medium">{courseLabel(course)}</div>
                  <Badge variant="secondary">{course.status}</Badge>
                </div>
                <div className="mt-1 text-xs text-muted-foreground">{course.term?.name} · {course.code}</div>
                <div className="mt-3 flex gap-3 text-xs text-muted-foreground">
                  <span>{course._count.courseEnrollments} learners</span>
                  <span>{course._count.lessonPlans} plans</span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  const offering = overview?.offering;

  return (
    <div className="space-y-4 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Button variant="ghost" size="sm" className="-ml-2 mb-1 h-7 px-2 text-xs" onClick={() => navigate('/school/teaching')}>
            <ArrowLeft className="mr-1 h-3 w-3" /> All my courses
          </Button>
          <h1 className="truncate text-xl font-semibold">{offering?.name ?? 'Course workspace'}</h1>
          <p className="text-sm text-muted-foreground">
            {[offering?.subject, offering?.className, offering?.section, offering?.stream].filter(Boolean).join(' · ')}
            {offering ? ` · ${offering.term.name}` : ''}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {offering && <Badge variant="secondary">{offering.status}</Badge>}
          {courses.length > 1 && (
            <div className="min-w-[240px]">
              <Picker
                label="Course"
                value={offeringId}
                onChange={(id) => navigate(`/school/teaching/${id}?tab=${tab}`)}
                options={courses.map((c) => ({ value: c.id, label: courseLabel(c) }))}
                className=""
              />
            </div>
          )}
        </div>
      </div>

      {error && (
        <EmptyState
          title="This course is not yours to open"
          hint="You can only open a course you are allocated to teach. Ask an administrator to allocate you on the course offering."
        />
      )}

      {!error && (
        <Tabs value={tab} onValueChange={(value) => setParams({ tab: value }, { replace: true })}>
          <TabsList className="flex-wrap">
            {TABS.map(({ value, label, icon: Icon }) => (
              <TabsTrigger key={value} value={value} className="gap-1.5">
                <Icon className="h-3.5 w-3.5" /> {label}
              </TabsTrigger>
            ))}
          </TabsList>

          <TabsContent value="overview" className="mt-4">
            <OverviewTab offeringId={offeringId} overview={overview} isLoading={isLoading} onGoTo={(t) => setParams({ tab: t }, { replace: true })} />
          </TabsContent>
          <TabsContent value="plan" className="mt-4">
            <PlanTab offeringId={offeringId} />
          </TabsContent>
          <TabsContent value="lessons" className="mt-4">
            <LessonsTab offeringId={offeringId} />
          </TabsContent>
          <TabsContent value="assessments" className="mt-4">
            <AssessmentsTab offeringId={offeringId} />
          </TabsContent>
          <TabsContent value="markbook" className="mt-4">
            <MarkbookTab offeringId={offeringId} />
          </TabsContent>
          <TabsContent value="learners" className="mt-4">
            <LearnersTab offeringId={offeringId} />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
