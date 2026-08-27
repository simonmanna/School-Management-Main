import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, ArrowRight, CheckCircle2, Clock, Send } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { SafeHtml } from '@/components/ui/safe-html';
import {
  useLmsModuleView, useCbtStartAttempt, useCbtAttempt, useCbtSaveResponse, useCbtSubmitAttempt,
} from '@/features/school/api';
import { notify } from '@/lib/notify';

type Answer = Record<string, unknown>;

/**
 * The quiz runner (L3.3) — sitting a quiz from inside a course.
 *
 * Thin on purpose: the CBT engine already owns attempt lifecycle, response
 * persistence and marking, including server-authoritative expiry. This screen
 * navigates, autosaves and submits; it never scores anything, and it never
 * decides when time is up — the server does, and rejects late saves.
 */
export function SchoolLmsQuizAttemptPage() {
  const { id = '' } = useParams(); // courseModule id
  const nav = useNavigate();

  const { data: moduleView } = useLmsModuleView(id);
  const startAttempt = useCbtStartAttempt();
  const saveResponse = useCbtSaveResponse();
  const submitAttempt = useCbtSubmitAttempt();

  const [attemptId, setAttemptId] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<string, Answer>>({});
  const [index, setIndex] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const seq = useRef(0);

  const { data: attempt, refetch } = useCbtAttempt(attemptId ?? undefined);
  const view: any = moduleView;
  const paperId: string | undefined = view?.body?.paperId;
  const instance = view?.body?.instance ?? {};

  // Open the attempt once the module tells us which paper backs this quiz.
  useEffect(() => {
    if (attemptId || !paperId) return;
    let cancelled = false;
    (async () => {
      try {
        const created: any = await startAttempt.mutateAsync({ paperId });
        if (!cancelled) setAttemptId(created?.id ?? null);
      } catch (e: any) {
        notify.error(e?.response?.data?.message ?? 'Could not start this attempt');
      }
    })();
    return () => { cancelled = true; };
  }, [paperId, attemptId, startAttempt]);

  const questions: any[] = (attempt as any)?.questions ?? [];
  const current = questions[index];
  const answered = useMemo(() => Object.keys(answers).length, [answers]);

  // The countdown is a courtesy, not the rule: `expiresAt` is the server's, and a
  // save after it is refused there. Nothing here is allowed to decide the deadline.
  const expiresAt: string | undefined = (attempt as any)?.expiresAt;
  const [remaining, setRemaining] = useState<number | null>(null);
  useEffect(() => {
    if (!expiresAt) return;
    const tick = () => setRemaining(Math.max(0, new Date(expiresAt).getTime() - Date.now()));
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [expiresAt]);

  const persist = async (questionId: string, response: Answer) => {
    if (!attemptId) return;
    try {
      seq.current += 1;
      await saveResponse.mutateAsync({
        attemptId, questionId, response, sequenceNumber: seq.current,
        // Lets the server discard a duplicate if the network retries.
        clientEventId: `${attemptId}:${questionId}:${seq.current}`,
      });
    } catch (e: any) {
      notify.error(e?.response?.data?.message ?? 'Answer not saved — check your connection');
    }
  };

  const choose = (questionId: string, response: Answer) => {
    setAnswers((a) => ({ ...a, [questionId]: response }));
    void persist(questionId, response);
  };

  const finish = async () => {
    if (!attemptId) return;
    setSubmitting(true);
    try {
      await submitAttempt.mutateAsync({ attemptId, idempotencyKey: `submit:${attemptId}` });
      await refetch();
      notify.success('Submitted');
      nav(`/school/lms/modules/${id}`);
    } catch (e: any) {
      notify.error(e?.response?.data?.message ?? 'Could not submit');
    } finally {
      setSubmitting(false);
    }
  };

  if (!paperId) return <p className="p-4 text-sm text-muted-foreground">Loading quiz…</p>;
  if (!attemptId || questions.length === 0) {
    return <p className="p-4 text-sm text-muted-foreground">Preparing your attempt…</p>;
  }

  const done = (attempt as any)?.status === 'submitted' || (attempt as any)?.status === 'auto_submitted';
  if (done) {
    return (
      <Card className="m-4"><CardContent className="flex flex-col items-center gap-3 py-12 text-center">
        <CheckCircle2 className="h-10 w-10 text-emerald-600" />
        <p className="font-medium">Attempt submitted</p>
        <p className="text-sm text-muted-foreground">
          Your answers are recorded. Any question needing a teacher&rsquo;s marking will be scored later.
        </p>
        <Button onClick={() => nav(`/school/lms/modules/${id}`)}>Back to the quiz</Button>
      </CardContent></Card>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-semibold">{instance.name ?? view?.module?.name ?? 'Quiz'}</h1>
          <p className="text-xs text-muted-foreground">
            Question {index + 1} of {questions.length} · {answered} answered
          </p>
        </div>
        {remaining != null && (
          <Badge variant={remaining < 60_000 ? 'destructive' : 'secondary'} className="tabular-nums">
            <Clock className="mr-1 h-3.5 w-3.5" />
            {Math.floor(remaining / 60000)}:{String(Math.floor((remaining % 60000) / 1000)).padStart(2, '0')}
          </Badge>
        )}
      </div>

      {remaining === 0 && (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardContent className="flex items-center gap-2 py-3 text-sm">
            <AlertTriangle className="h-4 w-4 text-destructive" />
            Time is up. The server will submit this attempt automatically.
          </CardContent>
        </Card>
      )}

      {/* Question navigator — free movement unless the quiz says otherwise. */}
      <div className="flex flex-wrap gap-1">
        {questions.map((q, i) => (
          <button
            key={q.questionId}
            disabled={instance.navMethod === 'sequential' && i > index}
            onClick={() => setIndex(i)}
            className={`h-7 w-7 rounded border text-xs tabular-nums disabled:opacity-40 ${
              i === index ? 'border-primary bg-primary text-primary-foreground'
                : answers[q.questionId] ? 'border-emerald-500/50 bg-emerald-500/10' : 'bg-card'
            }`}
          >
            {i + 1}
          </button>
        ))}
      </div>

      <Card>
        <CardHeader className="py-3">
          <CardTitle className="text-base">
            Question {index + 1}
            <span className="ml-2 text-xs font-normal text-muted-foreground">{current.marks} mark(s)</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <SafeHtml className="prose prose-sm dark:prose-invert max-w-none" html={current.prompt ?? ''} />

          {Array.isArray(current.options) && current.options.length > 0 ? (
            <div className="space-y-2">
              {current.options.map((o: any) => {
                const picked = (answers[current.questionId] as any)?.optionId === o.id;
                return (
                  <button
                    key={o.id}
                    onClick={() => choose(current.questionId, { optionId: o.id })}
                    className={`flex w-full items-center gap-2 rounded-md border px-3 py-2 text-left text-sm transition ${
                      picked ? 'border-primary bg-primary/10' : 'hover:bg-muted/50'
                    }`}
                  >
                    <span className={`h-3.5 w-3.5 shrink-0 rounded-full border ${picked ? 'border-primary bg-primary' : ''}`} />
                    <SafeHtml className="prose prose-sm dark:prose-invert max-w-none" html={o.label ?? ''} />
                  </button>
                );
              })}
            </div>
          ) : (
            <Textarea
              rows={5}
              placeholder="Your answer"
              defaultValue={(answers[current.questionId] as any)?.text ?? ''}
              onBlur={(e) => choose(current.questionId, { text: e.target.value })}
            />
          )}
        </CardContent>
      </Card>

      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" disabled={index === 0} onClick={() => setIndex((i) => i - 1)}>
          <ArrowLeft className="mr-1 h-4 w-4" />Previous
        </Button>
        <Button
          variant="outline" size="sm"
          disabled={index >= questions.length - 1}
          onClick={() => setIndex((i) => i + 1)}
        >
          Next<ArrowRight className="ml-1 h-4 w-4" />
        </Button>
        <span className="flex-1" />
        <Button size="sm" disabled={submitting} onClick={finish}>
          <Send className="mr-1 h-4 w-4" />Submit attempt
        </Button>
      </div>

      {answered < questions.length && (
        <p className="text-center text-xs text-muted-foreground">
          {questions.length - answered} question(s) still unanswered.
        </p>
      )}
    </div>
  );
}
