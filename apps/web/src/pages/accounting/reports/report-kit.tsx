/**
 * Shared presentation kit for the accounting report suite.
 *
 * Every report in this folder is built from these primitives so the whole set
 * prints and exports identically — a client who exports the P&L and the cash
 * book gets two files with the same header block, the same column discipline
 * and the same footing rules.
 */
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { money, useOrgCurrency } from '@/lib/format';
import { useAuthStore } from '@/stores/auth.store';

// ─────────────────────────────── formatting ────────────────────────────────

export function useMoney(): (v?: string | number | null) => string {
  const currency = useOrgCurrency();
  return React.useCallback((v?: string | number | null) => money(v ?? 0, currency), [currency]);
}

/** Accounting presentation: negatives in parentheses, zero as a dash. */
export function useAccountingMoney(): (v?: string | number | null, opts?: { blankZero?: boolean }) => string {
  const fmt = useMoney();
  return React.useCallback(
    (v?: string | number | null, opts?: { blankZero?: boolean }) => {
      const n = Number(v ?? 0);
      if (!Number.isFinite(n)) return '—';
      if (n === 0) return opts?.blankZero === false ? fmt(0) : '—';
      return n < 0 ? `(${fmt(Math.abs(n))})` : fmt(n);
    },
    [fmt],
  );
}

export function fmtDate(value?: string | Date | null): string {
  if (!value) return '—';
  const d = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: '2-digit' });
}

export function fmtDateTime(value?: string | Date | null): string {
  if (!value) return '—';
  const d = typeof value === 'string' ? new Date(value) : value;
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
}

export function fmtPercent(value?: string | number | null, digits = 1): string {
  if (value === null || value === undefined || value === '') return '—';
  const n = Number(value);
  return Number.isFinite(n) ? `${n.toFixed(digits)}%` : '—';
}

export const todayIso = (): string => new Date().toISOString().slice(0, 10);

// ─────────────────────────────── export wiring ─────────────────────────────

export interface ExportPayload {
  /** File stem — no extension. */
  filename: string;
  title: string;
  subtitle?: string;
  headers: string[];
  rows: string[][];
}

interface ExportContextValue {
  payload: ExportPayload | null;
  setPayload: (p: ExportPayload | null) => void;
}

const ExportContext = createContext<ExportContextValue>({ payload: null, setPayload: () => {} });

export const ExportProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [payload, setPayload] = useState<ExportPayload | null>(null);
  const value = useMemo(() => ({ payload, setPayload }), [payload]);
  return <ExportContext.Provider value={value}>{children}</ExportContext.Provider>;
};

export function useExportPayload(): ExportPayload | null {
  return useContext(ExportContext).payload;
}

/**
 * Publish the flat rows behind the currently rendered report so the page-level
 * toolbar can export exactly what is on screen. `deps` is what the payload was
 * derived from, so the effect does not re-publish on every render.
 */
export function useRegisterExport(build: () => ExportPayload | null, deps: unknown[]): void {
  const { setPayload } = useContext(ExportContext);
  useEffect(() => {
    setPayload(build());
    return () => setPayload(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

// ─────────────────────────────── layout pieces ─────────────────────────────

/**
 * The letterhead every report carries: organisation, report name, the period
 * it covers and when it was run. This is what makes an exported or printed
 * page defensible on its own, away from the screen it came from.
 */
export const ReportHeader: React.FC<{
  title: string;
  subtitle?: string;
  periodLabel: string;
  generatedAt?: string;
  basis?: string;
  right?: React.ReactNode;
}> = ({ title, subtitle, periodLabel, generatedAt, basis = 'Accrual basis · posted entries only', right }) => {
  const org = useAuthStore((s) => s.organization);
  const currency = useOrgCurrency();
  return (
    <div className="acct-report-header">
      <div>
        <div className="acct-report-org">{org?.name ?? 'Organisation'}</div>
        <h2 className="acct-report-title">{title}</h2>
        {subtitle && <div className="acct-report-subtitle">{subtitle}</div>}
        <div className="acct-report-period">{periodLabel}</div>
        <div className="acct-report-meta">
          {basis} · Amounts in {currency}
          {generatedAt ? ` · Generated ${fmtDateTime(generatedAt)}` : ''}
        </div>
      </div>
      {right && <div className="acct-report-header-right no-print">{right}</div>}
    </div>
  );
};

export const StatTile: React.FC<{
  label: string;
  value: string;
  hint?: string;
  tone?: 'default' | 'positive' | 'negative' | 'warning';
}> = ({ label, value, hint, tone = 'default' }) => (
  <div className={`acct-stat acct-stat-${tone}`}>
    <div className="acct-stat-label">{label}</div>
    <div className="acct-stat-value">{value}</div>
    {hint && <div className="acct-stat-hint">{hint}</div>}
  </div>
);

export const StatRow: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="acct-stat-row">{children}</div>
);

export const ReportTable: React.FC<{
  children: React.ReactNode;
  /** Renders the table edge-to-edge inside its own horizontal scroller. */
  dense?: boolean;
}> = ({ children, dense }) => (
  <div className="acct-table-wrap">
    <table className={`acct-table${dense ? ' acct-table-dense' : ''}`}>{children}</table>
  </div>
);

export const EmptyState: React.FC<{ message: string; hint?: string }> = ({ message, hint }) => (
  <div className="acct-empty">
    <div className="acct-empty-title">{message}</div>
    {hint && <div className="acct-empty-hint">{hint}</div>}
  </div>
);

export const LoadingRows: React.FC<{ cols: number; rows?: number }> = ({ cols, rows = 8 }) => (
  <>
    {Array.from({ length: rows }).map((_, i) => (
      <tr key={i}>
        {Array.from({ length: cols }).map((__, j) => (
          <td key={j}>
            <div className="acct-skeleton" />
          </td>
        ))}
      </tr>
    ))}
  </>
);

/** Signed delta, coloured by direction, with the sign always shown. */
export const Variance: React.FC<{ value?: string | null; percent?: string | null; invert?: boolean }> = ({
  value,
  percent,
  invert,
}) => {
  const fmt = useAccountingMoney();
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n === 0) return <span className="acct-muted">—</span>;
  const good = invert ? n < 0 : n > 0;
  return (
    <span className={good ? 'acct-pos' : 'acct-neg'}>
      {n > 0 ? '+' : '−'}
      {fmt(Math.abs(n))}
      {percent ? ` (${Number(percent) > 0 ? '+' : ''}${Number(percent).toFixed(1)}%)` : ''}
    </span>
  );
};

export function periodLabel(from?: string, to?: string): string {
  if (!from && !to) return 'All dates';
  return `For the period ${fmtDate(from)} to ${fmtDate(to)}`;
}

export function asOfLabel(asOf?: string): string {
  return `As at ${fmtDate(asOf)}`;
}
