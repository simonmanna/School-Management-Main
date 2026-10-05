import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { AlertTriangle, ArrowLeft, ArrowRight, CheckCircle2, Clock, Send } from 'lucide-react';
import { useAuthStore, useActiveStudent } from '@/stores/auth.store';
import {
  useModuleView, useStartAttempt, useAttempt, useSaveResponse, useSubmitAttempt,
} from '@/lib/portal-api';
import { apiErrorMessage } from '@/lib/api';
import { Button, Card, CardContent, Skeleton, Empty, Badge } from '@/components/ui';
import { SafeHtml } from '@/components/safe-html';

/**
 * Sitting a quiz.
 *
 * Thin on purpose. The CBT engine owns the attempt: it realises the questions,
 * persists each response, marks the objective ones, counts attempts and decides
 * when time is up — and it refuses a save that arrives after expiry. This screen
 * moves between questions, autosaves, and submits. It never scores anything, and
 * the countdown it draws is a courtesy rather than the rule.
 *
 * One question per screen: a primary-age pupil on a phone cannot usefully scroll
 * twenty of them, and one question is also the unit the autosave sends.
 *
 * Response shapes are the marker's contract (`cbt/cbt-marking.ts`): `{optionId}`
 * for a single choice, `{optionIds}` for several, `{value}` for a number,
 * `{text}` for anything written.
 */

type Response = Record<string, unknown>;

interface AttemptQuestion {
  questionId: string;
  type: string;
  marks: number;
  prompt: string;
  options: Array<{ id: string; label: string }>;
}

