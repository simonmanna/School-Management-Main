import { useNavigate } from 'react-router-dom';
import {
  ArrowRight, CalendarCheck2, Check, Handshake, PieChart, TrendingUp, Trophy, Wallet,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { money, date } from '@/lib/format';
import { cn } from '@/lib/utils';
import {
  useCrmPipeline, useCrmWinRate, useCrmForecast, useCrmTopCustomers, useCrmUpcomingTasks,
  useCrmDeals, useCompleteActivity, STAGE_META,
} from '@/features/crm/api';

function KpiCard({ icon: Icon, label, value, sub, accent }: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  sub?: string;
  accent?: string;
}) {
  return (
    <Card>
      <CardContent className="flex items-start justify-between px-5 py-4">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
          <p className="mt-1 truncate text-2xl font-bold text-foreground">{value}</p>
          {sub && <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>}
        </div>
        <div className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-xl', accent ?? 'bg-primary/10 text-primary')}>
          <Icon className="h-5 w-5" />
        </div>
      </CardContent>
    </Card>
  );
}

export function CrmDashboardPage() {
  const navigate = useNavigate();
  const completeActivity = useCompleteActivity();

  const { data: pipeline, isLoading: pipeLoading } = useCrmPipeline();
  const { data: winRate, isLoading: winLoading } = useCrmWinRate();
  const { data: forecast } = useCrmForecast(6);
  const { data: topCustomers } = useCrmTopCustomers(8);
  const { data: upcoming } = useCrmUpcomingTasks(10);
  const { data: recent } = useCrmDeals({ page: 1, pageSize: 8 });

  const loading = pipeLoading || winLoading;

  if (loading) {
    return (
      <div className="space-y-6 px-2 md:px-4 py-3 mx-auto">
        <Skeleton className="h-8 w-64" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 w-full" />)}
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const maxStageAmount = Math.max(1, ...(pipeline?.stages.map((s) => s.totalAmount) ?? [0]));
  const maxForecast = Math.max(1, ...(forecast?.map((f) => f.expectedAmount) ?? [0]));
  const totalOpen = pipeline?.stages.reduce((sum, s) => sum + s.count, 0) ?? 0;

  return (
    <div className="space-y-6 px-2 md:px-4 py-3 mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">CRM Dashboard</h1>
          <p className="text-sm text-muted-foreground">Pipeline health, forecast and follow-ups at a glance.</p>
        </div>
        <Button onClick={() => navigate('/crm/deals')}>
          <Handshake className="mr-1.5 h-4 w-4" /> Open Deals Pipeline
        </Button>
      </div>

      {/* KPIs */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          icon={Wallet}
          label="Open pipeline"
          value={money(pipeline?.openPipelineValue, 'IDR')}
          sub={`${totalOpen} open deals`}
          accent="bg-indigo-100 text-indigo-700"
        />
        <KpiCard
          icon={TrendingUp}
          label="Weighted value"
          value={money(pipeline?.weightedValue, 'IDR')}
          sub="probability-weighted"
          accent="bg-violet-100 text-violet-700"
        />
        <KpiCard
          icon={Trophy}
          label="Win rate"
          value={winRate ? `${Math.round(winRate.rate * 100)}%` : '-'}
          sub={winRate ? `${winRate.won} won · ${winRate.lost} lost` : undefined}
          accent="bg-emerald-100 text-emerald-700"
        />
        <KpiCard
          icon={CalendarCheck2}
          label="Upcoming tasks"
          value={String(upcoming?.length ?? 0)}
          sub="due soonest first"
          accent="bg-amber-100 text-amber-700"
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Stage distribution */}
        <Card>
          <CardHeader className="pb-3 px-5 pt-4 bg-muted/30 border-b rounded-t-lg">
            <CardTitle className="flex items-center gap-1.5 text-xs font-bold text-muted-foreground uppercase tracking-wider">
              <PieChart className="h-4 w-4" /> Stage distribution
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 px-5 py-4">
            {pipeline?.stages.map((s) => (
              <div key={s.stage}>
                <div className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2 font-medium capitalize">
                    <span className={cn('h-2 w-2 rounded-full', STAGE_META[s.stage].dot)} />
                    {STAGE_META[s.stage].label}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {s.count} deal{s.count === 1 ? '' : 's'} · {money(s.totalAmount, 'IDR')}
                  </span>
                </div>
                <div className="mt-1.5 h-2.5 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className={cn('h-full rounded-full transition-all', STAGE_META[s.stage].dot)}
                    style={{ width: `${(s.totalAmount / maxStageAmount) * 100}%` }}
                  />
                </div>
              </div>
            ))}
            {pipeline?.stages.every((s) => s.count === 0) && (
              <p className="py-6 text-center text-sm text-muted-foreground">No open deals yet — create your first deal.</p>
            )}
          </CardContent>
        </Card>

        {/* Forecast */}
        <Card>
          <CardHeader className="pb-3 px-5 pt-4 bg-muted/30 border-b rounded-t-lg">
            <CardTitle className="flex items-center gap-1.5 text-xs font-bold text-muted-foreground uppercase tracking-wider">
              <TrendingUp className="h-4 w-4" /> Forecast — expected close
            </CardTitle>
          </CardHeader>
          <CardContent className="px-5 py-4">
            <div className="flex h-44 items-end justify-between gap-3">
              {(forecast ?? []).map((f) => (
                <div key={f.month} className="flex flex-1 flex-col items-center gap-1.5">
                  <span className="text-[10px] font-semibold text-muted-foreground">
                    {f.expectedAmount > 0 ? money(f.expectedAmount, 'IDR').replace(/[,.]\d{2}$/, '') : ''}
                  </span>
                  <div
                    className={cn('w-full rounded-t-md transition-all', f.expectedAmount > 0 ? 'bg-gradient-to-t from-indigo-600 to-violet-500' : 'bg-muted')}
                    style={{ height: `${Math.max(4, (f.expectedAmount / maxForecast) * 100)}%` }}
                    title={`${f.month}: ${money(f.expectedAmount, 'IDR')}`}
                  />
                  <span className="text-[10px] font-medium text-muted-foreground">{f.month}</span>
                </div>
              ))}
            </div>
            {(forecast ?? []).length === 0 && (
              <p className="py-6 text-center text-sm text-muted-foreground">No expected-close dates set yet.</p>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Top customers */}
        <Card>
          <CardHeader className="pb-3 px-5 pt-4 bg-muted/30 border-b rounded-t-lg flex flex-row items-center justify-between">
            <CardTitle className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Top customers by open value</CardTitle>
            <Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={() => navigate('/crm/deals')}>
              View pipeline →
            </Button>
          </CardHeader>
          <CardContent className="px-5 py-4">
            {(topCustomers ?? []).length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">No data yet.</p>
            ) : (
              <ul className="space-y-3">
                {topCustomers?.map((c, i) => (
                  <li key={c.partnerId} className="flex items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-bold text-muted-foreground">{i + 1}</span>
                      <div className="min-w-0">
                        <button className="block max-w-[220px] truncate text-sm font-medium hover:text-primary hover:underline" onClick={() => navigate(`/customers/${c.partnerId}`)}>
                          {c.name}
                        </button>
                        <span className="text-xs text-muted-foreground">{c.dealCount} open deal{c.dealCount === 1 ? '' : 's'}</span>
                      </div>
                    </div>
                    <span className="text-sm font-bold">{money(c.dealValue, 'IDR')}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Upcoming tasks + recent deals */}
        <div className="space-y-6">
          <Card>
            <CardHeader className="pb-3 px-5 pt-4 bg-muted/30 border-b rounded-t-lg">
              <CardTitle className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Upcoming tasks</CardTitle>
            </CardHeader>
            <CardContent className="px-5 py-4">
              {(upcoming ?? []).length === 0 ? (
                <p className="py-4 text-center text-sm text-muted-foreground">All clear — no open tasks.</p>
              ) : (
                <ul className="space-y-2">
                  {upcoming?.slice(0, 5).map((t) => (
                    <li key={t.id} className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{t.title}</p>
                        <p className="text-[11px] text-muted-foreground">
                          {t.dueAt ? `Due ${date(t.dueAt)}` : 'No due date'}
                          {t.dealId ? ' · on deal' : ''}
                        </p>
                      </div>
                      <Button variant="outline" size="sm" className="h-7 px-2 text-[11px]" onClick={() => completeActivity.mutate(t.id)}>
                        <Check className="mr-1 h-3 w-3" /> Done
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3 px-5 pt-4 bg-muted/30 border-b rounded-t-lg flex flex-row items-center justify-between">
              <CardTitle className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Recently updated deals</CardTitle>
              <Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={() => navigate('/crm/deals')}>
                All deals →
              </Button>
            </CardHeader>
            <CardContent className="px-5 py-4">
              {(recent?.data ?? []).length === 0 ? (
                <p className="py-4 text-center text-sm text-muted-foreground">No deals yet.</p>
              ) : (
                <ul className="space-y-2">
                  {recent?.data.slice(0, 5).map((d) => (
                    <li key={d.id}>
                      <button className="group flex w-full items-center justify-between gap-3 text-left" onClick={() => navigate(`/crm/deals/${d.id}`)}>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium group-hover:text-primary">{d.name}</p>
                          <p className="text-[11px] text-muted-foreground">{d.partner?.name ?? '—'}</p>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <span className="text-sm font-bold">{money(d.amount, d.currencyCode || 'IDR')}</span>
                          <Badge variant="secondary" className={cn('text-[10px] capitalize', STAGE_META[d.stage].chip)}>{d.stage}</Badge>
                          <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
