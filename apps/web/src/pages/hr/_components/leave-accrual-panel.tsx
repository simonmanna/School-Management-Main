import { useState } from 'react';
import { CalendarClock, PlayCircle, RotateCcw, TimerOff } from 'lucide-react';
import { toast } from 'sonner';
import {
  useExpireCarryForward,
  useRunLeaveAccrual,
  useRunLeaveYearEnd,
} from '@/features/hr/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * The leave accrual controls.
 *
 * Every action here is previewed before it is committed. That is not politeness:
 * a year-end rollover forfeits days people have earned, and the only honest way
 * to run it is to show exactly whose days and how many, first. The server does
 * the same work either way — `dryRun` computes the movements and writes nothing.
 *
 * Re-running is safe. Each grant is keyed by its accrual period, so pressing a
 * button twice grants nothing twice; that is what makes these usable as a
 * monthly routine rather than a once-only migration.
 */

type Mode = 'accrual' | 'year-end' | 'expiry';

export function LeaveAccrualPanel() {
  const thisYear = new Date().getFullYear();
  const [asOf, setAsOf] = useState(new Date().toISOString().slice(0, 10));
  const [year, setYear] = useState(thisYear - 1);
  const [preview, setPreview] = useState<{ mode: Mode; data: any } | null>(null);

  const accrual = useRunLeaveAccrual();
  const yearEnd = useRunLeaveYearEnd();
  const expiry = useExpireCarryForward();

  const busy = accrual.isPending || yearEnd.isPending || expiry.isPending;

  const fail = (err: any) =>
    toast.error(err?.response?.data?.message ?? 'That could not be run.');

  const previewAccrual = async () => {
    try {
      setPreview({ mode: 'accrual', data: await accrual.mutateAsync({ asOf, dryRun: true }) });
    } catch (err) { fail(err); }
  };
  const previewYearEnd = async () => {
    try {
      setPreview({ mode: 'year-end', data: await yearEnd.mutateAsync({ year, dryRun: true }) });
    } catch (err) { fail(err); }
  };
  const previewExpiry = async () => {
    try {
      setPreview({ mode: 'expiry', data: await expiry.mutateAsync({ year: thisYear, asOf, dryRun: true }) });
    } catch (err) { fail(err); }
  };

  const commit = async () => {
    if (!preview) return;
    try {
      if (preview.mode === 'accrual') {
        const r = await accrual.mutateAsync({ asOf });
        toast.success(`Granted ${r.daysGranted} day(s) to ${r.employeesTouched} employee(s).`);
      } else if (preview.mode === 'year-end') {
        const r = await yearEnd.mutateAsync({ year });
        toast.success(`Carried ${r.totalCarried} day(s), forfeited ${r.totalForfeited}.`);
      } else {
        const r = await expiry.mutateAsync({ year: thisYear, asOf });
        toast.success(`Expired ${r.totalExpired} unused carried day(s).`);
      }
      setPreview(null);
    } catch (err) { fail(err); }
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-3">
        <Action
          icon={PlayCircle}
          title="Run accrual"
          body="Bring every employee's leave up to date. Only accrual periods that have CLOSED are granted, so nobody earns days for a month still running."
          control={
            <div>
              <Label className="text-xs text-muted-foreground">As at</Label>
              <Input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} />
            </div>
          }
          onPreview={previewAccrual}
          disabled={busy}
        />
        <Action
          icon={RotateCcw}
          title="Close a leave year"
          body="Carry forward what each leave type allows and forfeit the rest. Forfeiture is recorded, not silent — staff can see what they lost and when."
          control={
            <div>
              <Label className="text-xs text-muted-foreground">Year to close</Label>
              <Input
                type="number"
                value={year}
                onChange={(e) => setYear(Number(e.target.value))}
              />
            </div>
          }
          onPreview={previewYearEnd}
          disabled={busy}
        />
        <Action
          icon={TimerOff}
          title="Expire carried days"
          body="Remove carried-forward days not used by the policy deadline. Days already taken count against the carried block first."
          control={
            <p className="pt-5 text-xs text-muted-foreground">
              Uses the “as at” date on the left.
            </p>
          }
          onPreview={previewExpiry}
          disabled={busy}
        />
      </div>

      {preview && <PreviewCard preview={preview} onCommit={commit} onCancel={() => setPreview(null)} busy={busy} />}
    </div>
  );
}

function Action({
  icon: Icon, title, body, control, onPreview, disabled,
}: {
  icon: typeof PlayCircle;
  title: string;
  body: string;
  control: React.ReactNode;
  onPreview: () => void;
  disabled?: boolean;
}) {
  return (
    <Card className="flex flex-col p-4">
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 text-muted-foreground" />
        <h3 className="text-sm font-medium">{title}</h3>
      </div>
      <p className="mt-1 flex-1 text-xs leading-relaxed text-muted-foreground">{body}</p>
      <div className="mt-3">{control}</div>
      <Button className="mt-3" variant="outline" size="sm" onClick={onPreview} disabled={disabled}>
        Preview
      </Button>
    </Card>
  );
}

function PreviewCard({
  preview, onCommit, onCancel, busy,
}: {
  preview: { mode: Mode; data: any };
  onCommit: () => void;
  onCancel: () => void;
  busy: boolean;
}) {
  const { mode, data } = preview;

  const rows: Array<{ who: string; what: string; detail: string }> =
    mode === 'accrual'
      ? (data.granted ?? []).map((g: any) => ({
          who: g.employeeName,
          what: `+${g.days} day(s) ${g.leaveTypeName}`,
          detail: `${g.periodKey} · ${String(g.reason).toLowerCase().replace(/_/g, ' ')}`,
        }))
      : mode === 'year-end'
        ? (data.movements ?? []).map((m: any) => ({
            who: m.employeeName,
            what: `carry ${m.carried}, forfeit ${m.forfeited}`,
            detail: `${m.leaveTypeName} · ${m.remaining} day(s) remaining at close`,
          }))
        : (data.expiries ?? []).map((e: any) => ({
            who: e.employeeId,
            what: `−${e.expired} day(s)`,
            detail: `${e.leaveTypeName} · carried ${e.carried}, deadline ${e.deadline}`,
          }));

  const headline =
    mode === 'accrual'
      ? `${data.daysGranted ?? 0} day(s) would be granted to ${data.employeesTouched ?? 0} employee(s).`
      : mode === 'year-end'
        ? `${data.totalCarried ?? 0} day(s) would carry into ${data.intoYear}; ${data.totalForfeited ?? 0} would be forfeited.`
        : `${data.totalExpired ?? 0} carried day(s) would expire.`;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between rounded-t-lg border-b bg-muted/30">
        <CardTitle className="flex items-center gap-2 text-sm">
          <CalendarClock className="h-4 w-4" /> Preview — nothing has been written
        </CardTitle>
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" onClick={onCancel}>Discard</Button>
          <Button size="sm" onClick={onCommit} disabled={busy || rows.length === 0}>
            Apply {rows.length} movement(s)
          </Button>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <p className="border-b px-4 py-3 text-sm">{headline}</p>
        <div className="max-h-80 divide-y overflow-y-auto">
          {rows.length === 0 && (
            <p className="p-6 text-sm text-muted-foreground">
              Nothing to do — everything is already up to date.
            </p>
          )}
          {rows.map((r, i) => (
            <div key={i} className="flex items-center justify-between px-4 py-2">
              <div>
                <p className="text-sm">{r.who}</p>
                <p className="text-xs text-muted-foreground">{r.detail}</p>
              </div>
              <p className="text-sm font-medium">{r.what}</p>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
