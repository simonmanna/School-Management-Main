import { useMemo, useState } from 'react';
import { TrendingUp, Users, FileCheck2, GraduationCap, Percent } from 'lucide-react';
import { useAdmissionFunnel, useAdmissionBySource, useAcademicYears } from '@/features/school/api';
import { Card, CardContent } from '@/components/ui/card';
import { statusMeta } from './_components/admission-status';

/**
 * Admissions analytics dashboard (Phase 5). Funnel, conversion rates and source
 * breakdown — all computed server-side via groupBy, so it scales past the point
 * where loading every application into the browser would not.
 */
export function SchoolAdmissionsAnalyticsPage() {
  const { data: years } = useAcademicYears();
  const [yearId, setYearId] = useState<string>('');
  const { data: funnel, isLoading } = useAdmissionFunnel(yearId || undefined);
  const { data: bySource } = useAdmissionBySource(yearId || undefined);

  const stages = useMemo(() => {
    if (!funnel) return [];
    const s = funnel.stages;
    return [
      { key: 'submitted', label: 'Submitted', value: s.submitted, icon: Users },
      { key: 'reviewed', label: 'Reviewed', value: s.reviewed, icon: FileCheck2 },
      { key: 'accepted', label: 'Accepted', value: s.accepted, icon: FileCheck2 },
      { key: 'offered', label: 'Offered', value: s.offered, icon: TrendingUp },
      { key: 'offerAccepted', label: 'Offer accepted', value: s.offerAccepted, icon: TrendingUp },
      { key: 'enrolled', label: 'Enrolled', value: s.enrolled, icon: GraduationCap },
    ];
  }, [funnel]);

  const maxStage = Math.max(1, ...stages.map((s) => s.value));
  const sourceMax = Math.max(1, ...(bySource ?? []).map((s) => s.count));

  return (
    <div className="space-y-5 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Admissions analytics</h1>
          <p className="text-sm text-muted-foreground">The admissions funnel, conversion rates and enquiry sources.</p>
        </div>
        <select className="rounded-md border bg-card px-3 py-2 text-sm" value={yearId} onChange={(e) => setYearId(e.target.value)}>
          <option value="">All academic years</option>
          {(years?.data ?? []).map((y) => <option key={y.id} value={y.id}>{y.name}</option>)}
        </select>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label="Applications" value={funnel?.total ?? 0} sub={`${funnel?.drafts ?? 0} drafts`} />
        <Kpi label="Acceptance rate" value={`${funnel?.conversion.acceptanceRate ?? 0}%`} icon />
        <Kpi label="Offer acceptance" value={`${funnel?.conversion.offerAcceptanceRate ?? 0}%`} icon />
        <Kpi label="Overall yield" value={`${funnel?.conversion.overallYield ?? 0}%`} icon />
      </div>

      {/* Funnel */}
      <Card>
        <CardContent className="p-5">
          <h3 className="mb-4 text-sm font-semibold">Funnel</h3>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : (
            <div className="space-y-2">
              {stages.map((s) => (
                <div key={s.key} className="flex items-center gap-3">
                  <div className="w-32 shrink-0 text-sm text-muted-foreground">{s.label}</div>
                  <div className="h-7 flex-1 overflow-hidden rounded bg-muted/40">
                    <div
                      className="flex h-full items-center justify-end rounded bg-indigo-500/80 px-2 text-xs font-medium text-white"
                      style={{ width: `${Math.max(6, (s.value / maxStage) * 100)}%` }}
                    >
                      {s.value}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        {/* Status breakdown */}
        <Card>
          <CardContent className="p-5">
            <h3 className="mb-4 text-sm font-semibold">By status</h3>
            <div className="space-y-1.5">
              {Object.entries(funnel?.byStatus ?? {}).sort((a, b) => b[1] - a[1]).map(([status, count]) => {
                const meta = statusMeta(status);
                return (
                  <div key={status} className="flex items-center justify-between text-sm">
                    <span className={`rounded px-2 py-0.5 text-xs ${meta.cls}`}>{meta.label}</span>
                    <span className="font-medium">{count}</span>
                  </div>
                );
              })}
              {Object.keys(funnel?.byStatus ?? {}).length === 0 && (
                <p className="text-sm text-muted-foreground">No applications yet.</p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* By source */}
        <Card>
          <CardContent className="p-5">
            <h3 className="mb-4 text-sm font-semibold">Enquiry source</h3>
            <div className="space-y-2">
              {(bySource ?? []).map((s) => (
                <div key={s.source} className="flex items-center gap-3">
                  <div className="w-28 shrink-0 text-sm capitalize text-muted-foreground">{s.source}</div>
                  <div className="h-6 flex-1 overflow-hidden rounded bg-muted/40">
                    <div className="h-full rounded bg-emerald-500/80" style={{ width: `${Math.max(6, (s.count / sourceMax) * 100)}%` }} />
                  </div>
                  <div className="w-8 text-right text-sm font-medium">{s.count}</div>
                </div>
              ))}
              {(bySource ?? []).length === 0 && <p className="text-sm text-muted-foreground">No source data yet.</p>}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Kpi({ label, value, sub, icon }: { label: string; value: string | number; sub?: string; icon?: boolean }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">{label}</p>
          {icon && <Percent className="h-4 w-4 text-muted-foreground" />}
        </div>
        <p className="mt-1 text-2xl font-semibold">{value}</p>
        {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
      </CardContent>
    </Card>
  );
}