export default function StudentQuiz() {
  const { id = '' } = useParams(); // course module id
  const nav = useNavigate();
  const kind = useAuthStore((s) => s.portal?.kind);
  const active = useActiveStudent();

  const { data: moduleView, isLoading: loadingModule } = useModuleView(id);
  const startAttempt = useStartAttempt();
  const saveResponse = useSaveResponse();
  const submitAttempt = useSubmitAttempt();

  const [attemptId, setAttemptId] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<string, Response>>({});
  const [index, setIndex] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const seq = useRef(0);

  const { data: attempt, refetch } = useAttempt(attemptId ?? undefined);
  const view: any = moduleView;
  const paperId: string | undefined = view?.body?.paperId;
  const courseId: string | undefined = view?.course?.id;
  const instance: any = view?.body?.instance ?? {};

  // The server substitutes a pupil's own id and refuses any other, but the DTO
  // still requires the field, so it is sent from the portal context rather than
  // left out.
  const sitterId = active?.studentProfileId;

  // Open the attempt once the module names the paper behind this quiz. The ref
  // guard matters: without it a re-render burns a second attempt out of the
  // learner's allowance.
  const opening = useRef(false);
  useEffect(() => {
    if (attemptId || !paperId || !sitterId || opening.current) return;
    if (kind === 'guardian') return; // guardians may read a quiz, not sit one
    opening.current = true;
    (async () => {
      try {
        const created: any = await startAttempt.mutateAsync({ paperId, studentProfileId: sitterId });
        setAttemptId(created?.id ?? null);
      } catch (e) {
        setFailure(apiErrorMessage(e, 'This quiz could not be started'));
      }
    })();
  }, [paperId, attemptId, sitterId, kind, startAttempt]);

  const questions: AttemptQuestion[] = attempt?.questions ?? [];
  const current = questions[index];
  const answeredCount = useMemo(() => Object.keys(answers).length, [answers]);

  // `expiresAt` is the server's deadline; a save after it is refused there.
  const expiresAt: string | undefined = attempt?.expiresAt ?? undefined;
  const [remaining, setRemaining] = useState<number | null>(null);
  useEffect(() => {
    if (!expiresAt) return;
    const tick = () => setRemaining(Math.max(0, new Date(expiresAt).getTime() - Date.now()));
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [expiresAt]);

  const choose = (questionId: string, response: Response) => {
    setAnswers((a) => ({ ...a, [questionId]: response }));
    void (async () => {
      if (!attemptId) return;
      seq.current += 1;
      const n = seq.current;
      try {
        await saveResponse.mutateAsync({
          attemptId,
          questionId,
          response,
          sequenceNumber: n,
          // Lets the server discard a duplicate if the network retries.
          clientEventId: `${attemptId}:${questionId}:${n}`,
        });
      } catch (e) {
        // Losing an answer quietly is worse than a visible warning: the learner
        // can tap it again while the attempt is still open.
        toast.error(apiErrorMessage(e, 'That answer did not save — tap it again'));
      }
    })();
  };

  const finish = async () => {
    if (!attemptId) return;
    setSubmitting(true);
    try {
      await submitAttempt.mutateAsync({ attemptId, idempotencyKey: `submit:${attemptId}` });
      await refetch();
    } catch (e) {
      toast.error(apiErrorMessage(e, 'Could not hand in this quiz'));
    } finally {
      setSubmitting(false);
    }
  };

  const backToActivity = () => nav(courseId ? `/student/courses/${courseId}/modules/${id}` : '/student/courses');

  if (loadingModule) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-8 w-1/2" />
        <Skeleton className="h-48" />
      </div>
    );
  }

  if (kind === 'guardian') {
    return (
      <div className="space-y-3">
        <Empty title="Only your child can sit this quiz" hint="You can see the mark once it is released." />
        <Button variant="outline" className="w-full" onClick={backToActivity}>
          Back
        </Button>
      </div>
    );
  }

  if (failure) {
    return (
      <div className="space-y-3">
        <Empty title="This quiz could not be started" hint={failure} />
        <Button variant="outline" className="w-full" onClick={backToActivity}>
          Back
        </Button>
      </div>
    );
  }

  const handedIn = attempt?.status === 'submitted' || attempt?.status === 'auto_submitted';
  if (handedIn) {
    return (
      <div className="space-y-4">
        <Card>
          <CardContent className="space-y-2 py-10 text-center">
            <CheckCircle2 className="mx-auto h-10 w-10 text-[hsl(var(--success))]" />
            <p className="text-lg font-bold">Handed in</p>
            <p className="text-sm text-muted-foreground">
              Your answers are saved. Your teacher will release your mark once anything that needs
              marking by hand has been checked.
            </p>
          </CardContent>
        </Card>
        <Button className="w-full" size="lg" variant="outline" onClick={backToActivity}>
          Back to the activity
        </Button>
      </div>
    );
  }

  if (!attempt || !current) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-8 w-1/2" />
        <Skeleton className="h-48" />
        <p className="text-center text-sm text-muted-foreground">Getting your questions ready…</p>
      </div>
    );
  }

  const last = index === questions.length - 1;
  const sequential = instance.navMethod === 'sequential';

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-bold leading-tight">
            {instance.name ?? view?.module?.name ?? 'Quiz'}
          </h1>
          <p className="pt-0.5 text-sm text-muted-foreground">
            Question {index + 1} of {questions.length} · {answeredCount} answered
          </p>
        </div>
        {remaining !== null && (
          <Badge variant={remaining < 60_000 ? 'destructive' : 'outline'} className="gap-1 tabular-nums">
            <Clock className="h-3 w-3" />
            {formatClock(remaining)}
          </Badge>
        )}
      </div>

      {remaining === 0 && (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardContent className="flex items-center gap-2 py-3 text-sm">
            <AlertTriangle className="h-4 w-4 shrink-0 text-destructive" />
            Time is up. The school's system will hand this in for you.
          </CardContent>
        </Card>
      )}

      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-primary transition-[width]"
          style={{ width: `${((index + 1) / questions.length) * 100}%` }}
        />
      </div>

      <Card>
        <CardContent className="space-y-4">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-xs uppercase tracking-wide text-muted-foreground">
              Question {index + 1}
            </span>
            <span className="text-xs text-muted-foreground">
              {current.marks} mark{Number(current.marks) === 1 ? '' : 's'}
            </span>
          </div>
          <SafeHtml html={current.prompt} />
          <AnswerInput
            question={current}
            value={answers[current.questionId]}
            onChange={(r) => choose(current.questionId, r)}
          />
        </CardContent>
      </Card>

      <div className="flex gap-2">
        <Button variant="outline" size="lg" disabled={index === 0} onClick={() => setIndex((i) => i - 1)}>
          <ArrowLeft className="h-4 w-4" />
          Back
        </Button>
        {last ? (
          <Button className="flex-1" size="lg" disabled={submitting} onClick={() => void finish()}>
            <Send className="h-4 w-4" />
            {submitting ? 'Handing in…' : 'Hand in'}
          </Button>
        ) : (
          <Button className="flex-1" size="lg" onClick={() => setIndex((i) => i + 1)}>
            Next
            <ArrowRight className="h-4 w-4" />
          </Button>
        )}
      </div>

      {/* Question jumper. Hidden when the quiz is set to sequential navigation,
          which the server also enforces. */}
      {!sequential && questions.length > 1 && (
        <div className="flex flex-wrap justify-center gap-1.5">
          {questions.map((q, i) => (
            <button
              key={q.questionId}
              onClick={() => setIndex(i)}
              aria-label={`Go to question ${i + 1}`}
              aria-current={i === index}
              className={`h-9 w-9 rounded-lg border text-sm tabular-nums ${
                i === index
                  ? 'border-primary bg-primary text-primary-foreground'
                  : answers[q.questionId]
                    ? 'border-[hsl(var(--success))]/50 bg-[hsl(var(--success))]/10'
                    : 'border-input bg-card'
              }`}
            >
              {i + 1}
            </button>
          ))}
        </div>
      )}

      <p className="text-center text-xs text-muted-foreground">Your answers save as you go.</p>
    </div>
  );
}

