import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, CircleDashed, ClipboardCheck, FileText, GraduationCap, Lock, LayoutGrid, Send, Sigma } from 'lucide-react';
import {
  useTermBoard,
  useTermBoardAction,
  useTerms,
  type TermBoardClass,
  type TermBoardOutcome,
} from '@/features/school/api';
import { useAuthStore } from '@/stores/auth.store';
import { PERMISSIONS } from '@erp/shared';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { notify } from '@/lib/notify';
import { ConfirmButton } from './_components/confirm-button';
import { EmptyState, Picker, useDefaulted, useStickyState } from './_components/exam-workflow';

/**
 * Term Board — the Director of Studies' whole term on one screen (review A15,
 * Phase 1.5). Every class's exams, results and report cards, and each
 * end-of-term step run for ALL classes at once instead of class by class.
 * Every step goes through the same single-class service and gates as before;
 * the board reports, per class, what happened and why anything was skipped.
 */
type Action = 'class-lists' | 'compute' | 'publish' | 'build-cards' | 'release-cards' | 'propose-promotions';

const ACTIONS: Array<{
  action: Action; label: string; icon: React.ReactNode; permission: string;
  title: string; description: string; tone?: 'destructive';
}> = [
  {
    action: 'class-lists', label: 'Lock class lists', icon: <Lock className="h-4 w-4" />, permission: PERMISSIONS.school.manageAssessments,
    title: 'Lock every class list?', description: 'Each class’s list of pupils for this term is captured from their placements and locked. Results are worked out against it.',
  },
  {
    action: 'compute', label: 'Work out results', icon: <Sigma className="h-4 w-4" />, permission: PERMISSIONS.school.computeResults,
    title: 'Work out results for every class?', description: 'Uses approved marks only. A class whose list is not locked yet is locked first. Released results are not changed — they need an amendment.',
  },
  {
    action: 'publish', label: 'Release results', icon: <Send className="h-4 w-4" />, permission: PERMISSIONS.school.publishResults,
    title: 'Release results to families?', description: 'Every class whose results pass the release check is released to the parent portal. Classes with outstanding items are skipped and listed.',
  },
  {
    action: 'build-cards', label: 'Build report cards', icon: <FileText className="h-4 w-4" />, permission: PERMISSIONS.school.computeResults,
    title: 'Build every report card?', description: 'Builds each pupil’s card from the released results, with the comments written so far. Cards already released are not rebuilt.',
  },
  {
    action: 'release-cards', label: 'Release report cards', icon: <ClipboardCheck className="h-4 w-4" />, permission: PERMISSIONS.school.publishResults,
    title: 'Release every built report card?', description: 'Families can read them in the portal, and the class sets can be printed.',
  },
  {
    action: 'propose-promotions', label: 'Propose promotions', icon: <GraduationCap className="h-4 w-4" />, permission: PERMISSIONS.school.computeResults,
    title: 'Draw up the promotion lists?', description: 'Each class gets a promotion list from its released results (Term III at the end of the year). These are proposals: the head teacher decides each pupil on Term Results › Promotion.',
  },
];

