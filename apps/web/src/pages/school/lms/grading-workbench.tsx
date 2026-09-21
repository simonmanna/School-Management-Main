import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft, CheckCircle2, ChevronLeft, ChevronRight, Clock, FileText, Save,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { SafeHtml } from '@/components/ui/safe-html';
import { useLmsModuleAction, useLmsModuleView } from '@/features/school/api';
import { FileList } from '@/features/school/lms/file-upload';
import { can, CAP } from '@/features/school/lms/types';
import { notify } from '@/lib/notify';

type Filter = 'all' | 'ungraded' | 'graded';

interface Submission {
  id: string;
  studentProfileId: string;
  studentName: string | null;
  admissionNo: string | null;
  status: string;
  content: string | null;
  feedback: string | null;
  submittedAt: string | null;
  gradedAt: string | null;
  files?: { id: string; filename: string; contentType: string; byteSize: number }[];
}

/**
 * The marking workbench (Moodle's grading interface).
 *
 * The teacher view of an assignment previously listed submissions with no way to
 * enter a mark at all — marking meant leaving for the gradebook and matching
 * pupils by eye. Here the work, the score and the feedback are on one screen, and
 * the queue advances to the next unmarked pupil on save.
 *
 * The mark goes through the plugin's `grade` verb, which writes via the grade
 * bridge to `MarkingService`. This screen never writes a score itself.
 */
