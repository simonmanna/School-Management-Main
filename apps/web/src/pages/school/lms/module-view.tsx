import { useState } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, CheckCircle2, Circle, Clock, Lock } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { SafeHtml } from '@/components/ui/safe-html';
import { useLmsModuleView, useLmsModuleAction, useLmsSetCompletion } from '@/features/school/api';
import { activityUi } from '@/features/school/lms/activities/registry';
import { formatDue } from '@/features/school/lms/activities/shared';
import { can, CAP, type ModuleViewEnvelope } from '@/features/school/lms/types';
import { notify } from '@/lib/notify';

/**
 * The activity page: common chrome rendered once, body delegated to the registered
 * plugin component (ADR-014 §6).
 *
 * This page used to duck-type the response (`guessType(view)`) and fall back to
 * `<pre>{JSON.stringify(view)}</pre>` for anything it could not place. The server
 * now returns a tagged envelope, so dispatch is a registry lookup and the chrome —
 * title, due date, availability reason, grade, completion tick — is written once
 * instead of per activity type.
 */
export function SchoolLmsModuleViewPage() {
  const { id = '' } = useParams();
  const [params] = useSearchParams();
  const asStudent = params.get('asStudent') ?? undefined;
  const nav = useNavigate();

  const { data, isLoading, refetch } = useLmsModuleView(id, asStudent);
  const act = useLmsModuleAction();
  const setCompletion = useLmsSetCompletion();
  const [busy, setBusy] = useState(false);

  if (isLoading) return <p className="p-4 text-sm text-muted-foreground">Loading…</p>;
  const view = data as ModuleViewEnvelope | undefined;
  if (!view?.module) return <p className="p-4 text-sm text-muted-foreground">Activity not found.</p>;

  const { module: cm, course, audience } = view;
  const ui = activityUi(cm.activityType);
  const Body = audience === 'teacher' ? ui.TeacherView : ui.StudentView;
  const Icon = ui.icon;

  const run = async (action: string, dto: Record<string, unknown> = {}) => {
    setBusy(true);
    try {
      await act.mutateAsync({ id, action, ...dto, ...(asStudent ? { asStudent } : {}) });
      await refetch();
      notify.success('Saved');
    } catch (e: any) {
      notify.error(e?.response?.data?.message ?? e?.message ?? 'Action failed');
    } finally {
      setBusy(false);
    }
  };

  const due = formatDue(cm.dueAt);
  const overdue = cm.dueAt && new Date(cm.dueAt) < new Date() && cm.grade?.submissionStatus === 'assigned';
  const complete = cm.completion && cm.completion.state !== 'incomplete';
  const mayTick =
    cm.completion?.mode === 'manual' &&
    (view.viewingAs.kind === 'student' || can(view.capabilities, CAP.completionOverride));

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-4">
      <div className="flex items-start gap-3">
        <Button variant="ghost" size="icon" onClick={() => nav(`/school/lms/courses/${course.id}`)}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <Icon className="mt-1 h-6 w-6 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-semibold leading-tight">{cm.name}</h1>
          <p className="text-sm text-muted-foreground">
            {course.name}
            {audience === 'teacher' && <Badge variant="outline" className="ml-2 text-[10px]">Teacher view</Badge>}
            {view.viewingAs.kind === 'guardian' && <Badge variant="outline" className="ml-2 text-[10px]">Parent view</Badge>}
          </p>
        </div>
        {mayTick && (
          <Button
            variant={complete ? 'secondary' : 'outline'}
            size="sm"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await setCompletion.mutateAsync({ id, state: complete ? 'incomplete' : 'complete', asStudent });
                await refetch();
              } catch (e: any) {
                notify.error(e?.response?.data?.message ?? 'Could not update');
              } finally { setBusy(false); }
            }}
          >
            {complete ? <CheckCircle2 className="mr-1 h-4 w-4 text-emerald-600" /> : <Circle className="mr-1 h-4 w-4" />}
            {complete ? 'Completed' : 'Mark as done'}
          </Button>
        )}
      </div>

      {(due || complete) && (
        <div className="flex flex-wrap items-center gap-3 text-xs">
          {due && (
            <span className={`flex items-center gap-1 ${overdue ? 'text-destructive' : 'text-muted-foreground'}`}>
              {overdue ? <AlertTriangle className="h-3.5 w-3.5" /> : <Clock className="h-3.5 w-3.5" />}
              {overdue ? `Overdue — was due ${due}` : `Due ${due}`}
            </span>
          )}
          {complete && (
            <span className="flex items-center gap-1 text-emerald-600">
              <CheckCircle2 className="h-3.5 w-3.5" />
              {cm.completion?.state === 'complete_fail' ? 'Completed (not passed)' : 'Completed'}
            </span>
          )}
        </div>
      )}

      {/* The server decides availability; the client only explains it. */}
      {cm.availability && !cm.availability.available && (
        <Card className="border-amber-500/40 bg-amber-500/5">
          <CardContent className="flex items-start gap-2 py-3 text-sm">
            <Lock className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
            <div>
              <p className="font-medium">Not available yet</p>
              {cm.availability.reasons.length > 0 && (
                <ul className="mt-1 list-disc pl-4 text-xs text-muted-foreground">
                  {cm.availability.reasons.map((r, i) => <li key={i}>{r}</li>)}
                </ul>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {cm.intro && cm.activityType !== 'label' && cm.activityType !== 'page' && (
        <Card><CardContent className="py-4">
          <SafeHtml className="prose prose-sm dark:prose-invert max-w-none" html={cm.intro} />
        </CardContent></Card>
      )}

      <Body view={view} run={run} busy={busy} />
    </div>
  );
}
