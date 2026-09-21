import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  BadgeCheck, CalendarDays, ClipboardList, Search, Star, Users, Wallet,
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { useHrReportCatalog } from '@/features/hr/reports-api';
import type { ReportCatalogEntry } from '@/features/reports/types';

/**
 * The HR & payroll report centre.
 *
 * Lists only what the signed-in user may actually run — the API filters the
 * catalogue by grant, so a head of department never learns that a payroll
 * register exists. That is why the payroll section can simply be absent rather
 * than shown and disabled.
 */

const DOMAIN_META: Record<string, { label: string; icon: typeof Users; note: string }> = {
  payroll: {
    label: 'Payroll',
    icon: Wallet,
    note: 'Reads the approved run — never recalculates, so these tie to the payslips and the ledger.',
  },
  hr: {
    label: 'Workforce',
    icon: Users,
    note: 'Establishment, compliance, leave and attendance.',
  },
};

/** Screens that do something this generic runner cannot. */
const RELATED_SCREENS: Array<{ to: string; label: string; note: string }> = [
  { to: '/hr/payroll', label: 'Payroll runs', note: 'Calculate, approve and reverse' },
  { to: '/hr/payroll/inputs', label: 'Payroll inputs', note: 'Capture and approve one-off pay' },
  { to: '/hr/payslips', label: 'Payslips', note: 'Issue, mark paid and download' },
  { to: '/hr/leave', label: 'Leave', note: 'Requests, balances and accrual' },
  { to: '/hr/attendance', label: 'Attendance', note: 'Daily staff attendance' },
  { to: '/hr/reports/quick-view', label: 'Quick view', note: 'The older three-tab attendance/leave/payroll screen' },
];

const FAVOURITES_KEY = 'hr.reports.favourites';

function loadFavourites(): string[] {
  try {
    return JSON.parse(localStorage.getItem(FAVOURITES_KEY) ?? '[]') as string[];
  } catch {
    // Private windows and cleared site data both land here. A missing
    // favourites list is not an error worth showing anyone.
    return [];
  }
}

export default function HrReportCentrePage() {
  const { data: catalog, isLoading, error } = useHrReportCatalog();
  const [query, setQuery] = useState('');
  const [favourites, setFavourites] = useState<string[]>(loadFavourites);

  const toggleFavourite = (key: string) => {
    const next = favourites.includes(key)
      ? favourites.filter((k) => k !== key)
      : [...favourites, key];
    setFavourites(next);
    try {
      localStorage.setItem(FAVOURITES_KEY, JSON.stringify(next));
    } catch {
      // Storage can throw outright (blocked site data). The toggle still works
      // for this session; it simply will not be remembered.
    }
  };

  const grouped = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matches = (r: ReportCatalogEntry) =>
      !q || r.title.toLowerCase().includes(q) || r.description.toLowerCase().includes(q);

    const byDomain = new Map<string, ReportCatalogEntry[]>();
    for (const r of (catalog ?? []).filter(matches)) {
      if (!byDomain.has(r.domain)) byDomain.set(r.domain, []);
      byDomain.get(r.domain)!.push(r);
    }
    // Payroll first: it is what a bursar opens this page for.
    return [...byDomain.entries()].sort(([a], [b]) =>
      (a === 'payroll' ? -1 : b === 'payroll' ? 1 : a.localeCompare(b)));
  }, [catalog, query]);

  const starred = (catalog ?? []).filter((r) => favourites.includes(r.key));

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">HR &amp; payroll reports</h1>
        <p className="text-sm text-muted-foreground">
          {isLoading ? 'Loading…' : `${catalog?.length ?? 0} report(s) available to you. Every one exports to CSV, Excel and PDF.`}
        </p>
      </div>

      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="pl-9"
          placeholder="Search reports…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {error && (
        <Card className="border-destructive/40 bg-destructive/5 p-4 text-sm">
          Could not load the HR report catalogue. You may not have the
          <code className="mx-1">hr:reports:read</code> permission yet.
        </Card>
      )}

      {starred.length > 0 && !query && (
        <section>
          <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            <Star className="h-4 w-4" /> Starred
          </h2>
          <ReportGrid reports={starred} favourites={favourites} onToggle={toggleFavourite} />
        </section>
      )}

      {grouped.map(([domain, reports]) => {
        const meta = DOMAIN_META[domain] ?? { label: domain, icon: ClipboardList, note: '' };
        const Icon = meta.icon;
        return (
          <section key={domain}>
            <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              <Icon className="h-4 w-4" /> {meta.label}
            </h2>
            {meta.note && <p className="mb-2 text-xs text-muted-foreground">{meta.note}</p>}
            <ReportGrid reports={reports} favourites={favourites} onToggle={toggleFavourite} />
          </section>
        );
      })}

      {!isLoading && grouped.length === 0 && !error && (
        <p className="text-sm text-muted-foreground">No reports match “{query}”.</p>
      )}

      <section className="border-t pt-5">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Related screens
        </h2>
        <div className="flex flex-wrap gap-2">
          {RELATED_SCREENS.map((s) => (
            <Link
              key={s.to}
              to={s.to}
              className="rounded-md border px-3 py-2 text-sm hover:bg-accent"
              title={s.note}
            >
              {s.label}
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}

function ReportGrid({ reports, favourites, onToggle }: {
  reports: ReportCatalogEntry[];
  favourites: string[];
  onToggle: (key: string) => void;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {reports.map((r) => (
        <Card key={r.key} className="group relative p-4 transition hover:border-primary/50">
          <button
            type="button"
            aria-label={favourites.includes(r.key) ? 'Unstar report' : 'Star report'}
            className="absolute right-3 top-3 text-muted-foreground hover:text-amber-500"
            onClick={() => onToggle(r.key)}
          >
            <Star className={`h-4 w-4 ${favourites.includes(r.key) ? 'fill-amber-400 text-amber-500' : ''}`} />
          </button>
          <Link to={`/hr/reports/${r.key}`} className="block pr-6">
            <h3 className="font-medium">{r.title}</h3>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{r.description}</p>
            {r.key === 'payroll.readiness' && (
              <p className="mt-2 inline-flex items-center gap-1 text-[11px] text-emerald-700">
                <BadgeCheck className="h-3 w-3" /> Run before every payroll
              </p>
            )}
            {(r.filters.includes('dateFrom') && !r.requiredFilters.includes('dateFrom')) && (
              <p className="mt-2 inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                <CalendarDays className="h-3 w-3" /> Defaults to a sensible window
              </p>
            )}
          </Link>
        </Card>
      ))}
    </div>
  );
}
