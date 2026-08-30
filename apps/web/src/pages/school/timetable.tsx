import { useMemo, useState } from 'react';
import {
  usePeriods, useSubjects, useStaff,
  useTeacherTimetable, useRoomTimetable, useSubjectTimetable,
  useSpecialSchedule,
} from '@/features/school/api';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  TimetableGrid, TimetableControls, SpecialSchedulePanel,
  TeacherAvailabilityCard, TeachingRoomsCard, sel, staffName,
} from './timetable-shared';

type Tab = 'teacher' | 'room' | 'subject';

export function SchoolTimetablePage() {
  const [tab, setTab] = useState<Tab>('teacher');
  const [cycle, setCycle] = useState<string>('');
  const [specialFrom, setSpecialFrom] = useState('');
  const [specialTo, setSpecialTo] = useState('');
  const { data: periods } = usePeriods();
  const { data: subjects } = useSubjects();
  const { data: staff } = useStaff();
  const special = useSpecialSchedule(specialFrom || undefined, specialTo || undefined);

  const subjectName = useMemo(() => Object.fromEntries((subjects?.data ?? []).map((s: any) => [s.id, s.name])), [subjects]);
  const teacherName = useMemo(() => Object.fromEntries((staff?.data ?? []).map((s: any) => [s.id, staffName(s)])), [staff]);

  const [teacherId, setTeacherId] = useState('');
  const [room, setRoom] = useState('');
  const [subjectId, setSubjectId] = useState('');

  const teacherTT = useTeacherTimetable(tab === 'teacher' ? teacherId || undefined : undefined, cycle || undefined);
  const roomTT = useRoomTimetable(tab === 'room' ? room || undefined : undefined, cycle || undefined);
  const subjectTT = useSubjectTimetable(tab === 'subject' ? subjectId || undefined : undefined, cycle || undefined);

  const tt = tab === 'teacher' ? teacherTT : tab === 'room' ? roomTT : subjectTT;
  const entityId = tab === 'teacher' ? teacherId : tab === 'room' ? room : tab === 'subject' ? subjectId : '';

  const selector = (() => {
    switch (tab) {
      case 'teacher': return (
        <select className={sel} value={teacherId} onChange={(e) => setTeacherId(e.target.value)}>
          <option value="">Select teacher…</option>{(staff?.data ?? []).map((s: any) => <option key={s.id} value={s.id}>{teacherName[s.id]}</option>)}
        </select>);
      case 'room': return <Input className="w-48" placeholder="e.g. Lab A" value={room} onChange={(e) => setRoom(e.target.value)} />;
      case 'subject': return (
        <select className={sel} value={subjectId} onChange={(e) => setSubjectId(e.target.value)}>
          <option value="">Select subject…</option>{(subjects?.data ?? []).map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>);
    }
  })();

  const periodRows = useMemo(() => [...(periods?.data ?? [])].sort((a: any, b: any) => a.order - b.order), [periods]);

  return (
    <div className="space-y-4 p-6">
      <div>
        <h1 className="text-xl font-semibold">Timetable Management</h1>
        <p className="text-sm text-muted-foreground">Weekly grids, conflict detection, rotations, substitutions &amp; auto-generation. Class and Student grids have their own pages.</p>
      </div>

      <div className="flex flex-wrap gap-1">
        {([['teacher', 'Teacher'], ['room', 'Room'], ['subject', 'Subject']] as [Tab, string][]).map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)} className={`rounded-md px-3 py-1.5 text-sm font-medium ${tab === k ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}>{label} timetable</button>
        ))}
      </div>

      <TimetableControls cycle={cycle} setCycle={setCycle} specialFrom={specialFrom} setSpecialFrom={setSpecialFrom} specialTo={specialTo} setSpecialTo={setSpecialTo}>
        <div className="space-y-1"><Label className="text-xs">Teacher</Label>{selector}</div>
      </TimetableControls>

      {entityId && (
        <TimetableGrid tt={tt} periods={periodRows} teacherName={teacherName} subjectName={subjectName} staff={staff} tab={tab} />
      )}

      {tab === 'teacher' && teacherId && <TeacherAvailabilityCard teacherId={teacherId} periods={periodRows} />}
      <TeachingRoomsCard />
      <SpecialSchedulePanel events={special.data ?? []} loading={special.isLoading} />
    </div>
  );
}
