import { useState } from 'react';
import { FileStack, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { useLessonPlanTemplates, useCreateLessonPlanTemplate, useInstantiateTemplate } from '@/features/school/api';
import { useSubjects } from '@/features/school/api';
import { notify } from '@/lib/notify';

const sel = 'rounded-md border bg-card px-3 py-2 text-sm';

export function SchoolLmsTemplatesPage() {
  const { data: templates } = useLessonPlanTemplates();
  const { data: subjects } = useSubjects();
  const create = useCreateLessonPlanTemplate();
  const instantiate = useInstantiateTemplate();
  const [form, setForm] = useState({ name: '', subjectId: '', templateJson: '{"objectives":[],"activities":[]}' });
  const [inst, setInst] = useState({ id: '', courseOfferingId: '', topicId: '' });

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2"><FileStack className="h-5 w-5" /><h1 className="text-xl font-semibold">Lesson Plan Templates</h1><Badge variant="outline">{templates?.length ?? 0}</Badge></div>
      <Card><CardHeader><CardTitle className="text-base">New template</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-2 gap-3">
          <div><Label>Name</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
          <div><Label>Subject</Label><select className={sel} value={form.subjectId} onChange={(e) => setForm({ ...form, subjectId: e.target.value })}>
            <option value="">—</option>{subjects?.data?.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
          <div className="col-span-2"><Label>Template JSON</Label><textarea className={sel + ' h-28 w-full font-mono text-xs'} value={form.templateJson} onChange={(e) => setForm({ ...form, templateJson: e.target.value })} /></div>
          <div className="col-span-2"><Button disabled={!form.name || create.isPending} onClick={async () => { try { JSON.parse(form.templateJson); await create.mutateAsync({ ...form, templateJson: JSON.parse(form.templateJson) }); notify.success('Template created'); setForm({ name: '', subjectId: '', templateJson: '{"objectives":[],"activities":[]}' }); } catch (e: any) { notify.error(e?.message ?? 'Invalid JSON'); } }}><Plus className="mr-1 h-4 w-4" />Create</Button></div>
        </CardContent></Card>
      <Card><CardHeader><CardTitle className="text-base">Instantiate into a plan</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-2 gap-3">
          <div className="col-span-2"><Label>Template</Label><select className={sel} value={inst.id} onChange={(e) => setInst({ ...inst, id: e.target.value })}>
            <option value="">—</option>{templates?.map((t: any) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></div>
          <div><Label>Course Offering ID</Label><Input value={inst.courseOfferingId} onChange={(e) => setInst({ ...inst, courseOfferingId: e.target.value })} placeholder="uuid" /></div>
          <div><Label>Topic ID</Label><Input value={inst.topicId} onChange={(e) => setInst({ ...inst, topicId: e.target.value })} placeholder="uuid" /></div>
          <div className="col-span-2"><Button disabled={!inst.id || instantiate.isPending} onClick={async () => { try { await instantiate.mutateAsync({ id: inst.id, courseOfferingId: inst.courseOfferingId || null, topicId: inst.topicId || null }); notify.success('Plan instantiated'); setInst({ id: '', courseOfferingId: '', topicId: '' }); } catch (e: any) { notify.error(e?.message ?? 'Failed'); } }}>Instantiate</Button></div>
        </CardContent></Card>
      <Card><CardHeader><CardTitle className="text-base">Templates</CardTitle></CardHeader>
        <CardContent className="space-y-2">{!templates?.length && <p className="text-sm text-muted-foreground">None yet.</p>}
          {templates?.map((t: any) => <div key={t.id} className="flex items-center justify-between rounded-md border px-3 py-2 text-sm"><span>{t.name}</span><Badge variant="outline">{t.isPublic ? 'public' : 'private'}</Badge></div>)}</CardContent></Card>
    </div>
  );
}
