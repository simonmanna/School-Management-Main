import { useState } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft, BarChart3, CheckCircle2, Circle, Clock, GripVertical, Lock, Pencil, Plus, RefreshCw,
  Settings2, Trash2, Users,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { SafeHtml } from '@/components/ui/safe-html';
import {
  useLmsCoursePage, useLmsEnsureSections, useLmsAddSection, useLmsAddModule,
  useLmsDeleteModule, useLmsSyncRoster, useLmsGradebook, useLmsCompletionReport,
  useLmsMoveModule, useLmsUpdateModule, useLmsUpdateInstance, useLmsEditCell,
} from '@/features/school/api';
import { activityUi, registeredActivityTypes } from '@/features/school/lms/activities/registry';
import { ActivityEditor } from '@/features/school/lms/activity-editor';
import { formatDue } from '@/features/school/lms/activities/shared';
import { can, CAP, type CourseModuleView, type CoursePageView } from '@/features/school/lms/types';
import { notify } from '@/lib/notify';

type Tab = 'course' | 'grades' | 'completion';

/**
 * The course page (ADR-014 §6).
 *
 * Every affordance is driven by `capabilities` from the server — the client asks
 * what the caller may do rather than inferring it from a role. Activity rows come
 * from the registry, so this file never switches on `activityType`; it previously
 * rendered each row as `{activityType} · {id.slice(0, 8)}` because the payload
 * carried no names.
 */
