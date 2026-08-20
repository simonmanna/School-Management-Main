import { useMemo, useState } from 'react';
import { Plus, GraduationCap, Layers } from 'lucide-react';
import { useHrJobGrades, useCreateHrJobGrade, useDeleteHrJobGrade, useHrSalaryStructures, useCreateHrSalaryStructure, useDeleteHrSalaryStructure, useHrPayrollComponents } from '@/features/hr/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export function HrJobGradesPage() {
  const [tab, setTab] = useState<'grades' | 'structures'>('grades');
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>({});

  const { data: grades } = useHrJobGrades({});
  const { data: structures } = useHrSalaryStructures({});
  const { data: components } = useHrPayrollComponents({});
  const createGrade = useCreateHrJobGrade();
  const deleteGrade = useDeleteHrJobGrade();
  const createStructure = useCreateHrSalaryStructure();
  const deleteStructure = useDeleteHrSalaryStructure();

  const gradeRows = useMemo(() => grades?.rows ?? [], [grades]);
  const structureRows = useMemo(() => structures?.rows ?? [], [structures]);
  const componentRows = useMemo(() => components?.rows ?? [], [components]);

  const openCreate = () => { setForm({ isActive: true }); setOpen(true); };
  const submit = async () => {
    if (tab === 'grades') {
      if (!form.code || !form.name) return;
      await createGrade.mutateAsync({ code: form.code, name: form.name, description: form.description || null, minSalary: form.minSalary ? Number(form.minSalary) : null, maxSalary: form.maxSalary ? Number(form.maxSalary) : null, isActive: form.isActive });
    } else {
      if (!form.gradeId || !form.componentId) return;
      await createStructure.mutateAsync({ gradeId: form.gradeId, componentId: form.componentId, amount: form.amount ? Number(form.amount) : null, rate: form.rate ? Number(form.rate) : null, isActive: true });
    }
    setOpen(false);
  };

  return (
    <div className="space-y-4 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Job Grades & Salary Structures</h1>
          <p className="text-sm text-muted-foreground">Configurable grades and reusable, grade-aware salary components — the backbone of accurate payroll.</p>
        </div>
        <Button onClick={openCreate}><Plus className="h-4 w-4" /> {tab === 'grades' ? 'New job grade' : 'Add structure'}</Button>
      </div>

      <div className="flex gap-2">
        {(['grades', 'structures'] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`rounded-md border px-3 py-1.5 text-sm ${tab === t ? 'bg-muted font-medium' : ''}`}>
            {t === 'grades' ? 'Job Grades' : 'Salary Structures'}
          </button>
        ))}
      </div>

      {tab === 'grades' ? (
        <Card>
          <CardHeader className="bg-muted/30 border-b rounded-t-lg"><CardTitle className="text-sm">{gradeRows.length} job grades</CardTitle></CardHeader>
          <CardContent className="p-0">
            <div className="divide-y">
              {gradeRows.length === 0 && <p className="p-6 text-sm text-muted-foreground">No job grades yet.</p>}
              {gradeRows.map((g: any) => (
                <div key={g.id} className="flex items-center justify-between px-4 py-3 hover:bg-muted/40">
                  <div className="flex items-center gap-3">
                    <GraduationCap className="h-4 w-4 text-muted-foreground" />
                    <div>
                      <p className="text-sm font-medium">{g.code} · {g.name}</p>
                      <p className="text-xs text-muted-foreground">{g.description || '—'} · {g._count?.employees ?? 0} employees · {g._count?.structures ?? 0} structures</p>
                    </div>
                  </div>
                  <button onClick={() => { if (confirm(`Delete grade ${g.name}?`)) deleteGrade.mutate(g.id); }} className="rounded-md border px-2 py-1 text-xs text-rose-600 hover:bg-rose-50">Delete</button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader className="bg-muted/30 border-b rounded-t-lg"><CardTitle className="text-sm">{structureRows.length} salary structures</CardTitle></CardHeader>
          <CardContent className="p-0">
            <div className="divide-y">
              {structureRows.length === 0 && <p className="p-6 text-sm text-muted-foreground">No structures yet.</p>}
              {structureRows.map((s: any) => (
                <div key={s.id} className="flex items-center justify-between px-4 py-3 hover:bg-muted/40">
                  <div className="flex items-center gap-3">
                    <Layers className="h-4 w-4 text-muted-foreground" />
                    <div>
                      <p className="text-sm font-medium">{s.grade?.name} → {s.component?.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {s.component?.calcMethod === 'PERCENTAGE' ? `${s.rate}% of base` : `${s.amount ?? s.component?.amount ?? 0}`}
                        {s.component?.isTaxable ? ' · taxable' : ' · non-taxable'}
                      </p>
                    </div>
                  </div>
                  <button onClick={() => { if (confirm('Delete structure?')) deleteStructure.mutate(s.id); }} className="rounded-md border px-2 py-1 text-xs text-rose-600 hover:bg-rose-50">Delete</button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{tab === 'grades' ? 'New job grade' : 'Add salary structure'}</DialogTitle></DialogHeader>
          <div className="grid gap-3">
            {tab === 'grades' ? (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div><Label>Code *</Label><Input value={form.code ?? ''} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="G7" /></div>
                  <div><Label>Name *</Label><Input value={form.name ?? ''} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
                </div>
                <div><Label>Description</Label><Input value={form.description ?? ''} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
                <div className="grid grid-cols-2 gap-3">
                  <div><Label>Min salary</Label><Input type="number" value={form.minSalary ?? ''} onChange={(e) => setForm({ ...form, minSalary: e.target.value })} /></div>
                  <div><Label>Max salary</Label><Input type="number" value={form.maxSalary ?? ''} onChange={(e) => setForm({ ...form, maxSalary: e.target.value })} /></div>
                </div>
              </>
            ) : (
              <>
                <div><Label>Job grade *</Label>
                  <select value={form.gradeId ?? ''} onChange={(e) => setForm({ ...form, gradeId: e.target.value })} className="w-full rounded-md border bg-card px-3 py-2 text-sm">
                    <option value="">Select grade</option>
                    {gradeRows.map((g: any) => <option key={g.id} value={g.id}>{g.code} · {g.name}</option>)}
                  </select>
                </div>
                <div><Label>Payroll component *</Label>
                  <select value={form.componentId ?? ''} onChange={(e) => setForm({ ...form, componentId: e.target.value })} className="w-full rounded-md border bg-card px-3 py-2 text-sm">
                    <option value="">Select component</option>
                    {componentRows.map((c: any) => <option key={c.id} value={c.id}>{c.name} ({c.componentType})</option>)}
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div><Label>Fixed amount</Label><Input type="number" value={form.amount ?? ''} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></div>
                  <div><Label>Rate % (if percentage)</Label><Input type="number" value={form.rate ?? ''} onChange={(e) => setForm({ ...form, rate: e.target.value })} /></div>
                </div>
              </>
            )}
            <Button onClick={submit} disabled={createGrade.isPending || createStructure.isPending}>
              {tab === 'grades' ? 'Create grade' : 'Add structure'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
