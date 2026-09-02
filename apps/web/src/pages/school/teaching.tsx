import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  BookOpen, CalendarClock, CheckCircle2, ClipboardList,
  FileSpreadsheet, GraduationCap, Send, Undo2,
} from 'lucide-react';
import { useStaff, useTeacherOverview } from '@/features/school/api';
import { useMyCourses } from '@/features/school/teaching-api';
import { courseLabel } from './teaching/workspace';
import { useMyStaffIdentity } from '@/features/hr/api';
import { useAuthStore } from '@/stores/auth.store';
import { PERMISSIONS } from '@erp/shared';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { EmptyState, Picker, Progress, useStickyState } from './_components/exam-workflow';

/**
 * The teacher workspace — one screen that answers "what do I need to do?".
 *
 * Where My Marking made a teacher pick a term, class and subject before showing
 * anything, this leads with the work: what needs marking, what's due, what came
 * back, which exam papers still need entering. Every row deep-links to the one
 * screen that does the job.
 */
export function SchoolTeachingPage() {
  const navigate = useNavigate();
  const { data: staff } = useStaff();
  const teachers = useMemo(
    () => (staff?.data ?? []).filter((s) => (s as any).staffCategory !== 'non_teaching'),
    [staff],
  );
  // Who AM I? The server resolves this from the session; teacher-scoped
  // endpoints reject any other id unless the caller is an admin.
  const { data: me } = useMyStaffIdentity();
  const canPickAnyTeacher = useAuthStore((s) => s.hasPermission(PERMISSIONS.school.manageStaff));

  const [teacherId, setTeacherId] = useStickyState('teaching.teacherId');
  // A teacher always sees THEIR OWN workspace. Only an admin may look at
  // someone else's, and only then does the picker appear.
  const activeTeacher = canPickAnyTeacher
    ? teacherId || me?.staffProfileId || teachers[0]?.id || ''
    : me?.staffProfileId || '';
  const { data: overview, isLoading } = useTeacherOverview(activeTeacher || undefined);
  const { data: myCourses = [] } = useMyCourses(canPickAnyTeacher && activeTeacher ? { teacherPartnerId: activeTeacher } : {});

  const totalToMark = overview?.needsMarking.reduce((n, m) => n + m.count, 0) ?? 0;

  return (
    <div className="space-y-4 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">My Teaching</h1>
          <p className="text-sm text-muted-foreground">Everything waiting on you, in one place.</p>
        </div>
        {canPickAnyTeacher && (
          <div className="min-w-[220px]">
            <Picker
              label="Teacher"
              value={activeTeacher}
              onChange={setTeacherId}
              options={teachers.map((t) => ({ value: t.id, label: t.partner?.name ?? (t as any).employeeNo ?? t.id }))}
              className=""
            />
          </div>
        )}
      </div>

      {!activeTeacher && !canPickAnyTeacher && (
        <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
          Your login is not linked to a staff record yet, so there is no teaching
          workspace to show. An administrator can link it under
          Human Resource &rarr; Record Reconciliation.
        </div>
      )}

      {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}

      {overview && (
        <>
          {/* Summary tiles */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Tile label="To mark" value={totalToMark} icon={<ClipboardList className="h-4 w-4" />} tone={totalToMark > 0 ? 'active' : 'muted'} />
            <Tile label="Due this week" value={overview.dueSoon.length} icon={<CalendarClock className="h-4 w-4" />} tone="muted" />
            <Tile label="Awaiting approval" value={overview.awaitingApproval} icon={<Send className="h-4 w-4" />} tone="muted" />
            <Tile label="Returned to me" value={overview.returnedToMe.length} icon={<Undo2 className="h-4 w-4" />} tone={overview.returnedToMe.length > 0 ? 'danger' : 'muted'} />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            {/* Needs marking */}
            <Panel title="Needs marking" icon={<ClipboardList className="h-4 w-4" />}>
              {overview.needsMarking.length === 0 ? (
                <Done text="Nothing waiting to be marked." />
              ) : (
                overview.needsMarking.map((m) => (
                  <Row
                    key={m.assessmentId}
                    title={m.title}
                    sub={m.subject}
                    right={<Badge>{m.count} to mark</Badge>}
                    onClick={() => navigate(`/school/assessments/${m.assessmentId}/mark`)}
                  />
                ))
              )}
            </Panel>

            {/* Exam papers to enter */}
            <Panel title="Exam papers to enter" icon={<FileSpreadsheet className="h-4 w-4" />}>
              {overview.examPapers.length === 0 ? (
                <Done text="All exam papers are entered." />
              ) : (
                overview.examPapers.map((p) => (
                  <Row
                    key={p.examScheduleId}
                    title={`${p.subject} · ${p.examName}`}
                    sub=""
                    right={<Progress done={p.entered} total={p.total} />}
                    onClick={() => navigate('/school/enter-marks')}
                  />
                ))
              )}
            </Panel>

            {/* Due soon */}
            <Panel title="Due this week" icon={<CalendarClock className="h-4 w-4" />}>
              {overview.dueSoon.length === 0 ? (
                <Done text="Nothing due in the next week." />
              ) : (
                overview.dueSoon.map((d) => (
                  <Row
                    key={d.assessmentId}
                    title={d.title}
                    sub={d.subject}
                    right={d.overdue ? <Badge variant="destructive">Overdue</Badge> : <span className="text-xs text-muted-foreground">{d.dueAt ? new Date(d.dueAt).toLocaleDateString() : ''}</span>}
                    onClick={() => navigate('/school/gradebook')}
                  />
                ))
              )}
            </Panel>

            {/* Returned to me */}
            <Panel title="Returned to me" icon={<Undo2 className="h-4 w-4" />}>
              {overview.returnedToMe.length === 0 ? (
                <Done text="Nothing was sent back." />
              ) : (
                overview.returnedToMe.map((r) => (
                  <Row
                    key={r.studentAssessmentId}
                    title={r.title}
                    sub={r.subject}
                    right={<Badge variant="destructive">Rejected</Badge>}
                    onClick={() => navigate(`/school/assessments/${r.assessmentId}/mark`)}
                  />
                ))
              )}
            </Panel>
          </div>

          {/* My classes + lesson plans */}
          <div className="grid gap-4 lg:grid-cols-2">
            {/*
              My courses, not "my classes": Phase 3 gives every teaching
              relationship a course offering, and the workspace behind each one
              is where a week is planned, taught and closed.
            */}
            <Panel title="My courses" icon={<BookOpen className="h-4 w-4" />}>
              {myCourses.length === 0 ? (
                overview.classes.length === 0 ? (
                  <EmptyState title="No courses allocated" hint="Ask an admin to allocate you on a course offering." />
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {overview.classes.map((c) => (
                      <button
                        key={`${c.classId}:${c.subjectId}`}
                        onClick={() => navigate('/school/gradebook')}
                        className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent"
                      >
                        {c.className} · {c.subjectName}
                      </button>
                    ))}
                  </div>
                )
              ) : (
                <div className="space-y-1.5">
                  {myCourses.map((course) => (
                    <Row
                      key={course.id}
                      title={courseLabel(course)}
                      sub={`${course.term?.name ?? ''} · ${course._count.courseEnrollments} learners`}
                      right={<Badge variant="secondary">{course.status}</Badge>}
                      onClick={() => navigate(`/school/teaching/${course.id}`)}
                    />
                  ))}
                </div>
              )}
            </Panel>

            <Panel title="Lesson plans" icon={<GraduationCap className="h-4 w-4" />}>
              <div className="flex gap-3">
                <MiniStat label="Draft" value={overview.lessonPlans.draft} />
                <MiniStat label="Submitted" value={overview.lessonPlans.submitted} />
                <MiniStat label="Approved" value={overview.lessonPlans.approved} />
                <Button size="sm" variant="ghost" className="ml-auto self-center" onClick={() => navigate('/school/lms/lesson-plans')}>
                  Open
                </Button>
              </div>
            </Panel>
          </div>
        </>
      )}

      {!isLoading && !overview && (
        <EmptyState title="Pick a teacher" hint="Choose a teacher above to see their workspace." />
      )}
    </div>
  );
}

function Tile({ label, value, icon, tone }: { label: string; value: number; icon: React.ReactNode; tone: 'active' | 'danger' | 'muted' }) {
  const color = tone === 'danger' && value > 0 ? 'text-destructive' : tone === 'active' && value > 0 ? 'text-primary' : '';
  return (
    <Card>
      <CardContent className="flex items-center justify-between pt-4">
        <div>
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className={`text-2xl font-semibold ${color}`}>{value}</p>
        </div>
        <div className="text-muted-foreground">{icon}</div>
      </CardContent>
    </Card>
  );
}

function Panel({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">{icon} {title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-1.5">{children}</CardContent>
    </Card>
  );
}

function Row({ title, sub, right, onClick }: { title: string; sub: string; right: React.ReactNode; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex w-full items-center justify-between rounded-md border px-3 py-2 text-left text-sm transition hover:border-primary hover:bg-accent/40">
      <div className="min-w-0">
        <div className="truncate font-medium">{title}</div>
        {sub && <div className="truncate text-xs text-muted-foreground">{sub}</div>}
      </div>
      <div className="ml-2 shrink-0">{right}</div>
    </button>
  );
}

function Done({ text }: { text: string }) {
  return (
    <p className="flex items-center gap-2 py-3 text-sm text-muted-foreground">
      <CheckCircle2 className="h-4 w-4 text-emerald-600" /> {text}
    </p>
  );
}

function MiniStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border px-3 py-1.5 text-center">
      <div className="text-lg font-semibold">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}
