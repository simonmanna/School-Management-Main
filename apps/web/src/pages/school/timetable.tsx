import { useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import {
  useClasses, useSubjects, usePeriods, useClassTimetable, useCreateSlot,
} from '@/features/school/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { notify } from '@/lib/notify';

const sel = 'rounded-md border bg-card px-3 py-2 text-sm';
const DAYS = [
  { n: 1, label: 'Mon' }, { n: 2, label: 'Tue' }, { n: 3, label: 'Wed' },
  { n: 4, label: 'Thu' }, { n: 5, label: 'Fri' }, { n: 6, label: 'Sat' },
];

export function SchoolTimetablePage() {
  const [classId, setClassId] = useState('');
  const { data: classes } = useClasses();
  const { data: subjects } = useSubjects();
  const { data: periods } = usePeriods();
  const { data: slots } = useClassTimetable(classId || undefined);
  const createSlot = useCreateSlot();

  const [form, setForm] = useState<Record<string, string>>({});

  const periodRows = useMemo(
    () => [...(periods?.data ?? [])].sort((a, b) => a.order - b.order),
    [periods],
  );
  const slotAt = (periodId: string, day: number) =>
    (slots ?? []).find((s) => s.periodId === periodId && s.dayOfWeek === day);
  const subjectName = useMemo(
    () => Object.fromEntries((subjects?.data ?? []).map((s) => [s.id, s.name])),
    [subjects],
  );

  const addSlot = async () => {
    try {
      await createSlot.mutateAsync({
        classId,
        dayOfWeek: Number(form.dayOfWeek),
        periodId: form.periodId,
        subjectId: form.subjectId,
        room: form.room || undefined,
      });
      notify.success('Slot added');
      setForm({});
    } catch {
      notify.error('Could not add slot — check for a clash on that day/period');
    }
  };

  return (
    <div className="space-y-4 p-6">
      <div>
        <h1 className="text-xl font-semibold">Timetable</h1>
        <p className="text-sm text-muted-foreground">Weekly period grid per class.</p>
      </div>

      <div className="space-y-1">
        <Label className="text-xs">Class</Label>
        <select className={sel} value={classId} onChange={(e) => setClassId(e.target.value)}>
          <option value="">Select class…</option>
          {(classes?.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>

      {classId && (
        <>
          <Card>
            <CardContent className="overflow-x-auto p-0">
              <table className="w-full text-sm">
                <thead className="border-b text-left text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">Period</th>
                    {DAYS.map((d) => <th key={d.n} className="px-3 py-2 font-medium">{d.label}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {periodRows.length === 0 && (
                    <tr><td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">No periods configured. Add periods under Foundation first.</td></tr>
                  )}
                  {periodRows.map((p) => (
                    <tr key={p.id} className="border-b last:border-0">
                      <td className="px-3 py-2">
                        <div className="font-medium">{p.name}</div>
                        <div className="text-xs text-muted-foreground">{p.startTime}–{p.endTime}</div>
                      </td>
                      {DAYS.map((d) => {
                        const s = slotAt(p.id, d.n);
                        return (
                          <td key={d.n} className="px-3 py-2">
                            {s ? (
                              <div className="rounded bg-primary/10 px-2 py-1">
                                <div className="text-xs font-medium">{s.subject?.name ?? subjectName[s.subjectId] ?? '—'}</div>
                                {s.room && <div className="text-[10px] text-muted-foreground">{s.room}</div>}
                              </div>
                            ) : <span className="text-muted-foreground">·</span>}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Add slot</CardTitle></CardHeader>
            <CardContent className="flex flex-wrap items-end gap-2">
              <select className={sel} value={form.dayOfWeek ?? ''} onChange={(e) => setForm({ ...form, dayOfWeek: e.target.value })}>
                <option value="">Day…</option>{DAYS.map((d) => <option key={d.n} value={d.n}>{d.label}</option>)}
              </select>
              <select className={sel} value={form.periodId ?? ''} onChange={(e) => setForm({ ...form, periodId: e.target.value })}>
                <option value="">Period…</option>{periodRows.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <select className={sel} value={form.subjectId ?? ''} onChange={(e) => setForm({ ...form, subjectId: e.target.value })}>
                <option value="">Subject…</option>{(subjects?.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              <Input placeholder="Room" className="w-28" value={form.room ?? ''} onChange={(e) => setForm({ ...form, room: e.target.value })} />
              <Button disabled={!form.dayOfWeek || !form.periodId || !form.subjectId || createSlot.isPending} onClick={addSlot}>
                <Plus className="h-4 w-4" /> Add
              </Button>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
