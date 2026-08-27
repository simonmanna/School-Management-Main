import { CheckCircle2, Clock, ListChecks, Play, Settings2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { SafeHtml } from '@/components/ui/safe-html';
import { can, CAP } from '../types';
import type { ActivityUiPlugin, ActivityViewProps } from './shared';
import { formatDue, iconFor } from './shared';
import { GradePanel } from './assign';

/**
 * mod_quiz — the landing page for a quiz.
 *
 * The attempt itself runs in the dedicated runner (`/school/lms/quiz/:id/attempt`)
 * over the existing CBT engine; this page is the summary, attempt history and
 * entry point, mirroring Moodle's quiz view.
 */
function QuizStudent({ view }: ActivityViewProps) {
  const nav = useNavigate();
  const inst = view.body?.instance ?? {};
  const attempts: any[] = view.body?.attempts ?? [];
  const slotCount: number = view.body?.slotCount ?? 0;
  const allowed: number = Number(inst.attemptsAllowed ?? 0); // 0 = unlimited
  const used = attempts.length;
  const exhausted = allowed > 0 && used >= allowed;

  const now = Date.now();
  const notOpen = inst.openAt && new Date(inst.openAt).getTime() > now;
  const closed = inst.closeAt && new Date(inst.closeAt).getTime() < now;
  const mayAttempt =
    can(view.capabilities, CAP.quizAttempt) &&
    view.viewingAs.kind === 'student' &&
    !exhausted && !notOpen && !closed;

  return (
    <div className="space-y-4">
      {inst.intro && (
        <Card><CardContent className="py-5">
          <SafeHtml className="prose prose-sm dark:prose-invert max-w-none" html={inst.intro} />
        </CardContent></Card>
      )}

      <Card>
        <CardContent className="grid gap-3 py-5 sm:grid-cols-2 lg:grid-cols-4">
          <Fact label="Questions" value={slotCount || '—'} />
          <Fact label="Time limit" value={inst.timeLimitSec ? `${Math.round(inst.timeLimitSec / 60)} min` : 'None'} />
          <Fact label="Attempts allowed" value={allowed > 0 ? allowed : 'Unlimited'} />
          <Fact label="Grading" value={String(inst.gradingMethod ?? 'highest')} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between py-3">
          <CardTitle className="text-base">Your attempts</CardTitle>
          {inst.closeAt && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <Clock className="h-3.5 w-3.5" />Closes {formatDue(inst.closeAt)}
            </span>
          )}
        </CardHeader>
        <CardContent className="space-y-3">
          {attempts.length === 0 ? (
            <p className="text-sm text-muted-foreground">No attempts yet.</p>
          ) : (
            <ul className="divide-y rounded-md border">
              {attempts.map((a) => (
                <li key={a.id} className="flex items-center gap-3 p-3 text-sm">
                  <span className="w-20 text-muted-foreground">Attempt {a.attemptNumber}</span>
                  <Badge variant={a.status === 'submitted' ? 'secondary' : 'outline'} className="text-[10px]">{a.status}</Badge>
                  <span className="flex-1" />
                  {/* An attempt still awaiting human marking has no final score;
                      the backend refuses to publish one, so nor do we. */}
                  {a.manualPending > 0 ? (
                    <span className="text-xs text-muted-foreground">Awaiting marking</span>
                  ) : a.autoScore != null ? (
                    <span className="tabular-nums">{Number(a.autoScore)}</span>
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </li>
              ))}
            </ul>
          )}

          {mayAttempt ? (
            <Button onClick={() => nav(`/school/lms/quiz/${view.module.id}/attempt`)}>
              <Play className="mr-1 h-4 w-4" />{used > 0 ? 'Re-attempt quiz' : 'Attempt quiz'}
            </Button>
          ) : (
            <p className="text-xs text-muted-foreground">
              {notOpen ? `Opens ${formatDue(inst.openAt)}.`
                : closed ? 'This quiz has closed.'
                : exhausted ? `You have used all ${allowed} attempts.`
                : 'You cannot attempt this quiz.'}
            </p>
          )}
        </CardContent>
      </Card>

      {view.module.grade && <GradePanel grade={view.module.grade} />}
    </div>
  );
}

function QuizTeacher({ view }: ActivityViewProps) {
  const nav = useNavigate();
  const inst = view.body?.instance ?? {};
  const slots: any[] = view.body?.slots ?? [];
  const overrides: any[] = view.body?.overrides ?? [];
  const attemptCount: number = view.body?.attemptCount ?? 0;

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="grid gap-3 py-5 sm:grid-cols-2 lg:grid-cols-4">
          <Fact label="Questions" value={slots.length} />
          <Fact label="Attempts made" value={attemptCount} />
          <Fact label="Behaviour" value={String(inst.behaviour ?? 'deferredfeedback')} />
          <Fact label="Overrides" value={overrides.length} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between py-3">
          <CardTitle className="text-base">Questions</CardTitle>
          {can(view.capabilities, CAP.quizManage) && (
            <Button variant="outline" size="sm" onClick={() => nav(`/school/lms/quiz/${view.module.id}/edit`)}>
              <Settings2 className="mr-1 h-4 w-4" />Edit quiz
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {slots.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No questions yet. Add them from the question bank.
            </p>
          ) : (
            <ul className="divide-y rounded-md border">
              {slots.map((s) => (
                <li key={s.id} className="flex items-center gap-3 p-3 text-sm">
                  <span className="w-8 text-muted-foreground">{s.slotNo}</span>
                  <ListChecks className="h-4 w-4 text-muted-foreground" />
                  <span className="flex-1 truncate">
                    {s.questionId ? 'Fixed question' : s.randomCategoryId ? 'Random from category' : 'Unset'}
                  </span>
                  <span className="text-xs text-muted-foreground">{s.maxMark} mark(s)</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-sm font-medium">{value}</p>
    </div>
  );
}

export { CheckCircle2 };

export const QUIZ_PLUGINS: ActivityUiPlugin[] = [
  { type: 'quiz', label: 'Quiz', icon: iconFor('quiz'), StudentView: QuizStudent, TeacherView: QuizTeacher },
];
