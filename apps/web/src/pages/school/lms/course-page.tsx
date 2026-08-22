import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Plus, Pencil, Trash2, RefreshCw, Users, BarChart3, CheckCircle2, Circle,
  FileText, Link as LinkIcon, File, Type, ClipboardList, ListChecks, MessagesSquare,
  BarChart, BookA, BookOpen, GraduationCap, MessageSquare, Package, ExternalLink, Puzzle, CalendarCheck, Folder,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  useLmsCoursePage, useLmsEnsureSections, useLmsAddSection, useLmsAddModule,
  useLmsDeleteModule, useLmsSyncRoster, useLmsGradebook, useLmsCompletionReport, type LmsModule,
} from '@/features/school/api';
import { notify } from '@/lib/notify';

/** The activity palette — matches the registered backend plugins (ADR-014 §4). */
const ACTIVITY_TYPES: { type: string; label: string; icon: any; gradable?: boolean }[] = [
  { type: 'page', label: 'Page', icon: File },
  { type: 'resource', label: 'File', icon: FileText },
  { type: 'url', label: 'URL', icon: LinkIcon },
  { type: 'label', label: 'Text', icon: Type },
  { type: 'folder', label: 'Folder', icon: Folder },
  { type: 'assign', label: 'Assignment', icon: ClipboardList, gradable: true },
  { type: 'quiz', label: 'Quiz', icon: ListChecks, gradable: true },
  { type: 'forum', label: 'Forum', icon: MessagesSquare },
  { type: 'choice', label: 'Poll', icon: BarChart },
  { type: 'glossary', label: 'Glossary', icon: BookA },
  { type: 'wiki', label: 'Wiki', icon: BookOpen },
  { type: 'lesson', label: 'Lesson', icon: GraduationCap },
  { type: 'feedback', label: 'Feedback', icon: MessageSquare },
  { type: 'workshop', label: 'Workshop', icon: Users, gradable: true },
  { type: 'scorm', label: 'SCORM', icon: Package, gradable: true },
  { type: 'lti', label: 'External tool', icon: ExternalLink, gradable: true },
  { type: 'h5p', label: 'H5P', icon: Puzzle, gradable: true },
  { type: 'attendance', label: 'Attendance', icon: CalendarCheck },
];
const ICON: Record<string, any> = Object.fromEntries(ACTIVITY_TYPES.map((a) => [a.type, a.icon]));

type Tab = 'course' | 'grades' | 'completion';

