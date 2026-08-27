import { useState } from 'react';
import { ExternalLink, MessageSquarePlus, Package, Plus, Puzzle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { SafeHtml } from '@/components/ui/safe-html';
import { can, CAP } from '../types';
import type { ActivityUiPlugin, ActivityViewProps } from './shared';
import { iconFor } from './shared';
import { Empty } from './content';
import { api } from '@/lib/api';
import { notify } from '@/lib/notify';

/** mod_forum — threaded discussion. */
function ForumView({ view, run, busy }: ActivityViewProps) {
  const discussions: any[] = view.body?.discussions ?? [];
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const mayStart = can(view.capabilities, CAP.forumStartDiscussion);

  return (
    <div className="space-y-4">
      {view.body?.instance?.intro && (
        <Card><CardContent className="py-5">
          <SafeHtml className="prose prose-sm dark:prose-invert max-w-none" html={view.body.instance.intro} />
        </CardContent></Card>
      )}

      <Card>
        <CardHeader className="py-3"><CardTitle className="text-base">Discussions</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {discussions.length === 0 && <p className="text-sm text-muted-foreground">No discussions yet.</p>}
          {discussions.map((d) => (
            <div key={d.id} className="rounded-md border p-3">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">{d.title}</span>
                <Badge variant="outline" className="text-[10px]">{(d.posts ?? []).length} posts</Badge>
              </div>
              <div className="mt-2 space-y-2 pl-3">
                {(d.posts ?? []).slice(0, 3).map((post: any) => (
                  <div key={post.id} className="border-l-2 pl-3">
                    <p className="text-xs text-muted-foreground">{post.authorName ?? 'Participant'}</p>
                    <SafeHtml className="prose prose-sm dark:prose-invert max-w-none" html={post.body ?? post.content ?? ''} />
                  </div>
                ))}
              </div>
              {can(view.capabilities, CAP.forumReplyPost) && (
                <ReplyBox busy={busy} onReply={(text) => run('reply', { discussionId: d.id, body: text })} />
              )}
            </div>
          ))}

          {mayStart && (
            <div className="space-y-2 rounded-md border bg-muted/30 p-3">
              <Label className="text-xs">Start a discussion</Label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Topic" />
              <Textarea rows={3} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Your message" />
              <Button
                size="sm"
                disabled={busy || !title.trim()}
                onClick={async () => { await run('startDiscussion', { title, body }); setTitle(''); setBody(''); }}
              >
                <MessageSquarePlus className="mr-1 h-4 w-4" />Post
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function ReplyBox({ onReply, busy }: { onReply: (text: string) => Promise<void>; busy: boolean }) {
  const [text, setText] = useState('');
  return (
    <div className="mt-2 flex items-end gap-2">
      <Textarea rows={1} value={text} onChange={(e) => setText(e.target.value)} placeholder="Reply…" className="min-h-9" />
      <Button size="sm" variant="outline" disabled={busy || !text.trim()} onClick={async () => { await onReply(text); setText(''); }}>
        Reply
      </Button>
    </div>
  );
}

/** mod_choice — a single-question poll. */
function ChoiceView({ view, run, busy }: ActivityViewProps) {
  const inst = view.body?.instance ?? {};
  const options: any[] = inst.options ?? [];
  const mine = view.body?.myAnswer ?? null;
  const tally: Record<string, number> = view.body?.tally ?? {};
  const showResults = inst.showResults !== 'never' && (mine || view.audience === 'teacher');

  return (
    <Card>
      <CardHeader className="py-3"><CardTitle className="text-base">{inst.name ?? 'Choose'}</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        {inst.intro && <SafeHtml className="prose prose-sm dark:prose-invert max-w-none" html={inst.intro} />}
        {options.length === 0 && <Empty>No options have been set.</Empty>}
        <div className="space-y-2">
          {options.map((o: any, i: number) => {
            const key = o.key ?? String(i);
            const chosen = mine?.optionKey === key;
            return (
              <button
                key={key}
                disabled={busy || view.audience === 'teacher'}
                onClick={() => run('choose', { optionKey: key })}
                className={`flex w-full items-center justify-between rounded-md border px-3 py-2 text-left text-sm transition ${
                  chosen ? 'border-primary bg-primary/10' : 'hover:bg-muted/50'
                }`}
              >
                <span>{o.label ?? o.text ?? `Option ${i + 1}`}</span>
                {showResults && <Badge variant="secondary">{tally[key] ?? 0}</Badge>}
              </button>
            );
          })}
        </div>
        {mine && <p className="text-xs text-muted-foreground">Your answer is recorded.</p>}
      </CardContent>
    </Card>
  );
}

/** mod_feedback — anonymous survey. */
function FeedbackView({ view }: ActivityViewProps) {
  const inst = view.body?.instance ?? {};
  const items: any[] = inst.items ?? [];
  return (
    <Card>
      <CardHeader className="py-3"><CardTitle className="text-base">{inst.name ?? 'Feedback'}</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        {inst.intro && <SafeHtml className="prose prose-sm dark:prose-invert max-w-none" html={inst.intro} />}
        {inst.anonymous && <Badge variant="outline">Anonymous</Badge>}
        {items.length === 0 ? <Empty>No questions have been added.</Empty> : (
          <ol className="list-decimal space-y-2 pl-5 text-sm">
            {items.map((it: any, i: number) => <li key={i}>{it.text ?? it.label ?? `Question ${i + 1}`}</li>)}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}

/** mod_glossary — a shared term list. */
function GlossaryView({ view, run, busy }: ActivityViewProps) {
  const entries: any[] = view.body?.entries ?? view.body ?? [];
  const [concept, setConcept] = useState('');
  const [definition, setDefinition] = useState('');
  return (
    <Card>
      <CardHeader className="py-3"><CardTitle className="text-base">Glossary</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        {(!Array.isArray(entries) || entries.length === 0) && <p className="text-sm text-muted-foreground">No entries yet.</p>}
        {Array.isArray(entries) && entries.map((e: any) => (
          <div key={e.id} className="rounded-md border p-3">
            <p className="text-sm font-medium">{e.concept}</p>
            <SafeHtml className="prose prose-sm dark:prose-invert max-w-none" html={e.definition ?? ''} />
          </div>
        ))}
        <div className="space-y-2 rounded-md border bg-muted/30 p-3">
          <Label className="text-xs">Add an entry</Label>
          <Input value={concept} onChange={(e) => setConcept(e.target.value)} placeholder="Term" />
          <Textarea rows={2} value={definition} onChange={(e) => setDefinition(e.target.value)} placeholder="Definition" />
          <Button size="sm" disabled={busy || !concept.trim()} onClick={async () => { await run('addEntry', { concept, definition }); setConcept(''); setDefinition(''); }}>
            <Plus className="mr-1 h-4 w-4" />Add
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/** mod_wiki / mod_lesson — page collections. */
function PagesView({ view }: ActivityViewProps) {
  const pages: any[] = view.body?.pages ?? (Array.isArray(view.body) ? view.body : []);
  const [openId, setOpenId] = useState<string | null>(pages[0]?.id ?? null);
  const open = pages.find((p) => p.id === openId) ?? pages[0];
  if (pages.length === 0) return <Empty>No pages yet.</Empty>;
  return (
    <div className="grid gap-4 md:grid-cols-[220px_1fr]">
      <Card><CardContent className="p-2">
        {pages.map((p) => (
          <button
            key={p.id}
            onClick={() => setOpenId(p.id)}
            className={`block w-full truncate rounded px-2 py-1.5 text-left text-sm ${p.id === open?.id ? 'bg-muted font-medium' : 'hover:bg-muted/50'}`}
          >
            {p.title ?? 'Untitled'}
          </button>
        ))}
      </CardContent></Card>
      <Card><CardContent className="py-5">
        <h2 className="mb-2 text-lg font-semibold">{open?.title}</h2>
        <SafeHtml className="prose prose-sm dark:prose-invert max-w-none" html={open?.body ?? open?.content ?? ''} />
      </CardContent></Card>
    </div>
  );
}

/** Packaged/external content — SCORM, LTI, H5P. Settings render; runtimes are P8. */
function PackagedView({ view }: ActivityViewProps) {
  const inst = view.body?.instance ?? {};
  const type = view.module.activityType;
  const Icon = type === 'lti' ? ExternalLink : type === 'h5p' ? Puzzle : Package;
  const target = inst.toolUrl ?? inst.library ?? inst.manifest ?? null;
  return (
    <Card>
      <CardContent className="space-y-3 py-6">
        {inst.intro && <SafeHtml className="prose prose-sm dark:prose-invert max-w-none" html={inst.intro} />}
        <div className="flex items-center gap-3 rounded-md border p-4">
          <Icon className="h-8 w-8 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">{view.module.name}</p>
            <p className="truncate text-xs text-muted-foreground">{target ?? 'Not configured'}</p>
          </div>
        </div>
        {type === 'lti' ? (
          target ? (
            <Button
              size="sm"
              onClick={async () => {
                try {
                  // The platform mints a single-use OIDC session and tells us
                  // where to send the browser; the signed launch follows from there.
                  const { data } = await api.post<{ redirectUrl: string; state: string }>(
                    `/school/lms/lti/${view.module.id}/launch/begin`,
                  );
                  window.open(data.redirectUrl, inst.launchContainer === 'embed' ? '_self' : '_blank', 'noopener');
                } catch (e: any) {
                  notify.error(e?.response?.data?.message ?? 'This tool is not configured for launch');
                }
              }}
            >
              Launch tool
            </Button>
          ) : (
            <p className="text-xs text-muted-foreground">
              This external tool has no launch URL configured yet.
            </p>
          )
        ) : target ? (
          <Button size="sm" asChild>
            <a href={`/school/lms/modules/${view.module.id}/play`}>Launch</a>
          </Button>
        ) : (
          <p className="text-xs text-muted-foreground">
            No package uploaded yet.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

/** mod_attendance — a pointer into the attendance module, which owns the truth. */
function AttendanceView({ view }: ActivityViewProps) {
  const nav = typeof window !== 'undefined' ? null : null;
  void nav;
  return (
    <Card>
      <CardContent className="space-y-3 py-6 text-sm">
        <p>Attendance for this class is recorded in the attendance module.</p>
        <Button variant="outline" size="sm" asChild>
          <a href={`/school/attendance?courseOfferingId=${view.course.id}`}>Open attendance</a>
        </Button>
      </CardContent>
    </Card>
  );
}

function both(type: string, label: string, V: (p: ActivityViewProps) => JSX.Element): ActivityUiPlugin {
  return { type, label, icon: iconFor(type), StudentView: V, TeacherView: V };
}

export const INTERACTIVE_PLUGINS: ActivityUiPlugin[] = [
  both('forum', 'Forum', ForumView),
  both('choice', 'Poll', ChoiceView),
  both('feedback', 'Feedback', FeedbackView),
  both('glossary', 'Glossary', GlossaryView),
  both('wiki', 'Wiki', PagesView),
  both('lesson', 'Lesson', PagesView),
  both('scorm', 'SCORM', PackagedView),
  both('lti', 'External tool', PackagedView),
  both('h5p', 'H5P', PackagedView),
  both('attendance', 'Attendance', AttendanceView),
];
