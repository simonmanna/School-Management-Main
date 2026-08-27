import { useState } from 'react';
import { Presentation, Plus, Send, Check, RotateCcw, Archive } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { useLessonPlans, useCreateLessonPlan, useUpdateLessonPlan, useTransitionLessonPlan, useArchiveLessonPlan } from '@/features/school/api';
import { notify } from '@/lib/notify';

const sel = 'rounded-md border bg-card px-3 py-2 text-sm';
const STATUS_COLORS: Record<string, string> = { draft: 'secondary', submitted: 'default', needs_revision: 'destructive', approved: 'default', archived: 'outline' };

export function SchoolLmsLessonPlansPage() {
  const { data: plans, isLoading } = useLessonPlans();
  const create = useCreateLessonPlan();
  const update = useUpdateLessonPlan();
  const transition = useTransitionLessonPlan();
  const archive = useArchiveLessonPlan();

  const [editing, setEditing] = useState<any>(null);
  const [tab, setTab] = useState<'list' | 'edit'>('list');
  const [draft, setDraft] = useState({
    title: '', courseOfferingId: '', topicId: '', subtopic: '',
    objectives: '', materials: '', activities: '', resources: '', assessments: '', differentiation: '',
    workflowStatus: 'draft',
  });

  const startNew = () => { setEditing(null); setDraft({ title: '', courseOfferingId: '', topicId: '', subtopic: '', objectives: '', materials: '', activities: '', resources: '', assessments: '', differentiation: '', workflowStatus: 'draft' }); setTab('edit'); };
  const startEdit = (p: any) => { setEditing(p); setDraft({ title: p.title, courseOfferingId: p.courseOfferingId ?? '', topicId: p.topicId ?? '', subtopic: p.subtopic ?? '', objectives: (p.objectives ?? []).join('\n'), materials: (p.materials ?? []).join('\n'), activities: '', resources: '', assessments: '', differentiation: '', workflowStatus: p.workflowStatus }); setTab('edit'); };

  const save = async () => {
    const payload = {
      title: draft.title,
      courseOfferingId: draft.courseOfferingId || null,
      topicId: draft.topicId || null,
      subtopic: draft.subtopic || null,
      objectives: draft.objectives.split('\n').map((s) => s.trim()).filter(Boolean),
      materials: draft.materials.split('\n').map((s) => s.trim()).filter(Boolean),
      activities: draft.activities ? draft.activities.split('\n').map((s) => s.trim()).filter(Boolean) : undefined,
      resources: draft.resources ? draft.resources.split('\n').map((s) => s.trim()).filter(Boolean) : undefined,
      assessments: draft.assessments ? draft.assessments.split('\n').map((s) => s.trim()).filter(Boolean) : undefined,
      differentiation: draft.differentiation ? draft.differentiation.split('\n').map((s) => s.trim()).filter(Boolean) : undefined,
    };
    try {
      if (editing) await update.mutateAsync({ id: editing.id, ...payload });
      else await create.mutateAsync(payload);
      notify.success('Saved'); setTab('list');
    } catch (e: any) { notify.error(e?.message ?? 'Failed'); }
  };

  const doTransition = async (id: string, action: string, version?: number, requestedChanges?: string) => {
    try {
      await transition.mutateAsync({ id, action, version, requestedChanges });
      notify.success(`→ ${action}`);
    } catch (e: any) {
      notify.error(e?.response?.data?.message ?? e?.message ?? 'Failed');
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Presentation className="h-5 w-5" /><h1 className="text-xl font-semibold">Lesson Plans</h1>
          <Badge variant="outline">{plans?.length ?? 0}</Badge>
        </div>
        <Button onClick={startNew}><Plus className="mr-1 h-4 w-4" />New plan</Button>
      </div>

      <Tabs value={tab} onValueChange={(v: any) => setTab(v)}>
        <TabsList><TabsTrigger value="list">List</TabsTrigger><TabsTrigger value="edit">{editing ? 'Edit' : 'New'}</TabsTrigger></TabsList>
        <TabsContent value="list">
          <Card><CardContent className="space-y-2 pt-4">
            {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
            {!plans?.length && !isLoading && <p className="text-sm text-muted-foreground">No lesson plans. Create one.</p>}
            {plans?.map((p: any) => (
              <div key={p.id} className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
                <div>
                  <button className="font-medium hover:underline" onClick={() => startEdit(p)}>{p.title}</button>
                  <div className="text-xs text-muted-foreground">v{p.version} · {(p.objectives ?? []).length} objectives</div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={(STATUS_COLORS[p.workflowStatus] as any) ?? 'outline'}>{p.workflowStatus}</Badge>
                  {p.workflowStatus === 'draft' && <Button size="sm" variant="outline" onClick={() => doTransition(p.id, 'submitted', p.version)}><Send className="h-3 w-3" /> Submit</Button>}
                  {p.workflowStatus === 'submitted' && <><Button size="sm" onClick={() => doTransition(p.id, 'approved', p.version)}><Check className="h-3 w-3" /> Approve</Button><Button size="sm" variant="destructive" onClick={() => doTransition(p.id, 'needs_revision', p.version, 'Please revise')}><RotateCcw className="h-3 w-3" /> Revise</Button></>}
                  {p.workflowStatus === 'needs_revision' && <Button size="sm" onClick={() => doTransition(p.id, 'submitted', p.version)}><Send className="h-3 w-3" /> Resubmit</Button>}
                  {p.workflowStatus === 'approved' && <Button size="sm" variant="outline" onClick={() => archive.mutateAsync(p.id)}><Archive className="h-3 w-3" /> Archive</Button>}
                </div>
              </div>
            ))}
          </CardContent></Card>
        </TabsContent>
        <TabsContent value="edit">
          <Card><CardHeader><CardTitle className="text-base">{editing ? 'Edit plan' : 'New plan'}</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-2 gap-3">
              <div className="col-span-2"><Label>Title</Label><Input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} /></div>
              <div><Label>Course Offering ID</Label><Input value={draft.courseOfferingId} onChange={(e) => setDraft({ ...draft, courseOfferingId: e.target.value })} placeholder="uuid (optional)" /></div>
              <div><Label>Topic ID</Label><Input value={draft.topicId} onChange={(e) => setDraft({ ...draft, topicId: e.target.value })} placeholder="uuid (optional)" /></div>
              <div className="col-span-2"><Label>Subtopic</Label><Input value={draft.subtopic} onChange={(e) => setDraft({ ...draft, subtopic: e.target.value })} /></div>
              <div className="col-span-2"><Label>Objectives (one per line)</Label><textarea className={sel + ' h-24 w-full'} value={draft.objectives} onChange={(e) => setDraft({ ...draft, objectives: e.target.value })} /></div>
              <div className="col-span-2"><Label>Materials (one per line)</Label><textarea className={sel + ' h-20 w-full'} value={draft.materials} onChange={(e) => setDraft({ ...draft, materials: e.target.value })} /></div>
              <div className="col-span-2"><Label>Activities (one per line)</Label><textarea className={sel + ' h-20 w-full'} value={draft.activities} onChange={(e) => setDraft({ ...draft, activities: e.target.value })} /></div>
              <div className="col-span-2"><Label>Resources (one per line, ids)</Label><textarea className={sel + ' h-16 w-full'} value={draft.resources} onChange={(e) => setDraft({ ...draft, resources: e.target.value })} /></div>
              <div className="col-span-2"><Label>Assessments (one per line)</Label><textarea className={sel + ' h-16 w-full'} value={draft.assessments} onChange={(e) => setDraft({ ...draft, assessments: e.target.value })} /></div>
              <div className="col-span-2"><Label>Differentiation (one per line)</Label><textarea className={sel + ' h-16 w-full'} value={draft.differentiation} onChange={(e) => setDraft({ ...draft, differentiation: e.target.value })} /></div>
              <div className="col-span-2"><Button disabled={!draft.title || create.isPending || update.isPending} onClick={save}><Plus className="mr-1 h-4 w-4" />Save plan</Button></div>
            </CardContent></Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
