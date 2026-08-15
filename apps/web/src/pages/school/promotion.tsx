import { useMemo, useState } from 'react';
import { ArrowRight, GraduationCap, SkipForward, Users } from 'lucide-react';
import { useTerms, useClasses, useRollover, type RolloverPlan } from '@/features/school/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { notify } from '@/lib/notify';

const sel = 'rounded-md border bg-card px-3 py-2 text-sm';

/**
 * Academic-year rollover (P5d) + the promotion decision surface.
 *
 * The flow is deliberately two-step: PREVIEW runs the server dry-run and shows
 * exactly who is promoted / graduated / skipped, and only then EXECUTE commits.
 * Rollover for a whole cohort should never be a single blind click.
 */
export function SchoolPromotionPage() {
  const { data: terms } = useTerms();
  const { data: classes } = useClasses();
  const rollover = useRollover();

  const [fromTermId, setFromTermId] = useState('');
  const [toTermId, setToTermId] = useState('');
  const [plan, setPlan] = useState<RolloverPlan | null>(null);
  const [committed, setCommitted] = useState(false);

  const termName = useMemo(
    () => Object.fromEntries((terms?.data ?? []).map((t) => [t.id, t.name])),
    [terms],
  );
  const className = useMemo(
    () => Object.fromEntries((classes?.data ?? []).map((c) => [c.id, c.name])),
    [classes],
  );

  const valid = fromTermId && toTermId && fromTermId !== toTermId;

  const preview = async () => {
    try {
      const res = await rollover.mutateAsync({ fromTermId, toTermId, dryRun: true });
      setPlan(res);
      setCommitted(false);
    } catch {
      notify.error('Could not compute the rollover plan');
    }
  };

  const execute = async () => {
    if (!plan) return;
    try {
      const res = await rollover.mutateAsync({ fromTermId, toTermId, dryRun: false });
      setPlan(res);
      setCommitted(true);
      const errs = (res.executed ?? []).filter((e) => e.outcome === 'error').length;
      if (errs > 0) notify.error(`Rollover committed with ${errs} error(s) — re-run to resume`);
      else notify.success(`Rollover committed — ${res.counts.promoted} promoted, ${res.counts.graduated} graduated`);
    } catch {
      notify.error('Rollover failed');
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Promotion &amp; Rollover</h1>
        <p className="text-sm text-muted-foreground">
          Advance active students one grade into a new term. Preview first; committing creates new
          enrollments and never edits history.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Academic-year rollover</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-end gap-4">
            <div className="space-y-1">
              <Label>From term (closing)</Label>
              <select className={sel} value={fromTermId} onChange={(e) => { setFromTermId(e.target.value); setPlan(null); }}>
                <option value="">Select…</option>
                {(terms?.data ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
            <ArrowRight className="mb-2 h-4 w-4 text-muted-foreground" />
            <div className="space-y-1">
              <Label>To term (opening)</Label>
              <select className={sel} value={toTermId} onChange={(e) => { setToTermId(e.target.value); setPlan(null); }}>
                <option value="">Select…</option>
                {(terms?.data ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
            <Button variant="outline" disabled={!valid || rollover.isPending} onClick={preview}>
              Preview
            </Button>
            <Button disabled={!plan || committed || rollover.isPending} onClick={execute}>
              Execute rollover
            </Button>
          </div>
          {fromTermId && toTermId && fromTermId === toTermId && (
            <p className="text-sm text-destructive">From and To term must differ.</p>
          )}
        </CardContent>
      </Card>

      {plan && (
        <>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <StatCard icon={<Users className="h-4 w-4" />} label="Active students" value={plan.counts.total} />
            <StatCard icon={<ArrowRight className="h-4 w-4" />} label="To promote" value={plan.counts.promoted} />
            <StatCard icon={<GraduationCap className="h-4 w-4" />} label="To graduate" value={plan.counts.graduated} />
            <StatCard icon={<SkipForward className="h-4 w-4" />} label="Skipped" value={plan.counts.skipped} />
          </div>

          <Card>
            <CardHeader>
              <CardTitle>
                {committed ? 'Committed' : 'Planned'} — {termName[plan.fromTermId] ?? '?'} → {termName[plan.toTermId] ?? '?'}
                {!committed && <span className="ml-2 text-xs font-normal text-muted-foreground">(dry-run, nothing written yet)</span>}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-muted-foreground">
                      <th className="py-2 pr-4">Admission&nbsp;No</th>
                      <th className="py-2 pr-4">Outcome</th>
                      <th className="py-2 pr-4">Target class</th>
                      <th className="py-2 pr-4">Note</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...plan.promote, ...plan.graduate, ...plan.skip].map((r) => (
                      <tr key={r.studentProfileId} className="border-b last:border-0">
                        <td className="py-2 pr-4 font-mono text-xs">{r.admissionNo}</td>
                        <td className="py-2 pr-4"><OutcomeBadge outcome={r.outcome} /></td>
                        <td className="py-2 pr-4">{r.toClassId ? (className[r.toClassId] ?? r.toClassId) : '—'}</td>
                        <td className="py-2 pr-4 text-muted-foreground">{r.reason ?? ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4">
        <div className="rounded-md bg-muted p-2 text-muted-foreground">{icon}</div>
        <div>
          <div className="text-2xl font-semibold">{value}</div>
          <div className="text-xs text-muted-foreground">{label}</div>
        </div>
      </CardContent>
    </Card>
  );
}

function OutcomeBadge({ outcome }: { outcome: string }) {
  const cls: Record<string, string> = {
    promoted: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
    graduated: 'bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-300',
    skipped: 'bg-muted text-muted-foreground',
  };
  return <span className={`rounded px-2 py-0.5 text-xs font-medium ${cls[outcome] ?? 'bg-muted'}`}>{outcome}</span>;
}
