import { useState } from 'react';
import { MessagesSquare, Plus, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { useDiscussions, useDiscussion, useCreateDiscussion, useAddPost } from '@/features/school/api';
import { notify } from '@/lib/notify';

const sel = 'rounded-md border bg-card px-3 py-2 text-sm';

export function SchoolLmsDiscussionsPage() {
  const { data: list } = useDiscussions();
  const create = useCreateDiscussion();
  const addPost = useAddPost();
  const [selected, setSelected] = useState<string | null>(null);
  const { data: thread } = useDiscussion(selected ?? undefined);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [reply, setReply] = useState('');

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2"><MessagesSquare className="h-5 w-5" /><h1 className="text-xl font-semibold">Discussions</h1><Badge variant="outline">{list?.length ?? 0}</Badge></div>
      <div className="grid gap-4 md:grid-cols-2">
        <Card><CardHeader><CardTitle className="text-base">New discussion</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            <Input placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
            <textarea className={sel + ' h-24 w-full'} placeholder="Body" value={body} onChange={(e) => setBody(e.target.value)} />
            <Button disabled={!title || create.isPending} onClick={async () => { try { const d = await create.mutateAsync({ title, body }); notify.success('Created'); setSelected(d.id); setTitle(''); setBody(''); } catch (e: any) { notify.error(e?.message ?? 'Failed'); } }}><Plus className="mr-1 h-4 w-4" />Create</Button>
          </CardContent></Card>
        <Card><CardHeader><CardTitle className="text-base">Threads</CardTitle></CardHeader>
          <CardContent className="space-y-2">{!list?.length && <p className="text-sm text-muted-foreground">None yet.</p>}
            {list?.map((d: any) => <div key={d.id} className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
              <button className="font-medium hover:underline" onClick={() => setSelected(d.id)}>{d.title}</button><Badge variant="outline">{d._count?.posts ?? 0} posts</Badge>
            </div>)}</CardContent></Card>
      </div>
      {selected && thread && (
        <Card><CardHeader><CardTitle className="text-base">{thread.title}</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {thread.body && <p className="text-sm text-muted-foreground">{thread.body}</p>}
            {thread.posts?.map((p: any) => <div key={p.id} className="rounded-md border px-3 py-2 text-sm">{p.body}<div className="text-xs text-muted-foreground">{new Date(p.createdAt).toLocaleString()}</div></div>)}
            <div className="flex gap-2">
              <textarea className={sel + ' h-16 flex-1'} placeholder="Reply…" value={reply} onChange={(e) => setReply(e.target.value)} />
              <Button disabled={!reply || addPost.isPending} onClick={async () => { try { await addPost.mutateAsync({ id: selected, body: reply }); notify.success('Posted'); setReply(''); } catch (e: any) { notify.error(e?.message ?? 'Failed'); } }}><Send className="h-4 w-4" /></Button>
            </div>
          </CardContent></Card>
      )}
    </div>
  );
}