function formatClock(ms: number): string {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * The control for one question, by type.
 *
 * `matching` has no learner-side widget: the engine strips the pairs a matcher
 * would need, so it falls through to a written answer, which a teacher then
 * marks by hand. Same as the admin app does.
 */
function AnswerInput({
  question,
  value,
  onChange,
}: {
  question: AttemptQuestion;
  value: Response | undefined;
  onChange: (r: Response) => void;
}) {
  const options = question.options ?? [];

  if (question.type === 'mcq_multi') {
    const chosen: string[] = Array.isArray(value?.optionIds) ? (value!.optionIds as string[]) : [];
    return (
      <fieldset className="space-y-2">
        <legend className="pb-1 text-sm text-muted-foreground">Choose all the right answers.</legend>
        {options.map((o) => {
          const picked = chosen.includes(o.id);
          return (
            <label key={o.id} className={optionClass(picked)}>
              <input
                type="checkbox"
                checked={picked}
                onChange={() =>
                  onChange({ optionIds: picked ? chosen.filter((c) => c !== o.id) : [...chosen, o.id] })
                }
                className="h-5 w-5 shrink-0"
              />
              <SafeHtml html={o.label} className="text-base" />
            </label>
          );
        })}
      </fieldset>
    );
  }

  if (options.length > 0) {
    // mcq_single and true_false both answer with one optionId.
    return (
      <fieldset className="space-y-2">
        <legend className="sr-only">Choose one answer</legend>
        {options.map((o) => {
          const picked = value?.optionId === o.id;
          return (
            <label key={o.id} className={optionClass(picked)}>
              <input
                type="radio"
                name={question.questionId}
                checked={picked}
                onChange={() => onChange({ optionId: o.id })}
                className="h-5 w-5 shrink-0"
              />
              <SafeHtml html={o.label} className="text-base" />
            </label>
          );
        })}
      </fieldset>
    );
  }

  if (question.type === 'numeric') {
    return (
      <input
        type="number"
        inputMode="decimal"
        value={(value?.value as string) ?? ''}
        onChange={(e) => onChange({ value: e.target.value })}
        placeholder="Your answer"
        className="h-12 w-full rounded-lg border border-input bg-card px-3 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
    );
  }

  return (
    <textarea
      rows={question.type === 'essay' ? 8 : 3}
      value={(value?.text as string) ?? ''}
      onChange={(e) => onChange({ text: e.target.value })}
      placeholder="Your answer"
      className="w-full rounded-lg border border-input bg-card p-3 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    />
  );
}

function optionClass(picked: boolean): string {
  return [
    'flex min-h-12 cursor-pointer items-center gap-3 rounded-lg border p-3',
    picked ? 'border-primary bg-primary/5 font-medium' : 'border-input',
  ].join(' ');
}
