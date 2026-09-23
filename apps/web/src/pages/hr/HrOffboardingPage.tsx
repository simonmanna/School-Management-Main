import { useMemo, useState } from 'react';
import { LogOut, Calculator } from 'lucide-react';
import { toast } from 'sonner';
import { useHrOffboarding, useHrSettlementPreview, useHrSettle, useHrEmployees } from '@/features/hr/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useMoneyFormatter } from '@/lib/format';

const REASONS = ['resignation', 'termination', 'retirement', 'contract_expiry', 'redundancy', 'death', 'dismissal'];

export function HrOffboardingPage() {
  const fmt = useMoneyFormatter();
  const [settleOpen, setSettleOpen] = useState(false);
  const [form, setForm] = useState<any>({ lastDay: new Date().toISOString().slice(0, 10), reason: 'resignation' });
  const [estimate, setEstimate] = useState<any>(null);
  const { data: offboard } = useHrOffboarding({});
  const { data: empData } = useHrEmployees({ pageSize: 300 });
  const preview = useHrSettlementPreview();
  const settle = useHrSettle();

  const rows = useMemo(() => offboard?.rows ?? [], [offboard]);
  const employees = useMemo(() => empData?.rows ?? [], [empData]);

  const compute = async () => {
    if (!form.employeeId || !form.lastDay) return;
    try {
      setEstimate(await preview.mutateAsync({ employeeId: form.employeeId, lastDay: form.lastDay }));
    } catch (e: any) {
      toast.error(e?.response?.data?.message ?? 'Could not compute the settlement');
    }
  };

  const confirmSettle = async () => {
    if (!confirm('Confirm the exit? The employee is deactivated and their final pay is made by the payroll run for this period.')) return;
    try {
      await settle.mutateAsync({ employeeId: form.employeeId, lastDay: form.lastDay, reason: form.reason, notes: form.notes || undefined });
      toast.success('Settlement recorded — approve the leave-encashment input, then calculate the final payroll.');
      setSettleOpen(false);
      setEstimate(null);
    } catch (e: any) {
      toast.error(e?.response?.data?.message ?? 'Settlement failed');
    }
  };

  return (
    <div className="space-y-4 p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold">Offboarding & Final Settlement</h1>
          <p className="text-sm text-muted-foreground">
            Notice → settlement → final payroll (pro-rated salary, taxed leave payout, loans recovered) → access revocation → archive.
          </p>
        </div>
        <Button onClick={() => { setEstimate(null); setSettleOpen(true); }}><Calculator className="h-4 w-4" /> Settle an exit</Button>
      </div>

      <Card>
        <CardHeader className="bg-muted/30 border-b rounded-t-lg"><CardTitle className="text-sm">{rows.length} offboarding records</CardTitle></CardHeader>
        <CardContent className="p-0">
          <div className="divide-y">
            {rows.length === 0 && <p className="p-6 text-sm text-muted-foreground">No offboarding records yet.</p>}
            {rows.map((o: any) => (
              <div key={o.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 hover:bg-muted/40">
                <div className="flex items-center gap-3">
                  <LogOut className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium">{o.employee ? `${o.employee.firstName} ${o.employee.lastName ?? ''}` : 'Employee'}</p>
                    <p className="text-xs text-muted-foreground">
                      {o.reason?.replace('_', ' ')} · last day {o.lastWorkingDay ? new Date(o.lastWorkingDay).toISOString().slice(0, 10) : '—'}
                      {Number(o.leavePayout ?? 0) > 0 ? ` · leave payout ${fmt(o.leavePayout)}` : ''}
                    </p>
                  </div>
                </div>
                <Badge variant="outline" className={o.status === 'settled' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}>{o.status}</Badge>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Dialog open={settleOpen} onOpenChange={setSettleOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Final settlement</DialogTitle></DialogHeader>
          <div className="grid gap-3">
            <div><Label>Employee *</Label>
              <select value={form.employeeId ?? ''} onChange={(e) => { setForm({ ...form, employeeId: e.target.value }); setEstimate(null); }} className="w-full rounded-md border bg-card px-3 py-2 text-sm">
                <option value="">Select employee</option>
                {employees.map((e: any) => <option key={e.id} value={e.id}>{e.employeeCode} · {e.firstName} {e.lastName ?? ''}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Last working day *</Label><Input type="date" value={form.lastDay ?? ''} onChange={(e) => { setForm({ ...form, lastDay: e.target.value }); setEstimate(null); }} /></div>
              <div><Label>Reason</Label>
                <select value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} className="w-full rounded-md border bg-card px-3 py-2 text-sm">
                  {REASONS.map((r) => <option key={r} value={r}>{r.replace('_', ' ')}</option>)}
                </select>
              </div>
            </div>
            <div><Label>Notes</Label><Input value={form.notes ?? ''} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
            <Button variant="outline" onClick={compute} disabled={preview.isPending || !form.employeeId}>Compute estimate</Button>

            {estimate && (
              <div className="mt-1 space-y-1 rounded-md border p-3 text-sm">
                <Row k="Final period salary (pro-rated)" v={fmt(estimate.salaryDue)} />
                <Row k={`Leave encashment (${estimate.leaveDays} days)`} v={fmt(estimate.leavePayout)} />
                <Row k="Loans recovered" v={`−${fmt(estimate.loanOutstanding)}`} />
                <Row k="Advances recovered" v={`−${fmt(estimate.advanceOutstanding)}`} />
                <div className="flex justify-between border-t pt-1 font-semibold"><span>Estimated net (before tax)</span><span>{fmt(estimate.netSettlement)}</span></div>
                <p className="pt-1 text-xs text-muted-foreground">{estimate.note}</p>
                {!estimate.finalPayrollPeriod && (
                  <p className="text-xs text-amber-700">No payroll period covers this date yet — create it before confirming.</p>
                )}
              </div>
            )}
            {estimate && (
              <Button onClick={confirmSettle} disabled={settle.isPending || !estimate.finalPayrollPeriod}>
                Confirm exit{estimate.finalPayrollPeriod ? ` — final pay in ${estimate.finalPayrollPeriod.periodCode}` : ''}
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Row({ k, v }: { k: string; v: any }) {
  return (
    <div className="flex justify-between">
      <span className="text-muted-foreground">{k}</span>
      <span>{v ?? 0}</span>
    </div>
  );
}
