import { useMemo, useState } from 'react';
import { useHrAttendanceRegister, useHrLeaveOverview, useHrPayrollRuns } from '@/features/hr/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

const fmt = (n: number | string) => `Rp ${Number(n || 0).toLocaleString('id-ID')}`;

export function HrReportsPage() {
  const [tab, setTab] = useState('attendance');
  const [from, setFrom] = useState(new Date(new Date().setDate(1)).toISOString().slice(0, 10));
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10));
  const { data: register } = useHrAttendanceRegister({ from, to });
  const { data: leave } = useHrLeaveOverview();
  const { data: runs } = useHrPayrollRuns();

  const registerRows = useMemo(() => register?.rows ?? [], [register]);
  const leaveRows = useMemo(() => leave?.rows ?? [], [leave]);
  const runRows = useMemo(() => runs?.rows ?? [], [runs]);

  return (
    <div className="space-y-4 p-6">
      <div>
        <h1 className="text-xl font-semibold">HR reports</h1>
        <p className="text-sm text-muted-foreground">Attendance register, leave overview and payroll registers.</p>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="attendance">Attendance</TabsTrigger>
          <TabsTrigger value="leave">Leave</TabsTrigger>
          <TabsTrigger value="payroll">Payroll</TabsTrigger>
        </TabsList>

        <TabsContent value="attendance" className="space-y-4">
          <div className="flex items-center gap-2">
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="rounded-md border bg-card px-3 py-2 text-sm" />
            <span className="text-xs text-muted-foreground">→</span>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="rounded-md border bg-card px-3 py-2 text-sm" />
          </div>
          <Card>
            <CardHeader className="bg-muted/30 border-b rounded-t-lg">
              <CardTitle className="text-sm">Attendance register · {registerRows.length} employees</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="divide-y">
                {registerRows.length === 0 && <p className="p-6 text-sm text-muted-foreground">No data for the selected range.</p>}
                {registerRows.map((r: any) => (
                  <div key={r.employeeId} className="flex items-center justify-between px-4 py-3">
                    <div>
                      <p className="text-sm font-medium">{r.employeeCode} {r.firstName}{r.lastName ? ' ' + r.lastName : ''}</p>
                      <p className="text-xs text-muted-foreground">{r.department ?? 'No department'}</p>
                    </div>
                    <div className="flex items-center gap-4 text-xs">
                      <span>Present <b>{r.present}</b></span>
                      <span className="text-amber-600">Late <b>{r.late}</b></span>
                      <span className="text-rose-600">Absent <b>{r.absent}</b></span>
                      <span>On leave <b>{r.onLeave}</b></span>
                      <span className="hidden md:inline">OT <b>{Math.floor((r.overtimeMinutes ?? 0) / 60)}h {(r.overtimeMinutes ?? 0) % 60}m</b></span>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="leave" className="space-y-4">
          <Card>
            <CardHeader className="bg-muted/30 border-b rounded-t-lg">
              <CardTitle className="text-sm">Leave overview · {new Date().getFullYear()}</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="divide-y">
                {leaveRows.length === 0 && <p className="p-6 text-sm text-muted-foreground">No leave data yet.</p>}
                {leaveRows.map((r: any) => {
                  const remaining = Number(r.accrued ?? 0) + Number(r.adjusted ?? 0) - Number(r.used ?? 0);
                  return (
                    <div key={`${r.employeeId}-${r.leaveTypeId}`} className="flex items-center justify-between px-4 py-3">
                      <div>
                        <p className="text-sm font-medium">{r.employeeCode} {r.firstName} · {r.leaveType}</p>
                        <p className="text-xs text-muted-foreground">{r.department ?? 'No department'}</p>
                      </div>
                      <div className="flex items-center gap-4 text-xs">
                        <span>Accrued <b>{r.accrued}</b></span>
                        <span>Used <b>{r.used}</b></span>
                        <span>Pending <b>{r.pending}</b></span>
                        <span className="font-semibold">{remaining} left</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="payroll" className="space-y-4">
          <Card>
            <CardHeader className="bg-muted/30 border-b rounded-t-lg">
              <CardTitle className="text-sm">Payroll registers · {runRows.length} runs</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="divide-y">
                {runRows.length === 0 && <p className="p-6 text-sm text-muted-foreground">No payroll runs yet.</p>}
                {runRows.map((r: any) => (
                  <div key={r.id} className="flex items-center justify-between px-4 py-3">
                    <div>
                      <p className="text-sm font-medium">{r.runNumber} · {r.period?.periodCode}</p>
                      <p className="text-xs text-muted-foreground">{r._count?.items ?? 0} employees</p>
                    </div>
                    <div className="flex items-center gap-4 text-sm">
                      <span className="text-muted-foreground">Gross <b>{fmt(r.totalGross)}</b></span>
                      <span className="text-rose-600">Deductions <b>{fmt(r.totalDeductions)}</b></span>
                      <span>Net <b>{fmt(r.totalNet)}</b></span>
                      <Badge variant="outline">{r.status.replace(/_/g, ' ')}</Badge>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