export function SchoolLmsCoursePage() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const [edit, setEdit] = useState(false);
  const [tab, setTab] = useState<Tab>('course');
  const [addingIn, setAddingIn] = useState<string | null>(null);
  const [pick, setPick] = useState<{ type: string; name: string }>({ type: 'page', name: '' });

  const { data, isLoading } = useLmsCoursePage(id);
  const ensureSections = useLmsEnsureSections();
  const addSection = useLmsAddSection();
  const addModule = useLmsAddModule();
  const delModule = useLmsDeleteModule();
  const syncRoster = useLmsSyncRoster();

  const sections = data?.sections ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" onClick={() => nav('/school/lms/courses')}><ArrowLeft className="h-4 w-4" /></Button>
        <GraduationCap className="h-5 w-5" />
        <h1 className="text-xl font-semibold">Course {id.slice(0, 8)}</h1>
        <div className="ml-auto flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={async () => { try { await syncRoster.mutateAsync(id); notify.success('Roster synced'); } catch (e: any) { notify.error(e?.message ?? 'Failed'); } }}>
            <RefreshCw className="mr-1 h-4 w-4" />Sync roster
          </Button>
          <Button variant="outline" size="sm" onClick={() => nav(`/school/lms/courses/${id}/participants`)}><Users className="mr-1 h-4 w-4" />Participants</Button>
          <Button variant={edit ? 'default' : 'outline'} size="sm" onClick={() => setEdit((v) => !v)}><Pencil className="mr-1 h-4 w-4" />{edit ? 'Editing' : 'Edit mode'}</Button>
        </div>
      </div>

      <div className="flex gap-2 border-b">
        {(['course', 'grades', 'completion'] as Tab[]).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`px-3 py-2 text-sm capitalize ${tab === t ? 'border-b-2 border-primary font-medium' : 'text-muted-foreground'}`}>
            {t === 'course' ? 'Course' : t === 'grades' ? 'Gradebook' : 'Completion'}
          </button>
        ))}
      </div>

      {tab === 'course' && (
        <>
          {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
          {!isLoading && sections.length === 0 && (
            <Card><CardContent className="space-y-3 py-8 text-center">
              <p className="text-sm text-muted-foreground">This course has no sections yet.</p>
              <Button onClick={async () => { try { await ensureSections.mutateAsync(id); notify.success('Sections created'); } catch (e: any) { notify.error(e?.message ?? 'Failed'); } }}>
                <Plus className="mr-1 h-4 w-4" />Create sections
              </Button>
            </CardContent></Card>
          )}

          {sections.map((sec) => (
            <Card key={sec.id}>
              <CardHeader className="flex flex-row items-center justify-between py-3">
                <CardTitle className="text-base">{sec.name ?? (sec.sectionNo === 0 ? 'General' : `Section ${sec.sectionNo}`)}{sec.weekOf && <span className="ml-2 text-xs font-normal text-muted-foreground">{new Date(sec.weekOf).toLocaleDateString()}</span>}</CardTitle>
                {edit && <Button variant="ghost" size="sm" onClick={() => setAddingIn(addingIn === sec.id ? null : sec.id)}><Plus className="mr-1 h-4 w-4" />Add activity</Button>}
              </CardHeader>
              <CardContent className="space-y-1">
                {sec.modules.length === 0 && <p className="py-2 text-xs text-muted-foreground">No activities.</p>}
                {sec.modules.map((m) => <ModuleRow key={m.id} m={m} edit={edit} courseId={id} onOpen={() => nav(`/school/lms/modules/${m.id}`)} onDelete={async () => { try { await delModule.mutateAsync(m.id); notify.success('Removed'); } catch (e: any) { notify.error(e?.message ?? 'Failed'); } }} />)}

                {edit && addingIn === sec.id && (
                  <div className="mt-2 space-y-2 rounded-md border bg-muted/30 p-3">
                    <div className="flex flex-wrap gap-1">
                      {ACTIVITY_TYPES.map((a) => {
                        const Icon = a.icon;
                        return (
                          <button key={a.type} onClick={() => setPick({ ...pick, type: a.type })}
                            className={`flex items-center gap-1 rounded border px-2 py-1 text-xs ${pick.type === a.type ? 'border-primary bg-primary/10' : 'bg-card'}`}>
                            <Icon className="h-3.5 w-3.5" />{a.label}{a.gradable && <span className="text-[10px] text-amber-600">•</span>}
                          </button>
                        );
                      })}
                    </div>
                    <div className="flex items-end gap-2">
                      <div className="flex-1"><Label className="text-xs">Name</Label><Input value={pick.name} onChange={(e) => setPick({ ...pick, name: e.target.value })} placeholder="Activity name" /></div>
                      <Button size="sm" disabled={addModule.isPending} onClick={async () => {
                        try { await addModule.mutateAsync({ courseId: id, sectionId: sec.id, activityType: pick.type, name: pick.name || undefined, content: pick.type === 'label' ? pick.name : undefined, completionMode: 'manual' }); notify.success('Activity added'); setPick({ type: 'page', name: '' }); setAddingIn(null); }
                        catch (e: any) { notify.error(e?.message ?? 'Failed'); }
                      }}><Plus className="mr-1 h-4 w-4" />Add</Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}

          {edit && sections.length > 0 && (
            <Button variant="outline" size="sm" onClick={async () => { try { await addSection.mutateAsync({ id }); notify.success('Section added'); } catch (e: any) { notify.error(e?.message ?? 'Failed'); } }}>
              <Plus className="mr-1 h-4 w-4" />Add section
            </Button>
          )}
        </>
      )}

      {tab === 'grades' && <Gradebook id={id} />}
      {tab === 'completion' && <CompletionReport id={id} />}
    </div>
  );
}

function ModuleRow({ m, edit, onOpen, onDelete }: { m: LmsModule; edit: boolean; courseId: string; onOpen: () => void; onDelete: () => void }) {
  const Icon = ICON[m.activityType] ?? File;
  return (
    <div className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted/50">
      <Icon className="h-4 w-4 text-muted-foreground" />
      <button onClick={onOpen} className="flex-1 text-left text-sm hover:text-primary hover:underline">{m.activityType}{m.instanceId ? '' : ''} · {m.id.slice(0, 8)}</button>
      {m.assessmentId && <Badge variant="outline" className="text-[10px]">graded</Badge>}
      {!m.visible && <Badge variant="secondary" className="text-[10px]">hidden</Badge>}
      {m.completion && (m.completion === 'incomplete' ? <Circle className="h-4 w-4 text-muted-foreground" /> : <CheckCircle2 className="h-4 w-4 text-emerald-600" />)}
      {edit && <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onDelete}><Trash2 className="h-3.5 w-3.5" /></Button>}
    </div>
  );
}

function Gradebook({ id }: { id: string }) {
  const { data, isLoading } = useLmsGradebook(id);
  if (isLoading) return <p className="text-sm text-muted-foreground">Loading gradebook…</p>;
  const items: any[] = (data as any)?.items ?? [];
  const students: any[] = (data as any)?.students ?? [];
  if (items.length === 0) return <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">No gradable activities yet. Add an assignment or quiz.</CardContent></Card>;
  return (
    <Card><CardContent className="overflow-x-auto py-4">
      <table className="w-full text-sm">
        <thead><tr className="border-b text-left text-xs text-muted-foreground">
          <th className="py-2 pr-4">Student</th>
          {items.map((it) => <th key={it.id} className="px-3 py-2 whitespace-nowrap">{it.assessment?.title ?? it.activityType}</th>)}
          <th className="px-3 py-2">Total</th>
        </tr></thead>
        <tbody>
          {students.map((s) => (
            <tr key={s.studentProfileId} className="border-b">
              <td className="py-2 pr-4 font-mono text-xs">{s.studentProfileId.slice(0, 8)}</td>
              {items.map((it) => <td key={it.id} className="px-3 py-2 tabular-nums">{it.assessmentId ? s.cells[it.assessmentId]?.score ?? '—' : '—'}</td>)}
              <td className="px-3 py-2 font-medium tabular-nums">{s.total ?? '—'}</td>
            </tr>
          ))}
          {students.length === 0 && <tr><td colSpan={items.length + 2} className="py-6 text-center text-muted-foreground">No enrolled students. Sync the roster.</td></tr>}
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
      <div className="flex items-center gap-2 text-sm"><BarChart3 className="h-4 w-4" /><span>{modules.length} completion-tracked activities · {done} completions recorded</span></div>
      <div className="grid gap-2 md:grid-cols-2">
        {modules.map((m) => {
          const n = completions.filter((c) => c.courseModuleId === m.id && c.state !== 'incomplete').length;
          return <div key={m.id} className="flex items-center justify-between rounded border px-3 py-2 text-sm"><span>{m.activityType} · {m.id.slice(0, 8)}</span><Badge variant="outline">{n} done</Badge></div>;
        })}
      </div>
    </CardContent></Card>
  );
}
