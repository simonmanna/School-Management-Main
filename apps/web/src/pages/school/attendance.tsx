import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Save, Clock, ShieldCheck, BarChart3 } from 'lucide-react';
import {
  useClasses, useClassRoster, usePeriods,
  useAttendanceRegister, useMarkAttendance, useCorrectAttendance,
  useAttendanceThresholds, useUpsertAttendanceThreshold, useAttendanceWeekly,
  type AttendanceStatus,
} from '@/features/school/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { notify } from '@/lib/notify';

const sel = 'rounded-md border bg-card px-3 py-2 text-sm';
const STATUSES: AttendanceStatus[] = ['present', 'absent', 'late', 'excused', 'early_departure', 'unexcused'];
const STATUS_STYLE: Record<AttendanceStatus, string> = {
  present: 'bg-emerald-600 text-white',
  absent: 'bg-rose-600 text-white',
  late: 'bg-amber-500 text-white',
  excused: 'bg-sky-600 text-white',
  early_departure: 'bg-purple-600 text-white',
  unexcused: 'bg-red-800 text-white',
};
const STATUS_LABEL: Record<AttendanceStatus, string> = {
  present: 'Present', absent: 'Absent', late: 'Late', excused: 'Excused',
  early_departure: 'Left early', unexcused: 'Unexcused',
};