export function SchoolLmsCoursePage() {
  const { id = '' } = useParams();
  const [params] = useSearchParams();
  const asStudent = params.get('asStudent') ?? undefined;
  const nav = useNavigate();

  const [edit, setEdit] = useState(false);
  const [tab, setTab] = useState<Tab>('course');
  const [addingIn, setAddingIn] = useState<string | null>(null);
  const [editor, setEditor] = useState<
    { activityType: string; sectionId: string; existing?: CourseModuleView } | null
  >(null);
  const [dragging, setDragging] = useState<string | null>(null);

  const { data, isLoading } = useLmsCoursePage(id, asStudent);
  const ensureSections = useLmsEnsureSections();
  const addSection = useLmsAddSection();
  const addModule = useLmsAddModule();
  const delModule = useLmsDeleteModule();
  const syncRoster = useLmsSyncRoster();
  const moveModule = useLmsMoveModule();
  const updateModule = useLmsUpdateModule();
  const updateInstance = useLmsUpdateInstance();

  const page = data as CoursePageView | undefined;
  const caps = page?.capabilities ?? [];
  const mayEdit = can(caps, CAP.courseManageActivities);
  const isLearnerView = page?.viewingAs.kind !== 'staff' || Boolean(asStudent);
  const sections = page?.sections ?? [];
  // Every activity on the page — the "complete X before Y" condition needs to
  // offer siblings from other sections too, not just the current one.
  const allModules = sections.flatMap((sec) => sec.modules);

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-start gap-2">
        <Button variant="ghost" size="icon" onClick={() => nav('/school/lms/courses')}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-xl font-semibold">{page?.course.name ?? 'Course'}</h1>
          {page?.course.academicYear && (
            <p className="text-sm text-muted-foreground">{page.course.academicYear}</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {can(caps, CAP.courseManage) && (
            <Button variant="outline" size="sm" onClick={async () => {
              try { await syncRoster.mutateAsync(id); notify.success('Roster synced'); }
              catch (e: any) { notify.error(e?.response?.data?.message ?? 'Failed'); }
            }}>
              <RefreshCw className="mr-1 h-4 w-4" />Sync roster
            </Button>
          )}
          {can(caps, CAP.courseViewParticipants) && (
            <Button variant="outline" size="sm" onClick={() => nav(`/school/lms/courses/${id}/participants`)}>
              <Users className="mr-1 h-4 w-4" />Participants
            </Button>
          )}
          {can(caps, CAP.courseViewReports) && (
            <Button variant="outline" size="sm" onClick={() => nav(`/school/lms/courses/${id}/reports`)}>
              <BarChart3 className="mr-1 h-4 w-4" />Reports
            </Button>
          )}
          {mayEdit && (
            <Button variant={edit ? 'default' : 'outline'} size="sm" onClick={() => setEdit((v) => !v)}>
              <Pencil className="mr-1 h-4 w-4" />{edit ? 'Editing' : 'Edit mode'}
            </Button>
          )}
        </div>
      </div>

      {page?.course.summary && (
        <Card><CardContent className="py-4">
          <SafeHtml className="prose prose-sm dark:prose-invert max-w-none" html={page.course.summary} />
        </CardContent></Card>
      )}

      {page?.progress && page.progress.tracked > 0 && (
        <Card>
          <CardContent className="py-4">
            <div className="mb-2 flex items-center justify-between text-sm">
              <span className="font-medium">Your progress</span>
              <span className="tabular-nums text-muted-foreground">
                {page.progress.completed} of {page.progress.tracked} activities · {page.progress.percent}%
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${page.progress.percent}%` }} />
            </div>
          </CardContent>
        </Card>
      )}

      <div className="flex gap-2 border-b">
        {(['course', 'grades', 'completion'] as Tab[]).map((t) => {
          if (t === 'grades' && !can(caps, CAP.gradeView) && !can(caps, CAP.gradeViewAll)) return null;
          if (t === 'completion' && !can(caps, CAP.courseViewReports)) return null;
          return (
            <button key={t} onClick={() => setTab(t)}
              className={`px-3 py-2 text-sm ${tab === t ? 'border-b-2 border-primary font-medium' : 'text-muted-foreground'}`}>
              {t === 'course' ? 'Course' : t === 'grades' ? 'Gradebook' : 'Completion'}
            </button>
          );
        })}
      </div>

      {tab === 'course' && (
        <>
          {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
          {!isLoading && sections.length === 0 && (
            <Card><CardContent className="space-y-3 py-8 text-center">
              <p className="text-sm text-muted-foreground">This course has no sections yet.</p>
              {mayEdit && (
                <Button onClick={async () => {
                  try { await ensureSections.mutateAsync(id); notify.success('Sections created'); }
                  catch (e: any) { notify.error(e?.response?.data?.message ?? 'Failed'); }
                }}>
                  <Plus className="mr-1 h-4 w-4" />Create sections
                </Button>
              )}
            </CardContent></Card>
          )}

          {sections.map((sec) => (
            <Card key={sec.id} className={sec.availability && !sec.availability.available ? 'opacity-70' : undefined}>
              <CardHeader className="flex flex-row items-start justify-between py-3">
                <div className="min-w-0">
                  <CardTitle className="text-base">
                    {sec.name ?? (sec.sectionNo === 0 ? 'General' : `Section ${sec.sectionNo}`)}
                    {sec.weekOf && (
                      <span className="ml-2 text-xs font-normal text-muted-foreground">
                        week of {new Date(sec.weekOf).toLocaleDateString()}
                      </span>
                    )}
                    {!sec.visible && <Badge variant="secondary" className="ml-2 text-[10px]">hidden</Badge>}
                  </CardTitle>
                  {sec.summary && <SafeHtml className="prose prose-sm dark:prose-invert mt-1 max-w-none" html={sec.summary} />}
                  {sec.availability && !sec.availability.available && (
                    <p className="mt-1 flex items-center gap-1 text-xs text-amber-600">
                      <Lock className="h-3 w-3" />{sec.availability.reasons.join('; ') || 'Restricted'}
                    </p>
                  )}
                </div>
                {edit && mayEdit && (
                  <Button variant="ghost" size="sm" onClick={() => setAddingIn(addingIn === sec.id ? null : sec.id)}>
                    <Plus className="mr-1 h-4 w-4" />Add activity
                  </Button>
                )}
              </CardHeader>
              <CardContent className="space-y-1">
                {sec.modules.length === 0 && <p className="py-2 text-xs text-muted-foreground">No activities.</p>}
                {sec.modules.map((m) => (
                  <ModuleRow
                    key={m.id} cm={m} edit={edit && mayEdit} learner={isLearnerView}
                    dragging={dragging === m.id}
                    onDragStart={() => setDragging(m.id)}
                    onDragEnd={() => setDragging(null)}
                    onDropOn={async () => {
                      if (!dragging || dragging === m.id) return;
                      // Rebuild the target section's order with the dragged module
                      // inserted before the row it was dropped on, then let the
                      // server persist the whole sequence in one call.
                      const order = sec.modules.map((x) => x.id).filter((x) => x !== dragging);
                      const at = order.indexOf(m.id);
                      order.splice(at < 0 ? order.length : at, 0, dragging);
                      try {
                        await moveModule.mutateAsync({ id: dragging, sectionId: sec.id, sequence: order });
                      } catch (e: any) { notify.error(e?.response?.data?.message ?? 'Could not reorder'); }
                      setDragging(null);
                    }}
                    onEdit={() => setEditor({ activityType: m.activityType, sectionId: sec.id, existing: m })}
                    onOpen={() => nav(`/school/lms/modules/${m.id}${asStudent ? `?asStudent=${asStudent}` : ''}`)}
                    onDelete={async () => {
                      try { await delModule.mutateAsync(m.id); notify.success('Removed'); }
                      catch (e: any) { notify.error(e?.response?.data?.message ?? 'Failed'); }
                    }}
                  />
                ))}

                {edit && mayEdit && addingIn === sec.id && (
                  <div className="mt-2 space-y-2 rounded-md border bg-muted/30 p-3">
                    <Label className="text-xs">Choose an activity type</Label>
                    <div className="flex flex-wrap gap-1">
                      {registeredActivityTypes().map((a) => {
                        const Icon = a.icon;
                        return (
                          <button
                            key={a.type}
                            onClick={() => { setEditor({ activityType: a.type, sectionId: sec.id }); setAddingIn(null); }}
                            className="flex items-center gap-1 rounded border bg-card px-2 py-1 text-xs hover:border-primary hover:bg-primary/10"
                          >
                            <Icon className="h-3.5 w-3.5" />{a.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}

          {edit && mayEdit && sections.length > 0 && (
            <Button variant="outline" size="sm" onClick={async () => {
              try { await addSection.mutateAsync({ id }); notify.success('Section added'); }
              catch (e: any) { notify.error(e?.response?.data?.message ?? 'Failed'); }
            }}>
              <Plus className="mr-1 h-4 w-4" />Add section
            </Button>
          )}
        </>
      )}

      {tab === 'grades' && <Gradebook id={id} canEdit={can(caps, CAP.gradeEdit)} />}
      {tab === 'completion' && <CompletionReport id={id} />}

      {editor && (
        <ActivityEditor
          activityType={editor.activityType}
          existing={editor.existing}
          siblings={allModules}
          onClose={() => setEditor(null)}
          onSave={async ({ instance, spine }) => {
            if (editor.existing) {
              // Spine and plugin fields go to separate endpoints on purpose: a
              // plugin must never be able to write visibility or availability.
              await updateInstance.mutateAsync({ id: editor.existing.id, ...instance });
              await updateModule.mutateAsync({ id: editor.existing.id, ...spine });
              notify.success('Activity updated');
            } else {
              await addModule.mutateAsync({
                courseId: id, sectionId: editor.sectionId,
                activityType: editor.activityType, ...instance, ...spine,
              });
              notify.success('Activity added');
            }
          }}
        />
      )}
    </div>
  );
}

/** One activity row. Name, icon, due date, completion tick and grade all come from the envelope. */
function ModuleRow({
  cm, edit, learner, dragging, onOpen, onDelete, onEdit, onDragStart, onDragEnd, onDropOn,
}: {
  cm: CourseModuleView; edit: boolean; learner: boolean; dragging?: boolean;
  onOpen: () => void; onDelete: () => void; onEdit?: () => void;
  onDragStart?: () => void; onDragEnd?: () => void; onDropOn?: () => void;
}) {
  const Icon = activityUi(cm.activityType).icon;
  const due = formatDue(cm.dueAt);
  const blocked = cm.availability && !cm.availability.available;
  const complete = cm.completion && cm.completion.state !== 'incomplete';

  return (
    <div
      draggable={edit}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={(e) => { if (edit) e.preventDefault(); }}
      onDrop={(e) => { if (edit) { e.preventDefault(); onDropOn?.(); } }}
      className={`flex items-center gap-2 rounded-md px-2 py-2 hover:bg-muted/50 ${blocked ? 'opacity-60' : ''} ${
        dragging ? 'opacity-40 ring-1 ring-primary' : ''
      }`}
    >
      {edit && <GripVertical className="h-4 w-4 shrink-0 cursor-grab text-muted-foreground" />}
      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
      <button onClick={onOpen} className="min-w-0 flex-1 text-left">
        <span className="block truncate text-sm hover:text-primary hover:underline">{cm.name}</span>
        <span className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          {due && <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{due}</span>}
          {blocked && (
            <span className="flex items-center gap-1 text-amber-600">
              <Lock className="h-3 w-3" />{cm.availability?.reasons[0] ?? 'Restricted'}
            </span>
          )}
          {/* Released marks only; the envelope withholds unapproved scores. */}
          {learner && cm.grade?.released && cm.grade.score != null && (
            <span className="tabular-nums">{cm.grade.score}/{cm.grade.maxScore}</span>
          )}
          {learner && cm.gradable && !cm.grade?.released && <span>Not marked yet</span>}
        </span>
      </button>
      {!cm.visible && <Badge variant="secondary" className="text-[10px]">hidden</Badge>}
      {cm.completion && (
        complete
          ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
          : <Circle className="h-4 w-4 shrink-0 text-muted-foreground" />
      )}
      {edit && (
        <>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onEdit}>
            <Settings2 className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onDelete}>
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </>
      )}
    </div>
  );
}

function Gradebook({ id, canEdit }: { id: string; canEdit: boolean }) {
  const { data, isLoading, refetch } = useLmsGradebook(id);
  const editCell = useLmsEditCell();
  if (isLoading) return <p className="text-sm text-muted-foreground">Loading gradebook…</p>;
  const items: any[] = (data as any)?.items ?? [];
  const students: any[] = (data as any)?.students ?? [];
  if (items.length === 0) {
    return <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">
      No gradable activities yet. Add an assignment or quiz.
    </CardContent></Card>;
  }
  return (
    <Card><CardContent className="overflow-x-auto py-4">
      <table className="w-full text-sm">
        <thead><tr className="border-b text-left text-xs text-muted-foreground">
          <th className="py-2 pr-4">Student</th>
          {items.map((it) => <th key={it.id} className="whitespace-nowrap px-3 py-2">{it.assessment?.title ?? it.activityType}</th>)}
          <th className="px-3 py-2">Total</th>
        </tr></thead>
        <tbody>
          {students.map((s) => (
            <tr key={s.studentProfileId} className="border-b">
              <td className="py-2 pr-4">
                <span className="block">{s.studentName}</span>
                {s.admissionNo && <span className="text-xs text-muted-foreground">{s.admissionNo}</span>}
              </td>
              {items.map((it) => {
                const cell = it.assessmentId ? s.cells[it.assessmentId] : null;
                return (
                  <td key={it.id} className="px-3 py-2 tabular-nums">
                    {canEdit && cell ? (
                      <input
                        type="number"
                        defaultValue={cell.score ?? ''}
                        className="h-8 w-16 rounded border bg-background px-1 text-right text-sm tabular-nums"
                        max={it.assessment?.maxScore ?? undefined}
                        min={0}
                        onBlur={async (e) => {
                          const next = e.target.value === '' ? null : Number(e.target.value);
                          if (next === null || next === cell.score) return;
                          try {
                            // Writes go through the grade bridge to MarkingService,
                            // the one permitted writer of a mark.
                            await editCell.mutateAsync({ courseId: id, studentAssessmentId: cell.studentAssessmentId, score: next });
                            await refetch();
                          } catch (err: any) {
                            notify.error(err?.response?.data?.message ?? 'Could not save the mark');
                            e.target.value = String(cell.score ?? '');
                          }
                        }}
                      />
                    ) : (
                      cell?.score ?? '—'
                    )}
                  </td>
                );
              })}
              <td className="px-3 py-2 font-medium tabular-nums">{s.total ?? '—'}</td>
            </tr>
          ))}
          {students.length === 0 && (
            <tr><td colSpan={items.length + 2} className="py-6 text-center text-muted-foreground">
              No enrolled students. Sync the roster.
            </td></tr>
          )}
        </tbody>
      </table>
    </CardContent></Card>
  );
}

function CompletionReport({ id }: { id: string }) {
  const { data, isLoading } = useLmsCompletionReport(id);
  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  const modules: any[] = (data as any)?.modules ?? [];
  const completions: any[] = (data as any)?.completions ?? [];
  const done = completions.filter((c) => c.state !== 'incomplete').length;
  return (
    <Card><CardContent className="space-y-3 py-4">
      <div className="flex items-center gap-2 text-sm">
        <BarChart3 className="h-4 w-4" />
        <span>{modules.length} completion-tracked activities · {done} completions recorded</span>
      </div>
      <div className="grid gap-2 md:grid-cols-2">
        {modules.map((m) => {
          const n = completions.filter((c) => c.courseModuleId === m.id && c.state !== 'incomplete').length;
          const Icon = activityUi(m.activityType).icon;
          return (
            <div key={m.id} className="flex items-center justify-between rounded border px-3 py-2 text-sm">
              <span className="flex items-center gap-2">
                <Icon className="h-4 w-4 text-muted-foreground" />{m.name ?? m.activityType}
              </span>
              <Badge variant="outline">{n} done</Badge>
            </div>
          );
        })}
      </div>
    </CardContent></Card>
  );
}
