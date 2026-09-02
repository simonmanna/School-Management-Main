import { useState } from 'react';
import { Presentation, Plus, Send, Check, RotateCcw, Archive } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { useLessonPlans, useCreateLessonPlan, useUpdateLessonPlan, useTransitionLessonPlan, useArchiveLessonPlan } from '@/features/school/api';
import { useCourseOutcomeOptions, useMyCourses, useSchemeOfWork } from '@/features/school/teaching-api';
import { notify } from '@/lib/notify';

const sel = 'rounded-md border bg-card px-3 py-2 text-sm';
const STATUS_COLORS: Record<string, string> = { draft: 'secondary', submitted: 'default', needs_revision: 'destructive', approved: 'default', archived: 'outline' };
const lines = (value: string) => value.split('\n').map((s) => s.trim()).filter(Boolean);

const EMPTY = {
  title: '', courseOfferingId: '', schemeOfWorkWeekId: '', weekOf: '', topicId: '', subtopic: '',
  objectives: '', materials: '', activities: '', resources: '', assessments: '',
  learningOutcomeIds: [] as string[],
};

/**
 * Lesson plans.
 *
 * Phase 3 made the course offering mandatory: subject, class, term and
 * curriculum version all come from it, so the form asks for the course rather
 * than for four ids that could disagree with one another.
 */
