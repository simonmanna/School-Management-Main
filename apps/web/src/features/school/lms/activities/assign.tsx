import { useState } from 'react';
import { AlertTriangle, CheckCircle2, Clock, Send } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { SafeHtml } from '@/components/ui/safe-html';
import { can, CAP } from '../types';
import { FileList, FileUpload, type LmsFileRef } from '../file-upload';
import type { ActivityUiPlugin, ActivityViewProps } from './shared';
import { formatDue, iconFor } from './shared';
import { Empty } from './content';

/**
 * mod_assign — the homework activity.
 *
 * The grade shown here comes from the envelope, which only carries an APPROVED
 * mark; an entered-but-unmoderated score is deliberately withheld. So "not
 * released yet" and "scored zero" must stay visually distinct.
 */
function AssignStudent({ view, run, busy }: ActivityViewProps) {
  const inst = view.body?.instance ?? {};
  const submission = view.body?.submission ?? null;
  const [text, setText] = useState<string>(submission?.content ?? '');
  const [files, setFiles] = useState<LmsFileRef[]>([]);
  const grade = view.module.grade;
  const due = formatDue(view.module.dueAt);
  const overdue = view.module.dueAt && !submission && new Date(view.module.dueAt) < new Date();
  // The SERVER decides whether submission is still open and re-checks on submit;
  // this only mirrors its answer so the form can be disabled early.
  const locked = view.body?.canSubmit === false;
  const types: string[] = inst.submissionTypes ?? ['online_text', 'file'];
  const acceptsFiles = types.includes('file');
  const acceptsText = types.includes('online_text');
  const attemptsUsed: number = view.body?.attemptsUsed ?? 0;
  const maxAttempts: number = view.body?.maxAttempts ?? 1;
  const exhausted = maxAttempts > 0 && attemptsUsed >= maxAttempts && submission?.status !== 'draft';
  const maySubmit =
    can(view.capabilities, CAP.assignSubmit) && view.viewingAs.kind === 'student' && !exhausted;

  return (
    <div className="space-y-4">
      {inst.intro && (
        <Card><CardContent className="py-5">
          <SafeHtml className="prose prose-sm dark:prose-invert max-w-none" html={inst.intro} />
        </CardContent></Card>
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between py-3">
          <CardTitle className="text-base">Your submission</CardTitle>
          {due && (
            <span className={`flex items-center gap-1 text-xs ${overdue ? 'text-destructive' : 'text-muted-foreground'}`}>
              {overdue ? <AlertTriangle className="h-3.5 w-3.5" /> : <Clock className="h-3.5 w-3.5" />}
              {overdue ? `Overdue — was due ${due}` : `Due ${due}`}
            </span>
          )}
        </CardHeader>
        <CardContent className="space-y-3">
          {submission ? (
            <div className="space-y-2 rounded-md border bg-muted/30 p-3">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                <span className="text-sm font-medium">Submitted</span>
                <Badge variant="outline" className="text-[10px]">{submission.status}</Badge>
              </div>
              {submission.content && <p className="whitespace-pre-wrap text-sm">{submission.content}</p>}
              {submission.files?.length > 0 && <FileList files={submission.files} />}
              {submission.feedback && (
                <div className="rounded border-l-2 border-primary bg-background p-2">
                  <p className="text-xs font-medium text-muted-foreground">Teacher feedback</p>
                  <SafeHtml className="prose prose-sm dark:prose-invert max-w-none" html={submission.feedback} />
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">You have not submitted this yet.</p>
          )}

          {maySubmit && !locked && (
            <div className="space-y-3">
              {acceptsText && (
                <div className="space-y-1">
                  <Label className="text-xs">{submission ? 'Update your answer' : 'Your answer'}</Label>
                  <Textarea rows={5} value={text} onChange={(e) => setText(e.target.value)} placeholder="Type your work here…" />
                </div>
              )}
              {acceptsFiles && (
                <div className="space-y-1">
                  <Label className="text-xs">Attachments</Label>
                  <FileUpload onUploaded={setFiles} disabled={busy} max={inst.maxAttachments ?? 5} />
                </div>
              )}
              <Button
                size="sm"
                disabled={busy || (!text.trim() && files.length === 0)}
                onClick={() => run('submit', { content: text, attachments: files.map((f) => f.id) })}
              >
                <Send className="mr-1 h-4 w-4" />{submission ? 'Resubmit' : 'Submit'}
              </Button>
              {maxAttempts > 0 && (
                <p className="text-xs text-muted-foreground">
                  Attempt {Math.min(attemptsUsed + 1, maxAttempts)} of {maxAttempts}
                </p>
              )}
            </div>
          )}
          {locked && <p className="text-xs text-destructive">Submissions have closed for this assignment.</p>}
          {exhausted && !locked && (
            <p className="text-xs text-muted-foreground">You have used all {maxAttempts} attempt(s).</p>
          )}
        </CardContent>
      </Card>

      {grade && <GradePanel grade={grade} />}
    </div>
  );
}

/** Shared grade block — the same rules apply wherever a mark is shown. */
export function GradePanel({ grade }: { grade: NonNullable<ActivityViewProps['view']['module']['grade']> }) {
  return (
    <Card>
      <CardHeader className="py-3"><CardTitle className="text-base">Grade</CardTitle></CardHeader>
      <CardContent>
        {grade.released && grade.score != null ? (
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-semibold tabular-nums">{grade.score}</span>
            <span className="text-sm text-muted-foreground">/ {grade.maxScore}</span>
            {grade.percentage != null && (
              <Badge variant="secondary" className="ml-2">{grade.percentage}%</Badge>
            )}
          </div>
        ) : (
          // Never render an unreleased mark as a blank or a zero — a pupil reads
          // that as "I scored nothing" when the mark is simply not out yet.
          <p className="text-sm text-muted-foreground">
            Not released yet{grade.maxScore ? ` — marked out of ${grade.maxScore}` : ''}.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function AssignTeacher({ view }: ActivityViewProps) {
  const inst = view.body?.instance ?? {};
  const submissions: any[] = view.body?.submissions ?? [];
  const graded = submissions.filter((s) => s.status === 'graded').length;
  return (
    <div className="space-y-4">
      {inst.intro && (
        <Card><CardContent className="py-5">
          <SafeHtml className="prose prose-sm dark:prose-invert max-w-none" html={inst.intro} />
        </CardContent></Card>
      )}
      <Card>
        <CardHeader className="py-3">
          <CardTitle className="text-base">
            Submissions <span className="ml-2 text-sm font-normal text-muted-foreground">{graded} of {submissions.length} marked</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {submissions.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Nothing submitted yet.</p>
          ) : (
            <ul className="divide-y rounded-md border">
              {submissions.map((s) => (
                <li key={s.id} className="space-y-2 p-3 text-sm">
                  <div className="flex items-center gap-3">
                    {/* Blind marking blanks the name until the mark is in; the
                        server withholds it, so there is nothing to leak here. */}
                    <span className="flex-1 truncate">{s.studentName ?? 'Hidden (blind marking)'}</span>
                    <Badge variant={s.status === 'graded' ? 'secondary' : 'outline'} className="text-[10px]">{s.status}</Badge>
                    <span className="text-xs text-muted-foreground">
                      {s.submittedAt ? new Date(s.submittedAt).toLocaleDateString() : '—'}
                    </span>
                  </div>
                  {s.content && <p className="whitespace-pre-wrap rounded bg-muted/40 p-2 text-xs">{s.content}</p>}
                  {s.files?.length > 0 && <FileList files={s.files} />}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function WorkshopView({ view }: ActivityViewProps) {
  const inst = view.body?.instance ?? {};
  return (
    <Card>
      <CardHeader className="py-3"><CardTitle className="text-base">Peer assessment</CardTitle></CardHeader>
      <CardContent className="space-y-2 text-sm">
        <p>Phase: <Badge variant="outline">{inst.phase ?? 'setup'}</Badge></p>
        <p className="text-muted-foreground">
          {inst.numReviewers ?? 0} reviewer(s) per submission.
        </p>
        {!inst.phase && <Empty>This workshop has not been set up yet.</Empty>}
      </CardContent>
    </Card>
  );
}

export const SUBMISSION_PLUGINS: ActivityUiPlugin[] = [
  { type: 'assign', label: 'Assignment', icon: iconFor('assign'), StudentView: AssignStudent, TeacherView: AssignTeacher },
  { type: 'workshop', label: 'Workshop', icon: iconFor('workshop'), StudentView: WorkshopView, TeacherView: WorkshopView },
];
