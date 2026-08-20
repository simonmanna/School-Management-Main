import { useState } from 'react';
import { ClipboardList, Upload, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { useSubmitHomework, useGradeHomework } from '@/features/school/api';
import { notify } from '@/lib/notify';

const sel = 'rounded-md border bg-card px-3 py-2 text-sm';

export function SchoolLmsHomeworkPage() {
  const submit = useSubmitHomework();
  const grade = useGradeHomework();
  const [sub, setSub] = useState({ assignmentId: '', studentProfileId: '', content: '' });
  const [gr, setGr] = useState({ submissionId: '', score: '', feedback: '' });

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2"><ClipboardList className="h-5 w-5" /><h1 className="text-xl font-semibold">Homework &amp; Tasks</h1></div>
      <div className="grid gap-4 md:grid-cols-2">
        <Card><CardHeader><CardTitle className="text-base">Student submission</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            <div><Label>Assignment ID</Label><Input value={sub.assignmentId} onChange={(e) => setSub({ ...sub, assignmentId: e.target.value })} /></div>
            <div><Label>Student Profile ID</Label><Input value={sub.studentProfileId} onChange={(e) => setSub({ ...sub, studentProfileId: e.target.value })} /></div>
            <textarea className={sel + ' h-24 w-full'} placeholder="Answer / content" value={sub.content} onChange={(e) => setSub({ ...sub, content: e.target.value })} />
            <Button disabled={!sub.assignmentId || !sub.studentProfileId || submit.isPending} onClick={async () => { try { await submit.mutateAsync(sub); notify.success('Submitted'); setSub({ assignmentId: '', studentProfileId: '', content: '' }); } catch (e: any) { notify.error(e?.message ?? 'Failed'); } }}><Upload className="mr-1 h-4 w-4" />Submit</Button>
          </CardContent></Card>
        <Card><CardHeader><CardTitle className="text-base">Grade &amp; bridge to gradebook</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            <div><Label>Submission ID</Label><Input value={gr.submissionId} onChange={(e) => setGr({ ...gr, submissionId: e.target.value })} /></div>
            <div><Label>Score</Label><Input type="number" value={gr.score} onChange={(e) => setGr({ ...gr, score: e.target.value })} /></div>
            <textarea className={sel + ' h-20 w-full'} placeholder="Feedback" value={gr.feedback} onChange={(e) => setGr({ ...gr, feedback: e.target.value })} />
            <Button disabled={!gr.submissionId || !gr.score || grade.isPending} onClick={async () => { try { await grade.mutateAsync({ submissionId: gr.submissionId, score: Number(gr.score), feedback: gr.feedback }); notify.success('Graded → StudentAssessment bridged'); setGr({ submissionId: '', score: '', feedback: '' }); } catch (e: any) { notify.error(e?.message ?? 'Failed'); } }}><CheckCircle2 className="mr-1 h-4 w-4" />Grade</Button>
          </CardContent></Card>
      </div>
      <Card><CardContent className="pt-4 text-sm text-muted-foreground">
        Grading a submission creates an <Badge variant="outline">Assignment</Badge> assessment in the gradebook (idempotent per homework) and links the submission via <code>studentAssessmentId</code> — exactly the Phase 1 bridge decision (submission → StudentAssessment, not on the assignment).
      </CardContent></Card>
    </div>
  );
}
