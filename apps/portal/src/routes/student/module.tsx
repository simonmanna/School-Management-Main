import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import {
  AlertTriangle, ArrowLeft, CheckCircle2, Circle, Clock, Download, ExternalLink, Lock, Send, Upload,
} from 'lucide-react';
import { useAuthStore, useActiveStudent } from '@/stores/auth.store';
import {
  useModuleView, useModuleAction, useSetCompletion,
  downloadLmsFile, uploadFile, formatBytes, type LmsFileRef,
} from '@/lib/portal-api';
import { apiErrorMessage } from '@/lib/api';
import { can, CAP, describeGrade, type ModuleViewEnvelope } from '@/lib/lms-types';
import { Button, Card, CardContent, Skeleton, Empty, Badge } from '@/components/ui';
import { SafeHtml } from '@/components/safe-html';
import { coursePath, quizPath } from '@/lib/learner-paths';
import { activityIcon, activityLabel, formatDue } from './_activity';

/**
 * One activity, as a learner.
 *
 * Chrome once, body by activity type. The admin app does this with a plugin
 * registry of eighteen components; a pupil meets a much smaller set, so this
 * renders the content and hand-in types directly and falls back to the intro
 * text for anything else rather than pretending to support it.
 *
 * Everything that decides what may happen is server-side: `canSubmit`,
 * `availability`, attempt counts and the grade all arrive resolved, and the
 * server re-checks on submit. This screen mirrors those answers so the form can
 * be disabled early; it never grants anything.
 */
