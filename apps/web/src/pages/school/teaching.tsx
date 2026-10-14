import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BookOpen, CalendarClock, CheckCircle2, ClipboardList, FileSpreadsheet, Send, Undo2 } from 'lucide-react';
import { useStaff, useTeacherOverview } from '@/features/school/api';
import { useMyStaffIdentity } from '@/features/hr/api';
import { useMyCourses } from '@/features/school/teaching-api';
import { courseLabel } from './teaching/workspace';
import { useAuthStore } from '@/stores/auth.store';
import { PERMISSIONS } from '@erp/shared';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState, Picker, Progress, useStickyState } from './_components/exam-workflow';

/**
 * The teacher workspace — one screen that answers "what do I need to do?".
 *
 * Five counts — what needs marking, which exam papers need entering, what's
 * due, what's awaiting approval and what came back. Picking a tile lists its
 * items below; each row deep-links to the screen that does the job. The counts
 * refresh on their own.
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
  const { data: overview, isLoading, isError } = useTeacherOverview(activeTeacher || undefined);
  // The course workspace (/school/teaching/:offeringId) is reached ONLY from
  // here — keep this list, or the plan/teach/close screens have no way in.
  const { data: myCourses = [] } = useMyCourses(canPickAnyTeacher && activeTeacher ? { teacherPartnerId: activeTeacher } : {});
  // One row per assessment, not per returned learner.
  const returned = useMemo(() => {
    const byAssessment = new Map<string, { assessmentId: string; title: string; subject: string; count: number }>();
    for (const r of overview?.returnedToMe ?? []) {
      const row = byAssessment.get(r.assessmentId);
      if (row) row.count += 1;
      else byAssessment.set(r.assessmentId, { assessmentId: r.assessmentId, title: r.title, subject: r.subject, count: 1 });
    }
    return [...byAssessment.values()];
  }, [overview]);
  const noAllocations = !!overview && overview.classes.length === 0 && myCourses.length === 0;

  const [view, setView] = useState<View>('mark');
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

      {noAllocations && (
        <EmptyState
          title="No classes allocated to you yet"
          hint="Nothing can be marked until you are allocated to a class and subject. Ask the academic office to add you under Academic Management → Teaching Allocation."
        />
      )}

      {overview && !noAllocations && (
        <>
          {/* Live to-do counts. Picking one lists its items below. */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <Tile label="To mark" value={totalToMark} icon={<ClipboardList className="h-4 w-4" />} tone="active" selected={view === 'mark'} onClick={() => setView('mark')} />
            <Tile label="Exam papers to enter" value={overview.examPapers.length} icon={<FileSpreadsheet className="h-4 w-4" />} tone="active" selected={view === 'exams'} onClick={() => setView('exams')} />
            <Tile label="Due this week" value={overview.dueSoon.length} icon={<CalendarClock className="h-4 w-4" />} tone="active" selected={view === 'due'} onClick={() => setView('due')} />
            <Tile label="Awaiting approval" value={overview.awaitingApproval} icon={<Send className="h-4 w-4" />} tone="muted" selected={view === 'approval'} onClick={() => setView('approval')} />
            <Tile label="Returned to me" value={returned.length} icon={<Undo2 className="h-4 w-4" />} tone="danger" selected={view === 'returned'} onClick={() => setView('returned')} />
          </div>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">{VIEW_TITLE[view]}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1.5">
              {view === 'mark' && (overview.needsMarking.length === 0 ? (
                <Done text="Nothing waiting to be marked." />
              ) : overview.needsMarking.map((m) => (
                <Row key={m.assessmentId} title={m.title} sub={m.subject}
                  right={<Badge>{m.count} to mark</Badge>}
                  onClick={() => navigate(`/school/assessments/${m.assessmentId}/mark`)} />
              )))}

              {view === 'exams' && (overview.examPapers.length === 0 ? (
                <Done text="All exam papers are entered." />
              ) : overview.examPapers.map((p) => (
                <Row key={p.examScheduleId} title={`${p.subject} · ${p.examName}`} sub=""
                  right={<Progress done={p.entered} total={p.total} />}
                  onClick={() => navigate('/school/enter-marks')} />
              )))}

              {view === 'due' && (overview.dueSoon.length === 0 ? (
                <Done text="Nothing due in the next week." />
              ) : overview.dueSoon.map((d) => (
                <Row key={d.assessmentId} title={d.title} sub={d.subject}
                  right={d.overdue
                    ? <Badge variant="destructive">Overdue</Badge>
                    : <span className="text-xs text-muted-foreground">{d.dueAt ? new Date(d.dueAt).toLocaleDateString() : ''}</span>}
                  onClick={() => navigate(`/school/assessments/${d.assessmentId}/mark`)} />
              )))}

              {/* The overview only carries a count here; the board lists them. */}
              {view === 'approval' && (overview.awaitingApproval === 0 ? (
                <Done text="Nothing is waiting for approval." />
              ) : (
                <div className="flex flex-wrap items-center justify-between gap-3 py-2 text-sm">
                  <span>{overview.awaitingApproval} mark(s) sent and waiting for approval.</span>
                  <Button size="sm" variant="outline" onClick={() => navigate('/school/assessments?status=submitted')}>
                    View on Assessment Board
                  </Button>
                </div>
              ))}

              {view === 'returned' && (returned.length === 0 ? (
                <Done text="Nothing was sent back." />
              ) : returned.map((r) => (
                <Row key={r.assessmentId} title={r.title} sub={r.subject}
                  right={<Badge variant="destructive">{r.count} returned</Badge>}
                  onClick={() => navigate(`/school/assessments/${r.assessmentId}/mark`)} />
              )))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base"><BookOpen className="h-4 w-4" /> My courses</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1.5">
              {myCourses.length === 0 ? (
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
              ) : myCourses.map((course) => (
                <Row
                  key={course.id}
                  title={courseLabel(course)}
                  sub={`${course.term?.name ?? ''} · ${course._count.courseEnrollments} learners`}
                  right={<span className="text-xs text-muted-foreground">Plan, teach &amp; mark →</span>}
                  onClick={() => navigate(`/school/teaching/${course.id}`)}
                />
              ))}
            </CardContent>
          </Card>
        </>
      )}

      {!isLoading && isError && (
        <EmptyState title="Couldn't load your teaching work" hint="The server didn't answer. Refresh the page; if it keeps happening, tell the system administrator." />
      )}
      {!isLoading && !isError && !overview && canPickAnyTeacher && (
        <EmptyState title="Pick a teacher" hint="Choose a teacher above to see their workspace." />
      )}
    </div>
  );
}

