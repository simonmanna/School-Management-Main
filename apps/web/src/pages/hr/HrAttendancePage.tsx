import { useMemo, useState } from 'react';
import { Clock } from 'lucide-react';
import { useHrAttendance, useHrClock, useHrManualAttendance, useHrEmployees } from '@/features/hr/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const STATUS_STYLE: Record<string, string> = {
  PRESENT: 'bg-emerald-100 text-emerald-800',
  ABSENT: 'bg-rose-100 text-rose-800',
  LATE: 'bg-amber-100 text-amber-800',
  EARLY_LEAVE: 'bg-orange-100 text-orange-800',
  ON_LEAVE: 'bg-violet-100 text-violet-800',
  OFF_DAY: 'bg-muted text-muted-foreground',
};

const STATUS_FILTERS = ['', 'PRESENT', 'ABSENT', 'LATE', 'EARLY_LEAVE', 'ON_LEAVE', 'OFF_DAY'];

const today = () => new Date().toISOString().slice(0, 10);

export function HrAttendancePage() {
  const [employeeId, setEmployeeId] = useState('');
  const [status, setStatus] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [clockOpen, setClockOpen] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [clockForm, setClockForm] = useState<any>({});
  const [manualForm, setManualForm] = useState<any>({});
  const { data } = useHrAttendance({ employeeId: employeeId || undefined, status: status || undefined, from: from || undefined, to: to || undefined, pageSize: 50 });
  const { data: empData } = useHrEmployees({ pageSize: 200 });
  const clock = useHrClock();
  const manual = useHrManualAttendance();

  const rows = useMemo(() => data?.rows ?? [], [data]);
  const employees = useMemo(() => empData?.rows ?? [], [empData]);

  const doClock = async () => {
    if (!clockForm.employeeId || !clockForm.eventType) return;
    await clock.mutateAsync({ employeeId: clockForm.employeeId, eventType: clockForm.eventType });
    setClockOpen(false);
    setClockForm({});
  };
  const doManual = async () => {
    if (!manualForm.employeeId || !manualForm.date || !manualForm.checkInAt) return;
    await manual.mutateAsync({
      employeeId: manualForm.employeeId,
      date: manualForm.date,
      checkInAt: manualForm.checkInAt,
      checkOutAt: manualForm.checkOutAt || undefined,
      totalBreakMinutes: manualForm.totalBreakMinutes ? Number(manualForm.totalBreakMinutes) : 0,
      notes: manualForm.notes || undefined,
    });
    setManualOpen(false);
    setManualForm({});
  };

  return (
    <div className="space-y-4 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Attendance</h1>
          <p className="text-sm text-muted-foreground">Clock events, daily records and registers.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => { setClockForm({}); setClockOpen(true); }}><Clock className="h-4 w-4" /> Clock in/out</Button>
          <Button onClick={() => { setManualForm({ date: today() }); setManualOpen(true); }}>Manual entry</Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} className="rounded-md border bg-card px-3 py-2 text-sm">
          <option value="">All employees</option>
          {employees.map((e: any) => <option key={e.id} value={e.id}>{e.employeeCode} · {e.firstName}{e.lastName ? ' ' + e.lastName : ''}</option>)}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="rounded-md border bg-card px-3 py-2 text-sm">
          {STATUS_FILTERS.map((s) => <option key={s} value={s}>{s ? s.replace(/_/g, ' ') : 'All statuses'}</option>)}
        </select>
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="rounded-md border bg-card px-3 py-2 text-sm" />
        <span className="text-xs text-muted-foreground">→</span>
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="rounded-md border bg-card px-3 py-2 text-sm" />
      </div>

      <Card>
        <CardHeader className="bg-muted/30 border-b rounded-t-lg">
          <CardTitle className="text-sm">{rows.length} attendance records</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="divide-y">
            {rows.length === 0 && <p className="p-6 text-sm text-muted-foreground">No records match the filters.</p>}
            {rows.map((a: any) => (
              <div key={a.id} className="flex items-center justify-between px-4 py-3 hover:bg-muted/40">
                <div className="flex items-center gap-3">
                  <Clock className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium">
                      {a.employee?.employeeCode} · {a.employee?.firstName}{a.employee?.lastName ? ' ' + a.employee?.lastName : ''}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {a.date}{a.shift ? ` · ${a.shift.name}` : ''} · {a.checkInAt ? new Date(a.checkInAt).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) : '—'}
                      {a.checkOutAt ? '–' + new Date(a.checkOutAt).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) : ''}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <div className="hidden text-right text-xs text-muted-foreground md:block">
                    <p>Worked: {Math.floor((a.workedMinutes ?? 0) / 60)}h {(a.workedMinutes ?? 0) % 60}m</p>
                    {a.overtimeMinutes > 0 && <p className="text-amber-600">OT: {Math.floor(a.overtimeMinutes / 60)}h {a.overtimeMinutes % 60}m</p>}
                    {a.lateMinutes > 0 && <p className="text-rose-600">Late: {a.lateMinutes}m</p>}
                  </div>
                  <Badge variant="outline" className={STATUS_STYLE[a.status] ?? ''}>{a.status.replace(/_/g, ' ')}</Badge>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Clock dialog */}
      <Dialog open={clockOpen} onOpenChange={setClockOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Clock in / out</DialogTitle></DialogHeader>
          <div className="grid gap-3">
            <div>
              <Label>Employee *</Label>
              <select value={clockForm.employeeId ?? ''} onChange={(e) => setClockForm({ ...clockForm, employeeId: e.target.value })}
                className="w-full rounded-md border bg-card px-3 py-2 text-sm">
                <option value="">Select employee…</option>
                {employees.map((e: any) => <option key={e.id} value={e.id}>{e.employeeCode} · {e.firstName}{e.lastName ? ' ' + e.lastName : ''}</option>)}
              </select>
            </div>
            <div>
              <Label>Event *</Label>
              <select value={clockForm.eventType ?? ''} onChange={(e) => setClockForm({ ...clockForm, eventType: e.target.value })}
                className="w-full rounded-md border bg-card px-3 py-2 text-sm">
                <option value="">Select event…</option>
                <option value="CHECK_IN">Check in</option>
                <option value="CHECK_OUT">Check out</option>
                <option value="BREAK_START">Break start</option>
                <option value="BREAK_END">Break end</option>
              </select>
            </div>
            <Button onClick={doClock} disabled={clock.isPending}>Record event</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Manual entry dialog */}
      <Dialog open={manualOpen} onOpenChange={setManualOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Manual attendance</DialogTitle></DialogHeader>
          <div className="grid gap-3">
            <div>
              <Label>Employee *</Label>
              <select value={manualForm.employeeId ?? ''} onChange={(e) => setManualForm({ ...manualForm, employeeId: e.target.value })}
                className="w-full rounded-md border bg-card px-3 py-2 text-sm">
                <option value="">Select employee…</option>
                {employees.map((e: any) => <option key={e.id} value={e.id}>{e.employeeCode} · {e.firstName}{e.lastName ? ' ' + e.lastName : ''}</option>)}
              </select>
            </div>
            <div>
              <Label>Date *</Label>
              <Input type="date" value={manualForm.date ?? ''} onChange={(e) => setManualForm({ ...manualForm, date: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Check-in *</Label>
                <Input type="datetime-local" value={manualForm.checkInAt ?? ''} onChange={(e) => setManualForm({ ...manualForm, checkInAt: e.target.value })} />
              </div>
              <div>
                <Label>Check-out</Label>
                <Input type="datetime-local" value={manualForm.checkOutAt ?? ''} onChange={(e) => setManualForm({ ...manualForm, checkOutAt: e.target.value })} />
              </div>
            </div>
            <div>
              <Label>Break minutes</Label>
              <Input type="number" value={manualForm.totalBreakMinutes ?? ''} onChange={(e) => setManualForm({ ...manualForm, totalBreakMinutes: e.target.value })} />
            </div>
            <Button onClick={doManual} disabled={manual.isPending}>Save record</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
