import { useMemo, useState } from 'react';
import { Plus, Send, Coffee, Minus, Wand2, Trash2, CalendarDays } from 'lucide-react';
import {
  useClasses, useSubjects, usePeriods, useStaff, useStudents,
  useClassTimetable, useTeacherTimetable, useRoomTimetable, useSubjectTimetable, useStudentTimetable,
  useCreateSlot, useUpdateSlot, usePublishTimetable,
  useTeachingRooms, useCreateTeachingRoom, useDeleteTeachingRoom,
  useTeacherAvailability, useSetAvailability,
  useRotation, useSetRotation, useOverrides, useCreateOverride, useDeleteOverride,
  useGenerateTimetable, useSpecialSchedule,
  type TimetableSlotInput,
} from '@/features/school/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { notify } from '@/lib/notify';

const sel = 'rounded-md border bg-card px-3 py-2 text-sm';
const DAYS = [
  { n: 1, label: 'Mon' }, { n: 2, label: 'Tue' }, { n: 3, label: 'Wed' },
  { n: 4, label: 'Thu' }, { n: 5, label: 'Fri' }, { n: 6, label: 'Sat' }, { n: 7, label: 'Sun' },
];
const TYPES = [{ v: 'lesson', label: 'Lesson' }, { v: 'break', label: 'Break' }, { v: 'free', label: 'Free' }];
type Tab = 'class' | 'teacher' | 'room' | 'subject' | 'student';

