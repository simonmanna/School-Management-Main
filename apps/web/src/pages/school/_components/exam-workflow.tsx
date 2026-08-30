import { useCallback, useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Check } from 'lucide-react';

/**
 * Shared furniture for the termly academic workflow.
 *
 * The old screens were correct but unnavigable: eleven sibling pages, each
 * named after a domain noun, with no indication of what comes before or after.
 * Everything here exists to answer two questions the user kept asking — "where
 * am I?" and "what do I do next?".
 *
 * The rail used to stop at "Results", which is where the term actually gets
 * hard: approving marks, releasing results, printing cards and moving pupils up
 * were four unlinked screens an administrator had to already know about. It now
 * covers the whole term.
 */

export const STEPS = [
  { n: 1, label: 'Create exam', to: '/school/exam-workspace' },
  { n: 2, label: 'Choose classes', to: '/school/exam-workspace/classes' },
  { n: 3, label: 'Enter marks', to: '/school/enter-marks' },
  { n: 4, label: 'Approve marks', to: '/school/approvals' },
  { n: 5, label: 'Results', to: '/school/results' },
  { n: 6, label: 'Report cards', to: '/school/report-cards' },
  { n: 7, label: 'Promote', to: '/school/promotion' },
] as const;

export type StepNumber = 1 | 2 | 3 | 4 | 5 | 6 | 7;

/** The numbered rail across the top of every step. */
export function WorkflowSteps({ current }: { current: StepNumber }) {
  const { search } = useLocation();
  return (
    <nav aria-label="Exam workflow" className="flex flex-wrap items-center gap-1 rounded-lg border bg-card p-1.5">
      {STEPS.map((s, i) => {
        const state = s.n < current ? 'done' : s.n === current ? 'current' : 'todo';
        return (
          <div key={s.n} className="flex items-center">
            <Link
              to={`${s.to}${search}`}
              aria-current={state === 'current' ? 'step' : undefined}
              className={[
                'flex items-center gap-2 rounded-md px-3 py-1.5 text-sm transition',
                state === 'current'
                  ? 'bg-primary text-primary-foreground font-medium'
                  : 'text-muted-foreground hover:bg-accent hover:text-foreground',
              ].join(' ')}
            >
              <span
                className={[
                  'flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
                  state === 'current'
                    ? 'bg-primary-foreground text-primary'
                    : state === 'done'
                      ? 'bg-emerald-600 text-white'
                      : 'border border-current',
                ].join(' ')}
              >
                {state === 'done' ? <Check className="h-3 w-3" /> : s.n}
              </span>
              <span className="whitespace-nowrap">{s.label}</span>
            </Link>
            {i < STEPS.length - 1 && <span aria-hidden className="mx-0.5 h-px w-4 bg-border" />}
          </div>
        );
      })}
    </nav>
  );
}

export const selectClass =
  'h-9 w-full rounded-md border bg-card px-2.5 text-sm outline-none focus:ring-2 focus:ring-ring disabled:opacity-50';

/** A labelled dropdown — the filter strip is the same on every step. */
export function Picker({
  label, value, onChange, options, placeholder = 'Select…', disabled, className = 'min-w-[150px] flex-1',
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <div className={className}>
      <label className="mb-1 block text-xs font-medium text-muted-foreground">{label}</label>
      <select className={selectClass} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
        <option value="">{placeholder}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </div>
  );
}

/**
 * Selections survive the jump between steps. Losing your class and subject
 * every time you navigated was, on its own, most of what made the old flow feel
 * broken.
 */
export function useStickyState(key: string, initial = '') {
  const storageKey = `school.examflow.${key}`;
  const [value, setValue] = useState<string>(() => {
    try { return localStorage.getItem(storageKey) ?? initial; } catch { return initial; }
  });
  const set = useCallback((v: string) => {
    setValue(v);
    try {
      if (v) localStorage.setItem(storageKey, v);
      else localStorage.removeItem(storageKey);
    } catch { /* private mode */ }
  }, [storageKey]);
  return [value, set] as const;
}

/** Adopt a fallback once the options load, so a fresh user is never staring at empty dropdowns. */
export function useDefaulted(value: string, set: (v: string) => void, fallback: string | undefined) {
  useEffect(() => {
    if (!value && fallback) set(fallback);
  }, [value, fallback, set]);
}

/** Marks-entered progress, as a bar plus the raw counts. */
export function Progress({ done, total, className = '' }: { done: number; total: number; className?: string }) {
  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
  const tone = total === 0 ? 'bg-muted-foreground/30' : pct === 100 ? 'bg-emerald-600' : pct > 0 ? 'bg-amber-500' : 'bg-muted-foreground/30';
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <div className="h-1.5 w-24 overflow-hidden rounded-full bg-muted">
        <div className={`h-full rounded-full transition-all ${tone}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="whitespace-nowrap text-xs tabular-nums text-muted-foreground">
        {done}/{total}
      </span>
    </div>
  );
}

/** What to do when the screen would otherwise be blank. */
export function EmptyState({
  icon, title, hint, action,
}: { icon?: React.ReactNode; title: string; hint?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed py-14 text-center">
      {icon && <div className="text-muted-foreground">{icon}</div>}
      <div>
        <p className="font-medium">{title}</p>
        {hint && <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{hint}</p>}
      </div>
      {action}
    </div>
  );
}

export function fmtDate(d?: string | null) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
}
