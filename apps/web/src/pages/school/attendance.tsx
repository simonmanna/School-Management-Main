import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Save } from 'lucide-react';
import {
  useClasses,
  useClassRoster,
  useAttendanceRegister,
  useMarkAttendance,
  type AttendanceStatus,
} from '@/features/school/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { notify } from '@/lib/notify';

const sel = 'rounded-md border bg-card px-3 py-2 text-sm';
const STATUSES: AttendanceStatus[] = ['present', 'absent', 'late', 'excused'];
const STATUS_STYLE: Record<AttendanceStatus, string> = {
  present: 'bg-emerald-600 text-white',
  absent: 'bg-rose-600 text-white',
  late: 'bg-amber-500 text-white',
  excused: 'bg-sky-600 text-white',
};

export function SchoolAttendancePage() {
  const today = new Date().toISOString().slice(0, 10);
  const [classId, setClassId] = useState('');
  const [date, setDate] = useState(today);
  const [marks, setMarks] = useState<Record<string, AttendanceStatus>>({});

  const { data: classes } = useClasses();
  const { data: roster } = useClassRoster(classId || undefined);
  const { data: register } = useAttendanceRegister(classId || undefined, date || undefined);
  const mark = useMarkAttendance();

  // Prefill from any existing register for the day.
  useEffect(() => {
    const next: Record<string, AttendanceStatus> = {};
    for (const r of register ?? []) next[r.studentProfileId] = r.status;
    setMarks(next);
  }, [register, classId, date]);

  const students = useMemo(() => roster ?? [], [roster]);
  const summary = useMemo(() => {
    const c = { present: 0, absent: 0, late: 0, excused: 0, unmarked: 0 };
    for (const s of students) {
      const m = marks[s.id];
      if (m) c[m] += 1;
      else c.unmarked += 1;
    }
    return c;
  }, [students, marks]);

  const setAll = (status: AttendanceStatus) =>
    setMarks(Object.fromEntries(students.map((s) => [s.id, status])));

  const save = async () => {
    const entries = students
      .filter((s) => marks[s.id])
      .map((s) => ({ studentProfileId: s.id, status: marks[s.id] }));
    if (entries.length === 0) {
      notify.error('Mark at least one student');
      return;
    }
    try {
      await mark.mutateAsync({ date, classId, entries });
      notify.success(`Attendance saved · ${entries.length} student(s)`);
    } catch {
      notify.error('Could not save attendance');
    }
  };

  return (
    <div className="space-y-4 p-6">
      <div>
        <h1 className="text-xl font-semibold">Attendance</h1>
        <p className="text-sm text-muted-foreground">Daily register — mark a class, save in one click.</p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label className="text-xs">Class</Label>
          <select className={sel} value={classId} onChange={(e) => setClassId(e.target.value)}>
            <option value="">Select class…</option>
            {(classes?.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Date</Label>
          <input type="date" className={sel} value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        {classId && students.length > 0 && (
          <Button variant="ghost" size="sm" onClick={() => setAll('present')}>
            <CheckCircle2 className="h-4 w-4" /> All present
          </Button>
        )}
      </div>

      {!classId && <p className="text-sm text-muted-foreground">Pick a class to load its roster.</p>}

      {classId && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">
              {students.length} students ·{' '}
              <span className="text-emerald-600">{summary.present} present</span> ·{' '}
              <span className="text-rose-600">{summary.absent} absent</span> ·{' '}
              <span className="text-amber-600">{summary.late} late</span>
              {summary.unmarked > 0 && <span className="text-muted-foreground"> · {summary.unmarked} unmarked</span>}
            </CardTitle>
            <Button onClick={save} disabled={mark.isPending}>
              <Save className="h-4 w-4" /> Save register
            </Button>
          </CardHeader>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead className="border-b text-left text-muted-foreground">
                <tr><th className="px-4 py-2 font-medium">Adm. no.</th><th className="px-4 py-2 font-medium">Name</th><th className="px-4 py-2 font-medium">Status</th></tr>
              </thead>
              <tbody>
                {students.length === 0 && (
                  <tr><td colSpan={3} className="px-4 py-6 text-center text-muted-foreground">No active students in this class.</td></tr>
                )}
                {students.map((s) => (
                  <tr key={s.id} className="border-b last:border-0">
                    <td className="px-4 py-2 font-mono text-xs">{s.admissionNo}</td>
                    <td className="px-4 py-2">{s.partner?.name ?? '—'}</td>
                    <td className="px-4 py-2">
                      <div className="flex gap-1">
                        {STATUSES.map((st) => (
                          <button
                            key={st}
                            onClick={() => setMarks({ ...marks, [s.id]: st })}
                            className={`rounded px-2 py-1 text-xs capitalize ${marks[s.id] === st ? STATUS_STYLE[st] : 'bg-muted text-muted-foreground hover:bg-muted/70'}`}
                          >
                            {st}
                          </button>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
