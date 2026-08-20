import { useState } from 'react';
import { Target, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { useObjectiveMastery, useCourseProgress, useRecordEvidence, useRecomputeObjective, useRecomputeCourse } from '@/features/school/api';
import { notify } from '@/lib/notify';

const sel = 'rounded-md border bg-card px-3 py-2 text-sm';

export function SchoolLmsMasteryPage() {
  const { data: mastery } = useObjectiveMastery();
  const { data: progress } = useCourseProgress();
  const record = useRecordEvidence();
  const recomputeObj = useRecomputeObjective();
  const recomputeCourse = useRecomputeCourse();
  const [ev, setEv] = useState({ studentProfileId: '', learningObjectiveId: '', sourceType: 'ASSIGNMENT', sourceId: '', normalizedScore: '' });

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2"><Target className="h-5 w-5" /><h1 className="text-xl font-semibold">Mastery &amp; Evidence</h1></div>

      <Card><CardHeader><CardTitle className="text-base">Record evidence (computed mastery source)</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-2 gap-3">
          <div><Label>Student Profile ID</Label><Input value={ev.studentProfileId} onChange={(e) => setEv({ ...ev, studentProfileId: e.target.value })} /></div>
          <div><Label>Learning Objective ID</Label><Input value={ev.learningObjectiveId} onChange={(e) => setEv({ ...ev, learningObjectiveId: e.target.value })} /></div>
          <div><Label>Source type</Label><select className={sel} value={ev.sourceType} onChange={(e) => setEv({ ...ev, sourceType: e.target.value })}>
            <option>ASSESSMENT</option><option>QUIZ</option><option>ASSIGNMENT</option><option>TEACHER_OBSERVATION</option><option>LESSON_ACTIVITY</option><option>PRACTICAL</option></select></div>
          <div><Label>Source ID</Label><Input value={ev.sourceId} onChange={(e) => setEv({ ...ev, sourceId: e.target.value })} placeholder="result/quiz/submission id" /></div>
          <div className="col-span-2"><Label>Normalized score (0–100)</Label><Input type="number" value={ev.normalizedScore} onChange={(e) => setEv({ ...ev, normalizedScore: e.target.value })} /></div>
          <div className="col-span-2"><Button disabled={!ev.studentProfileId || !ev.learningObjectiveId || !ev.sourceId || record.isPending} onClick={async () => { try { await record.mutateAsync({ ...ev, normalizedScore: ev.normalizedScore ? Number(ev.normalizedScore) : undefined }); notify.success('Evidence recorded'); } catch (e: any) { notify.error(e?.message ?? 'Failed'); } }}>Record evidence</Button></div>
        </CardContent></Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card><CardHeader><CardTitle className="text-base">Objective mastery (weighted policy)</CardTitle></CardHeader>
          <CardContent className="space-y-2">{!mastery?.length && <p className="text-sm text-muted-foreground">No computed mastery yet.</p>}
            {mastery?.map((m: any) => (
              <div key={m.id} className="rounded-md border px-3 py-2 text-sm flex items-center justify-between">
                <span className="font-mono text-xs">{m.learningObjectiveId.slice(0, 8)} · {m.studentProfileId.slice(0, 8)}</span>
                <div className="flex items-center gap-2"><div className="h-2 w-24 overflow-hidden rounded bg-muted"><div className="h-full bg-primary" style={{ width: `${Math.min(100, Number(m.masteryPct))}%` }} /></div><Badge variant="outline">{Number(m.masteryPct).toFixed(0)}%</Badge></div>
              </div>
            ))}</CardContent></Card>
        <Card><CardHeader><CardTitle className="text-base">Course progress</CardTitle></CardHeader>
          <CardContent className="space-y-2">{!progress?.length && <p className="text-sm text-muted-foreground">No course progress yet.</p>}
            {progress?.map((p: any) => (
              <div key={p.id} className="rounded-md border px-3 py-2 text-sm flex items-center justify-between">
                <span className="font-mono text-xs">{p.courseOfferingId.slice(0, 8)} · {p.studentProfileId.slice(0, 8)}</span>
                <Badge variant="outline">{Number(p.progressPct).toFixed(0)}%</Badge>
              </div>
            ))}</CardContent></Card>
      </div>

      <Card><CardHeader><CardTitle className="text-base">Recompute</CardTitle></CardHeader>
        <CardContent className="flex gap-2">
          <Button variant="outline" disabled={recomputeObj.isPending} onClick={async () => { if (!ev.studentProfileId || !ev.learningObjectiveId) return notify.error('Provide student + objective'); try { await recomputeObj.mutateAsync({ studentProfileId: ev.studentProfileId, learningObjectiveId: ev.learningObjectiveId }); notify.success('Objective recomputed'); } catch (e: any) { notify.error(e?.message ?? 'Failed'); } }}><RefreshCw className="mr-1 h-4 w-4" />Recompute objective</Button>
          <Button variant="outline" disabled={recomputeCourse.isPending} onClick={async () => { if (!ev.studentProfileId || !ev.learningObjectiveId) return notify.error('Need a course context'); try { await recomputeCourse.mutateAsync({ studentProfileId: ev.studentProfileId, courseOfferingId: ev.learningObjectiveId }); notify.success('Course recomputed'); } catch (e: any) { notify.error(e?.message ?? 'Failed'); } }}><RefreshCw className="mr-1 h-4 w-4" />Recompute course</Button>
        </CardContent></Card>
    </div>
  );
}
