import { useMemo, useState } from 'react';
import { LogOut, Calculator } from 'lucide-react';
import { useHrOffboarding, useHrSettlementPreview, useHrEmployees } from '@/features/hr/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export function HrOffboardingPage() {
  const [settleOpen, setSettleOpen] = useState(false);
  const [form, setForm] = useState<any>({ lastDay: new Date().toISOString().slice(0, 10) });
  const [settlement, setSettlement] = useState<any>(null);
  const { data: offboard } = useHrOffboarding({});
  const { data: empData } = useHrEmployees({ pageSize: 300 });
  const settlePreview = useHrSettlementPreview();

  const rows = useMemo(() => offboard?.rows ?? [], [offboard]);
  const employees = useMemo(() => empData?.rows ?? [], [empData]);

  const runSettlement = async () => {
    if (!form.employeeId || !form.lastDay) return;
    const res = await settlePreview.mutateAsync({ employeeId: form.employeeId, lastDay: form.lastDay });
    setSettlement(res);
  };

  const total = settlement ? (Number(settlement.salaryDue) + Number(settlement.leavePayout) + Number(settlement.bonusDue) - Number(settlement.loanBalance) - Number(settlement.unpaidDeductions)) : 0;

  return (
    <div className="space-y-4 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Offboarding & Final Settlement</h1>
          <p className="text-sm text-muted-foreground">Notice → final payroll → leave/loan settlement → asset return → access revocation → archive.</p>
        </div>
        <Button onClick={() => { setSettlement(null); setSettleOpen(true); }}><Calculator className="h-4 w-4" /> Compute settlement</Button>
      </div>

      <Card>
        <CardHeader className="bg-muted/30 border-b rounded-t-lg"><CardTitle className="text-sm">{rows.length} offboarding records</CardTitle></CardHeader>
        <CardContent className="p-0">
          <div className="divide-y">
            {rows.length === 0 && <p className="p-6 text-sm text-muted-foreground">No offboarding records yet.</p>}
            {rows.map((o: any) => (
              <div key={o.id} className="flex items-center justify-between px-4 py-3 hover:bg-muted/40">
                <div className="flex items-center gap-3">
                  <LogOut className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium">{o.employee ? `${o.employee.firstName} ${o.employee.lastName ?? ''}` : 'Employee'}</p>
                    <p className="text-xs text-muted-foreground">{o.reason} · last day {o.lastDay ? new Date(o.lastDay).toISOString().slice(0, 10) : '—'}</p>
                  </div>
                </div>
                <Badge variant="outline" className={o.status === 'COMPLETED' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}>{o.status}</Badge>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Dialog open={settleOpen} onOpenChange={setSettleOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Final settlement preview</DialogTitle></DialogHeader>
          <div className="grid gap-3">
            <div><Label>Employee *</Label>
              <select value={form.employeeId ?? ''} onChange={(e) => setForm({ ...form, employeeId: e.target.value })} className="w-full rounded-md border bg-card px-3 py-2 text-sm">
                <option value="">Select employee</option>
                {employees.map((e: any) => <option key={e.id} value={e.id}>{e.employeeCode} · {e.firstName} {e.lastName ?? ''}</option>)}
              </select>
            </div>
            <div><Label>Last working day *</Label><Input type="date" value={form.lastDay ?? ''} onChange={(e) => setForm({ ...form, lastDay: e.target.value })} /></div>
            <Button onClick={runSettlement} disabled={settlePreview.isPending}>Compute</Button>

            {settlement && (
              <div className="mt-2 space-y-1 rounded-md border p-3 text-sm">
                <Row k="Salary due" v={settlement.salaryDue} />
                <Row k="Leave payout" v={settlement.leavePayout} />
                <Row k="Bonus due" v={settlement.bonusDue} />
                <Row k="Loan balance" v={`-${settlement.loanBalance}`} />
                <Row k="Unpaid deductions" v={`-${settlement.unpaidDeductions}`} />
                <div className="border-t pt-1 font-semibold">Net settlement: {total}</div>
              </div>
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
