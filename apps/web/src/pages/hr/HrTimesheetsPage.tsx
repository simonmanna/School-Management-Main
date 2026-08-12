import { useMemo, useState } from 'react';
import { FileClock } from 'lucide-react';
import { useHrTimesheets, useHrTimesheet, useCreateHrTimesheet, useSubmitHrTimesheet, useApproveHrTimesheet, useRejectHrTimesheet, useAddHrTimesheetEntry, useDeleteHrTimesheetEntry, useHrEmployees } from '@/features/hr/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const STATUS_STYLE: Record<string, string> = {
  DRAFT: 'bg-muted text-muted-foreground',
  SUBMITTED: 'bg-amber-100 text-amber-800',
  APPROVED: 'bg-emerald-100 text-emerald-800',
  REJECTED: 'bg-rose-100 text-rose-800',
};

const WORK_TYPES = ['REPAIR', 'HOTEL', 'SCHOOL', 'RENTAL', 'CLEANING', 'MANUFACTURING', 'PROJECT', 'CUSTOMER', 'OTHER'];

const fmtH = (min: number) => `${Math.floor(min / 60)}h ${min % 60}m`;

export function HrTimesheetsPage() {
  const [status, setStatus] = useState('');
  const [detailId, setDetailId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState<any>({});
  const [entryForm, setEntryForm] = useState<any>({});
  const { data } = useHrTimesheets({ status: status || undefined });
  const { data: empData } = useHrEmployees({ pageSize: 200 });
  const { data: detail } = useHrTimesheet(detailId ?? undefined);
  const create = useCreateHrTimesheet();
  const submit = useSubmitHrTimesheet();
  const approve = useApproveHrTimesheet();
  const reject = useRejectHrTimesheet();
  const addEntry = useAddHrTimesheetEntry();
  const delEntry = useDeleteHrTimesheetEntry();

  const rows = useMemo(() => data?.rows ?? [], [data]);
  const employees = useMemo(() => empData?.rows ?? [], [empData]);
  const entries = useMemo(() => detail?.entries ?? [], [detail]);

  const doCreate = async () => {
    if (!createForm.employeeId || !createForm.periodStart || !createForm.periodEnd) return;
    await create.mutateAsync({
      employeeId: createForm.employeeId,
      periodStart: createForm.periodStart,
      periodEnd: createForm.periodEnd,
      notes: createForm.notes || undefined,
    });
    setCreateOpen(false);
    setCreateForm({});
  };
  const doAddEntry = async () => {
    if (!detailId || !entryForm.date || !entryForm.startAt || !entryForm.endAt) return;
    await addEntry.mutateAsync({
      id: detailId,
      dto: {
        date: entryForm.date,
        startAt: entryForm.startAt,
        endAt: entryForm.endAt,
        workType: entryForm.workType ?? 'OTHER',
        description: entryForm.description || undefined,
        isBillable: entryForm.isBillable ?? false,
        linkedEntityType: entryForm.linkedEntityType || null,
        linkedEntityId: entryForm.linkedEntityId || null,
      },
    });
    setEntryForm({});
  };

  return (
    <div className="space-y-4 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Timesheets</h1>
          <p className="text-sm text-muted-foreground">Project/repair hours with approval flow.</p>
        </div>
        <Button onClick={() => { setCreateForm({}); setCreateOpen(true); }}>New timesheet</Button>
      </div>

      <div className="flex items-center gap-2">
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="rounded-md border bg-card px-3 py-2 text-sm">
          <option value="">All statuses</option>
          {['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED'].map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      <Card>
        <CardHeader className="bg-muted/30 border-b rounded-t-lg">
          <CardTitle className="text-sm">{rows.length} timesheets</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="divide-y">
            {rows.length === 0 && <p className="p-6 text-sm text-muted-foreground">No timesheets yet.</p>}
            {rows.map((t: any) => (
              <div key={t.id} className="flex items-center justify-between px-4 py-3 hover:bg-muted/40">
                <button className="flex flex-1 items-center gap-3 text-left" onClick={() => setDetailId(t.id)}>
                  <FileClock className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium">{t.timesheetCode} · {t.employee?.employeeCode} {t.employee?.firstName}</p>
                    <p className="text-xs text-muted-foreground">
                      {t.periodStart} → {t.periodEnd} · {fmtH(t.totalMinutes ?? 0)} · {t._count?.entries ?? 0} entries
                    </p>
                  </div>
                </button>
                <div className="flex items-center gap-2">
                  {t.status === 'DRAFT' && <Button size="sm" variant="outline" onClick={() => submit.mutate(t.id)}>Submit</Button>}
                  {t.status === 'SUBMITTED' && (
                    <>
                      <Button size="sm" variant="outline" onClick={() => approve.mutate(t.id)}>Approve</Button>
                      <Button size="sm" variant="outline" onClick={() => reject.mutate({ id: t.id })}>Reject</Button>
                    </>
                  )}
                  <Badge variant="outline" className={STATUS_STYLE[t.status] ?? ''}>{t.status}</Badge>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Create dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>New timesheet</DialogTitle></DialogHeader>
          <div className="grid gap-3">
            <div>
              <Label>Employee *</Label>
              <select value={createForm.employeeId ?? ''} onChange={(e) => setCreateForm({ ...createForm, employeeId: e.target.value })}
                className="w-full rounded-md border bg-card px-3 py-2 text-sm">
                <option value="">Select employee…</option>
                {employees.map((e: any) => <option key={e.id} value={e.id}>{e.employeeCode} · {e.firstName}{e.lastName ? ' ' + e.lastName : ''}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Period start *</Label>
                <Input type="date" value={createForm.periodStart ?? ''} onChange={(e) => setCreateForm({ ...createForm, periodStart: e.target.value })} />
              </div>
              <div>
                <Label>Period end *</Label>
                <Input type="date" value={createForm.periodEnd ?? ''} onChange={(e) => setCreateForm({ ...createForm, periodEnd: e.target.value })} />
              </div>
            </div>
            <Button onClick={doCreate} disabled={create.isPending}>Create timesheet</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Detail dialog */}
      <Dialog open={!!detailId} onOpenChange={(o) => { if (!o) setDetailId(null); }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{detail?.timesheetCode} · {detail?.employee?.firstName}{detail?.employee?.lastName ? ' ' + detail?.employee?.lastName : ''}</DialogTitle>
          </DialogHeader>

          <div className="flex items-center gap-2">
            {detail?.status === 'DRAFT' && <Button size="sm" onClick={() => submit.mutate(detail.id)}>Submit</Button>}
            {detail?.status === 'SUBMITTED' && (
              <>
                <Button size="sm" onClick={() => approve.mutate(detail.id)}>Approve</Button>
                <Button size="sm" variant="outline" onClick={() => reject.mutate({ id: detail.id })}>Reject</Button>
              </>
            )}
            <Badge variant="outline" className={STATUS_STYLE[detail?.status ?? ''] ?? ''}>{detail?.status}</Badge>
          </div>

          <div className="grid grid-cols-2 gap-3 rounded-md bg-muted/30 p-3">
            <p className="text-xs text-muted-foreground">Period</p><p className="text-sm">{detail?.periodStart} → {detail?.periodEnd}</p>
            <p className="text-xs text-muted-foreground">Total</p><p className="text-sm">{fmtH(detail?.totalMinutes ?? 0)}</p>
          </div>

          <div className="space-y-2">
            {entries.map((en: any) => (
              <div key={en.id} className="flex items-center justify-between rounded-md border px-3 py-2">
                <div>
                  <p className="text-sm font-medium">{en.date} · {en.startAt.slice(11, 16)}–{en.endAt.slice(11, 16)} · {fmtH(en.minutes)}</p>
                  <p className="text-xs text-muted-foreground">
                    {en.workType.replace(/_/g, ' ')}{en.description ? ` · ${en.description}` : ''}{en.isBillable ? ' · billable' : ''}
                  </p>
                </div>
                <button onClick={() => delEntry.mutate(en.id)} className="rounded-md border px-2 py-1 text-xs text-rose-600 hover:bg-rose-50">Delete</button>
              </div>
            ))}
            {entries.length === 0 && <p className="text-sm text-muted-foreground">No entries yet.</p>}
          </div>

          {detail?.status === 'DRAFT' && (
            <div className="grid gap-2 rounded-md border p-3">
              <p className="text-sm font-medium">Add entry</p>
              <div className="grid grid-cols-2 gap-2">
                <Input type="date" value={entryForm.date ?? ''} onChange={(e) => setEntryForm({ ...entryForm, date: e.target.value })} />
                <select value={entryForm.workType ?? 'OTHER'} onChange={(e) => setEntryForm({ ...entryForm, workType: e.target.value })}
                  className="rounded-md border bg-card px-3 py-2 text-sm">
                  {WORK_TYPES.map((w) => <option key={w} value={w}>{w.replace(/_/g, ' ')}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Input type="datetime-local" value={entryForm.startAt ?? ''} onChange={(e) => setEntryForm({ ...entryForm, startAt: e.target.value })} />
                <Input type="datetime-local" value={entryForm.endAt ?? ''} onChange={(e) => setEntryForm({ ...entryForm, endAt: e.target.value })} />
              </div>
              <div className="flex items-center gap-2">
                <Input value={entryForm.description ?? ''} onChange={(e) => setEntryForm({ ...entryForm, description: e.target.value })} placeholder="Description" />
                <label className="flex items-center gap-1 text-xs">
                  <input type="checkbox" checked={entryForm.isBillable ?? false} onChange={(e) => setEntryForm({ ...entryForm, isBillable: e.target.checked })} />
                  Billable
                </label>
                <Button size="sm" onClick={doAddEntry} disabled={addEntry.isPending}>Add</Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
