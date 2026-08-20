import { useMemo, useState } from 'react';
import { Plus, FileSignature, AlertTriangle } from 'lucide-react';
import { useHrContracts, useCreateHrContract, useHrExpiringContracts, useHrEmployees, useHrPositions } from '@/features/hr/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const TYPES = ['PERMANENT', 'FIXED_TERM', 'PROBATION', 'TEMPORARY', 'CASUAL', 'PART_TIME', 'HOURLY', 'CONTRACTOR', 'INTERNSHIP'];

export function HrContractsPage() {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>({});
  const { data } = useHrContracts({});
  const { data: expiring } = useHrExpiringContracts(60);
  const { data: empData } = useHrEmployees({ pageSize: 300 });
  const { data: posData } = useHrPositions({});
  const create = useCreateHrContract();

  const rows = useMemo(() => data?.rows ?? [], [data]);
  const employees = useMemo(() => empData?.rows ?? [], [empData]);
  const positions = useMemo(() => posData?.rows ?? [], [posData]);

  const openCreate = () => { setForm({ contractType: 'PERMANENT', startDate: new Date().toISOString().slice(0, 10) }); setOpen(true); };
  const submit = async () => {
    if (!form.employeeId || !form.contractType || !form.startDate) return;
    await create.mutateAsync({
      employeeId: form.employeeId, positionId: form.positionId || null, contractType: form.contractType,
      startDate: form.startDate, endDate: form.endDate || null, salary: form.salary ? Number(form.salary) : null,
      documentUrl: form.documentUrl || null,
    });
    setOpen(false);
  };

  return (
    <div className="space-y-4 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Employment Contracts</h1>
          <p className="text-sm text-muted-foreground">Track the contract lifecycle — draft → active → expiring → renewed/terminated — with expiry alerts.</p>
        </div>
        <Button onClick={openCreate}><Plus className="h-4 w-4" /> New contract</Button>
      </div>

      {expiring?.length > 0 && (
        <Card className="border-amber-300 bg-amber-50/50">
          <CardHeader className="border-b"><CardTitle className="text-sm flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-amber-600" /> {expiring.length} contract(s) expiring within 60 days</CardTitle></CardHeader>
          <CardContent className="p-0">
            <div className="divide-y">
              {expiring.map((c: any) => (
                <div key={c.id} className="px-4 py-2 text-sm">{c.employee ? `${c.employee.firstName} ${c.employee.lastName ?? ''}` : 'Employee'} — {c.contractNumber} ends {c.endDate ? new Date(c.endDate).toISOString().slice(0, 10) : '—'}</div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="bg-muted/30 border-b rounded-t-lg"><CardTitle className="text-sm">{rows.length} contracts</CardTitle></CardHeader>
        <CardContent className="p-0">
          <div className="divide-y">
            {rows.length === 0 && <p className="p-6 text-sm text-muted-foreground">No contracts yet.</p>}
            {rows.map((c: any) => (
              <div key={c.id} className="flex items-center justify-between px-4 py-3 hover:bg-muted/40">
                <div className="flex items-center gap-3">
                  <FileSignature className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium">{c.contractNumber || '(no number)'} · {c.contractType}</p>
                    <p className="text-xs text-muted-foreground">
                      {c.employee ? `${c.employee.firstName} ${c.employee.lastName ?? ''}` : 'Employee'} · {c.startDate ? new Date(c.startDate).toISOString().slice(0, 10) : ''} → {c.endDate ? new Date(c.endDate).toISOString().slice(0, 10) : 'open'}
                      {c.salary ? ` · ${c.salary}` : ''}
                    </p>
                  </div>
                </div>
                <Badge variant="outline" className={c.status === 'active' ? 'bg-emerald-50 text-emerald-700' : c.status === 'expiring' ? 'bg-amber-50 text-amber-700' : 'bg-muted text-muted-foreground'}>{c.status}</Badge>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>New contract</DialogTitle></DialogHeader>
          <div className="grid gap-3">
            <div><Label>Employee *</Label>
              <select value={form.employeeId ?? ''} onChange={(e) => setForm({ ...form, employeeId: e.target.value })} className="w-full rounded-md border bg-card px-3 py-2 text-sm">
                <option value="">Select employee</option>
                {employees.map((e: any) => <option key={e.id} value={e.id}>{e.employeeCode} · {e.firstName} {e.lastName ?? ''}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Type *</Label>
                <select value={form.contractType ?? 'PERMANENT'} onChange={(e) => setForm({ ...form, contractType: e.target.value })} className="w-full rounded-md border bg-card px-3 py-2 text-sm">
                  {TYPES.map((t) => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
                </select>
              </div>
              <div><Label>Position</Label>
                <select value={form.positionId ?? ''} onChange={(e) => setForm({ ...form, positionId: e.target.value })} className="w-full rounded-md border bg-card px-3 py-2 text-sm">
                  <option value="">None</option>
                  {positions.map((p: any) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Start date *</Label><Input type="date" value={form.startDate ?? ''} onChange={(e) => setForm({ ...form, startDate: e.target.value })} /></div>
              <div><Label>End date</Label><Input type="date" value={form.endDate ?? ''} onChange={(e) => setForm({ ...form, endDate: e.target.value })} /></div>
            </div>
            <div><Label>Salary</Label><Input type="number" value={form.salary ?? ''} onChange={(e) => setForm({ ...form, salary: e.target.value })} /></div>
            <Button onClick={submit} disabled={create.isPending}>Create contract</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
