import { useMemo, useState } from 'react';
import { useStudents, useSubjects, usePeriods, useStaff, useStudentTimetable, useSpecialSchedule } from '@/features/school/api';
import { Label } from '@/components/ui/label';
import { TimetableGrid, SpecialSchedulePanel, TimetableControls, sel, staffName } from './timetable-shared';

const studentLabel = (s: any) =>
  [s.partner?.name, s.admissionNo && `(${s.admissionNo})`].filter(Boolean).join(' ') || s.id;

export function StudentTimetablePage() {
  const [specialFrom, setSpecialFrom] = useState('');
  const [specialTo, setSpecialTo] = useState('');
  const { data: periods } = usePeriods();
  const { data: subjects } = useSubjects();
  const { data: staff } = useStaff();
  const { data: students } = useStudents({ pageSize: 300 });
  const special = useSpecialSchedule(specialFrom || undefined, specialTo || undefined);

  const subjectName = useMemo(() => Object.fromEntries((subjects?.data ?? []).map((s: any) => [s.id, s.name])), [subjects]);
  const teacherName = useMemo(() => Object.fromEntries((staff?.data ?? []).map((s: any) => [s.id, staffName(s)])), [staff]);
  const periodRows = useMemo(() => [...(periods?.data ?? [])].sort((a: any, b: any) => a.order - b.order), [periods]);

  const [studentId, setStudentId] = useState('');
  const selected = (students?.data ?? []).find((s: any) => s.id === studentId);
  const studentTT = useStudentTimetable(studentId || undefined);

  return (
    <div className="space-y-4 p-6">
      <div>
        <h1 className="text-xl font-semibold">Student Timetable</h1>
        <p className="text-sm text-muted-foreground">The weekly grid for an individual student — derived from their class &amp; subject enrolments.</p>
      </div>

      <TimetableControls hideCycle specialFrom={specialFrom} setSpecialFrom={setSpecialFrom} specialTo={specialTo} setSpecialTo={setSpecialTo}>
        <div className="space-y-1 min-w-[16rem]"><Label className="text-xs">Student</Label>
          <select className={sel} value={studentId} onChange={(e) => setStudentId(e.target.value)}>
            <option value="">Select student…</option>
            {(students?.data ?? []).map((s: any) => (
              <option key={s.id} value={s.id}>{studentLabel(s)}{s.currentClass?.name ? ` — ${s.currentClass.name}` : ''}</option>
            ))}
          </select>
        </div>
      </TimetableControls>

      {!studentId && (
        <p className="text-sm text-muted-foreground">Select a student above to view their weekly timetable.</p>
      )}

      {studentId && selected && (
        <div className="text-sm">
          <span className="font-medium">{studentLabel(selected)}</span>
          {selected.currentClass?.name && <span className="text-muted-foreground"> · {selected.currentClass.name}</span>}
          {selected.admissionNo && <span className="text-muted-foreground"> · {selected.admissionNo}</span>}
        </div>
      )}

      {studentId && (
        <TimetableGrid tt={studentTT} periods={periodRows} teacherName={teacherName} subjectName={subjectName} staff={staff} tab="student" />
      )}

      <SpecialSchedulePanel events={special.data ?? []} loading={special.isLoading} />
    </div>
  );
}
