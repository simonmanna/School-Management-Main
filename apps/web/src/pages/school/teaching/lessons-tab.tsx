import { useState } from 'react';
import { CalendarRange, CheckCircle2, ChevronLeft, ChevronRight, Link2, Loader2, NotebookPen, Paperclip, Plus } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { notify } from '@/lib/notify';
import {
  useAddLessonEvidence, useCourseLearners, useCreateFollowUp, useDeliverLesson, useFollowUps,
  useGenerateTeachingWeek, useReflectOnLesson, useTeachingWeek, useUpdateFollowUp,
  useUpdateScheduledLesson, type ScheduledLesson,
} from '@/features/school/teaching-api';
import { EmptyState, fmtDate, selectClass } from '../_components/exam-workflow';

const DAY_MS = 24 * 60 * 60 * 1000;
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const mondayOf = (date: Date) => {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d;
};

/**
 * The Lessons tab — one week at a time.
 *
 * Delivery is confirmed here, not inferred: a lesson that was scheduled stays
 * outstanding until the teacher says what happened. Reflection, evidence and
 * remedial follow-up hang off that confirmation, so the whole week closes on
 * one screen.
 */
export function LessonsTab({ offeringId }: { offeringId: string }) {
  const [weekStart, setWeekStart] = useState(() => mondayOf(new Date()).toISOString());
  const { data: week, isLoading } = useTeachingWeek(offeringId, weekStart);
  const generate = useGenerateTeachingWeek(offeringId);

  const shift = (weeks: number) => setWeekStart(new Date(new Date(weekStart).getTime() + weeks * 7 * DAY_MS).toISOString());

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => shift(-1)}><ChevronLeft className="h-4 w-4" /></Button>
          <div className="text-sm font-medium">
            {week ? `${fmtDate(week.weekStart)} – ${fmtDate(week.weekEnd)}` : fmtDate(weekStart)}
          </div>
          <Button size="sm" variant="outline" onClick={() => shift(1)}><ChevronRight className="h-4 w-4" /></Button>
          <Button size="sm" variant="ghost" onClick={() => setWeekStart(mondayOf(new Date()).toISOString())}>This week</Button>
        </div>
        <div className="flex items-center gap-3">
          {week && (
            <span className="text-sm text-muted-foreground">
              {week.stats.delivered}/{week.stats.scheduled} delivered
              {week.stats.cancelled > 0 ? ` · ${week.stats.cancelled} cancelled` : ''}
            </span>
          )}
          <Button
            size="sm"
            disabled={generate.isPending}
            onClick={() =>
              generate.mutate(
                { courseOfferingId: offeringId, weekStart },
                {
                  onSuccess: (r) => notify.success(`Week ready`, `${r.created} lesson(s) created, ${r.existing} already there.`),
                  onError: (e: any) => notify.error(e?.response?.data?.message ?? 'Could not generate the week'),
                },
              )
            }
          >
            {generate.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CalendarRange className="mr-2 h-4 w-4" />}
            Generate from timetable
          </Button>
        </div>
      </div>

      {week?.schemeWeek && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Scheme week {week.schemeWeek.weekNumber}{week.schemeWeek.theme ? ` — ${week.schemeWeek.theme}` : ''}</CardTitle>
          </CardHeader>
          <CardContent>
            {week.schemeWeek.items.length === 0 ? (
              <p className="text-sm text-muted-foreground">No content planned for this week.</p>
            ) : (
              <ul className="list-inside list-disc text-sm text-muted-foreground">
                {week.schemeWeek.items.map((item) => (
                  <li key={item.id}>{item.title}{item.learningOutcome ? ` — ${item.learningOutcome.title}` : ''}</li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}

      {isLoading && <p className="text-sm text-muted-foreground">Loading the week…</p>}

      {week && week.lessons.length === 0 && !isLoading && (
        <EmptyState
          title="No lessons in this week yet"
          hint="Generate them from the timetable, then confirm each one as it is taught."
        />
      )}

      <div className="space-y-3">
        {week?.lessons.map((lesson) => (
          <LessonCard key={lesson.id} offeringId={offeringId} lesson={lesson} plans={week.plans} />
        ))}
      </div>

      <FollowUpPanel offeringId={offeringId} />
    </div>
  );
}

function LessonCard({ offeringId, lesson, plans }: { offeringId: string; lesson: ScheduledLesson; plans: Array<{ id: string; title: string }> }) {
  const attach = useUpdateScheduledLesson(offeringId);
  const deliver = useDeliverLesson(offeringId);
  const reflect = useReflectOnLesson(offeringId);
  const addEvidence = useAddLessonEvidence(offeringId);
  const [open, setOpen] = useState(false);
  const [covered, setCovered] = useState(lesson.delivery?.coveredContent ?? '');
  const [variance, setVariance] = useState(lesson.delivery?.varianceReason ?? '');
  const [attendanceDate, setAttendanceDate] = useState(
    (lesson.delivery?.attendanceDate ?? lesson.plannedDate).slice(0, 10),
  );
  const [evidenceNote, setEvidenceNote] = useState('');

  const delivered = lesson.delivery?.status === 'delivered' || lesson.delivery?.status === 'partially_delivered';
  const day = DAYS[(new Date(lesson.plannedDate).getUTCDay() + 6) % 7];

  const record = (status: 'delivered' | 'partially_delivered' | 'cancelled') =>
    deliver.mutate(
      { id: lesson.id, status, coveredContent: covered || undefined, varianceReason: variance || undefined, attendanceDate: new Date(attendanceDate).toISOString() },
      {
        onSuccess: () => notify.success(status === 'cancelled' ? 'Lesson cancelled' : 'Delivery recorded'),
        onError: (e: any) => notify.error(e?.response?.data?.message ?? 'Could not record the lesson'),
      },
    );

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <button className="text-left" onClick={() => setOpen((v) => !v)}>
            <CardTitle className="text-base">{day} · {fmtDate(lesson.plannedDate)}</CardTitle>
            <p className="text-xs text-muted-foreground">
              {lesson.lessonPlan ? lesson.lessonPlan.title : 'No lesson plan attached'}
              {lesson.room ? ` · ${lesson.room}` : ''}
            </p>
          </button>
          <div className="flex items-center gap-2">
            {lesson.delivery?.reflectedAt && <Badge variant="outline" className="gap-1"><NotebookPen className="h-3 w-3" /> Reflected</Badge>}
            {lesson.delivery?.evidence?.length ? <Badge variant="outline" className="gap-1"><Paperclip className="h-3 w-3" /> {lesson.delivery.evidence.length}</Badge> : null}
            <Badge variant={delivered ? 'default' : lesson.status === 'cancelled' ? 'destructive' : 'secondary'}>
              {delivered ? (lesson.delivery?.status === 'partially_delivered' ? 'Partly delivered' : 'Delivered') : lesson.status}
            </Badge>
            <Button size="sm" variant="ghost" onClick={() => setOpen((v) => !v)}>{open ? 'Close' : 'Open'}</Button>
          </div>
        </div>
      </CardHeader>

      {open && (
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label className="text-xs">Lesson plan</Label>
              <select
                className={selectClass}
                value={lesson.lessonPlanId ?? ''}
                onChange={(e) => attach.mutate({ id: lesson.id, lessonPlanId: e.target.value || undefined })}
              >
                <option value="">No plan</option>
                {plans.map((p) => (
                  <option key={p.id} value={p.id}>{p.title}</option>
                ))}
              </select>
            </div>
            <div>
              <Label className="text-xs">Attendance register</Label>
              <Input type="date" value={attendanceDate} onChange={(e) => setAttendanceDate(e.target.value)} />
              {lesson.delivery?.attendanceMarked && (
                <p className="mt-1 text-xs text-muted-foreground">
                  {lesson.delivery.presentCount} present · {lesson.delivery.absentCount} absent (from the register)
                </p>
              )}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label className="text-xs">What was covered</Label>
              <Textarea rows={2} value={covered} onChange={(e) => setCovered(e.target.value)} placeholder="Topics actually taught" />
            </div>
            <div>
              <Label className="text-xs">If it differed from the plan, why</Label>
              <Textarea rows={2} value={variance} onChange={(e) => setVariance(e.target.value)} placeholder="Required when only part of the lesson was delivered" />
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={deliver.isPending} onClick={() => record('delivered')}>
              <CheckCircle2 className="mr-1 h-4 w-4" /> Confirm delivered
            </Button>
            <Button size="sm" variant="outline" disabled={deliver.isPending} onClick={() => record('partially_delivered')}>
              Partly delivered
            </Button>
            <Button size="sm" variant="ghost" className="text-destructive" disabled={deliver.isPending} onClick={() => record('cancelled')}>
              Cancel lesson
            </Button>
          </div>

          {delivered && (
            <>
              <ReflectionBlock lesson={lesson} onSave={(dto) => reflect.mutate({ id: lesson.id, ...dto }, { onSuccess: () => notify.success('Reflection saved') })} />

              <div className="space-y-2 rounded-md border p-3">
                <Label className="text-xs">Evidence from this lesson</Label>
                {lesson.delivery?.evidence?.length ? (
                  <ul className="space-y-1 text-sm">
                    {lesson.delivery.evidence.map((e) => (
                      <li key={e.id} className="flex items-center gap-2 text-muted-foreground">
                        <Link2 className="h-3 w-3" /> {e.kind}: {e.note ?? e.url ?? e.assessmentId}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted-foreground">Nothing attached yet.</p>
                )}
                <div className="flex gap-2">
                  <Input value={evidenceNote} onChange={(e) => setEvidenceNote(e.target.value)} placeholder="Note, observation or link" />
                  <Button
                    size="sm"
                    disabled={!evidenceNote.trim()}
                    onClick={() =>
                      addEvidence.mutate(
                        { id: lesson.id, kind: evidenceNote.startsWith('http') ? 'LINK' : 'NOTE', ...(evidenceNote.startsWith('http') ? { url: evidenceNote } : { note: evidenceNote }) },
                        { onSuccess: () => { setEvidenceNote(''); notify.success('Evidence attached'); } },
                      )
                    }
                  >
                    <Plus className="mr-1 h-3.5 w-3.5" /> Attach
                  </Button>
                </div>
              </div>

              <NewFollowUp offeringId={offeringId} lessonDeliveryId={lesson.delivery!.id} />
            </>
          )}
        </CardContent>
      )}
    </Card>
  );
}

function ReflectionBlock({ lesson, onSave }: { lesson: ScheduledLesson; onSave: (dto: { whatWorked?: string; whatDidntWork?: string; studentsNeedingSupport?: string; followUpNote?: string }) => void }) {
  const [worked, setWorked] = useState(lesson.delivery?.whatWorked ?? '');
  const [didnt, setDidnt] = useState(lesson.delivery?.whatDidntWork ?? '');
  const [support, setSupport] = useState(lesson.delivery?.studentsNeedingSupport ?? '');

  return (
    <div className="space-y-2 rounded-md border p-3">
      <Label className="text-xs">Reflection</Label>
      <div className="grid gap-3 sm:grid-cols-3">
        <Textarea rows={2} value={worked} onChange={(e) => setWorked(e.target.value)} placeholder="What worked" />
        <Textarea rows={2} value={didnt} onChange={(e) => setDidnt(e.target.value)} placeholder="What did not" />
        <Textarea rows={2} value={support} onChange={(e) => setSupport(e.target.value)} placeholder="Learners needing support" />
      </div>
      <Button size="sm" variant="outline" onClick={() => onSave({ whatWorked: worked, whatDidntWork: didnt, studentsNeedingSupport: support })}>
        Save reflection
      </Button>
    </div>
  );
}

function NewFollowUp({ offeringId, lessonDeliveryId }: { offeringId: string; lessonDeliveryId: string }) {
  const create = useCreateFollowUp(offeringId);
  const { data: learners = [] } = useCourseLearners(offeringId);
  const [action, setAction] = useState('');
  const [studentProfileId, setStudentProfileId] = useState('');

  return (
    <div className="flex flex-wrap items-end gap-2 rounded-md border border-dashed p-3">
      <div className="min-w-[200px] flex-1">
        <Label className="text-xs">Remedial follow-up</Label>
        <Input value={action} onChange={(e) => setAction(e.target.value)} placeholder="e.g. Re-teach place value in a small group" />
      </div>
      <div className="min-w-[180px]">
        <Label className="text-xs">Learner (optional)</Label>
        <select className={selectClass} value={studentProfileId} onChange={(e) => setStudentProfileId(e.target.value)}>
          <option value="">Whole class</option>
          {learners.map((l) => (
            <option key={l.studentProfileId} value={l.studentProfileId}>{l.name}</option>
          ))}
        </select>
      </div>
      <Button
        size="sm"
        disabled={!action.trim()}
        onClick={() =>
          create.mutate(
            { courseOfferingId: offeringId, action: action.trim(), lessonDeliveryId, studentProfileId: studentProfileId || undefined },
            { onSuccess: () => { setAction(''); setStudentProfileId(''); notify.success('Follow-up raised'); }, onError: (e: any) => notify.error(e?.response?.data?.message ?? 'Could not raise the follow-up') },
          )
        }
      >
        Raise
      </Button>
    </div>
  );
}

/** Everything the course still owes, from any week. */
function FollowUpPanel({ offeringId }: { offeringId: string }) {
  const { data: followUps = [] } = useFollowUps({ courseOfferingId: offeringId });
  const update = useUpdateFollowUp(offeringId);
  const open = followUps.filter((f) => f.status === 'open' || f.status === 'in_progress');

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Follow-up ({open.length} open)</CardTitle>
      </CardHeader>
      <CardContent className="space-y-1.5">
        {followUps.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing outstanding.</p>
        ) : (
          followUps.map((f) => (
            <div key={f.id} className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
              <div className="min-w-0">
                <div className="truncate">{f.action}</div>
                <div className="text-xs text-muted-foreground">
                  {f.status}{f.dueDate ? ` · due ${fmtDate(f.dueDate)}` : ''}
                </div>
              </div>
              {f.status !== 'done' && f.status !== 'cancelled' && (
                <Button size="sm" variant="outline" onClick={() => update.mutate({ id: f.id, status: 'done' }, { onSuccess: () => notify.success('Follow-up closed') })}>
                  Done
                </Button>
              )}
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
