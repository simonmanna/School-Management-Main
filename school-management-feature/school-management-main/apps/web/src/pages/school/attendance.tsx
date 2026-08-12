import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  useClasses,
  useCurrentTerm,
  useDailyRegister,
  useMarkAttendance,
} from '@/features/school/api';

export function AttendancePage() {
  const [classId, setClassId] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const { data: classes } = useClasses();
  const { data: term } = useCurrentTerm();
  const { data: register, refetch } = useDailyRegister(classId, date);
  const markAttendance = useMarkAttendance();

  const handleMarkAll = async (status: 'present' | 'absent' | 'late' | 'excused') => {
    if (!classId) return;
    const entries = (register ?? []).map((r: any) => ({
      studentProfileId: r.studentProfileId,
      status,
    }));
    await markAttendance.mutateAsync({ classId, date, entries });
    refetch();
  };

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Attendance</h1>
      {term && <Badge>Current term: {term.name}</Badge>}
      <Card>
        <CardHeader>
          <CardTitle>Daily register</CardTitle>
          <CardDescription>Pick a class and date. Click a status to mark the entire class.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Class</Label>
              <select
                className="w-full rounded border p-2"
                value={classId}
                onChange={(e) => setClassId(e.target.value)}
              >
                <option value="">Pick a class…</option>
                {(classes ?? []).map((c: any) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
            <div>
              <Label>Date</Label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
          </div>
          <div className="flex gap-2">
            <Button onClick={() => handleMarkAll('present')}>All Present</Button>
            <Button variant="outline" onClick={() => handleMarkAll('absent')}>All Absent</Button>
            <Button variant="outline" onClick={() => handleMarkAll('late')}>All Late</Button>
          </div>
          <div className="rounded border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="p-2 text-left">Adm. No</th>
                  <th className="p-2 text-left">Name</th>
                  <th className="p-2 text-left">Status</th>
                </tr>
              </thead>
              <tbody>
                {(register ?? []).map((r: any) => (
                  <tr key={r.id} className="border-b">
                    <td className="p-2">{r.studentProfile?.admissionNo}</td>
                    <td className="p-2">{r.studentProfile?.partner?.name ?? r.studentProfile?.admissionNo}</td>
                    <td className="p-2"><Badge>{r.status}</Badge></td>
                  </tr>
                ))}
                {(register ?? []).length === 0 && (
                  <tr><td colSpan={3} className="p-4 text-center text-muted-foreground">No register for this date yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}