export default function StudentModule() {
  const { cid = '', id = '' } = useParams();
  const kind = useAuthStore((s) => s.portal?.kind);
  const active = useActiveStudent();
  const asStudent = kind === 'guardian' ? active?.studentProfileId : undefined;
  const nav = useNavigate();

  const { data, isLoading, isError, error, refetch } = useModuleView(id, asStudent);
  const action = useModuleAction();
  const setCompletion = useSetCompletion();
  const [busy, setBusy] = useState(false);

  const backTo = coursePath(kind, cid);

  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-40" />
      </div>
    );
  }

  if (isError || !data?.module) {
    const status = (error as any)?.response?.status;
    return (
      <div className="space-y-3">
        <Back to={backTo} />
        <Empty
          title={
            status === 403
              ? 'This activity is not open to you'
              : status === 404
                ? 'This activity no longer exists'
                : 'This activity could not be loaded'
          }
        />
        {!status && (
          <button className="text-sm text-primary underline" onClick={() => void refetch()}>
            Try again
          </button>
        )}
      </div>
    );
  }

  const view = data as ModuleViewEnvelope;
  const cm = view.module;
  const Icon = activityIcon(cm.activityType);
  const due = formatDue(cm.dueAt);
  const done = Boolean(cm.completion && cm.completion.state !== 'incomplete');
  const blocked = Boolean(cm.availability && !cm.availability.available);
  // A guardian may read their child's course; they may not do the work in it.
  const isLearner = view.viewingAs.kind === 'student';
  const mayTick = cm.completion?.mode === 'manual' && isLearner;

  const run = async (verb: string, body?: Record<string, unknown>) => {
    setBusy(true);
    try {
      await action.mutateAsync({ moduleId: id, action: verb, body, asStudent });
      await refetch();
      toast.success('Sent to your teacher');
    } catch (e) {
      toast.error(apiErrorMessage(e, 'That did not go through'));
    } finally {
      setBusy(false);
    }
  };

  const tick = async () => {
    setBusy(true);
    try {
      await setCompletion.mutateAsync({ moduleId: id, state: done ? 'incomplete' : 'complete' });
      await refetch();
    } catch (e) {
      toast.error(apiErrorMessage(e, 'Could not update that'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <Back to={backTo} />

      <div className="flex items-start gap-3">
        <Icon className="mt-0.5 h-6 w-6 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-bold leading-tight">{cm.name}</h1>
          <p className="pt-0.5 text-sm text-muted-foreground">
            {activityLabel(cm.activityType)} · {view.course.name}
          </p>
        </div>
      </div>

      {due && (
        <p className="flex items-center gap-1.5 text-sm">
          <Clock className="h-4 w-4 text-muted-foreground" />
          <span className="text-muted-foreground">Due {due}</span>
        </p>
      )}

      {blocked ? (
        <Card>
          <CardContent className="space-y-1 py-6 text-center">
            <Lock className="mx-auto h-7 w-7 text-muted-foreground" />
            <p className="font-medium">Not open yet</p>
            {cm.availability!.reasons.length > 0 && (
              <p className="text-sm text-muted-foreground">{cm.availability!.reasons.join(' · ')}</p>
            )}
          </CardContent>
        </Card>
      ) : (
        <>
          <Body view={view} busy={busy} run={run} courseId={cid} isLearner={isLearner} nav={nav} />
          <GradeCard view={view} />
          {mayTick && (
            <Button variant={done ? 'outline' : 'secondary'} className="w-full" disabled={busy} onClick={tick}>
              {done ? (
                <>
                  <CheckCircle2 className="h-4 w-4 text-[hsl(var(--success))]" />
                  Done — tap to undo
                </>
              ) : (
                <>
                  <Circle className="h-4 w-4" />
                  Mark as done
                </>
              )}
            </Button>
          )}
        </>
      )}
    </div>
  );
}

function Back({ to }: { to: string }) {
  return (
    <Link to={to} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
      <ArrowLeft className="h-4 w-4" />
      Back to the course
    </Link>
  );
}

interface BodyProps {
  view: ModuleViewEnvelope;
  busy: boolean;
  run: (verb: string, body?: Record<string, unknown>) => Promise<void>;
  courseId: string;
  isLearner: boolean;
  nav: ReturnType<typeof useNavigate>;
}

function Body(props: BodyProps) {
  const { view } = props;
  switch (view.module.activityType) {
    case 'page':
    case 'label':
    case 'lesson':
      return <PageBody view={view} />;
    case 'resource':
      return <ResourceBody view={view} />;
    case 'folder':
      return <FolderBody view={view} />;
    case 'url':
      return <UrlBody view={view} />;
    case 'assign':
      return <AssignBody {...props} />;
    case 'quiz':
      return <QuizBody {...props} />;
    default:
      // Not pretending to render an activity type this app has no screen for.
      // The intro is what the teacher wrote about it, which is better than an
      // empty card or a JSON dump.
      return <IntroOnly view={view} />;
  }
}

function instanceOf(view: ModuleViewEnvelope): any {
  return view.body?.instance ?? view.body ?? {};
}

function Intro({ html }: { html?: string | null }) {
  if (!html) return null;
  return (
    <Card>
      <CardContent>
        <SafeHtml html={html} />
      </CardContent>
    </Card>
  );
}

function IntroOnly({ view }: { view: ModuleViewEnvelope }) {
  const html = instanceOf(view).intro ?? view.module.intro;
  if (!html) {
    return <Empty title="Nothing to show here" hint="Ask your teacher about this activity." />;
  }
  return <Intro html={html} />;
}

function PageBody({ view }: { view: ModuleViewEnvelope }) {
  const inst = instanceOf(view);
  const html = inst.content ?? inst.intro ?? view.module.intro;
  if (!html) return <Empty title="This page has no content yet" />;
  return (
    <Card>
      <CardContent>
        <SafeHtml html={html} />
      </CardContent>
    </Card>
  );
}

function FileRow({ file }: { file: LmsFileRef }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border p-3">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{file.filename}</p>
        {file.byteSize ? <p className="text-xs text-muted-foreground">{formatBytes(file.byteSize)}</p> : null}
      </div>
      <Button
        size="sm"
        variant="outline"
        onClick={() => void downloadLmsFile(file.id, file.filename)}
        aria-label={`Download ${file.filename}`}
      >
        <Download className="h-4 w-4" />
        Open
      </Button>
    </div>
  );
}

function ResourceBody({ view }: { view: ModuleViewEnvelope }) {
  const inst = instanceOf(view);
  const file: LmsFileRef | null = view.body?.file ?? null;
  return (
    <div className="space-y-3">
      <Intro html={inst.intro} />
      {file ? <FileRow file={file} /> : <Empty title="No file has been attached yet" />}
    </div>
  );
}

function FolderBody({ view }: { view: ModuleViewEnvelope }) {
  const inst = instanceOf(view);
  const files: LmsFileRef[] = view.body?.files ?? [];
  return (
    <div className="space-y-3">
      <Intro html={inst.intro} />
      {files.length === 0 ? (
        <Empty title="This folder is empty" />
      ) : (
        <div className="space-y-2">
          {files.map((f) => (
            <FileRow key={f.id} file={f} />
          ))}
        </div>
      )}
    </div>
  );
}

function UrlBody({ view }: { view: ModuleViewEnvelope }) {
  const inst = instanceOf(view);
  const href: string = inst.externalUrl ?? '';
  return (
    <div className="space-y-3">
      <Intro html={inst.intro} />
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 rounded-lg border p-3 text-sm text-primary"
        >
          <ExternalLink className="h-4 w-4 shrink-0" />
          <span className="break-all">{href}</span>
        </a>
      ) : (
        <Empty title="No link has been set" />
      )}
    </div>
  );
}

