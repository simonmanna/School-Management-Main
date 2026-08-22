import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useLmsModuleView, useLmsModuleAction } from '@/features/school/api';
import { notify } from '@/lib/notify';

/**
 * Generic activity page (ADR-014 §6). Renders whatever the plugin's view returns —
 * the course page never switches on activity type, and neither does this shell beyond
 * offering the plugin's common actions.
 */
export function SchoolLmsModuleViewPage() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const { data, isLoading } = useLmsModuleView(id);
  const act = useLmsModuleAction();
  const [text, setText] = useState('');

  const view: any = data ?? {};
  const instance = view.instance ?? view;
  const type: string = instance?.activityType ?? guessType(view);

  const run = async (action: string, dto: Record<string, unknown> = {}) => {
    try { await act.mutateAsync({ id, action, ...dto }); notify.success(`${action} ok`); setText(''); }
    catch (e: any) { notify.error(e?.message ?? 'Failed'); }
  };

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" onClick={() => nav(-1)}><ArrowLeft className="h-4 w-4" /></Button>
        <h1 className="text-xl font-semibold">{instance?.name ?? 'Activity'}</h1>
        <Badge variant="outline">{type}</Badge>
      </div>

      {instance?.intro && <Card><CardContent className="prose prose-sm max-w-none py-4" dangerouslySetInnerHTML={{ __html: instance.intro }} /></Card>}
      {instance?.content && <Card><CardContent className="prose prose-sm max-w-none py-4" dangerouslySetInnerHTML={{ __html: instance.content }} /></Card>}
      {instance?.externalUrl && <Card><CardContent className="py-4"><a className="text-primary underline" href={instance.externalUrl} target="_blank" rel="noreferrer">{instance.externalUrl}</a></CardContent></Card>}

      {/* Type-specific quick actions */}
      {(view.discussions !== undefined) && (
        <Card>
          <CardHeader className="py-3"><CardTitle className="text-base">Discussions</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {(view.discussions ?? []).map((d: any) => (
              <div key={d.id} className="rounded border p-2 text-sm"><div className="font-medium">{d.title}</div><div className="text-xs text-muted-foreground">{(d.posts ?? []).length} posts</div></div>
            ))}
            <div className="flex items-end gap-2 pt-2">
              <div className="flex-1"><Label className="text-xs">New discussion</Label><Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Title" /></div>
              <Button size="sm" onClick={() => run('startDiscussion', { title: text })}><Send className="mr-1 h-4 w-4" />Post</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {type === 'assign' && (
        <Card>
          <CardHeader className="py-3"><CardTitle className="text-base">Your submission</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {view.submission && <div className="rounded border bg-muted/30 p-2 text-sm">{view.submission.content ?? '(attachment submitted)'} <Badge variant="outline" className="ml-2">{view.submission.status}</Badge></div>}
            <Label className="text-xs">Online text</Label>
            <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Type your submission" />
            <Button size="sm" onClick={() => run('submit', { content: text })}><Send className="mr-1 h-4 w-4" />Submit</Button>
          </CardContent>
        </Card>
      )}

      {type === 'choice' && instance?.options && (
        <Card>
          <CardHeader className="py-3"><CardTitle className="text-base">Choose</CardTitle></CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {(instance.options as any[]).map((o: any, i: number) => (
              <Button key={i} variant="outline" size="sm" onClick={() => run('choose', { optionKey: o.key ?? String(i) })}>{o.label ?? o.text ?? `Option ${i + 1}`}</Button>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Raw payload for any other type — honest fallback so nothing is hidden. */}
      <Card>
        <CardHeader className="py-3"><CardTitle className="text-sm text-muted-foreground">Activity data</CardTitle></CardHeader>
        <CardContent><pre className="overflow-x-auto rounded bg-muted/40 p-3 text-xs">{JSON.stringify(view, null, 2)}</pre></CardContent>
      </Card>
    </div>
  );
}

function guessType(view: any): string {
  if (view.discussions !== undefined) return 'forum';
  if (view.submission !== undefined || view.submissions !== undefined) return 'assign';
  if (view.slotCount !== undefined || view.slots !== undefined) return 'quiz';
  if (view.tracks !== undefined) return 'scorm';
  if (view.entries !== undefined) return 'glossary';
  if (view.pages !== undefined) return view.instance?.wikiMode ? 'wiki' : 'lesson';
  return view.instance?.externalUrl ? 'url' : 'page';
}