function Step({ ok, partial, children }: { ok: boolean; partial?: boolean; children: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1 text-xs ${ok ? 'text-emerald-700 dark:text-emerald-400' : partial ? 'text-amber-700 dark:text-amber-400' : 'text-muted-foreground'}`}>
      {ok ? <CheckCircle2 className="h-3.5 w-3.5" /> : <CircleDashed className="h-3.5 w-3.5" />}
      {children}
    </span>
  );
}

const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0);
const RESULT_LABEL: Record<string, string> = {
  computed: 'Worked out', approved: 'Approved', published: 'Released', locked: 'Final', draft: 'Draft', superseded: 'Replaced',
};

export function SchoolTermBoardPage() {
  const { data: terms } = useTerms();
  const termList = terms?.data ?? [];
  const [termId, setTermId] = useStickyState('termId');
  useDefaulted(termId, setTermId, termList.find((t) => t.isCurrent)?.id ?? termList[0]?.id);
  const { data: board, isLoading, isError } = useTermBoard(termId || undefined);
  const run = useTermBoardAction();
  const has = useAuthStore((s) => s.hasPermission);
  const [last, setLast] = useState<{ label: string; result: TermBoardOutcome } | null>(null);

  const doRun = async (a: (typeof ACTIONS)[number]) => {
    if (!termId) return;
    try {
      const result = await run.mutateAsync({ action: a.action, termId });
      setLast({ label: a.label, result });
      const skipped = result.total - result.done;
      (skipped ? notify.info : notify.success)(`${a.label}: ${result.done} of ${result.total} classes done`, {
        description: skipped ? 'The classes that were skipped are listed below with the reason.' : undefined,
      });
    } catch (e: any) {
      notify.error(`${a.label} failed`, { description: e?.response?.data?.message ?? 'Try again.' });
    }
  };

  const classes = board?.classes ?? [];
  return (
    <div className="space-y-4 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold"><LayoutGrid className="h-5 w-5" />Term Board</h1>
          <p className="text-sm text-muted-foreground">
            Every class’s marks, results and report cards for the term — and each end-of-term step for all classes at once.
          </p>
        </div>
        <Picker label="Term" value={termId} onChange={setTermId} options={termList.map((t) => ({ value: t.id, label: t.label ?? t.name }))} className="min-w-[170px]" />
      </div>

      <Card>
        <CardContent className="flex flex-wrap items-center gap-2 p-4">
          {ACTIONS.map((a, i) => (
            <div key={a.action} className="flex items-center gap-2">
              {i > 0 && <span aria-hidden className="text-muted-foreground">→</span>}
              <ConfirmButton
                variant="outline"
                disabled={!termId || run.isPending || !has(a.permission)}
                title={a.title}
                description={a.description}
                confirmLabel={a.label}
                onConfirm={() => doRun(a)}
              >
                {a.icon} {a.label}
              </ConfirmButton>
            </div>
          ))}
          <span className="ml-auto text-xs text-muted-foreground">
            Comments: <Link to="/school/report-comments" className="underline">Report Comments</Link>
          </span>
        </CardContent>
      </Card>

      {last && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{last.label}: {last.result.done} of {last.result.total} classes</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-1 text-sm sm:grid-cols-2">
            {last.result.outcomes.map((o) => (
              <div key={o.classId} className="flex items-start gap-2">
                {o.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" /> : <CircleDashed className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />}
                <span><strong>{o.className}</strong> — {o.detail}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {isLoading && <p className="text-sm text-muted-foreground">Loading the term…</p>}
      {isError && <EmptyState title="Couldn’t load the term board" hint="Refresh the page; if it keeps happening, tell the system administrator." />}

      {board && (
        <Card>
          <CardContent className="overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead className="border-b text-left text-xs text-muted-foreground">
                <tr>
                  <th className="p-3 font-medium">Class</th>
                  <th className="p-3 font-medium">Class list</th>
                  <th className="p-3 font-medium">Exams (marks in · approved)</th>
                  <th className="p-3 font-medium">Results</th>
                  <th className="p-3 font-medium">Comments</th>
                  <th className="p-3 font-medium">Report cards</th>
                </tr>
              </thead>
              <tbody>
                {classes.map((c) => <BoardRow key={c.classId} c={c} />)}
              </tbody>
            </table>
            {classes.length === 0 && <p className="p-4 text-sm text-muted-foreground">No active classes.</p>}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function BoardRow({ c }: { c: TermBoardClass }) {
  const rc = c.reportCards;
  return (
    <tr className="border-b align-top last:border-0">
      <td className="p-3">
        <div className="font-medium">{c.className}</div>
        <div className="text-xs text-muted-foreground">{c.pupils} pupil{c.pupils === 1 ? '' : 's'}{c.level ? ` · ${c.level}` : ''}</div>
      </td>
      <td className="p-3">
        {c.classList
          ? <Step ok={c.classList.frozen} partial={!c.classList.frozen}>{c.classList.frozen ? `Locked · ${c.classList.members}` : 'Not locked'}</Step>
          : <Step ok={false}>Not captured</Step>}
      </td>
      <td className="space-y-1 p-3">
        {c.exams.length === 0 && <span className="text-xs text-muted-foreground">No exams this term</span>}
        {c.exams.map((e) => {
          const inPct = pct(e.entered, e.expected);
          return (
            <div key={e.examId}>
              <Step ok={inPct >= 100 && e.approved >= e.entered} partial={inPct > 0}>
                <Link to="/school/exam-results" className="hover:underline">{e.name}</Link>: {inPct}% · {pct(e.approved, e.expected)}% approved
                {e.locked === e.papers && e.papers > 0 ? ' · locked' : ''}
              </Step>
            </div>
          );
        })}
      </td>
      <td className="p-3">
        {c.results
          ? <Badge variant={['published', 'locked'].includes(c.results.status) ? 'default' : 'secondary'}>
              {RESULT_LABEL[c.results.status] ?? c.results.status} · v{c.results.revision}
            </Badge>
          : <span className="text-xs text-muted-foreground">Not worked out</span>}
      </td>
      <td className="p-3">
        {rc.pupils
          ? <div className="space-y-0.5">
              <Step ok={rc.classTeacherComments >= rc.pupils} partial={rc.classTeacherComments > 0}>Class teacher {rc.classTeacherComments}/{rc.pupils}</Step>
              <div><Step ok={rc.headComments >= rc.pupils} partial={rc.headComments > 0}>Head teacher {rc.headComments}/{rc.pupils}</Step></div>
            </div>
          : <span className="text-xs text-muted-foreground">—</span>}
      </td>
      <td className="p-3">
        {rc.pupils
          ? <div className="space-y-0.5">
              <Step ok={rc.built >= rc.pupils} partial={rc.built > 0}>Built {rc.built}/{rc.pupils}</Step>
              <div><Step ok={rc.released >= rc.pupils} partial={rc.released > 0}>Released {rc.released}/{rc.pupils}</Step></div>
            </div>
          : <span className="text-xs text-muted-foreground">—</span>}
      </td>
    </tr>
  );
}
