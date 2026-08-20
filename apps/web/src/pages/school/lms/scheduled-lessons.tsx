import { useState } from 'react';
import { CalendarCheck, Play, Check, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { useScheduledLessons, useCreateScheduledLesson, useDeliverLesson } from '@/features/school/api';
import { notify } from '@/lib/notify';

const sel = 'rounded-md border bg-card px-3 py-2 text-sm';
const STATUS: Record<string, any> = { scheduled: 'outline', in_progress: 'default', completed: 'default', cancelled: 'destructive' };

export function SchoolLmsScheduledLessonsPage() {
  const { data: lessons } = useScheduledLessons();
  const create = useCreateScheduledLesson();
  const deliver = useDeliverLesson();
  const [form, setForm] = useState({ courseOfferingId: '', plannedDate: '', lessonPlanId: '' });
  const [refl, setRefl] = useState<Record<string, string>>({});

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2"><CalendarCheck className="h-5 w-5" /><h1 className="text-xl font-semibold">Scheduled Lessons</h1><Badge variant="outline">{lessons?.length ?? 0}</Badge></div>
      <Card><CardHeader><CardTitle className="text-base">Schedule from plan / slot</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-2 gap-3">
          <div><Label>Course Offering ID</Label><Input value={form.courseOfferingId} onChange={(e) => setForm({ ...form, courseOfferingId: e.target.value })} placeholder="uuid" /></div>
          <div><Label>Planned date</Label><Input type="datetime-local" value={form.plannedDate} onChange={(e) => setForm({ ...form, plannedDate: e.target.value })} /></div>
          <div className="col-span-2"><Label>Lesson Plan ID (optional)</Label><Input value={form.lessonPlanId} onChange={(e) => setForm({ ...form, lessonPlanId: e.target.value })} placeholder="uuid" /></div>
          <div className="col-span-2"><Button disabled={!form.courseOfferingId || !form.plannedDate || create.isPending} onClick={async () => { try { await create.mutateAsync(form); notify.success('Scheduled'); setForm({ courseOfferingId: '', plannedDate: '', lessonPlanId: '' }); } catch (e: any) { notify.error(e?.message ?? 'Failed'); } }}>Schedule</Button></div>
        </CardContent></Card>
      <Card><CardHeader><CardTitle className="text-base">Lessons</CardTitle></CardHeader>
        <CardContent className="space-y-2">{!lessons?.length && <p className="text-sm text-muted-foreground">No scheduled lessons.</p>}
          {lessons?.map((l: any) => (
            <div key={l.id} className="rounded-md border px-3 py-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">{new Date(l.plannedDate).toLocaleString()}</span>
                <Badge variant={STATUS[l.status] ?? 'outline'}>{l.status}</Badge>
              </div>
              <div className="mt-2 flex items-center gap-2">
                <Button size="sm" variant="outline" disabled={l.status !== 'scheduled'} onClick={async () => { try { await deliver.mutateAsync({ scheduledLessonId: l.id, action: 'start' }); notify.success('Started'); } catch (e: any) { notify.error(e?.message ?? 'Failed'); } }}><Play className="h-3 w-3" /> Start</Button>
                <Button size="sm" disabled={l.status !== 'in_progress'} onClick={async () => { try { await deliver.mutateAsync({ scheduledLessonId: l.id, action: 'complete', reflection: refl[l.id] || null }); notify.success('Completed'); } catch (e: any) { notify.error(e?.message ?? 'Failed'); } }}><Check className="h-3 w-3" /> Complete</Button>
                <Button size="sm" variant="destructive" disabled={l.status === 'completed' || l.status === 'cancelled'} onClick={async () => { try { await deliver.mutateAsync({ scheduledLessonId: l.id, action: 'cancel' }); notify.success('Cancelled'); } catch (e: any) { notify.error(e?.message ?? 'Failed'); } }}><X className="h-3 w-3" /> Cancel</Button>
              </div>
              <textarea className={sel + ' mt-2 h-16 w-full text-xs'} placeholder="Reflection on completion…" value={refl[l.id] ?? ''} onChange={(e) => setRefl({ ...refl, [l.id]: e.target.value })} />
            </div>
          ))}
        </CardContent></Card>
    </div>
  );
}
