import type { ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, CircleDashed, Lock } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import type { ExamGateConflict, ExamLifecycleState, ExamStep } from '@/features/school/exam-operations-api';

export const selectClass = 'w-full rounded-md border bg-card px-3 py-2 text-sm';

/** Plain-language names for the exam lifecycle. The server owns the states. */
export const LIFECYCLE_LABEL: Record<ExamLifecycleState, string> = {
  draft: 'Being set up',
  setup: 'Papers being configured',
  scheduled: 'Timetabled',
  candidates_locked: 'Candidate list locked',
  in_progress: 'Being sat',
  marking: 'Being marked',
  moderation: 'Being moderated',
  results_ready: 'Ready for results',
  closed: 'Closed',
  archived: 'Archived',
};

export const LIFECYCLE_BLURB: Record<ExamLifecycleState, string> = {
  draft: 'Add the papers this examination is made of.',
  setup: 'Give every paper a date, a time and a maximum mark.',
  scheduled: 'Register the candidates, then freeze the list.',
  candidates_locked: 'Assign invigilators and decide any access arrangements.',
  in_progress: 'Record the register for every paper as it is sat.',
  marking: 'Allocate scripts to markers and agree the marks.',
  moderation: 'Draw a sample and have it re-marked.',
  results_ready: 'The marks are approved. Work out the results.',
  closed: 'Every paper is locked. Nothing more can be marked.',
  archived: 'Kept for the record only.',
};

/**
 * Translate the exam gate's codes into something an exam officer can act on.
 *
 * The gate stays the single authority for whether a step may be taken — this
 * only says who and what in plain language.
 */
export function describeConflict(c: ExamGateConflict): string {
  switch (c.code) {
    case 'NO_PAPERS': return 'No papers have been added to this examination yet.';
    case 'PAPER_NOT_TIMETABLED': return 'A paper has no date or start time.';
    case 'PAPER_NO_MARKS': return 'A paper has no maximum mark.';
    case 'VENUE_CLASH': return `Two papers need the same room at once — ${c.detail}.`;
    case 'INVIGILATOR_CLASH': return `An invigilator is booked twice at once — ${c.detail}.`;
    case 'CANDIDATE_CLASH': return `A class is timetabled for two papers at once — ${c.detail}.`;
    case 'NO_CANDIDATE_SNAPSHOT': return 'The candidate list has not been frozen yet.';
    case 'SNAPSHOT_STALE': return `The frozen list no longer matches the registrations — ${c.detail}.`;
    case 'CANDIDATES_UNSEATED': return `${c.detail}. Allocate seats before the examination starts.`;
    case 'VENUE_OVER_CAPACITY': return c.detail;
    case 'NO_INVIGILATOR': return 'A paper has no invigilator assigned.';
    case 'CONSIDERATIONS_UNDECIDED': return `${c.detail}. Approve or refuse them before the examination starts.`;
    case 'ATTENDANCE_INCOMPLETE': return c.detail;
    case 'SCRIPTS_UNMARKED': return c.detail;
    case 'SCRIPT_NOT_RECONCILED': return 'A script has two marks that have not been agreed yet.';
    case 'MODERATION_OUTSTANDING': return 'This paper requires moderation and none has been done.';
    case 'INCIDENTS_OPEN': return `${c.detail}. Close them before the results are finalised.`;
    case 'PAPER_NOT_PROJECTED': return 'A paper has no assessment behind it, so its marks cannot reach the results.';
    case 'EXAM_MARKS_NOT_APPROVED': return 'Marks for a candidate have not been approved yet.';
    case 'BAD_DATES': return 'The end date is before the start date.';
    case 'NO_TERM': return 'This examination has no term.';
    default: return c.detail;
  }
}

export function LifecycleBadge({ state }: { state: ExamLifecycleState }) {
  const tone = state === 'closed' || state === 'archived' ? 'secondary' : 'default';
  return (
    <Badge variant={tone}>
      {(state === 'closed' || state === 'archived') && <Lock className="mr-1 h-3 w-3" />}
      {LIFECYCLE_LABEL[state]}
    </Badge>
  );
}

/** The ten-step checklist. Every step is complete because its evidence exists. */
export function ExamStepList({ steps, onSelect, active }: { steps: ExamStep[]; onSelect?: (key: string) => void; active?: string }) {
  return (
    <ol className="space-y-1">
      {steps.map((s, i) => (
        <li key={s.key}>
          <button
            type="button"
            disabled={!onSelect}
            onClick={() => onSelect?.(s.key)}
            className={`flex w-full items-start gap-2 rounded px-2 py-1.5 text-left text-sm ${onSelect ? 'hover:bg-accent' : ''} ${active === s.key ? 'bg-accent' : ''}`}
          >
            {s.done
              ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
              : <CircleDashed className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />}
            <span className="min-w-0">
              <span className="block font-medium">{i + 1}. {s.label}</span>
              <span className="block text-xs text-muted-foreground">{s.detail}</span>
            </span>
          </button>
        </li>
      ))}
    </ol>
  );
}

/** What is blocking the next step, grouped so five pupils read as one instruction. */
export function GateBlockers({ conflicts, ready }: { conflicts: ExamGateConflict[]; ready: boolean }) {
  if (ready) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm">
        <CheckCircle2 className="h-4 w-4 text-emerald-600" /> Ready for the next step.
      </div>
    );
  }
  const groups = new Map<string, ExamGateConflict[]>();
  for (const c of conflicts) {
    const list = groups.get(c.code) ?? [];
    list.push(c);
    groups.set(c.code, list);
  }
  return (
    <div className="space-y-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
      <div className="flex items-center gap-2 font-medium">
        <AlertTriangle className="h-4 w-4 text-amber-600" /> Not ready yet
      </div>
      <ul className="space-y-1">
        {[...groups.values()].map((list, i) => (
          <li key={i} className="text-muted-foreground">
            {describeConflict(list[0])}
            {list.length > 1 && <span className="ml-1 text-xs">({list.length} occurrences)</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded border border-dashed p-6 text-center text-sm text-muted-foreground">{children}</p>;
}

export function fmtDate(v?: string | null): string {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
}

export function fmtDateTime(v?: string | null): string {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString(undefined, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export function num(v: string | number | null | undefined): string {
  if (v === null || v === undefined || v === '') return '—';
  const n = Number(v);
  return Number.isNaN(n) ? String(v) : String(Math.round(n * 100) / 100);
}

/** Pull the server's message out of an axios error without inventing one. */
export function apiMessage(e: unknown, fallback: string): string {
  const body = (e as { response?: { data?: { message?: unknown; conflicts?: Array<{ detail?: string }> } } })?.response?.data;
  if (body?.conflicts?.length) return body.conflicts.map((c) => c.detail).filter(Boolean).join('; ');
  if (typeof body?.message === 'string') return body.message;
  if (Array.isArray(body?.message)) return (body.message as string[]).join('; ');
  return fallback;
}
