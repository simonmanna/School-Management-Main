import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowRight, Undo2, ShieldCheck, ClipboardList, Users, FileLock2, PenLine, Scale, AlertTriangle } from 'lucide-react';
import { useExams } from '@/features/school/api';
import {
  useExamGate, useExamOpsOverview, useExamTransition,
  type ExamLifecycleState,
} from '@/features/school/exam-operations-api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { notify } from '@/lib/notify';
import {
  Empty, ExamStepList, GateBlockers, LIFECYCLE_BLURB, LIFECYCLE_LABEL, LifecycleBadge,
  apiMessage, fmtDate, selectClass,
} from './_components/exam-ops-shared';
import { ExamCandidatesPanel, ExamPapersPanel } from './_components/exam-ops-setup';
import { ExamRegisterPanel, ExamIncidentsPanel } from './_components/exam-ops-session';
import { ExamCustodyPanel } from './_components/exam-ops-custody';
import { ExamMarkingPanel } from './_components/exam-ops-marking';

/**
 * Phase 5 — the examination operations console.
 *
 * One examination, one screen, ten steps. The stepper is a VIEW of the server's
 * lifecycle and of the rows underneath it: a step is complete because its
 * evidence exists, never because someone ticked it here. Every "next step"
 * button asks the server's gate first and shows what is blocking it.
 */
