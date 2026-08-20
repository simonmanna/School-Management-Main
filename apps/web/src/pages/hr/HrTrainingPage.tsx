import { useMemo, useState } from 'react';
import { Plus, BookOpen, GraduationCap } from 'lucide-react';
import { useHrTrainings, useCreateHrTraining, useDeleteHrTraining, useHrEnrollTraining, useHrCpdReport, useHrEmployees } from '@/features/hr/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export function HrTrainingPage() {
  const [tab, setTab] = useState<'trainings' | 'cpd'>('trainings');
  const [open, setOpen] = useState(false);
  const [enrollOpen, setEnrollOpen] = useState(false);
  const [form, setForm] = useState<any>({});
  const [enrollForm, setEnrollForm] = useState<any>({});
  const { data: trainings } = useHrTrainings({});
  const { data: cpd } = useHrCpdReport();
  const { data: empData } = useHrEmployees({ pageSize: 300 });
  const createTraining = useCreateHrTraining();
  const deleteTraining = useDeleteHrTraining();
  const enroll = useHrEnrollTraining();

  const trainingRows = useMemo(() => trainings?.rows ?? [], [trainings]);
  const employees = useMemo(() => empData?.rows ?? [], [empData]);
  const cpdRows = useMemo(() => (cpd as any[]) ?? [], [cpd]);

  const submit = async () => {
    if (!form.title) return;
    await createTraining.mutateAsync({ title: form.title, provider: form.provider || null, category: form.category || null, cost: form.cost ? Number(form.cost) : null, durationHours: form.durationHours ? Number(form.durationHours) : null, status: 'PLANNED' });
    setOpen(false);
  };
  const submitEnroll = async () => {
    if (!enrollForm.trainingId || !enrollForm.employeeId) return;
    await enroll.mutateAsync({ trainingId: enrollForm.trainingId, employeeId: enrollForm.employeeId, status: 'ENROLLED' });
    setEnrollOpen(false);
  };

  return (
    <div className="space-y-4 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Training & CPD</h1>
          <p className="text-sm text-muted-foreground">Courses, workshops and continuous professional development — with CPD hours per employee for accreditation.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => { setEnrollForm({}); setEnrollOpen(true); }}>Enroll employee</Button>
          <Button onClick={() => { setForm({}); setOpen(true); }}><Plus className="h-4 w-4" /> Training</Button>
        </div>
      </div>

      <div className="flex gap-2">
        {(['trainings', 'cpd'] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`rounded-md border px-3 py-1.5 text-sm ${tab === t ? 'bg-muted font-medium' : ''}`}>{t === 'trainings' ? 'Trainings' : 'CPD Report'}</button>
        ))}
      </div>

      {tab === 'trainings' ? (
        <Card>
          <CardHeader className="bg-muted/30 border-b rounded-t-lg"><CardTitle className="text-sm">{trainingRows.length} trainings</CardTitle></CardHeader>
          <CardContent className="p-0">
            <div className="divide-y">
              {trainingRows.length === 0 && <p className="p-6 text-sm text-muted-foreground">No trainings yet.</p>}
              {trainingRows.map((t: any) => (
                <div key={t.id} className="flex items-center justify-between px-4 py-3 hover:bg-muted/40">
                  <div className="flex items-center gap-3">
                    <BookOpen className="h-4 w-4 text-muted-foreground" />
                    <div>
                      <p className="text-sm font-medium">{t.title}</p>
                      <p className="text-xs text-muted-foreground">{t.provider || '—'} · {t.category || ''} · {t._count?.enrollments ?? 0} enrolled{t.cost ? ` · ${t.cost}` : ''}</p>
                    </div>
                  </div>
                  <button onClick={() => { if (confirm(`Delete training ${t.title}?`)) deleteTraining.mutate(t.id); }} className="rounded-md border px-2 py-1 text-xs text-rose-600 hover:bg-rose-50">Delete</button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader className="bg-muted/30 border-b rounded-t-lg"><CardTitle className="text-sm">{cpdRows.length} employees with CPD records</CardTitle></CardHeader>
          <CardContent className="p-0">
            <div className="divide-y">
              {cpdRows.length === 0 && <p className="p-6 text-sm text-muted-foreground">No CPD data yet.</p>}
              {cpdRows.map((e: any) => (
                <div key={e.employeeId} className="flex items-center justify-between px-4 py-3 hover:bg-muted/40">
                  <div className="flex items-center gap-3">
                    <GraduationCap className="h-4 w-4 text-muted-foreground" />
                    <div>
                      <p className="text-sm font-medium">{e.employeeName}</p>
                      <p className="text-xs text-muted-foreground">{e.completed} completed / {e.enrolled} enrolled</p>
                    </div>
                  </div>
                  <Badge variant="outline" className="bg-blue-50 text-blue-700">{e.totalCpdHours ?? 0} CPD hrs</Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>New training</DialogTitle></DialogHeader>
          <div className="grid gap-3">
            <div><Label>Title *</Label><Input value={form.title ?? ''} onChange={(e) => setForm({ ...form, title: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Provider</Label><Input value={form.provider ?? ''} onChange={(e) => setForm({ ...form, provider: e.target.value })} /></div>
              <div><Label>Category</Label><Input value={form.category ?? ''} onChange={(e) => setForm({ ...form, category: e.target.value })} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Cost</Label><Input type="number" value={form.cost ?? ''} onChange={(e) => setForm({ ...form, cost: e.target.value })} /></div>
              <div><Label>Duration (hrs)</Label><Input type="number" value={form.durationHours ?? ''} onChange={(e) => setForm({ ...form, durationHours: e.target.value })} /></div>
            </div>
            <Button onClick={submit} disabled={createTraining.isPending}>Create training</Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={enrollOpen} onOpenChange={setEnrollOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Enroll employee</DialogTitle></DialogHeader>
          <div className="grid gap-3">
            <div><Label>Training *</Label>
              <select value={enrollForm.trainingId ?? ''} onChange={(e) => setEnrollForm({ ...enrollForm, trainingId: e.target.value })} className="w-full rounded-md border bg-card px-3 py-2 text-sm">
                <option value="">Select training</option>
                {trainingRows.map((t: any) => <option key={t.id} value={t.id}>{t.title}</option>)}
              </select>
            </div>
            <div><Label>Employee *</Label>
              <select value={enrollForm.employeeId ?? ''} onChange={(e) => setEnrollForm({ ...enrollForm, employeeId: e.target.value })} className="w-full rounded-md border bg-card px-3 py-2 text-sm">
                <option value="">Select employee</option>
                {employees.map((e: any) => <option key={e.id} value={e.id}>{e.employeeCode} · {e.firstName} {e.lastName ?? ''}</option>)}
              </select>
            </div>
            <Button onClick={submitEnroll} disabled={enroll.isPending}>Enroll</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