/** mod_assign — hand work in. */
function AssignBody({ view, busy, run, isLearner }: BodyProps) {
  const inst = instanceOf(view);
  const submission = view.body?.submission ?? null;
  const [text, setText] = useState<string>(submission?.content ?? '');
  const [files, setFiles] = useState<LmsFileRef[]>([]);
  const [uploading, setUploading] = useState(false);

  const types: string[] = inst.submissionTypes ?? ['online_text', 'file'];
  const acceptsText = types.includes('online_text');
  const acceptsFiles = types.includes('file');
  const attemptsUsed: number = view.body?.attemptsUsed ?? 0;
  const maxAttempts: number = view.body?.maxAttempts ?? 1;
  const exhausted = maxAttempts > 0 && attemptsUsed >= maxAttempts && submission?.status !== 'draft';
  // The server owns this answer and re-checks it on submit.
  const closed = view.body?.canSubmit === false;
  const maySubmit = isLearner && can(view.capabilities, CAP.assignSubmit) && !closed && !exhausted;

  const pickFiles = async (picked: FileList | null) => {
    if (!picked?.length) return;
    setUploading(true);
    try {
      const uploaded = await Promise.all(Array.from(picked).map((f) => uploadFile(f)));
      setFiles((prev) => [...prev, ...uploaded]);
    } catch (e) {
      toast.error(apiErrorMessage(e, 'That file would not upload'));
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-3">
      <Intro html={inst.intro ?? view.module.intro} />

      <Card>
        <CardContent className="space-y-3">
          <p className="font-medium">Your work</p>

          {submission ? (
            <div className="space-y-2 rounded-lg border bg-muted/40 p-3">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-[hsl(var(--success))]" />
                <span className="text-sm font-medium">Handed in</span>
                {submission.status && (
                  <Badge variant="outline" className="text-[10px]">
                    {submission.status}
                  </Badge>
                )}
              </div>
              {submission.content && <p className="whitespace-pre-wrap text-sm">{submission.content}</p>}
              {submission.files?.length > 0 && (
                <div className="space-y-2">
                  {submission.files.map((f: LmsFileRef) => (
                    <FileRow key={f.id} file={f} />
                  ))}
                </div>
              )}
              {submission.feedback && (
                <div className="rounded-md border-l-2 border-primary bg-card p-2">
                  <p className="text-xs font-medium text-muted-foreground">What your teacher said</p>
                  <SafeHtml html={submission.feedback} />
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">You have not handed this in yet.</p>
          )}

          {maySubmit && (
            <div className="space-y-3 border-t pt-3">
              {acceptsText && (
                <label className="block space-y-1">
                  <span className="text-sm font-medium">{submission ? 'Change your answer' : 'Your answer'}</span>
                  <textarea
                    rows={6}
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    placeholder="Type your work here…"
                    className="w-full rounded-lg border border-input bg-card p-3 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                </label>
              )}

              {acceptsFiles && (
                <div className="space-y-2">
                  <span className="text-sm font-medium">Attach a file or photo</span>
                  <label className="flex h-12 cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed text-sm text-muted-foreground">
                    <Upload className="h-4 w-4" />
                    {uploading ? 'Uploading…' : 'Choose files'}
                    <input
                      type="file"
                      multiple
                      className="hidden"
                      disabled={uploading || busy}
                      onChange={(e) => void pickFiles(e.target.files)}
                    />
                  </label>
                  {files.map((f) => (
                    <p key={f.id} className="truncate text-xs text-muted-foreground">
                      {f.filename} {f.byteSize ? `· ${formatBytes(f.byteSize)}` : ''}
                    </p>
                  ))}
                </div>
              )}

              <Button
                className="w-full"
                size="lg"
                disabled={busy || uploading || (!text.trim() && files.length === 0)}
                onClick={() => void run('submit', { content: text, attachments: files.map((f) => f.id) })}
              >
                <Send className="h-4 w-4" />
                {submission ? 'Hand in again' : 'Hand in'}
              </Button>

              {maxAttempts > 0 && (
                <p className="text-center text-xs text-muted-foreground">
                  Try {Math.min(attemptsUsed + 1, maxAttempts)} of {maxAttempts}
                </p>
              )}
            </div>
          )}

          {closed && (
            <p className="flex items-center gap-1.5 text-sm text-destructive">
              <AlertTriangle className="h-4 w-4" />
              Hand-in has closed for this work.
            </p>
          )}
          {exhausted && !closed && (
            <p className="text-sm text-muted-foreground">You have used all {maxAttempts} of your tries.</p>
          )}
          {!isLearner && <p className="text-sm text-muted-foreground">You are viewing this as a parent.</p>}
        </CardContent>
      </Card>
    </div>
  );
}

/** mod_quiz — the attempt itself runs in its own screen. */
function QuizBody({ view, isLearner, nav }: BodyProps) {
  const inst = instanceOf(view);
  const attemptsUsed: number = view.body?.attemptsUsed ?? 0;
  const maxAttempts: number = inst.maxAttempts ?? view.body?.maxAttempts ?? 0;
  const paperId: string | undefined = view.body?.paperId;
  const exhausted = maxAttempts > 0 && attemptsUsed >= maxAttempts;
  const mayAttempt = isLearner && can(view.capabilities, CAP.quizAttempt) && !exhausted && !!paperId;

  return (
    <div className="space-y-3">
      <Intro html={inst.intro ?? view.module.intro} />
      <Card>
        <CardContent className="space-y-3">
          <dl className="grid grid-cols-2 gap-3 text-sm">
            {inst.timeLimitSeconds ? (
              <Fact label="Time" value={`${Math.round(inst.timeLimitSeconds / 60)} min`} />
            ) : null}
            {maxAttempts > 0 ? <Fact label="Tries" value={`${attemptsUsed} of ${maxAttempts} used`} /> : null}
            {view.module.grade ? <Fact label="Out of" value={String(view.module.grade.maxScore)} /> : null}
          </dl>

          {mayAttempt ? (
            <Button className="w-full" size="lg" onClick={() => nav(quizPath(view.module.id))}>
              {attemptsUsed > 0 ? 'Try again' : 'Start'}
            </Button>
          ) : exhausted ? (
            <p className="text-sm text-muted-foreground">You have used all {maxAttempts} of your tries.</p>
          ) : !paperId ? (
            <p className="text-sm text-muted-foreground">This quiz has no questions in it yet.</p>
          ) : (
            <p className="text-sm text-muted-foreground">You are viewing this as a parent.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="font-medium tabular-nums">{value}</dd>
    </div>
  );
}

/**
 * The mark.
 *
 * The envelope carries a score only once moderation has approved it, so there
 * are three distinct states and never a bare zero standing in for "waiting".
 */
function GradeCard({ view }: { view: ModuleViewEnvelope }) {
  const g = describeGrade(view.module.grade);
  if (g.kind === 'none') return null;

  if (g.kind === 'withheld') {
    return (
      <Card>
        <CardContent className="py-4">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Your mark</p>
          <p className="pt-0.5 font-medium">Not released yet</p>
          <p className="text-sm text-muted-foreground">
            Your teacher is still checking. It will appear here once it is ready.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="py-4">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">Your mark</p>
        <p className="pt-0.5 text-2xl font-bold tabular-nums">{g.label}</p>
        {g.percent !== null && <p className="text-sm text-muted-foreground">{Math.round(g.percent)}%</p>}
      </CardContent>
    </Card>
  );
}
