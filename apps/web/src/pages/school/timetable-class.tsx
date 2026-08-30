import { useMemo, useState } from 'react';
import { useClasses, useSubjects, usePeriods, useStaff, useClassTimetable, useSpecialSchedule } from '@/features/school/api';
import { Label } from '@/components/ui/label';
import {
  TimetableGrid, TimetableControls, SpecialSchedulePanel, ClassExtras, sel, staffName,
} from './timetable-shared';

export function ClassTimetablePage() {
  const [cycle, setCycle] = useState<string>('');
  const [specialFrom, setSpecialFrom] = useState('');
  const [specialTo, setSpecialTo] = useState('');
  const { data: periods } = usePeriods();
  const { data: subjects } = useSubjects();
  const { data: staff } = useStaff();
  const { data: classes } = useClasses();
  const special = useSpecialSchedule(specialFrom || undefined, specialTo || undefined);

  const subjectName = useMemo(() => Object.fromEntries((subjects?.data ?? []).map((s: any) => [s.id, s.name])), [subjects]);
  const teacherName = useMemo(() => Object.fromEntries((staff?.data ?? []).map((s: any) => [s.id, staffName(s)])), [staff]);
  const periodRows = useMemo(() => [...(periods?.data ?? [])].sort((a: any, b: any) => a.order - b.order), [periods]);

  const [classId, setClassId] = useState('');
  const classTT = useClassTimetable(classId || undefined, cycle || undefined);

  return (
    <div className="space-y-4 p-6">
      <div>
        <h1 className="text-xl font-semibold">Class Timetable</h1>
        <p className="text-sm text-muted-foreground">Weekly grid for a class — add lessons, breaks &amp; free periods, rotate weeks, publish and auto-generate.</p>
      </div>

      <TimetableControls cycle={cycle} setCycle={setCycle} specialFrom={specialFrom} setSpecialFrom={setSpecialFrom} specialTo={specialTo} setSpecialTo={setSpecialTo}>
        <div className="space-y-1"><Label className="text-xs">Class</Label>
          <select className={sel} value={classId} onChange={(e) => setClassId(e.target.value)}>
            <option value="">Select class…</option>{(classes?.data ?? []).map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
      </TimetableControls>

      {classId && (
        <TimetableGrid tt={classTT} periods={periodRows} teacherName={teacherName} subjectName={subjectName} staff={staff} tab="class" />
      )}

      {classId && <ClassExtras classId={classId} subjects={subjects?.data ?? []} staff={staff?.data ?? []} periods={periodRows} />}
      <SpecialSchedulePanel events={special.data ?? []} loading={special.isLoading} />
    </div>
  );
}
