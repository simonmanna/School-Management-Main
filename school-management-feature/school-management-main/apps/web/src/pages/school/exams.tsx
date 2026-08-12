import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  useApproveGrades,
  useExams,
  useGradeEntries,
} from '@/features/school/api';

export function ExamsPage() {
  const [examScheduleId, setExamScheduleId] = useState('');
  const { data: exams } = useExams();
  const { data: entries, refetch } = useGradeEntries(examScheduleId);
  const approve = useApproveGrades();

  const handleApprove = async () => {
    await approve.mutate({});
    refetch();
  };

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Examinations</h1>
      <Card>
        <CardHeader>
          <CardTitle>Exams</CardTitle>
          <CardDescription>Schedule, publish, close exams. Approve grade entries here.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {(exams ?? []).map((e: any) => (
            <div key={e.id} className="flex items-center justify-between rounded border p-3">
              <div>
                <div className="font-medium">{e.name}</div>
                <div className="text-xs text-muted-foreground">
                  {new Date(e.startDate).toLocaleDateString()} → {new Date(e.endDate).toLocaleDateString()}
                </div>
              </div>
              <Badge>{e.status}</Badge>
            </div>
          ))}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Grade entry</CardTitle>
          <CardDescription>Bulk-upsert grades for a class × subject. Approve to lock.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <Label>Exam schedule ID</Label>
            <Input value={examScheduleId} onChange={(e) => setExamScheduleId(e.target.value)} placeholder="sched_…" />
          </div>
          <table className="w-full text-sm">
            <thead><tr className="border-b bg-muted/50"><th className="p-2 text-left">Student</th><th className="p-2 text-right">Marks</th><th className="p-2 text-left">Grade</th></tr></thead>
            <tbody>
              {(entries ?? []).map((g: any) => (
                <tr key={g.id} className="border-b">
                  <td className="p-2">{g.studentProfile?.admissionNo}</td>
                  <td className="p-2 text-right">{g.marksObtained} / {g.maxMarks}</td>
                  <td className="p-2"><Badge>{g.grade ?? '—'}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
          {examScheduleId && (
            <div className="flex gap-2">
              <Button onClick={handleApprove}>Approve all</Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}