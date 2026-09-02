import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  BarChart3, BookOpen, CalendarDays, ClipboardList, GraduationCap, Search,
  Users, Wallet, Star,
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { useReportCatalog } from '@/features/school/reports-api';
import type { ReportCatalogEntry } from '@/features/school/reports-api';

/**
 * The report centre.
 *
 * Lists only what the signed-in user may actually run — the API filters the
 * catalogue by grant, so a class teacher never learns that a "Fee Defaulters"
 * report exists.
 *
 * Cross-links to the existing charted screens rather than replacing them: the
 * analytics, attendance and admissions pages give a picture this generic runner
 * cannot, and rebuilding them here would lose that.
 */

const DOMAIN_META: Record<string, { label: string; icon: typeof Users }> = {
  student: { label: 'Students', icon: Users },
  enrollment: { label: 'Enrolment', icon: ClipboardList },
  admissions: { label: 'Admissions', icon: ClipboardList },
  attendance: { label: 'Attendance', icon: CalendarDays },
  academics: { label: 'Academics', icon: GraduationCap },
  fees: { label: 'Fees', icon: Wallet },
  finance: { label: 'Finance', icon: Wallet },
  staff: { label: 'Staff', icon: Users },
  timetable: { label: 'Timetable', icon: CalendarDays },
  curriculum: { label: 'Curriculum', icon: BookOpen },
  lms: { label: 'Learning', icon: BookOpen },
  meals: { label: 'Meals', icon: ClipboardList },
  inventory: { label: 'Inventory', icon: ClipboardList },
  documents: { label: 'Documents', icon: ClipboardList },
  executive: { label: 'Management', icon: BarChart3 },
  audit: { label: 'Audit', icon: ClipboardList },
};

/** Related screens that show the same data with charts the runner cannot draw. */
const RELATED_SCREENS: Array<{ to: string; label: string; note: string }> = [
  { to: '/school/analytics', label: 'Academic analytics', note: 'Charted trends and distributions' },
  { to: '/school/attendance-report', label: 'Attendance dashboard', note: 'Charted attendance over time' },
  { to: '/school/enrollment-summary', label: 'Enrolment summary', note: 'Boarding and day breakdown' },
  { to: '/school/admissions-analytics', label: 'Admissions funnel', note: 'Stage-by-stage conversion' },
  { to: '/school/report-cards', label: 'Report cards', note: 'Printable pupil report cards' },
];

const FAVOURITES_KEY = 'school.reports.favourites';

function loadFavourites(): string[] {
  try {
    return JSON.parse(localStorage.getItem(FAVOURITES_KEY) ?? '[]') as string[];
  } catch {
    // Private windows and cleared site data both land here. A missing
    // favourites list is not an error worth showing anyone.
    return [];
  }
}

export default function SchoolReportsPage() {
  const { data: catalog, isLoading, error } = useReportCatalog();
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
    return [...byDomain.entries()].sort(([a], [b]) =>
      (DOMAIN_META[a]?.label ?? a).localeCompare(DOMAIN_META[b]?.label ?? b));
  }, [catalog, query]);

  const starred = (catalog ?? []).filter((r) => favourites.includes(r.key));

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Reports</h1>
        <p className="text-sm text-muted-foreground">
          {isLoading ? 'Loading…' : `${catalog?.length ?? 0} report(s) available to you.`}
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
          Could not load the report catalogue. You may not have the
          <code className="mx-1">school:reports:read</code> permission yet.
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
        const meta = DOMAIN_META[domain] ?? { label: domain, icon: ClipboardList };
        const Icon = meta.icon;
        return (
          <section key={domain}>
            <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              <Icon className="h-4 w-4" /> {meta.label}
            </h2>
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
          <Link to={`/school/reports/${r.key}`} className="block pr-6">
            <h3 className="font-medium">{r.title}</h3>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{r.description}</p>
            {r.asOfMode === 'current-only' && (
              <p className="mt-2 text-[11px] text-amber-600">Current balances only</p>
            )}
          </Link>
        </Card>
      ))}
    </div>
  );
}