export function SchoolExamOperationsPage() {
  const [params, setParams] = useSearchParams();
  const { data: exams } = useExams();
  const examId = params.get('exam') ?? '';
  const tab = params.get('tab') ?? 'overview';
  const paperId = params.get('paper') ?? '';

  const setParam = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v); else next.delete(k);
    if (k === 'exam') { next.delete('paper'); }
    setParams(next, { replace: true });
  };

  const { data: overview, isLoading } = useExamOpsOverview(examId || undefined);
  const state = overview?.exam.lifecycleState;
  const nextState = useMemo(() => nextForward(state), [state]);
  const { data: gate } = useExamGate(examId || undefined, nextState);
  const transition = useExamTransition();
  const [reason, setReason] = useState('');

  // Default to the first paper once an examination is chosen, so the register
  // and marking tabs are never a blank screen with a hidden prerequisite.
  useEffect(() => {
    if (!paperId && overview?.papers.length) setParam('paper', overview.papers[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overview?.papers.length, paperId]);

  const move = async (target: ExamLifecycleState, backwards = false) => {
    if (!overview) return;
    try {
      await transition.mutateAsync({
        examId: overview.exam.id,
        target,
        reason: backwards ? reason : undefined,
        expectedVersion: overview.exam.version,
      });
      setReason('');
      notify.success(`Examination moved to “${LIFECYCLE_LABEL[target]}”`, { description: LIFECYCLE_BLURB[target] });
    } catch (e) {
      notify.error('Could not move this examination on', { description: apiMessage(e, 'Check what is outstanding below.') });
    }
  };

  return (
    <div className="space-y-4 p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Examination operations</h1>
          <p className="text-sm text-muted-foreground">
            Run one examination end to end — papers, candidates, question-paper custody, the register, marking and moderation.
          </p>
        </div>
        <div className="flex items-end gap-2">
          <select className={`${selectClass} w-72`} value={examId} onChange={(e) => setParam('exam', e.target.value)}>
            <option value="">Choose an examination…</option>
            {(exams?.data ?? []).map((e: { id: string; name: string; status: string }) => (
              <option key={e.id} value={e.id}>{e.name}</option>
            ))}
          </select>
          <Button asChild variant="outline" size="sm">
            <Link to="/school/exam-workspace">Set up an examination</Link>
          </Button>
        </div>
      </div>

      {!examId && <Empty>Choose an examination above to open its operations console.</Empty>}
      {examId && isLoading && <Empty>Loading…</Empty>}

      {overview && (
        <>
          <Card>
            <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle className="text-base">{overview.exam.name}</CardTitle>
                <p className="mt-1 text-xs text-muted-foreground">
                  {overview.exam.examTypeName ?? 'Examination'} · {overview.exam.termName ?? 'term'} ·{' '}
                  {fmtDate(overview.exam.startDate)} – {fmtDate(overview.exam.endDate)}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <LifecycleBadge state={overview.exam.lifecycleState} />
                <Badge variant="secondary">{overview.papers.length} paper(s)</Badge>
                <Badge variant="secondary">{overview.candidates.length} candidate(s)</Badge>
              </div>
            </CardHeader>
            <CardContent className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <div>
                <p className="mb-2 text-xs font-medium text-muted-foreground">Where this examination is</p>
                <ExamStepList steps={overview.steps} />
              </div>
              <div className="space-y-3">
                <p className="text-xs font-medium text-muted-foreground">Next step</p>
                {nextState ? (
                  <>
                    <div className="rounded-md border p-3 text-sm">
                      <p className="font-medium">{LIFECYCLE_LABEL[nextState]}</p>
                      <p className="text-xs text-muted-foreground">{LIFECYCLE_BLURB[nextState]}</p>
                    </div>
                    {gate && <GateBlockers conflicts={gate.conflicts} ready={gate.ready} />}
                    <Button
                      size="sm"
                      disabled={!gate?.ready || transition.isPending}
                      onClick={() => move(nextState)}
                    >
                      <ArrowRight className="h-4 w-4" /> Move to “{LIFECYCLE_LABEL[nextState]}”
                    </Button>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    This examination is {LIFECYCLE_LABEL[overview.exam.lifecycleState].toLowerCase()}. Nothing further to advance.
                  </p>
                )}

                {backwardOptions(overview.exam.lifecycleState, overview.exam.allowedTransitions).length > 0 && (
                  <div className="space-y-2 border-t pt-3">
                    <p className="text-xs font-medium text-muted-foreground">Step back (a correction, recorded with a reason)</p>
                    <Input placeholder="Why is this examination going back a step?" value={reason} onChange={(e) => setReason(e.target.value)} />
                    <div className="flex flex-wrap gap-2">
                      {backwardOptions(overview.exam.lifecycleState, overview.exam.allowedTransitions).map((t) => (
                        <Button key={t} size="sm" variant="outline" disabled={!reason.trim() || transition.isPending} onClick={() => move(t, true)}>
                          <Undo2 className="h-4 w-4" /> {LIFECYCLE_LABEL[t]}
                        </Button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          <Tabs value={tab} onValueChange={(v) => setParam('tab', v)}>
            <TabsList className="flex-wrap">
              <TabsTrigger value="overview"><ClipboardList className="mr-1 h-4 w-4" /> Papers</TabsTrigger>
              <TabsTrigger value="candidates"><Users className="mr-1 h-4 w-4" /> Candidates</TabsTrigger>
              <TabsTrigger value="custody"><FileLock2 className="mr-1 h-4 w-4" /> Question papers</TabsTrigger>
              <TabsTrigger value="register"><ShieldCheck className="mr-1 h-4 w-4" /> Register</TabsTrigger>
              <TabsTrigger value="incidents"><AlertTriangle className="mr-1 h-4 w-4" /> Incidents &amp; arrangements</TabsTrigger>
              <TabsTrigger value="marking"><PenLine className="mr-1 h-4 w-4" /> Marking</TabsTrigger>
              <TabsTrigger value="moderation"><Scale className="mr-1 h-4 w-4" /> Moderation</TabsTrigger>
            </TabsList>

            <TabsContent value="overview" className="pt-4">
              <ExamPapersPanel overview={overview} onOpenPaper={(id, to) => { setParam('paper', id); setParam('tab', to); }} />
            </TabsContent>
            <TabsContent value="candidates" className="pt-4">
              <ExamCandidatesPanel overview={overview} />
            </TabsContent>
            <TabsContent value="custody" className="pt-4">
              <ExamCustodyPanel examId={overview.exam.id} />
            </TabsContent>
            <TabsContent value="register" className="pt-4">
              <ExamRegisterPanel overview={overview} paperId={paperId} onPaper={(id) => setParam('paper', id)} />
            </TabsContent>
            <TabsContent value="incidents" className="pt-4">
              <ExamIncidentsPanel overview={overview} />
            </TabsContent>
            <TabsContent value="marking" className="pt-4">
              <ExamMarkingPanel overview={overview} paperId={paperId} onPaper={(id) => setParam('paper', id)} mode="marking" />
            </TabsContent>
            <TabsContent value="moderation" className="pt-4">
              <ExamMarkingPanel overview={overview} paperId={paperId} onPaper={(id) => setParam('paper', id)} mode="moderation" />
            </TabsContent>
          </Tabs>
        </>
      )}
    </div>
  );
}

const ORDER: ExamLifecycleState[] = [
  'draft', 'setup', 'scheduled', 'candidates_locked', 'in_progress',
  'marking', 'moderation', 'results_ready', 'closed', 'archived',
];

/** The next step forward, skipping `archived` — archiving is never "next". */
function nextForward(state?: ExamLifecycleState): ExamLifecycleState | undefined {
  if (!state) return undefined;
  const i = ORDER.indexOf(state);
  const next = ORDER[i + 1];
  return next === 'archived' ? undefined : next;
}

function backwardOptions(state: ExamLifecycleState, allowed: ExamLifecycleState[]): ExamLifecycleState[] {
  const i = ORDER.indexOf(state);
  return allowed.filter((t) => t !== 'archived' && ORDER.indexOf(t) < i);
}
