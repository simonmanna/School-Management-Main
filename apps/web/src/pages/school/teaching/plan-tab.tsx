import { useState } from 'react';
import { BookMarked, Loader2, Plus, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { notify } from '@/lib/notify';
import {
  useAddSchemeItem, useAddSchemeWeek, useCourseOutcomeOptions, useCourseResources,
  useAttachCourseResource, useCreateSchemeOfWork, useDetachCourseResource,
  useLearningResourceLibrary, useRemoveSchemeItem, useRemoveSchemeWeek, useSchemeOfWork,
  useUpdateSchemeOfWork, useUpdateSchemeWeek,
} from '@/features/school/teaching-api';
import { EmptyState, Picker, Progress, fmtDate, selectClass } from '../_components/exam-workflow';

const STATE_TONE: Record<string, string> = {
  covered: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
  partial: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
  planned: 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300',
  open: 'bg-muted text-muted-foreground',
};

/**
 * The Plan tab — the scheme of work, plus the materials the course carries.
 *
 * The scheme is the term map: which weeks cover what, and how many periods each
 * should take. Progress next to each week is read from delivery, so the scheme
 * shows what has actually been taught rather than what was intended.
 */
export function PlanTab({ offeringId }: { offeringId: string }) {
  const { data: scheme, isLoading } = useSchemeOfWork(offeringId);
  const create = useCreateSchemeOfWork(offeringId);
  const update = useUpdateSchemeOfWork(offeringId);
  const addWeek = useAddSchemeWeek(offeringId);
  const [title, setTitle] = useState('');

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading scheme of work…</p>;

  if (!scheme) {
    return (
      <div className="space-y-4">
        <EmptyState
          icon={<BookMarked className="h-6 w-6" />}
          title="No scheme of work yet"
          hint="Lay the term out week by week. Weeks can be generated from the term dates and edited afterwards."
          action={
            <div className="flex flex-col items-center gap-2">
              <Input className="w-72" placeholder="Title (optional)" value={title} onChange={(e) => setTitle(e.target.value)} />
              <Button
                disabled={create.isPending}
                onClick={() =>
                  create.mutate(
                    { courseOfferingId: offeringId, title: title || undefined, generateWeeksFromTerm: true },
                    { onSuccess: () => notify.success('Scheme of work created'), onError: (e: any) => notify.error(e?.response?.data?.message ?? 'Could not create the scheme') },
                  )
                }
              >
                {create.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Create from term dates
              </Button>
            </div>
          }
        />
        <ResourcesCard offeringId={offeringId} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="flex items-center gap-2 text-base"><BookMarked className="h-4 w-4" /> {scheme.title}</CardTitle>
            <div className="flex items-center gap-2">
              <Badge variant="secondary" className="capitalize">{scheme.status}</Badge>
              {scheme.status !== 'active' && (
                <Button size="sm" variant="outline" onClick={() => update.mutate({ id: scheme.id, status: 'active' }, { onSuccess: () => notify.success('Scheme activated') })}>
                  Activate
                </Button>
              )}
              {scheme.status === 'active' && (
                <Button size="sm" variant="ghost" onClick={() => update.mutate({ id: scheme.id, status: 'archived' }, { onSuccess: () => notify.success('Scheme archived') })}>
                  Archive
                </Button>
              )}
              <Button size="sm" onClick={() => addWeek.mutate({ id: scheme.id }, { onSuccess: () => notify.success('Week added') })}>
                <Plus className="mr-1 h-3.5 w-3.5" /> Add week
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex flex-wrap items-center gap-4 text-sm">
            <span className="text-muted-foreground">{scheme.progress.totalWeeks} weeks · {scheme.progress.totalPlannedPeriods} planned periods</span>
            <Progress done={scheme.progress.coveredWeeks} total={scheme.progress.totalWeeks} />
            <span className="text-muted-foreground">{scheme.progress.coveragePct}% covered</span>
          </div>
        </CardContent>
      </Card>

      <div className="space-y-3">
        {scheme.weeks.map((week) => (
          <WeekCard key={week.id} offeringId={offeringId} week={week} state={scheme.progress.weeks.find((w) => w.weekNumber === week.weekNumber)?.state ?? 'open'} />
        ))}
      </div>

      <ResourcesCard offeringId={offeringId} />
    </div>
  );
}

function WeekCard({ offeringId, week, state }: { offeringId: string; week: any; state: string }) {
  const updateWeek = useUpdateSchemeWeek(offeringId);
  const removeWeek = useRemoveSchemeWeek(offeringId);
  const addItem = useAddSchemeItem(offeringId);
  const removeItem = useRemoveSchemeItem(offeringId);
  const { data: outcomes = [] } = useCourseOutcomeOptions(offeringId);
  const [open, setOpen] = useState(false);
  const [itemTitle, setItemTitle] = useState('');
  const [outcomeId, setOutcomeId] = useState('');
  const [periods, setPeriods] = useState('1');

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <button className="text-left" onClick={() => setOpen((v) => !v)}>
            <CardTitle className="text-base">Week {week.weekNumber}{week.theme ? ` — ${week.theme}` : ''}</CardTitle>
            <p className="text-xs text-muted-foreground">
              {week.weekStart ? fmtDate(week.weekStart) : 'No date'} · {week.items.length} item(s) · {week.plannedPeriods} period(s) · {week.lessonPlans.length} plan(s)
            </p>
          </button>
          <div className="flex items-center gap-2">
            <span className={`rounded-full px-2 py-0.5 text-xs capitalize ${STATE_TONE[state]}`}>{state}</span>
            <Button size="sm" variant="ghost" onClick={() => setOpen((v) => !v)}>{open ? 'Close' : 'Edit'}</Button>
          </div>
        </div>
      </CardHeader>
      {open && (
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <Label className="text-xs">Theme</Label>
              <Input defaultValue={week.theme ?? ''} onBlur={(e) => e.target.value !== (week.theme ?? '') && updateWeek.mutate({ weekId: week.id, theme: e.target.value })} />
            </div>
            <div>
              <Label className="text-xs">Week starting</Label>
              <Input
                type="date"
                defaultValue={week.weekStart ? week.weekStart.slice(0, 10) : ''}
                onBlur={(e) => e.target.value && updateWeek.mutate({ weekId: week.id, weekStart: new Date(e.target.value).toISOString() })}
              />
            </div>
            <div>
              <Label className="text-xs">Planned periods</Label>
              <Input type="number" min={0} defaultValue={week.plannedPeriods} onBlur={(e) => updateWeek.mutate({ weekId: week.id, plannedPeriods: Number(e.target.value) })} />
            </div>
          </div>

          <div>
            <Label className="text-xs">Notes</Label>
            <Textarea rows={2} defaultValue={week.notes ?? ''} onBlur={(e) => e.target.value !== (week.notes ?? '') && updateWeek.mutate({ weekId: week.id, notes: e.target.value })} />
          </div>

          <div className="space-y-1.5">
            {week.items.map((item: any) => (
              <div key={item.id} className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
                <div className="min-w-0">
                  <div className="truncate font-medium">{item.title}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {item.learningOutcome ? `Outcome: ${item.learningOutcome.title}` : 'No outcome linked'} · {item.plannedPeriods} period(s)
                  </div>
                </div>
                <Button size="sm" variant="ghost" onClick={() => removeItem.mutate(item.id)}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap items-end gap-2 rounded-md border border-dashed p-3">
            <div className="min-w-[180px] flex-1">
              <Label className="text-xs">What is taught</Label>
              <Input value={itemTitle} onChange={(e) => setItemTitle(e.target.value)} placeholder="Topic or activity" />
            </div>
            <div className="min-w-[180px] flex-1">
              <Label className="text-xs">Curriculum outcome</Label>
              <select className={selectClass} value={outcomeId} onChange={(e) => setOutcomeId(e.target.value)}>
                <option value="">None</option>
                {outcomes.map((o) => (
                  <option key={o.id} value={o.id}>{o.title}</option>
                ))}
              </select>
            </div>
            <div className="w-24">
              <Label className="text-xs">Periods</Label>
              <Input type="number" min={0} value={periods} onChange={(e) => setPeriods(e.target.value)} />
            </div>
            <Button
              size="sm"
              disabled={!itemTitle.trim()}
              onClick={() =>
                addItem.mutate(
                  { weekId: week.id, title: itemTitle.trim(), learningOutcomeId: outcomeId || undefined, plannedPeriods: Number(periods) || 1 },
                  { onSuccess: () => { setItemTitle(''); setOutcomeId(''); setPeriods('1'); } },
                )
              }
            >
              <Plus className="mr-1 h-3.5 w-3.5" /> Add
            </Button>
          </div>

          <div className="flex justify-end">
            <Button
              size="sm"
              variant="ghost"
              className="text-destructive"
              onClick={() => removeWeek.mutate(week.id, { onError: (e: any) => notify.error(e?.response?.data?.message ?? 'Could not remove the week') })}
            >
              Remove week {week.weekNumber}
            </Button>
          </div>
        </CardContent>
      )}
    </Card>
  );
}

/** Materials attached to the course, not to a single plan. */
function ResourcesCard({ offeringId }: { offeringId: string }) {
  const { data: attached = [] } = useCourseResources(offeringId);
  const { data: library } = useLearningResourceLibrary();
  const attach = useAttachCourseResource(offeringId);
  const detach = useDetachCourseResource(offeringId);
  const [resourceId, setResourceId] = useState('');
  const options = (Array.isArray(library) ? library : (library as any)?.data ?? []) as any[];

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Course resources</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {attached.length === 0 ? (
          <p className="text-sm text-muted-foreground">No materials attached to this course yet.</p>
        ) : (
          <div className="space-y-1.5">
            {attached.map((row: any) => (
              <div key={row.id} className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
                <div className="min-w-0">
                  <div className="truncate font-medium">{row.learningResource?.title}</div>
                  <div className="text-xs text-muted-foreground">
                    {row.learningResource?.type}{row.visibleToLearners ? ' · visible to learners' : ' · staff only'}
                  </div>
                </div>
                <Button size="sm" variant="ghost" onClick={() => detach.mutate(row.learningResourceId)}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </div>
        )}
        <div className="flex flex-wrap items-end gap-2">
          <Picker
            label="Attach a resource"
            value={resourceId}
            onChange={setResourceId}
            options={options.map((r: any) => ({ value: r.id, label: r.title }))}
          />
          <Button
            size="sm"
            disabled={!resourceId}
            onClick={() => attach.mutate({ learningResourceId: resourceId, visibleToLearners: true }, { onSuccess: () => { setResourceId(''); notify.success('Resource attached'); } })}
          >
            Attach
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