export function SchoolTimetablePage() {
  const [tab, setTab] = useState<Tab>('class');
  const [cycle, setCycle] = useState<string>(''); // '' = all weeks
  const [specialFrom, setSpecialFrom] = useState('');
  const [specialTo, setSpecialTo] = useState('');
  const { data: periods } = usePeriods();
  const { data: subjects } = useSubjects();
  const { data: classes } = useClasses();
  const { data: staff } = useStaff();
  const { data: students } = useStudents();
  const special = useSpecialSchedule(specialFrom || undefined, specialTo || undefined);

  const periodRows = useMemo(() => [...(periods?.data ?? [])].sort((a: any, b: any) => a.order - b.order), [periods]);
  const subjectName = useMemo(() => Object.fromEntries((subjects?.data ?? []).map((s: any) => [s.id, s.name])), [subjects]);
  const teacherName = useMemo(() => Object.fromEntries((staff?.data ?? []).map((s: any) => [s.id, `${s.firstName ?? ''} ${s.lastName ?? ''}`.trim() || s.employeeNo])), [staff]);

  const [classId, setClassId] = useState('');
  const [teacherId, setTeacherId] = useState('');
  const [room, setRoom] = useState('');
  const [subjectId, setSubjectId] = useState('');
  const [studentId, setStudentId] = useState('');

  const classTT = useClassTimetable(tab === 'class' ? classId || undefined : undefined, cycle || undefined);
  const teacherTT = useTeacherTimetable(tab === 'teacher' ? teacherId || undefined : undefined, cycle || undefined);
  const roomTT = useRoomTimetable(tab === 'room' ? room || undefined : undefined, cycle || undefined);
  const subjectTT = useSubjectTimetable(tab === 'subject' ? subjectId || undefined : undefined, cycle || undefined);
  const studentTT = useStudentTimetable(tab === 'student' ? studentId || undefined : undefined);

  const tt = tab === 'class' ? classTT : tab === 'teacher' ? teacherTT : tab === 'room' ? roomTT : tab === 'subject' ? subjectTT : studentTT;
  const isLoading = tt.isLoading;
  const [form, setForm] = useState<Record<string, string>>({});
  const createSlot = useCreateSlot();
  const updateSlot = useUpdateSlot();
  const slotAt = (periodId: string, day: number) => tt.data?.grid?.[day]?.[periodId];

  const addSlot = async () => {
    if (tab !== 'class' || !classId) return;
    try {
      await createSlot.mutateAsync({
        classId, dayOfWeek: Number(form.dayOfWeek), periodId: form.periodId, subjectId: form.subjectId,
        room: form.room || undefined, teacherPartnerId: form.teacherPartnerId || undefined,
        type: (form.type as any) || 'lesson', substituteTeacherId: form.substituteTeacherId || undefined,
        spanPeriods: Number(form.spanPeriods || 1), cycle: (form.cycle as any) || 'all',
        teachingRoomId: form.teachingRoomId || undefined,
      } as TimetableSlotInput);
      notify.success('Slot added');
      setForm({});
    } catch (e: any) { notify.error(e?.response?.data?.message ?? 'Could not add slot — check for a clash'); }
  };

  const applyType = async (slotId: string, type: string) => {
    try { await updateSlot.mutateAsync({ id: slotId, dto: { type: type as any } }); notify.success('Updated'); }
    catch (e: any) { notify.error(e?.response?.data?.message ?? 'Update failed'); }
  };
  const applySub = async (slotId: string, substituteTeacherId: string) => {
    try { await updateSlot.mutateAsync({ id: slotId, dto: { substituteTeacherId: substituteTeacherId || undefined } }); notify.success('Substitution saved'); }
    catch (e: any) { notify.error(e?.response?.data?.message ?? 'Update failed'); }
  };
  const cell = (s: any) => {
    if (!s) return <span className="text-muted-foreground">·</span>;
    if (s.type === 'break') return <div className="rounded bg-amber-100 px-2 py-1 text-xs font-medium text-amber-700"><Coffee className="mr-1 inline h-3 w-3" />Break{(s.spanPeriods ?? 1) > 1 ? ` ×${s.spanPeriods}` : ''}</div>;
    if (s.type === 'free') return <div className="rounded bg-slate-100 px-2 py-1 text-xs text-slate-500">Free</div>;
    const teacher = s.substituteTeacherId ? `${teacherName[s.substituteTeacherId]} (sub)` : teacherName[s.teacherPartnerId];
    return (
      <div className={`rounded px-2 py-1 ${s.overridden ? 'bg-rose-100' : 'bg-primary/10'}`}>
        <div className="text-xs font-medium">{s.subject?.name ?? subjectName[s.subjectId] ?? '—'}</div>
        {teacher && <div className="text-[10px] text-muted-foreground">{teacher}</div>}
        {s.spanPeriods > 1 && <div className="text-[10px] text-muted-foreground">double ×{s.spanPeriods}</div>}
        {tab === 'class' && s.room && <div className="text-[10px] text-muted-foreground">{s.room}</div>}
        {s.overridden && <div className="text-[10px] text-rose-600">{s.overrideReason ?? 'override'}</div>}
        {tab === 'class' && (
          <div className="mt-1 flex flex-wrap gap-1">
            <select className="h-6 rounded border bg-card text-[10px]" defaultValue="" onChange={(e) => e.target.value && applyType(s.id, e.target.value)}>
              <option value="">Type…</option>{TYPES.map((t) => <option key={t.v} value={t.v}>{t.label}</option>)}
            </select>
            <select className="h-6 rounded border bg-card text-[10px]" defaultValue="" onChange={(e) => applySub(s.id, e.target.value)}>
              <option value="">Sub…</option>{(staff?.data ?? []).map((st: any) => <option key={st.id} value={st.id}>{teacherName[st.id]}</option>)}
            </select>
          </div>
        )}
      </div>
    );
  };

  const grid = (
    <Card>
      <CardContent className="overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="border-b text-left text-muted-foreground">
            <tr><th className="px-3 py-2 font-medium">Period</th>{DAYS.map((d) => <th key={d.n} className="px-3 py-2 font-medium">{d.label}</th>)}</tr>
          </thead>
          <tbody>
            {periodRows.length === 0 && (
              <tr><td colSpan={DAYS.length + 1} className="px-3 py-6 text-center text-muted-foreground">
                {isLoading ? 'Loading…' : 'No periods configured. Add periods under Foundation first.'}</td></tr>
            )}
            {periodRows.map((p: any) => (
              <tr key={p.id} className="border-b last:border-0">
                <td className="px-3 py-2"><div className="font-medium">{p.name}</div><div className="text-xs text-muted-foreground">{p.startTime}–{p.endTime}</div></td>
                {DAYS.map((d) => <td key={d.n} className="px-3 py-2 align-top">{cell(slotAt(p.id, d.n))}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );

  const selector = (() => {
    switch (tab) {
      case 'class': return (
        <select className={sel} value={classId} onChange={(e) => setClassId(e.target.value)}>
          <option value="">Select class…</option>{(classes?.data ?? []).map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>);
      case 'teacher': return (
        <select className={sel} value={teacherId} onChange={(e) => setTeacherId(e.target.value)}>
          <option value="">Select teacher…</option>{(staff?.data ?? []).map((s: any) => <option key={s.id} value={s.id}>{teacherName[s.id]}</option>)}
        </select>);
      case 'room': return <Input className="w-48" placeholder="e.g. Lab A" value={room} onChange={(e) => setRoom(e.target.value)} />;
      case 'subject': return (
        <select className={sel} value={subjectId} onChange={(e) => setSubjectId(e.target.value)}>
          <option value="">Select subject…</option>{(subjects?.data ?? []).map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>);
      case 'student': return (
        <select className={sel} value={studentId} onChange={(e) => setStudentId(e.target.value)}>
          <option value="">Select student…</option>{(students?.data ?? []).map((s: any) => <option key={s.id} value={s.id}>{s.firstName} {s.lastName}</option>)}
        </select>);
    }
  })();

  return (
    <div className="space-y-4 p-6">
      <div>
        <h1 className="text-xl font-semibold">Timetable Management</h1>
        <p className="text-sm text-muted-foreground">Weekly grids, conflict detection, rotations, substitutions & auto-generation.</p>
      </div>

      <div className="flex flex-wrap gap-1">
        {([['class', 'Class'], ['teacher', 'Teacher'], ['room', 'Room'], ['subject', 'Subject'], ['student', 'Student']] as [Tab, string][]).map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)} className={`rounded-md px-3 py-1.5 text-sm font-medium ${tab === k ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}>{label} timetable</button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="space-y-1"><Label className="text-xs">View cycle</Label>
          <select className={sel} value={cycle} onChange={(e) => setCycle(e.target.value)}>
            <option value="">All weeks</option><option value="A">Week A only</option><option value="B">Week B only</option>
          </select>
        </div>
        <div className="space-y-1"><Label className="text-xs">Special schedule (exam/event) range</Label>
          <div className="flex gap-1">
            <Input type="date" className="w-40" value={specialFrom} onChange={(e) => setSpecialFrom(e.target.value)} />
            <Input type="date" className="w-40" value={specialTo} onChange={(e) => setSpecialTo(e.target.value)} />
          </div>
        </div>
      </div>

      <div className="space-y-1"><Label className="text-xs">{tab === 'student' ? 'Student' : tab === 'room' ? 'Room name' : tab === 'teacher' ? 'Teacher' : tab === 'subject' ? 'Subject' : 'Class'}</Label>{selector}</div>

      {(tab === 'class' ? classId : tab === 'teacher' ? teacherId : tab === 'room' ? room : tab === 'subject' ? subjectId : tab === 'student' ? studentId : '') && grid}

      {tab === 'class' && classId && (
        <Card>
          <CardHeader><CardTitle className="text-base">Add slot (lesson / break / free · double period · cycle)</CardTitle></CardHeader>
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
            <select className={sel} value={form.spanPeriods ?? '1'} onChange={(e) => setForm({ ...form, spanPeriods: e.target.value })}>
              <option value="1">1 period</option><option value="2">Double (2)</option><option value="3">Triple (3)</option>
            </select>
            <select className={sel} value={form.cycle ?? 'all'} onChange={(e) => setForm({ ...form, cycle: e.target.value })}>
              <option value="all">All weeks</option><option value="A">Week A</option><option value="B">Week B</option>
            </select>
            <select className={sel} value={form.subjectId ?? ''} onChange={(e) => setForm({ ...form, subjectId: e.target.value })}>
              <option value="">Subject…</option>{(subjects?.data ?? []).map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <select className={sel} value={form.teacherPartnerId ?? ''} onChange={(e) => setForm({ ...form, teacherPartnerId: e.target.value })}>
              <option value="">Teacher…</option>{(staff?.data ?? []).map((s: any) => <option key={s.id} value={s.id}>{`${s.firstName ?? ''} ${s.lastName ?? ''}`}</option>)}
            </select>
            <Input placeholder="Room" className="w-28" value={form.room ?? ''} onChange={(e) => setForm({ ...form, room: e.target.value })} />
            <Button disabled={!form.dayOfWeek || !form.periodId || !form.subjectId || createSlot.isPending} onClick={addSlot}>
              <Plus className="h-4 w-4" /> Add
            </Button>
          </CardContent>
        </Card>
      )}

      {tab === 'class' && classId && <ClassExtras classId={classId} subjects={subjects?.data ?? []} staff={staff?.data ?? []} />}
      {tab === 'teacher' && teacherId && <TeacherAvailabilityCard teacherId={teacherId} periods={periodRows} />}
      <TeachingRoomsCard />
      <SpecialSchedulePanel events={special.data ?? []} loading={special.isLoading} />
    </div>
  );
}

/* ── Special schedule (exam / event calendar overlay) ─────────────────────── */
function SpecialSchedulePanel({ events, loading }: { events: any[]; loading: boolean }) {
  return (
    <Card>
      <CardHeader><CardTitle className="text-base flex items-center gap-2"><CalendarDays className="h-4 w-4" /> Special schedule — exams & events</CardTitle></CardHeader>
      <CardContent>
        {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
        {!loading && events.length === 0 && <p className="text-sm text-muted-foreground">No exam/event calendar entries in the selected range. Pick a date range above, or add exam/event entries under School → Calendar & Holidays.</p>}
        <div className="grid gap-2 sm:grid-cols-2">
          {events.map((e: any) => (
            <div key={e.id} className={`rounded-md border px-3 py-2 ${e.type === 'exam' ? 'border-rose-200 bg-rose-50' : 'border-blue-200 bg-blue-50'}`}>
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">{e.title}</span>
                <span className="text-xs uppercase text-muted-foreground">{e.type}</span>
              </div>
              <div className="text-xs text-muted-foreground">{e.startDate?.slice(0, 10)} → {e.endDate?.slice(0, 10)}</div>
              {e.description && <div className="mt-1 text-xs">{e.description}</div>}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

/* ── Class extras: rotation, publish, generate, overrides ─────────────────── */
function ClassExtras({ classId, subjects, staff }: { classId: string; subjects: any[]; staff: any[] }) {
  const rotation = useRotation(classId);
  const setRotation = useSetRotation();
  const publish = usePublishTimetable();
  const generate = useGenerateTimetable();
  const overrides = useOverrides(classId);
  const createOverride = useCreateOverride();
  const deleteOverride = useDeleteOverride();
  const [ov, setOv] = useState<Record<string, string>>({});

  const generateTt = async () => {
    const subjectLoads = subjects.slice(0, 5).map((s: any, i) => ({ subjectId: s.id, perWeek: 3 + (i % 3) }));
    try {
      const res = await generate.mutateAsync({ classId, subjectLoads, maxPerDay: 2 });
      notify.success(`Generated ${(res as any).created} slots`);
    } catch (e: any) { notify.error(e?.response?.data?.message ?? 'Generation failed'); }
  };

  return (
    <>
      <Card>
        <CardHeader><CardTitle className="text-base">Rotation & publishing</CardTitle></CardHeader>
        <CardContent className="flex flex-wrap items-end gap-2">
          <div className="space-y-1"><Label className="text-xs">Active cycle</Label>
            <select className={sel} value={rotation.data?.activeCycle ?? 'all'} onChange={(e) => setRotation.mutateAsync({ classId, activeCycle: e.target.value })}>
              <option value="all">All weeks</option><option value="A">Week A</option><option value="B">Week B</option>
            </select>
          </div>
          <Button variant="outline" onClick={() => publish.mutateAsync({ classId, published: true })}><Send className="h-4 w-4" /> Publish</Button>
          <Button variant="outline" onClick={() => publish.mutateAsync({ classId, published: false })}><Minus className="h-4 w-4" /> Unpublish</Button>
          <Button variant="outline" onClick={generateTt} disabled={generate.isPending}><Wand2 className="h-4 w-4" /> Auto-generate</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Temporary changes (overrides)</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-end gap-2">
            <select className={sel} value={ov.dayOfWeek ?? ''} onChange={(e) => setOv({ ...ov, dayOfWeek: e.target.value })}>
              <option value="">Day…</option>{DAYS.map((d) => <option key={d.n} value={d.n}>{d.label}</option>)}
            </select>
            <Input className="w-40" type="date" value={ov.from ?? ''} onChange={(e) => setOv({ ...ov, from: e.target.value })} />
            <Input className="w-40" type="date" value={ov.to ?? ''} onChange={(e) => setOv({ ...ov, to: e.target.value })} />
            <select className={sel} value={ov.subjectId ?? ''} onChange={(e) => setOv({ ...ov, subjectId: e.target.value })}>
              <option value="">Replacement subject…</option>{subjects.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <select className={sel} value={ov.teacherPartnerId ?? ''} onChange={(e) => setOv({ ...ov, teacherPartnerId: e.target.value })}>
              <option value="">Replacement teacher…</option>{staff.map((s: any) => <option key={s.id} value={s.id}>{`${s.firstName ?? ''} ${s.lastName ?? ''}`}</option>)}
            </select>
            <Button disabled={!ov.dayOfWeek || !ov.from || !ov.to || createOverride.isPending} onClick={async () => {
              try { await createOverride.mutateAsync({ classId, dayOfWeek: Number(ov.dayOfWeek), periodId: '', effectiveFrom: ov.from, effectiveTo: ov.to, subjectId: ov.subjectId || undefined, teacherPartnerId: ov.teacherPartnerId || undefined, reason: ov.reason }); notify.success('Override added'); setOv({}); }
              catch (e: any) { notify.error(e?.response?.data?.message ?? 'Failed'); }
            }}><Plus className="h-4 w-4" /> Add override</Button>
          </div>
          <div className="space-y-1">
            {(overrides.data ?? []).map((o: any) => (
              <div key={o.id} className="flex items-center justify-between rounded border px-3 py-2 text-sm">
                <span>Day {o.dayOfWeek} · {o.effectiveFrom?.slice(0, 10)}→{o.effectiveTo?.slice(0, 10)} · {o.reason ?? 'change'}</span>
                <Button variant="ghost" size="sm" onClick={() => deleteOverride.mutateAsync(o.id)}><Trash2 className="h-4 w-4" /></Button>
              </div>
            ))}
            {(overrides.data ?? []).length === 0 && <p className="text-xs text-muted-foreground">No temporary changes.</p>}
          </div>
        </CardContent>
      </Card>
    </>
  );
}

/* ── Teacher availability matrix ──────────────────────────────────────────── */
function TeacherAvailabilityCard({ teacherId, periods }: { teacherId: string; periods: any[] }) {
  const avail = useTeacherAvailability(teacherId);
  const setAvail = useSetAvailability();
  const map = useMemo(() => Object.fromEntries((avail.data ?? []).map((a: any) => [`${a.dayOfWeek}-${a.periodId}`, a.status])), [avail.data]);
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Teacher availability</CardTitle></CardHeader>
      <CardContent className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b text-muted-foreground"><tr><th className="px-2 py-1 text-left">Period</th>{DAYS.map((d) => <th key={d.n} className="px-2 py-1">{d.label}</th>)}</tr></thead>
          <tbody>
            {periods.map((p: any) => (
              <tr key={p.id} className="border-b">
                <td className="px-2 py-1">{p.name}</td>
                {DAYS.map((d) => {
                  const key = `${d.n}-${p.id}`;
                  const status = map[key] ?? 'available';
                  return (
                    <td key={d.n} className="px-2 py-1">
                      <select className={`h-7 rounded border text-[10px] ${status === 'unavailable' ? 'bg-rose-100' : status === 'busy' ? 'bg-amber-100' : 'bg-emerald-50'}`}
                        value={status} onChange={(e) => setAvail.mutateAsync({ teacherPartnerId: teacherId, dayOfWeek: d.n, periodId: p.id, status: e.target.value })}>
                        <option value="available">✓</option><option value="busy">Busy</option><option value="unavailable">✕</option>
                      </select>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

/* ── Teaching rooms management ────────────────────────────────────────────── */
function TeachingRoomsCard() {
  const rooms = useTeachingRooms();
  const createRoom = useCreateTeachingRoom();
  const deleteRoom = useDeleteTeachingRoom();
  const [name, setName] = useState('');
  const [type, setType] = useState('classroom');
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Teaching rooms</CardTitle></CardHeader>
      <CardContent className="space-y-2">
        <div className="flex flex-wrap items-end gap-2">
          <Input className="w-48" placeholder="Room name" value={name} onChange={(e) => setName(e.target.value)} />
          <select className={sel} value={type} onChange={(e) => setType(e.target.value)}>
            <option value="classroom">Classroom</option><option value="lab">Lab</option><option value="hall">Hall</option><option value="gym">Gym</option>
          </select>
          <Button disabled={!name || createRoom.isPending} onClick={async () => { try { await createRoom.mutateAsync({ name, type }); notify.success('Room added'); setName(''); } catch (e: any) { notify.error(e?.response?.data?.message ?? 'Failed'); } }}><Plus className="h-4 w-4" /> Add</Button>
        </div>
        <div className="flex flex-wrap gap-2">
          {(rooms.data ?? []).map((r: any) => (
            <div key={r.id} className="flex items-center gap-2 rounded border px-3 py-1.5 text-sm">
              <span>{r.name} <span className="text-xs text-muted-foreground">({r.type})</span></span>
              <Button variant="ghost" size="sm" onClick={() => deleteRoom.mutateAsync(r.id)}><Trash2 className="h-4 w-4" /></Button>
            </div>
          ))}
          {(rooms.data ?? []).length === 0 && <p className="text-xs text-muted-foreground">No teaching rooms yet.</p>}
        </div>
      </CardContent>
    </Card>
  );
}
