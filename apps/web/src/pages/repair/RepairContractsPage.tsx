import { useState } from 'react';
import { Handshake, Plus, CalendarClock } from 'lucide-react';
import { useRepairContracts, useCreateContract, useUpdateContract, useActivateContract,
  useCancelContract, useDeleteContract, useRepairSchedules, useCreateSchedule,
  useDeleteSchedule,
} from '@/features/repair/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { date } from '@/lib/format';

const STATUS_STYLES: Record<string, string> = {
  draft: 'bg-muted text-muted-foreground',
  active: 'bg-emerald-100 text-emerald-800',
  expired: 'bg-muted text-muted-foreground',
  cancelled: 'bg-muted text-muted-foreground',
};

export function RepairContractsPage() {
  const { data } = useRepairContracts();
  const create = useCreateContract();
  const update = useUpdateContract();
  const activate = useActivateContract();
  const cancel = useCancelContract();
  const del = useDeleteContract();
  const { data: schedules } = useRepairSchedules();
  const createSchedule = useCreateSchedule();
  const delSchedule = useDeleteSchedule();

  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [form, setForm] = useState({
    partnerId: '', title: '', startDate: '', endDate: '', frequencyDays: '30', slaHours: '24', notes: '',
  });
  const [showScheduleForm, setShowScheduleForm] = useState(false);
  const [scheduleForm, setScheduleForm] = useState({
    contractId: '', title: '', assetRef: '', intervalDays: '30', nextDueAt: '', taskTemplate: '',
  });
  const [error, setError] = useState('');

  const rows = Array.isArray(data) ? data : (data as any)?.items ?? [];
  const scheduleRows = Array.isArray(schedules) ? schedules : (schedules as any)?.items ?? [];
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const setS = (k: string, v: string) => setScheduleForm((f) => ({ ...f, [k]: v }));

  const openCreate = () => {
    setEditing(null);
    setForm({ partnerId: '', title: '', startDate: '', endDate: '', frequencyDays: '30', slaHours: '24', notes: '' });
    setShowForm(true);
  };

  const openEdit = (c: any) => {
    setEditing(c);
    setForm({
      partnerId: c.partnerId, title: c.title,
      startDate: c.startDate ? c.startDate.slice(0, 10) : '',
      endDate: c.endDate ? c.endDate.slice(0, 10) : '',
      frequencyDays: String(c.frequencyDays ?? 30), slaHours: String(c.slaHours ?? 24), notes: c.notes ?? '',
    });
    setShowForm(true);
  };

  const submit = async () => {
    setError('');
    const dto = {
      ...form,
      startDate: form.startDate ? new Date(form.startDate).toISOString() : undefined,
      endDate: form.endDate ? new Date(form.endDate).toISOString() : undefined,
      frequencyDays: form.frequencyDays ? Number(form.frequencyDays) : undefined,
      slaHours: form.slaHours ? Number(form.slaHours) : undefined,
    };
    try {
      if (editing) await update.mutateAsync({ id: editing.id, dto });
      else await create.mutateAsync(dto);
      setShowForm(false);
    } catch (e: any) {
      setError(e?.response?.data?.message ?? String(e?.message ?? e));
    }
  };

  const submitSchedule = async () => {
    setError('');
    try {
      await createSchedule.mutateAsync({
        ...scheduleForm,
        contractId: scheduleForm.contractId || undefined,
        intervalDays: Number(scheduleForm.intervalDays) || 30,
        nextDueAt: scheduleForm.nextDueAt ? new Date(scheduleForm.nextDueAt).toISOString() : undefined,
      });
      setShowScheduleForm(false);
      setScheduleForm({ contractId: '', title: '', assetRef: '', intervalDays: '30', nextDueAt: '', taskTemplate: '' });
    } catch (e: any) {
      setError(e?.response?.data?.message ?? String(e?.message ?? e));
    }
  };

  return (
    <div className="space-y-4 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Service Contracts</h1>
          <p className="text-sm text-muted-foreground">SLA maintenance contracts and preventive schedules.</p>
        </div>
        <Button onClick={openCreate}><Plus className="h-4 w-4" /> New contract</Button>
      </div>

      {showForm && (
        <Card>
          <CardHeader className="bg-muted/30 border-b rounded-t-lg">
            <CardTitle className="text-sm">{editing ? `Edit ${editing.title}` : 'New contract'}</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-4">
            <Input placeholder="Partner ID" value={form.partnerId} onChange={(e) => set('partnerId', e.target.value)} />
            <Input placeholder="Title (Annual maintenance)" value={form.title} onChange={(e) => set('title', e.target.value)} />
            <Input type="date" value={form.startDate} onChange={(e) => set('startDate', e.target.value)} />
            <Input type="date" value={form.endDate} onChange={(e) => set('endDate', e.target.value)} />
            <Input type="number" placeholder="Frequency (days)" value={form.frequencyDays} onChange={(e) => set('frequencyDays', e.target.value)} />
            <Input type="number" placeholder="SLA (hours)" value={form.slaHours} onChange={(e) => set('slaHours', e.target.value)} />
            <Input className="sm:col-span-2" placeholder="Notes" value={form.notes} onChange={(e) => set('notes', e.target.value)} />
            <div className="flex items-end gap-2">
              <Button onClick={submit} disabled={create.isPending || update.isPending}>Save</Button>
              <Button variant="ghost" onClick={() => setShowForm(false)}>Cancel</Button>
            </div>
            {error && <p className="text-sm text-red-600 sm:col-span-4">{error}</p>}
          </CardContent>
        </Card>
      )}

      <Tabs defaultValue="contracts">
        <TabsList>
          <TabsTrigger value="contracts">Contracts ({rows.length})</TabsTrigger>
          <TabsTrigger value="schedules">Preventive schedules ({scheduleRows.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="contracts" className="space-y-4">
          <Card>
            <CardHeader className="bg-muted/30 border-b rounded-t-lg"><CardTitle className="text-sm">{rows.length} contracts</CardTitle></CardHeader>
            <CardContent className="p-0">
              <div className="divide-y">
                {rows.length === 0 && <p className="p-6 text-sm text-muted-foreground">No contracts yet.</p>}
                {rows.map((c: any) => (
                  <div key={c.id} className="flex items-center justify-between px-4 py-3">
                    <div className="flex items-center gap-3">
                      <Handshake className="h-4 w-4 text-muted-foreground" />
                      <div>
                        <p className="text-sm font-medium">{c.title} <span className="text-xs text-muted-foreground">· {c.contractNumber}</span></p>
                        <p className="text-xs text-muted-foreground">
                          {c.partner?.name ?? c.partnerId.slice(0, 8)} · every {c.frequencyDays} d · SLA {c.slaHours} h
                          {c.startDate ? ` · ${date(c.startDate)} → ${c.endDate ? date(c.endDate) : '—'}` : ''}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {c.status === 'draft' && (
                        <Button size="sm" variant="outline" onClick={() => activate.mutateAsync(c.id)}>Activate</Button>
                      )}
                      {c.status === 'active' && (
                        <Button size="sm" variant="outline" onClick={() => cancel.mutateAsync({ id: c.id })}>Cancel</Button>
                      )}
                      <Button size="sm" variant="ghost" onClick={() => openEdit(c)}>Edit</Button>
                      <Button size="sm" variant="ghost" onClick={() => del.mutateAsync(c.id)}>Delete</Button>
                      <Badge variant="outline" className={STATUS_STYLES[c.status] ?? ''}>{c.status}</Badge>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="schedules" className="space-y-4">
          <Card>
            <CardHeader className="bg-muted/30 border-b rounded-t-lg">
              <CardTitle className="text-sm">Preventive maintenance schedules</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="divide-y">
                {scheduleRows.length === 0 && <p className="p-6 text-sm text-muted-foreground">No schedules yet.</p>}
                {scheduleRows.map((s: any) => (
                  <div key={s.id} className="flex items-center justify-between px-4 py-3">
                    <div className="flex items-center gap-3">
                      <CalendarClock className="h-4 w-4 text-muted-foreground" />
                      <div>
                        <p className="text-sm font-medium">{s.title}{s.assetRef ? ` · ${s.assetRef}` : ''}</p>
                        <p className="text-xs text-muted-foreground">
                          every {s.intervalDays} d · next {s.nextDueAt ? date(s.nextDueAt) : '—'}
                          {s.lastRunAt ? ` · last ${date(s.lastRunAt)}` : ''}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline">{s.status}</Badge>
                      <Button size="sm" variant="ghost" onClick={() => delSchedule.mutateAsync(s.id)}>Delete</Button>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {showScheduleForm && (
            <Card>
              <CardHeader className="bg-muted/30 border-b rounded-t-lg"><CardTitle className="text-sm">New schedule</CardTitle></CardHeader>
              <CardContent className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-4">
                <select value={scheduleForm.contractId} onChange={(e) => setS('contractId', e.target.value)} className="rounded-md border bg-card px-3 py-2 text-sm">
                  <option value="">— Contract (optional) —</option>
                  {rows.map((c: any) => <option key={c.id} value={c.id}>{c.title}</option>)}
                </select>
                <Input placeholder="Title" value={scheduleForm.title} onChange={(e) => setS('title', e.target.value)} />
                <Input placeholder="Asset ref" value={scheduleForm.assetRef} onChange={(e) => setS('assetRef', e.target.value)} />
                <Input type="number" placeholder="Interval (days)" value={scheduleForm.intervalDays} onChange={(e) => setS('intervalDays', e.target.value)} />
                <Input type="date" placeholder="Next due" value={scheduleForm.nextDueAt} onChange={(e) => setS('nextDueAt', e.target.value)} />
                <Input className="sm:col-span-2" placeholder="Task template" value={scheduleForm.taskTemplate} onChange={(e) => setS('taskTemplate', e.target.value)} />
                <div className="flex items-end gap-2">
                  <Button onClick={submitSchedule} disabled={createSchedule.isPending}>Save</Button>
                  <Button variant="ghost" onClick={() => setShowScheduleForm(false)}>Cancel</Button>
                </div>
              </CardContent>
            </Card>
          )}

          <Button variant="outline" onClick={() => setShowScheduleForm((v) => !v)}>
            <Plus className="h-4 w-4" /> New schedule
          </Button>
        </TabsContent>
      </Tabs>
    </div>
  );
}