export function SchoolAttendancePage() {
  const [tab, setTab] = useState<'take' | 'correct' | 'thresholds' | 'analytics'>('take');
  const { data: classes } = useClasses();
  const [classId, setClassId] = useState('');
  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState(today);
  const [periodId, setPeriodId] = useState('');
  const { data: periods } = usePeriods();

  return (
    <div className="space-y-4 p-6">
      <div>
        <h1 className="text-xl font-semibold">Attendance Management</h1>
        <p className="text-sm text-muted-foreground">Daily &amp; period attendance, corrections, parent alerts, and analytics.</p>
      </div>
      <Tabs value={tab} onValueChange={(v) => setTab(v as any)}>
        <TabsList>
          <TabsTrigger value="take">Take attendance</TabsTrigger>
          <TabsTrigger value="correct">Corrections</TabsTrigger>
          <TabsTrigger value="thresholds">Alert settings</TabsTrigger>
          <TabsTrigger value="analytics">Analytics</TabsTrigger>
        </TabsList>
        <TabsContent value="take" className="pt-4">
          <TakeTab classId={classId} setClassId={setClassId} date={date} setDate={setDate} periodId={periodId} setPeriodId={setPeriodId} periods={periods} classes={classes} />
        </TabsContent>
        <TabsContent value="correct" className="pt-4">
          <CorrectTab classId={classId} setClassId={setClassId} date={date} classes={classes} />
        </TabsContent>
        <TabsContent value="thresholds" className="pt-4">
          <ThresholdsTab classId={classId} setClassId={setClassId} classes={classes} />
        </TabsContent>
        <TabsContent value="analytics" className="pt-4">
          <AnalyticsTab classId={classId} setClassId={setClassId} classes={classes} today={today} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

/* ── Take attendance (P0: daily + period, late, early, reasons) ── */
function TakeTab({ classId, setClassId, date, setDate, periodId, setPeriodId, periods, classes }: any) {
  const { data: roster } = useClassRoster(classId || undefined);
  const { data: register } = useAttendanceRegister(classId || undefined, date || undefined);
  const mark = useMarkAttendance();
  const [marks, setMarks] = useState<Record<string, { status: AttendanceStatus; minutesLate?: number; earlyDepartureMinutes?: number; reason?: string }>>({});

  useEffect(() => {
    const next: any = {};
    for (const r of register ?? []) next[r.studentProfileId] = { status: r.status, minutesLate: r.minutesLate, earlyDepartureMinutes: r.earlyDepartureMinutes, reason: r.reason };
    setMarks(next);
  }, [register, classId, date, periodId]);

  const students = useMemo(() => roster ?? [], [roster]);
  const summary = useMemo(() => {
    const c: Record<string, number> = {};
    for (const s of students) { const m = marks[s.id]; if (m) c[m.status] = (c[m.status] ?? 0) + 1; }
    return c;
  }, [students, marks]);

  const save = async () => {
    const entries = students.filter((s: any) => marks[s.id]).map((s: any) => ({ studentProfileId: s.id, ...marks[s.id] }));
    if (entries.length === 0) return notify.error('Mark at least one student');
    try {
      await mark.mutateAsync({ date, classId, periodId: periodId || undefined, entries });
      notify.success(`Saved · ${entries.length} student(s)${periodId ? ' (period)' : ''}`);
    } catch { notify.error('Could not save attendance'); }
  };

  const setAll = (status: AttendanceStatus) => setMarks(Object.fromEntries(students.map((s: any) => [s.id, { status }])));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label className="text-xs">Class</Label>
          <select className={sel} value={classId} onChange={(e) => setClassId(e.target.value)}>
            <option value="">Select class…</option>{(classes?.data ?? []).map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Date</Label>
          <input type="date" className={sel} value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Period (optional)</Label>
          <select className={sel} value={periodId} onChange={(e) => setPeriodId(e.target.value)}>
            <option value="">Daily register</option>{(periods?.data ?? []).map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        {classId && students.length > 0 && (
          <Button variant="ghost" size="sm" onClick={() => setAll('present')}><CheckCircle2 className="h-4 w-4" /> All present</Button>
        )}
      </div>
      {!classId && <p className="text-sm text-muted-foreground">Pick a class to load its roster.</p>}
      {classId && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">{students.length} students ·{' '}
              {STATUSES.filter((s) => summary[s]).map((s) => <span key={s} className="mr-2">{summary[s]} {STATUS_LABEL[s].toLowerCase()}</span>)}
            </CardTitle>
            <Button onClick={save} disabled={mark.isPending}><Save className="h-4 w-4" /> Save</Button>
          </CardHeader>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead className="border-b text-left text-muted-foreground"><tr><th className="px-4 py-2">Adm.</th><th className="px-4 py-2">Name</th><th className="px-4 py-2">Status</th><th className="px-4 py-2">Detail</th></tr></thead>
              <tbody>
                {students.map((s: any) => {
                  const m = marks[s.id] ?? { status: undefined as any };
                  return (
                    <tr key={s.id} className="border-b last:border-0">
                      <td className="px-4 py-2 font-mono text-xs">{s.admissionNo}</td>
                      <td className="px-4 py-2">{s.partner?.name ?? '—'}</td>
                      <td className="px-4 py-2"><div className="flex flex-wrap gap-1">{STATUSES.map((st) => (
                        <button key={st} onClick={() => setMarks({ ...marks, [s.id]: { ...m, status: st } })}
                          className={`rounded px-2 py-1 text-xs capitalize ${m.status === st ? STATUS_STYLE[st] : 'bg-muted text-muted-foreground hover:bg-muted/70'}`}>{STATUS_LABEL[st]}</button>
                      ))}</div></td>
                      <td className="px-4 py-2">
                        <div className="flex gap-1">
                          <Input type="number" placeholder="late min" className="h-8 w-20" value={m.minutesLate ?? ''} onChange={(e) => setMarks({ ...marks, [s.id]: { ...m, minutesLate: Number(e.target.value) || undefined } })} />
                          <Input type="number" placeholder="left early min" className="h-8 w-20" value={m.earlyDepartureMinutes ?? ''} onChange={(e) => setMarks({ ...marks, [s.id]: { ...m, earlyDepartureMinutes: Number(e.target.value) || undefined } })} />
                          <Input placeholder="reason" className="h-8 w-32" value={m.reason ?? ''} onChange={(e) => setMarks({ ...marks, [s.id]: { ...m, reason: e.target.value } })} />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/* ── Corrections (P0d) ── */
function CorrectTab({ classId, setClassId, date, classes }: any) {
  const { data: register } = useAttendanceRegister(classId || undefined, date || undefined);
  const correct = useCorrectAttendance();
  const [target, setTarget] = useState<any>(null);
  const rows = register ?? [];

  const apply = async () => {
    if (!target) return;
    try {
      await correct.mutateAsync({ id: target.id, status: target.status, minutesLate: target.minutesLate || undefined, earlyDepartureMinutes: target.earlyDepartureMinutes || undefined, reason: target.reason, correctionNote: target.correctionNote });
      notify.success('Correction saved (audit-logged)'); setTarget(null);
    } catch { notify.error('Correction failed'); }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1"><Label className="text-xs">Class</Label>
          <select className={sel} value={classId} onChange={(e) => setClassId(e.target.value)}>
            <option value="">Select class…</option>{(classes?.data ?? []).map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select></div>
        <div className="space-y-1"><Label className="text-xs">Date</Label><input type="date" className={sel} value={date} onChange={() => {}} /></div>
      </div>
      {classId && (
        <Card>
          <CardHeader><CardTitle className="text-base">Records for {date}</CardTitle></CardHeader>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead className="border-b text-left text-muted-foreground"><tr><th className="px-4 py-2">Student</th><th className="px-4 py-2">Current</th><th className="px-4 py-2">Fix</th></tr></thead>
              <tbody>
                {rows.map((r: any) => (
                  <tr key={r.id} className="border-b last:border-0">
                    <td className="px-4 py-2">{r.studentProfile?.partner?.name ?? r.studentProfileId?.slice(0, 8)}</td>
                    <td className="px-4 py-2"><Badge className={STATUS_STYLE[r.status as AttendanceStatus]}>{STATUS_LABEL[r.status as AttendanceStatus]}</Badge></td>
                    <td className="px-4 py-2">
                      {target?.id === r.id ? (
                        <div className="flex flex-wrap items-center gap-1">
                          <select className={sel + ' w-40'} value={target.status} onChange={(e) => setTarget({ ...target, status: e.target.value })}>
                            {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                          </select>
                          <Input placeholder="note" className="h-8 w-32" value={target.correctionNote ?? ''} onChange={(e) => setTarget({ ...target, correctionNote: e.target.value })} />
                          <Button size="sm" onClick={apply} disabled={correct.isPending}><ShieldCheck className="h-4 w-4" /> Save</Button>
                          <Button size="sm" variant="ghost" onClick={() => setTarget(null)}>Cancel</Button>
                        </div>
                      ) : (
                        <Button size="sm" variant="ghost" onClick={() => setTarget({ ...r, status: r.status })}>Correct</Button>
                      )}
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && <tr><td colSpan={3} className="px-4 py-6 text-center text-muted-foreground">No records for this date.</td></tr>}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/* ── Alert thresholds (P1a) ── */
function ThresholdsTab({ classId, setClassId, classes }: any) {
  const { data: t } = useAttendanceThresholds(classId || undefined);
  const upsert = useUpsertAttendanceThreshold();
  const [min, setMin] = useState<number>(75);
  const [flags, setFlags] = useState({ notifyAbsent: true, notifyLate: true, notifyEarly: true, notifyBelowThreshold: true });
  useEffect(() => { if (t) { setMin(t.minAttendancePct); setFlags({ notifyAbsent: t.notifyAbsent, notifyLate: t.notifyLate, notifyEarly: t.notifyEarly, notifyBelowThreshold: t.notifyBelowThreshold }); } }, [t]);

  const save = async () => {
    try {
      await upsert.mutateAsync({ classId: classId || null, minAttendancePct: min, ...flags });
      notify.success('Alert settings saved');
    } catch { notify.error('Save failed'); }
  };

  return (
    <Card>
      <CardHeader><CardTitle className="text-base flex items-center gap-2"><Clock className="h-4 w-4" /> Parent alert settings {classId ? '(this class)' : '(org default)'}</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1 max-w-xs"><Label className="text-xs">Minimum attendance % before warning</Label>
          <Input type="number" value={min} onChange={(e) => setMin(Number(e.target.value))} /></div>
        <div className="space-y-2">
          {([['notifyAbsent', 'Notify on absence'], ['notifyLate', 'Notify on late arrival'], ['notifyEarly', 'Notify on leaving early'], ['notifyBelowThreshold', 'Notify when below threshold']] as [keyof typeof flags, string][]).map(([k, label]) => (
            <label key={k} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={(flags as any)[k]} onChange={(e) => setFlags({ ...flags, [k]: e.target.checked })} /> {label}</label>
          ))}
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1"><Label className="text-xs">Scope</Label>
            <select className={sel} value={classId} onChange={(e) => setClassId(e.target.value)}>
              <option value="">Org default</option>{(classes?.data ?? []).map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select></div>
          <Button size="sm" onClick={save} disabled={upsert.isPending}><Save className="h-4 w-4" /> Save</Button>
        </div>
        <p className="text-xs text-muted-foreground">Guardians are messaged in-app (best-effort email/SMS when provider credentials are configured).</p>
      </CardContent>
    </Card>
  );
}

/* ── Analytics (P2) ── */
function AnalyticsTab({ classId, setClassId, classes, today }: any) {
  const weekStart = useMemo(() => { const d = new Date(today); const day = (d.getDay() + 6) % 7; d.setDate(d.getDate() - day); return d.toISOString().slice(0, 10); }, [today]);
  const { data: weekly } = useAttendanceWeekly(classId || undefined, weekStart);
  const days = useMemo(() => { const out: string[] = []; const d = new Date(weekStart); for (let i = 0; i < 7; i++) { out.push(new Date(d.getTime() + i * 86400000).toISOString().slice(0, 10)); } return out; }, [weekStart]);
  const series = ['present', 'absent', 'late', 'excused', 'early_departure', 'unexcused'] as const;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1"><Label className="text-xs">Class</Label>
          <select className={sel} value={classId} onChange={(e) => setClassId(e.target.value)}>
            <option value="">Select class…</option>{(classes?.data ?? []).map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select></div>
        <Badge variant="secondary"><BarChart3 className="h-3 w-3 mr-1" /> Week of {weekStart}</Badge>
      </div>
      {classId && (
        <Card>
          <CardHeader><CardTitle className="text-base">Weekly attendance</CardTitle></CardHeader>
          <CardContent>
            <table className="w-full text-sm">
              <thead className="border-b text-left text-muted-foreground"><tr><th className="px-2 py-1">Day</th>{series.map((s) => <th key={s} className="px-2 py-1 capitalize">{STATUS_LABEL[s]}</th>)}</tr></thead>
              <tbody>
                {days.map((d) => {
                  const row = weekly?.byDate?.[d] ?? {};
                  return (<tr key={d} className="border-b last:border-0">
                    <td className="px-2 py-1 font-medium">{new Date(d).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}</td>
                    {series.map((s) => <td key={s} className="px-2 py-1">{row[s] ?? 0}</td>)}
                  </tr>);
                })}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
