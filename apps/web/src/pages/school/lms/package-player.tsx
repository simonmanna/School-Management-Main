import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, CheckCircle2, Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useLmsModuleView } from '@/features/school/api';
import { attachScormApi, attachH5pListener } from '@/features/school/lms/scorm-runtime';
import type { ModuleViewEnvelope } from '@/features/school/lms/types';
import { notify } from '@/lib/notify';

/**
 * Player for packaged content — SCORM and H5P (L8).
 *
 * The package runs in an iframe and talks to the LMS through the run-time API
 * installed on `window` before the frame loads. Ordering matters: a SCORM package
 * looks for `window.parent.API` during its own startup, so the API must exist
 * first or the package reports "LMS not found" and refuses to run.
 */
export function SchoolLmsPackagePlayerPage() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const { data, isLoading, refetch } = useLmsModuleView(id);
  const view = data as ModuleViewEnvelope | undefined;

  const [ready, setReady] = useState(false);
  const [saved, setSaved] = useState<Date | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const frame = useRef<HTMLIFrameElement>(null);

  const type = view?.module.activityType;
  const inst: any = view?.body?.instance ?? view?.body ?? {};
  const tracks: any[] = view?.body?.tracks ?? [];

  // Resume where the pupil left off, and count this as the next attempt only
  // when the last one is finished.
  const { attempt, initialCmi } = useMemo(() => {
    if (tracks.length === 0) return { attempt: 1, initialCmi: {} as Record<string, string> };
    const latest = tracks.reduce((a, b) => (a.attempt > b.attempt ? a : b));
    const done = ['completed', 'passed', 'failed'].includes(String(latest.lessonStatus));
    return {
      attempt: done ? latest.attempt + 1 : latest.attempt,
      initialCmi: done ? {} : ((latest.cmi ?? {}) as Record<string, string>),
    };
  }, [tracks]);

  useEffect(() => {
    if (!view || type !== 'scorm') return;
    const session = attachScormApi({
      courseModuleId: id,
      attempt,
      version: String(inst.scormVersion ?? '1.2') === '2004' ? '2004' : '1.2',
      initialCmi,
      onCommit: () => { setSaved(new Date()); setFailed(null); void refetch(); },
      onError: (m) => { setFailed(m); notify.error(m); },
    });
    setReady(true);
    return () => session.detach();
  }, [view, type, id, attempt, inst.scormVersion, initialCmi, refetch]);

  useEffect(() => {
    if (!view || type !== 'h5p') return;
    setReady(true);
    return attachH5pListener({
      courseModuleId: id,
      onScore: () => { setSaved(new Date()); void refetch(); },
    });
  }, [view, type, id, refetch]);

  if (isLoading) return <p className="p-4 text-sm text-muted-foreground">Loading…</p>;
  if (!view) return <p className="p-4 text-sm text-muted-foreground">Activity not found.</p>;

  const src = packageUrl(type, inst);

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col p-4">
      <div className="mb-3 flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => nav(`/school/lms/modules/${id}`)}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-semibold">{view.module.name}</h1>
          <p className="text-xs text-muted-foreground">
            {view.course.name} · attempt {attempt}
            {inst.maxAttempts > 0 ? ` of ${inst.maxAttempts}` : ''}
          </p>
        </div>
        {failed ? (
          <Badge variant="destructive" className="gap-1">
            <AlertTriangle className="h-3 w-3" />Not saved
          </Badge>
        ) : saved ? (
          <Badge variant="secondary" className="gap-1">
            <CheckCircle2 className="h-3 w-3" />
            Saved {saved.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
          </Badge>
        ) : ready ? (
          <Badge variant="outline">Ready</Badge>
        ) : (
          <Badge variant="outline" className="gap-1"><Loader2 className="h-3 w-3 animate-spin" />Starting</Badge>
        )}
      </div>

      {!src ? (
        <Card className="flex-1"><CardContent className="flex h-full flex-col items-center justify-center gap-2 text-center">
          <AlertTriangle className="h-8 w-8 text-muted-foreground" />
          <p className="text-sm font-medium">No package uploaded</p>
          <p className="max-w-sm text-xs text-muted-foreground">
            A teacher needs to upload the {type === 'h5p' ? 'H5P' : 'SCORM'} package in this activity&rsquo;s settings.
          </p>
        </CardContent></Card>
      ) : (
        <iframe
          ref={frame}
          title={view.module.name}
          src={src}
          className="flex-1 rounded-md border bg-white"
          // The package is third-party content: sandbox it, and keep it same-origin
          // only so far as the run-time API requires.
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
        />
      )}

      {failed && (
        <p className="mt-2 text-xs text-destructive">
          {failed} — your work may not have been recorded. Tell your teacher before closing this page.
        </p>
      )}
    </div>
  );
}

/**
 * Where the package is served from. Packages are uploaded through the LMS file
 * area, so the launch URL is the extracted entry point for that file.
 */
function packageUrl(type: string | undefined, inst: any): string | null {
  if (type === 'h5p') {
    return inst.packageFileId ? `/api/v1/school/lms/packages/h5p/${inst.packageFileId}/index.html` : null;
  }
  if (type === 'scorm') {
    const entry = inst.manifest?.entryPoint ?? 'index.html';
    return inst.packageFileId ? `/api/v1/school/lms/packages/scorm/${inst.packageFileId}/${entry}` : null;
  }
  return null;
}