type View = 'mark' | 'exams' | 'due' | 'approval' | 'returned';

const VIEW_TITLE: Record<View, string> = {
  mark: 'Needs marking',
  exams: 'Exam papers to enter',
  due: 'Due this week',
  approval: 'Awaiting approval',
  returned: 'Returned to me',
};

function Tile({ label, value, icon, tone, selected, onClick }: {
  label: string; value: number; icon: React.ReactNode; tone: 'active' | 'danger' | 'muted'; selected: boolean; onClick: () => void;
}) {
  const color = tone === 'danger' && value > 0 ? 'text-destructive' : tone === 'active' && value > 0 ? 'text-primary' : '';
  return (
    <button type="button" onClick={onClick} aria-pressed={selected} className="text-left">
      <Card className={`h-full transition hover:border-primary ${selected ? 'border-primary ring-1 ring-primary' : ''}`}>
        <CardContent className="flex items-center justify-between pt-4">
          <div>
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className={`text-2xl font-semibold ${color}`}>{value}</p>
          </div>
          <div className="text-muted-foreground">{icon}</div>
        </CardContent>
      </Card>
    </button>
  );
}

function Row({ title, sub, right, onClick }: { title: string; sub: string; right: React.ReactNode; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex w-full items-center justify-between rounded-md border px-3 py-2 text-left text-sm transition hover:border-primary hover:bg-accent/40">
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
