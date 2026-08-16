import { useMemo, useState } from 'react';
import { Plus, Send, Coffee, Minus } from 'lucide-react';
import {
  useClasses, useSubjects, usePeriods, useStaff,
  useClassTimetable, useTeacherTimetable, useRoomTimetable, useSubjectTimetable,
  useCreateSlot, useUpdateSlot, usePublishTimetable,
  type TimetableSlotInput,
} from '@/features/school/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { notify } from '@/lib/notify';

const sel = 'rounded-md border bg-card px-3 py-2 text-sm';
// 1=Mon … 7=Sun, matching the server's CreateTimetableSlotDto range.
const DAYS = [
  { n: 1, label: 'Mon' }, { n: 2, label: 'Tue' }, { n: 3, label: 'Wed' },
  { n: 4, label: 'Thu' }, { n: 5, label: 'Fri' }, { n: 6, label: 'Sat' },
  { n: 7, label: 'Sun' },
];
const TYPES = [
  { v: 'lesson', label: 'Lesson' },
  { v: 'break', label: 'Break' },
  { v: 'free', label: 'Free' },
];

type Tab = 'class' | 'teacher' | 'room' | 'subject';

export function SchoolTimetablePage() {
  const [tab, setTab] = useState<Tab>('class');
  const { data: periods } = usePeriods();
  const { data: subjects } = useSubjects();
  const { data: classes } = useClasses();
  const { data: staff } = useStaff();

  const periodRows = useMemo(
    () => [...(periods?.data ?? [])].sort((a, b) => a.order - b.order),
    [periods],
  );
  const subjectName = useMemo(
    () => Object.fromEntries((subjects?.data ?? []).map((s: any) => [s.id, s.name])),
    [subjects],
  );
  const teacherName = useMemo(
    () => Object.fromEntries((staff?.data ?? []).map((s: any) => [s.id, `${s.firstName ?? ''} ${s.lastName ?? ''}`.trim() || s.employeeNo])),
    [staff],
  );

  const [classId, setClassId] = useState('');
  const [teacherId, setTeacherId] = useState('');
  const [room, setRoom] = useState('');
  const [subjectId, setSubjectId] = useState('');

  const classTT = useClassTimetable(tab === 'class' ? classId || undefined : undefined);
  const teacherTT = useTeacherTimetable(tab === 'teacher' ? teacherId || undefined : undefined);
  const roomTT = useRoomTimetable(tab === 'room' ? room || undefined : undefined);
  const subjectTT = useSubjectTimetable(tab === 'subject' ? subjectId || undefined : undefined);

  const tt = tab === 'class' ? classTT : tab === 'teacher' ? teacherTT : tab === 'room' ? roomTT : subjectTT;
  const isLoading = tt.isLoading;

  const [form, setForm] = useState<Record<string, string>>({});
  const createSlot = useCreateSlot();
  const updateSlot = useUpdateSlot();
  const publish = usePublishTimetable();

  const slotAt = (periodId: string, day: number) => tt.data?.grid?.[day]?.[periodId];

  const addSlot = async () => {
    if (tab !== 'class' || !classId) return;
    try {
      await createSlot.mutateAsync({
        classId,
        dayOfWeek: Number(form.dayOfWeek),
        periodId: form.periodId,
        subjectId: form.subjectId,
        room: form.room || undefined,
        teacherPartnerId: form.teacherPartnerId || undefined,
        type: (form.type as any) || 'lesson',
        substituteTeacherId: form.substituteTeacherId || undefined,
      } as TimetableSlotInput);
      notify.success('Slot added');
      setForm({});
    } catch (e: any) {
      notify.error(e?.response?.data?.message ?? 'Could not add slot — check for a clash on that day/period');
    }
  };

  const applyType = async (slotId: string, type: string) => {
    try {
      await updateSlot.mutateAsync({ id: slotId, dto: { type: type as any } });
      notify.success('Updated');
    } catch (e: any) { notify.error(e?.response?.data?.message ?? 'Update failed'); }
  };
  const applySub = async (slotId: string, substituteTeacherId: string) => {
    try {
      await updateSlot.mutateAsync({ id: slotId, dto: { substituteTeacherId: substituteTeacherId || undefined } });
      notify.success('Substitution saved');
    } catch (e: any) { notify.error(e?.response?.data?.message ?? 'Update failed'); }
  };

  const doPublish = async (published: boolean) => {
    if (!classId) return;
    try {
      await publish.mutateAsync({ classId, published });
      notify.success(published ? 'Timetable published' : 'Unpublished');
    } catch (e: any) { notify.error(e?.response?.data?.message ?? 'Publish failed'); }
  };

  const cell = (s: any) => {
    if (!s) return <span className="text-muted-foreground">·</span>;
    if (s.type === 'break') return <div className="rounded bg-amber-100 px-2 py-1 text-xs font-medium text-amber-700"><Coffee className="mr-1 inline h-3 w-3" />Break</div>;
    if (s.type === 'free') return <div className="rounded bg-slate-100 px-2 py-1 text-xs text-slate-500">Free</div>;
    const teacher = s.substituteTeacherId ? `${teacherName[s.substituteTeacherId]} (sub)` : teacherName[s.teacherPartnerId];
    return (
      <div className="rounded bg-primary/10 px-2 py-1">
        <div className="text-xs font-medium">{s.subject?.name ?? subjectName[s.subjectId] ?? '—'}</div>
        {teacher && <div className="text-[10px] text-muted-foreground">{teacher}</div>}
        {tab === 'class' && s.room && <div className="text-[10px] text-muted-foreground">{s.room}</div>}
        <div className="mt-1 flex gap-1">
          <select className="h-6 rounded border bg-card text-[10px]" defaultValue="" onChange={(e) => e.target.value && applyType(s.id, e.target.value)}>
            <option value="">Type…</option>
            {TYPES.map((t) => <option key={t.v} value={t.v}>{t.label}</option>)}
          </select>
        </div>
        {tab === 'class' && (
          <div className="mt-1 flex gap-1">
            <select className="h-6 rounded border bg-card text-[10px]" defaultValue="" onChange={(e) => e.target.value !== undefined && applySub(s.id, e.target.value)}>
              <option value="">Sub…</option>
              {(staff?.data ?? []).map((st: any) => <option key={st.id} value={st.id}>{teacherName[st.id]}</option>)}
            </select>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-4 p-6">
      <div>
        <h1 className="text-xl font-semibold">Timetable Management</h1>
        <p className="text-sm text-muted-foreground">Class, teacher, room and subject weekly grids with conflict checking.</p>
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap gap-1">
        {([['class', 'Class'], ['teacher', 'Teacher'], ['room', 'Room'], ['subject', 'Subject']] as [Tab, string][]).map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${tab === k ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}>
            {label} timetable
          </button>
        ))}
      </div>

      {/* Selector */}
      <div className="space-y-1">
        <Label className="text-xs">{tab === 'teacher' ? 'Teacher' : tab === 'room' ? 'Room name' : tab === 'subject' ? 'Subject' : 'Class'}</Label>
        {tab === 'class' && (
          <select className={sel} value={classId} onChange={(e) => setClassId(e.target.value)}>
            <option value="">Select class…</option>
            {(classes?.data ?? []).map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        )}
        {tab === 'teacher' && (
          <select className={sel} value={teacherId} onChange={(e) => setTeacherId(e.target.value)}>
            <option value="">Select teacher…</option>
            {(staff?.data ?? []).map((s: any) => <option key={s.id} value={s.id}>{teacherName[s.id]}</option>)}
          </select>
        )}
        {tab === 'room' && (
          <Input className="w-48" placeholder="e.g. Lab A" value={room} onChange={(e) => setRoom(e.target.value)} />
        )}
        {tab === 'subject' && (
          <select className={sel} value={subjectId} onChange={(e) => setSubjectId(e.target.value)}>
            <option value="">Select subject…</option>
            {(subjects?.data ?? []).map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        )}
      </div>

      {tab === 'class' && classId && (
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => doPublish(true)} disabled={publish.isPending}><Send className="h-4 w-4" /> Publish</Button>
          <Button variant="outline" onClick={() => doPublish(false)} disabled={publish.isPending}><Minus className="h-4 w-4" /> Unpublish</Button>
        </div>
      )}

      {(tab === 'class' ? classId : tab === 'teacher' ? teacherId : tab === 'room' ? room : tab === 'subject' ? subjectId : '') && (
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
                  <tr><td colSpan={DAYS.length + 1} className="px-3 py-6 text-center text-muted-foreground">
                    {isLoading ? 'Loading…' : 'No periods configured. Add periods under Foundation first.'}
                  </td></tr>
                )}
                {periodRows.map((p: any) => (
                  <tr key={p.id} className="border-b last:border-0">
                    <td className="px-3 py-2">
                      <div className="font-medium">{p.name}</div>
                      <div className="text-xs text-muted-foreground">{p.startTime}–{p.endTime}</div>
                    </td>
                    {DAYS.map((d) => (
                      <td key={d.n} className="px-3 py-2 align-top">{cell(slotAt(p.id, d.n))}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      {tab === 'class' && classId && (
        <Card>
          <CardHeader><CardTitle className="text-base">Add slot (lesson / break / free)</CardTitle></CardHeader>
          <CardContent className="flex flex-wrap items-end gap-2">
            <select className={sel} value={form.dayOfWeek ?? ''} onChange={(e) => setForm({ ...form, dayOfWeek: e.target.value })}>
              <option value="">Day…</option>{DAYS.map((d) => <option key={d.n} value={d.n}>{d.label}</option>)}
            </select>
            <select className={sel} value={form.periodId ?? ''} onChange={(e) => setForm({ ...form, periodId: e.target.value })}>
              <option value="">Period…</option>{periodRows.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <select className={sel} value={form.type ?? 'lesson'} onChange={(e) => setForm({ ...form, type: e.target.value })}>
              {TYPES.map((t) => <option key={t.v} value={t.v}>{t.label}</option>)}
            </select>
            <select className={sel} value={form.subjectId ?? ''} onChange={(e) => setForm({ ...form, subjectId: e.target.value })}>
              <option value="">Subject…</option>{(subjects?.data ?? []).map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <select className={sel} value={form.teacherPartnerId ?? ''} onChange={(e) => setForm({ ...form, teacherPartnerId: e.target.value })}>
              <option value="">Teacher…</option>{(staff?.data ?? []).map((s: any) => <option key={s.id} value={s.id}>{teacherName[s.id]}</option>)}
            </select>
            <Input placeholder="Room" className="w-28" value={form.room ?? ''} onChange={(e) => setForm({ ...form, room: e.target.value })} />
            <Button disabled={!form.dayOfWeek || !form.periodId || !form.subjectId || createSlot.isPending} onClick={addSlot}>
              <Plus className="h-4 w-4" /> Add
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
