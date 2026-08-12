import { useMemo, useState } from 'react';
import { Wallet } from 'lucide-react';
import { useHrPayrollRuns, useHrPayrollRun, useHrPayrollPeriods, useCreateHrPayrollRun, useCalculateHrPayrollRun, useApproveHrPayrollRun, useReverseHrPayrollRun } from '@/features/hr/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';

const fmt = (n: number | string) => `Rp ${Number(n || 0).toLocaleString('id-ID')}`;

const RUN_STATUS: Record<string, string> = {
  DRAFT: 'bg-muted text-muted-foreground',
  CALCULATED: 'bg-cyan-100 text-cyan-800',
  APPROVED: 'bg-emerald-100 text-emerald-800',
  PAID: 'bg-sky-100 text-sky-800',
  REVERSED: 'bg-amber-100 text-amber-800',
};

export function HrPayrollPage() {
  const [periodId, setPeriodId] = useState('');
  const [detailId, setDetailId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState<any>({});
  const { data } = useHrPayrollRuns({ periodId: periodId || undefined });
  const { data: periods } = useHrPayrollPeriods();
  const { data: detail } = useHrPayrollRun(detailId ?? undefined);
  const create = useCreateHrPayrollRun();
  const calculate = useCalculateHrPayrollRun();
  const approve = useApproveHrPayrollRun();
  const reverse = useReverseHrPayrollRun();

  const rows = useMemo(() => data?.rows ?? [], [data]);
  const periodRows = useMemo(() => periods?.rows ?? [], [periods]);
  const items = useMemo(() => detail?.items ?? [], [detail]);

  const doCreate = async () => {
    if (!createForm.periodId) return;
    await create.mutateAsync({ periodId: createForm.periodId });
    setCreateOpen(false);
    setCreateForm({});
  };

  return (
    <div className="space-y-4 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Payroll</h1>
          <p className="text-sm text-muted-foreground">Periods → runs → calculate → approve → post to GL → pay.</p>
        </div>
        <Button onClick={() => { setCreateForm({}); setCreateOpen(true); }}>New run</Button>
      </div>

      <div className="flex items-center gap-2">
        <select value={periodId} onChange={(e) => setPeriodId(e.target.value)} className="rounded-md border bg-card px-3 py-2 text-sm">
          <option value="">All periods</option>
          {periodRows.map((p: any) => <option key={p.id} value={p.id}>{p.periodCode} ({p.startDate} → {p.endDate})</option>)}
        </select>
      </div>

      <Card>
        <CardHeader className="bg-muted/30 border-b rounded-t-lg">
          <CardTitle className="text-sm">{rows.length} payroll runs</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="divide-y">
            {rows.length === 0 && <p className="p-6 text-sm text-muted-foreground">No payroll runs yet — create a run for an open period.</p>}
            {rows.map((r: any) => (
              <div key={r.id} className="flex items-center justify-between px-4 py-3 hover:bg-muted/40">
                <button className="flex flex-1 items-center gap-3 text-left" onClick={() => setDetailId(r.id)}>
                  <Wallet className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium">{r.runNumber} · {r.period?.periodCode}</p>
                    <p className="text-xs text-muted-foreground">
                      Net {fmt(r.totalNet)} · {r._count?.items ?? 0} employees
                      {r.glPosted ? ' · GL posted' : ''}
                    </p>
                  </div>
                </button>
                <div className="flex items-center gap-2">
                  {r.status === 'DRAFT' && <Button size="sm" variant="outline" onClick={() => calculate.mutate(r.id)}>Calculate</Button>}
                  {r.status === 'CALCULATED' && <Button size="sm" onClick={() => approve.mutate(r.id)}>Approve & post</Button>}
                  {r.status === 'APPROVED' && (
                    <Button size="sm" variant="outline" onClick={() => { if (confirm('Reverse this run and void its GL entry?')) reverse.mutate({ id: r.id }); }}>Reverse</Button>
                  )}
                  <Badge variant="outline" className={RUN_STATUS[r.status] ?? ''}>{r.status.replace(/_/g, ' ')}</Badge>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Create run dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>New payroll run</DialogTitle></DialogHeader>
          <div className="grid gap-3">
            <div>
              <Label>Period *</Label>
              <select value={createForm.periodId ?? ''} onChange={(e) => setCreateForm({ ...createForm, periodId: e.target.value })}
                className="w-full rounded-md border bg-card px-3 py-2 text-sm">
                <option value="">Select period…</option>
                {periodRows.filter((p: any) => p.status === 'OPEN').map((p: any) => (
                  <option key={p.id} value={p.id}>{p.periodCode} ({p.startDate} → {p.endDate})</option>
                ))}
              </select>
            </div>
            <Button onClick={doCreate} disabled={create.isPending}>Create run</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Run detail dialog */}
      <Dialog open={!!detailId} onOpenChange={(o) => { if (!o) setDetailId(null); }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{detail?.runNumber} · {detail?.period?.periodCode}</DialogTitle></DialogHeader>

          <div className="flex items-center gap-2">
            {detail?.status === 'DRAFT' && <Button size="sm" onClick={() => calculate.mutate(detail.id)}>Calculate</Button>}
            {detail?.status === 'CALCULATED' && <Button size="sm" onClick={() => approve.mutate(detail.id)}>Approve & post</Button>}
            <Badge variant="outline" className={RUN_STATUS[detail?.status ?? ''] ?? ''}>{detail?.status?.replace(/_/g, ' ')}</Badge>
          </div>

          <div className="grid grid-cols-3 gap-2 text-center">
            {[['Gross', detail?.totalGross], ['Deductions', detail?.totalDeductions], ['Net', detail?.totalNet]].map(([label, val]) => (
              <div key={String(label)} className="rounded-md bg-muted/30 p-3">
                <p className="text-xs text-muted-foreground">{label}</p>
                <p className="text-sm font-semibold">{fmt(Number(val ?? 0))}</p>
              </div>
            ))}
          </div>

          <div className="rounded-md border">
            <div className="bg-muted/30 border-b px-3 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Employee breakdown</div>
            <div className="divide-y">
              {items.length === 0 && <p className="p-4 text-sm text-muted-foreground">No items yet — run Calculate.</p>}
              {items.map((it: any) => (
                <div key={it.id} className="px-3 py-2">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium">{it.employee?.employeeCode} {it.employee?.firstName}{it.employee?.lastName ? ' ' + it.employee?.lastName : ''}</p>
                    <p className="text-sm font-semibold">{fmt(it.netPay)}</p>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Base {fmt(it.baseSalary)}{it.overtimeHours > 0 ? ` · OT ${it.overtimeHours}h` : ''}{it.absenceDays > 0 ? ` · absent ${it.absenceDays}d` : ''}
                    {' · '}tax {fmt(it.taxAmount)}{it.pensionAmount > 0 ? ` · pension ${fmt(it.pensionAmount)}` : ''}{it.socialSecurityAmount > 0 ? ` · SSF ${fmt(it.socialSecurityAmount)}` : ''}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