export function SchoolLmsGradingWorkbenchPage() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const { data, isLoading, refetch } = useLmsModuleView(id);
  const run = useLmsModuleAction();

  const [filter, setFilter] = useState<Filter>('ungraded');
  const [cursor, setCursor] = useState(0);
  const [score, setScore] = useState('');
  const [feedback, setFeedback] = useState('');

  const view: any = data;
  const instance = view?.body?.instance ?? {};
  const all: Submission[] = view?.body?.submissions ?? [];
  const maxScore = Number(instance.maxScore ?? view?.module?.grade?.maxScore ?? 100);
  const mayGrade = can(view?.capabilities, CAP.assignGrade);

  const queue = useMemo(() => {
    if (filter === 'ungraded') return all.filter((s) => s.status !== 'graded');
    if (filter === 'graded') return all.filter((s) => s.status === 'graded');
    return all;
  }, [all, filter]);

  const current = queue[Math.min(cursor, Math.max(queue.length - 1, 0))] ?? null;

  // Load the selected pupil's existing feedback into the form. Score is left blank
  // rather than pre-filled: the mark lives on the assessment spine, not on the
  // submission, so a stale number here would look authoritative and be wrong.
  useEffect(() => {
    setScore('');
    setFeedback(current?.feedback ?? '');
  }, [current?.id]);

  useEffect(() => { setCursor(0); }, [filter]);

  const numeric = Number(score);
  const valid = score.trim() !== '' && !Number.isNaN(numeric) && numeric >= 0 && numeric <= maxScore;
  const gradedCount = all.filter((s) => s.status === 'graded').length;

  async function save(advance: boolean) {
    if (!current || !valid) return;
    try {
      await run.mutateAsync({
        id,
        action: 'grade',
        studentProfileId: current.studentProfileId,
        score: numeric,
        feedback: feedback.trim() || undefined,
      });
      notify.success(`Marked ${current.studentName ?? 'submission'}`);
      await refetch();
      if (advance) {
        // On the "ungraded" queue the marked pupil drops out, so the same index is
        // already the next one; elsewhere step forward explicitly.
        setCursor((c) => (filter === 'ungraded' ? Math.min(c, Math.max(queue.length - 2, 0)) : Math.min(c + 1, queue.length - 1)));
      }
    } catch (e: any) {
      notify.error(e?.response?.data?.message ?? 'Could not save the mark');
    }
  }

  if (isLoading) return <p className="p-4 text-sm text-muted-foreground">Loading submissions…</p>;

  if (!mayGrade) {
    return (
      <Card className="m-4"><CardContent className="py-10 text-center text-sm text-muted-foreground">
        You do not have permission to mark this activity.
      </CardContent></Card>
    );
  }

  return (
    <div className="space-y-4 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" size="icon" onClick={() => nav(`/school/lms/modules/${id}`)}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-xl font-semibold">Marking — {view?.module?.name ?? 'Activity'}</h1>
          <p className="text-sm text-muted-foreground">
            {view?.course?.name} · {gradedCount} of {all.length} marked
          </p>
        </div>
        <div className="flex gap-1">
          {(['ungraded', 'graded', 'all'] as Filter[]).map((f) => (
            <Button
              key={f}
              size="sm"
              variant={filter === f ? 'default' : 'outline'}
              onClick={() => setFilter(f)}
            >
              {f === 'ungraded' ? 'To mark' : f === 'graded' ? 'Marked' : 'All'}
              <Badge variant="secondary" className="ml-1 text-[10px] tabular-nums">
                {f === 'ungraded' ? all.length - gradedCount : f === 'graded' ? gradedCount : all.length}
              </Badge>
            </Button>
          ))}
        </div>
      </div>

      {queue.length === 0 && (
        <Card><CardContent className="py-12 text-center text-sm text-muted-foreground">
          {all.length === 0
            ? 'Nothing has been submitted yet.'
            : filter === 'ungraded'
              ? 'Everything submitted has been marked.'
              : 'No submissions in this view.'}
        </CardContent></Card>
      )}

      {current && (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="space-y-3">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between py-3">
                <div className="min-w-0">
                  <CardTitle className="truncate text-base">
                    {/* Blind marking withholds the name server-side until the mark
                        is in; there is nothing to reveal here. */}
                    {current.studentName ?? 'Hidden (blind marking)'}
                  </CardTitle>
                  {current.admissionNo && (
                    <p className="text-xs text-muted-foreground">{current.admissionNo}</p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={current.status === 'graded' ? 'secondary' : 'outline'}>{current.status}</Badge>
                  {current.submittedAt && (
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Clock className="h-3 w-3" />
                      {new Date(current.submittedAt).toLocaleString()}
                    </span>
                  )}
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {current.content ? (
                  <div className="whitespace-pre-wrap rounded-md border bg-muted/30 p-3 text-sm">
                    {current.content}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">No typed answer.</p>
                )}
                {current.files && current.files.length > 0 ? (
                  <div className="space-y-1">
                    <Label className="text-xs">Attachments</Label>
                    <FileList files={current.files} />
                  </div>
                ) : (
                  <p className="flex items-center gap-1 text-xs text-muted-foreground">
                    <FileText className="h-3 w-3" />No attachments
                  </p>
                )}
              </CardContent>
            </Card>

            {instance.intro && (
              <Card>
                <CardHeader className="py-3"><CardTitle className="text-base">Task</CardTitle></CardHeader>
                <CardContent>
                  <SafeHtml className="prose prose-sm dark:prose-invert max-w-none" html={instance.intro} />
                </CardContent>
              </Card>
            )}
          </div>

          <div className="space-y-3">
            <Card className="lg:sticky lg:top-4">
              <CardHeader className="py-3"><CardTitle className="text-base">Mark</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <div className="space-y-1">
                  <Label className="text-xs">Score (out of {maxScore})</Label>
                  <Input
                    type="number"
                    min={0}
                    max={maxScore}
                    value={score}
                    autoFocus
                    onChange={(e) => setScore(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && valid) void save(true); }}
                  />
                  {score.trim() !== '' && !valid && (
                    <p className="text-xs text-destructive">Enter a number between 0 and {maxScore}.</p>
                  )}
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Feedback</Label>
                  <Textarea
                    rows={6}
                    value={feedback}
                    onChange={(e) => setFeedback(e.target.value)}
                    placeholder="What went well, what to do next…"
                  />
                </div>
                <div className="flex gap-2">
                  <Button className="flex-1" disabled={!valid || run.isPending} onClick={() => save(true)}>
                    <Save className="mr-1 h-4 w-4" />Save and next
                  </Button>
                  <Button variant="outline" disabled={!valid || run.isPending} onClick={() => save(false)}>
                    Save
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  The mark is written to the assessment spine and still follows the normal
                  moderation and release rules before a pupil sees it.
                </p>
              </CardContent>
            </Card>

            <div className="flex items-center justify-between gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={cursor <= 0}
                onClick={() => setCursor((c) => Math.max(0, c - 1))}
              >
                <ChevronLeft className="mr-1 h-4 w-4" />Previous
              </Button>
              <span className="text-xs tabular-nums text-muted-foreground">
                {Math.min(cursor + 1, queue.length)} of {queue.length}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={cursor >= queue.length - 1}
                onClick={() => setCursor((c) => Math.min(queue.length - 1, c + 1))}
              >
                Next<ChevronRight className="ml-1 h-4 w-4" />
              </Button>
            </div>

            <Card>
              <CardContent className="max-h-72 overflow-y-auto p-0">
                <ul className="divide-y text-sm">
                  {queue.map((s, i) => (
                    <li key={s.id}>
                      <button
                        type="button"
                        onClick={() => setCursor(i)}
                        className={`flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-muted/50 ${
                          i === cursor ? 'bg-primary/10' : ''
                        }`}
                      >
                        <span className="min-w-0 flex-1 truncate">{s.studentName ?? 'Hidden'}</span>
                        {s.status === 'graded' && <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />}
                      </button>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