export function SchoolLmsLessonPlansPage() {
  const { data: plans, isLoading } = useLessonPlans();
  const { data: courses = [] } = useMyCourses();
  const create = useCreateLessonPlan();
  const update = useUpdateLessonPlan();
  const transition = useTransitionLessonPlan();
  const archive = useArchiveLessonPlan();

  const [editing, setEditing] = useState<any>(null);
  const [tab, setTab] = useState<'list' | 'edit'>('list');
  const [draft, setDraft] = useState({ ...EMPTY });

  const { data: scheme } = useSchemeOfWork(draft.courseOfferingId || undefined);
  const { data: outcomes = [] } = useCourseOutcomeOptions(draft.courseOfferingId || undefined);

  const startNew = () => { setEditing(null); setDraft({ ...EMPTY }); setTab('edit'); };
  const startEdit = (p: any) => {
    setEditing(p);
    setDraft({
      title: p.title,
      courseOfferingId: p.courseOfferingId ?? '',
      schemeOfWorkWeekId: p.schemeOfWorkWeekId ?? '',
      weekOf: p.weekOf ? String(p.weekOf).slice(0, 10) : '',
      topicId: p.topicId ?? '',
      subtopic: p.subtopic ?? '',
      objectives: p.objectives ?? '',
      materials: p.materials ?? '',
      activities: '',
      resources: '',
      assessments: '',
      learningOutcomeIds: (p.learningOutcomes ?? []).map((o: any) => o.learningOutcomeId),
    });
    setTab('edit');
  };

  const save = async () => {
    const payload: any = {
      title: draft.title,
      courseOfferingId: draft.courseOfferingId,
      schemeOfWorkWeekId: draft.schemeOfWorkWeekId || undefined,
      weekOf: draft.weekOf ? new Date(draft.weekOf).toISOString() : undefined,
      topicId: draft.topicId || undefined,
      subtopic: draft.subtopic || undefined,
      objectives: draft.objectives || undefined,
      materials: draft.materials || undefined,
      learningOutcomeIds: draft.learningOutcomeIds,
      activities: lines(draft.activities).map((title, sequence) => ({ title, sequence })),
      resources: lines(draft.resources).map((learningResourceId) => ({ learningResourceId })),
      assessments: lines(draft.assessments).map((prompt, sequence) => ({ kind: 'formative', prompt, sequence })),
    };
    try {
      if (editing) await update.mutateAsync({ id: editing.id, ...payload, version: editing.version });
      else await create.mutateAsync(payload);
      notify.success('Saved');
      setTab('list');
    } catch (e: any) {
      notify.error(e?.response?.data?.message ?? e?.message ?? 'Failed');
    }
  };

  const doTransition = async (id: string, action: string, version?: number, requestedChanges?: string) => {
    try {
      await transition.mutateAsync({ id, action, version, requestedChanges });
      notify.success(`→ ${action}`);
    } catch (e: any) {
      notify.error(e?.response?.data?.message ?? e?.message ?? 'Failed');
    }
  };

  const toggleOutcome = (id: string) =>
    setDraft((d) => ({
      ...d,
      learningOutcomeIds: d.learningOutcomeIds.includes(id)
        ? d.learningOutcomeIds.filter((x) => x !== id)
        : [...d.learningOutcomeIds, id],
    }));

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
                  <div className="text-xs text-muted-foreground">
                    v{p.version}
                    {p.courseOffering ? ` · ${p.courseOffering.name}` : ' · no course'}
                    {p.schemeOfWorkWeek ? ` · week ${p.schemeOfWorkWeek.weekNumber}` : ''}
                    {` · ${(p.learningOutcomes ?? []).length} outcome(s)`}
                  </div>
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

              <div>
                <Label>Course</Label>
                <select className={sel + ' w-full'} value={draft.courseOfferingId} onChange={(e) => setDraft({ ...draft, courseOfferingId: e.target.value, schemeOfWorkWeekId: '', learningOutcomeIds: [] })}>
                  <option value="">Select a course…</option>
                  {courses.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
                {!draft.courseOfferingId && <p className="mt-1 text-xs text-muted-foreground">A plan belongs to a course; subject, class and term follow from it.</p>}
              </div>

              <div>
                <Label>Scheme week</Label>
                <select className={sel + ' w-full'} value={draft.schemeOfWorkWeekId} disabled={!scheme} onChange={(e) => setDraft({ ...draft, schemeOfWorkWeekId: e.target.value })}>
                  <option value="">{scheme ? 'Not linked' : 'No scheme of work'}</option>
                  {scheme?.weeks.map((w) => (
                    <option key={w.id} value={w.id}>Week {w.weekNumber}{w.theme ? ` — ${w.theme}` : ''}</option>
                  ))}
                </select>
              </div>

              <div><Label>Week of</Label><Input type="date" value={draft.weekOf} onChange={(e) => setDraft({ ...draft, weekOf: e.target.value })} /></div>
              <div><Label>Subtopic</Label><Input value={draft.subtopic} onChange={(e) => setDraft({ ...draft, subtopic: e.target.value })} /></div>

              <div className="col-span-2">
                <Label>Curriculum outcomes covered</Label>
                {outcomes.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No outcomes are defined for this course's subject or curriculum.</p>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {outcomes.map((o) => (
                      <button
                        key={o.id}
                        type="button"
                        onClick={() => toggleOutcome(o.id)}
                        className={`rounded-full border px-2.5 py-1 text-xs transition ${draft.learningOutcomeIds.includes(o.id) ? 'border-primary bg-primary/10' : 'hover:bg-accent'}`}
                      >
                        {o.title}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="col-span-2"><Label>Objectives</Label><textarea className={sel + ' h-24 w-full'} value={draft.objectives} onChange={(e) => setDraft({ ...draft, objectives: e.target.value })} /></div>
              <div className="col-span-2"><Label>Materials</Label><textarea className={sel + ' h-20 w-full'} value={draft.materials} onChange={(e) => setDraft({ ...draft, materials: e.target.value })} /></div>
              <div className="col-span-2"><Label>Activities (one per line)</Label><textarea className={sel + ' h-20 w-full'} value={draft.activities} onChange={(e) => setDraft({ ...draft, activities: e.target.value })} /></div>
              <div className="col-span-2"><Label>Resource ids (one per line)</Label><textarea className={sel + ' h-16 w-full'} value={draft.resources} onChange={(e) => setDraft({ ...draft, resources: e.target.value })} /></div>
              <div className="col-span-2"><Label>Formative checks (one per line)</Label><textarea className={sel + ' h-16 w-full'} value={draft.assessments} onChange={(e) => setDraft({ ...draft, assessments: e.target.value })} /></div>
              <div className="col-span-2">
                <Button disabled={!draft.title || !draft.courseOfferingId || create.isPending || update.isPending} onClick={save}>
                  <Plus className="mr-1 h-4 w-4" />Save plan
                </Button>
              </div>
            </CardContent></Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
