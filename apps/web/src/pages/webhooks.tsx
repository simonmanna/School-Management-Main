import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, RotateCw } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { api } from '@/lib/api';
import { notify } from '@/lib/notify';

interface Endpoint {
  id: string;
  url: string;
  events: string[];
  isActive: boolean;
  createdAt: string;
}

interface Delivery {
  id: string;
  eventName: string;
  status: 'pending' | 'succeeded' | 'failed' | 'dead';
  attempts: number;
  responseStatus: number | null;
  createdAt: string;
}

export function WebhooksPage() {
  const qc = useQueryClient();
  const endpoints = useQuery<Endpoint[]>({
    queryKey: ['webhooks'],
    queryFn: async () => (await api.get<Endpoint[]>('/webhooks/endpoints')).data,
  });
  const deliveries = useQuery<{ id: string; eventName: string; status: string; attempts: number; responseStatus: number | null; createdAt: string }[]>({
    queryKey: ['webhooks-deliveries'],
    queryFn: async () => (await api.get<Delivery[]>('/webhooks/deliveries')).data,
  });
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState('');
  const [events, setEvents] = useState('');

  const create = useMutation({
    mutationFn: async () => (await api.post('/webhooks/endpoints', { url, events: events.split(',').map((s) => s.trim()).filter(Boolean) })).data,
    onSuccess: (data: any) => {
      notify.success('Endpoint created', `Signing secret: ${data.signingSecret?.slice(0, 16)}…`);
      setOpen(false);
      setUrl('');
      setEvents('');
      qc.invalidateQueries({ queryKey: ['webhooks'] });
    },
    onError: (e: any) => notify.error(e?.response?.data?.message ?? 'Failed'),
  });

  const rotate = useMutation({
    mutationFn: async (id: string) => (await api.post(`/webhooks/endpoints/${id}/rotate`)).data,
    onSuccess: (data: any) => {
      notify.success('Secret rotated', `New secret: ${data.signingSecret?.slice(0, 16)}…`);
      qc.invalidateQueries({ queryKey: ['webhooks'] });
    },
  });
  const remove = useMutation({
    mutationFn: async (id: string) => await api.delete(`/webhooks/endpoints/${id}`),
    onSuccess: () => {
      notify.success('Removed');
      qc.invalidateQueries({ queryKey: ['webhooks'] });
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Webhooks</h1>
          <p className="text-sm text-muted-foreground">Outbound event delivery to your services</p>
        </div>
        <Button onClick={() => setOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />New Endpoint
        </Button>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Endpoints</CardTitle>
            <CardDescription>Subscribe to events delivered to your URL</CardDescription>
          </CardHeader>
          <CardContent>
            {endpoints.isLoading && <Skeleton className="h-24 w-full" />}
            {endpoints.data && endpoints.data.length === 0 && (
              <p className="text-sm text-muted-foreground">No endpoints yet.</p>
            )}
            {endpoints.data?.map((ep) => (
              <div key={ep.id} className="flex items-center justify-between border-b py-2 last:border-b-0">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <Badge variant={ep.isActive ? 'default' : 'outline'}>{ep.isActive ? 'active' : 'inactive'}</Badge>
                    <code className="truncate text-xs">{ep.url}</code>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {ep.events.length === 0 ? 'all events' : `${ep.events.length} event(s)`} · created {new Date(ep.createdAt).toLocaleDateString()}
                  </div>
                </div>
                <div className="flex gap-1">
                  <Button size="sm" variant="ghost" onClick={() => rotate.mutate(ep.id)} aria-label="Rotate secret">
                    <RotateCw className="h-3 w-3" />
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => remove.mutate(ep.id)} aria-label="Delete">
                    <Trash2 className="h-3 w-3 text-destructive" />
                  </Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent Deliveries</CardTitle>
            <CardDescription>Last 200 attempts</CardDescription>
          </CardHeader>
          <CardContent>
            {deliveries.isLoading && <Skeleton className="h-24 w-full" />}
            {deliveries.data && deliveries.data.length === 0 && (
              <p className="text-sm text-muted-foreground">No deliveries yet.</p>
            )}
            <div className="max-h-96 overflow-y-auto">
              {deliveries.data?.map((d) => (
                <div key={d.id} className="flex items-center justify-between border-b py-2 text-sm last:border-b-0">
                  <div>
                    <div className="font-mono text-xs">{d.eventName}</div>
                    <div className="text-xs text-muted-foreground">
                      {new Date(d.createdAt).toLocaleString()} · attempt {d.attempts}
                    </div>
                  </div>
                  <Badge
                    variant={
                      d.status === 'succeeded' ? 'default' :
                      d.status === 'failed' ? 'destructive' :
                      d.status === 'dead' ? 'destructive' : 'secondary'
                    }
                  >
                    {d.status} {d.responseStatus ? `· ${d.responseStatus}` : ''}
                  </Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New Webhook Endpoint</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-sm font-medium">URL</label>
              <input
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://your-service.example.com/webhooks/cafe-pos"
                className="mt-1 w-full rounded border bg-background px-2 py-1 text-sm"
              />
            </div>
            <div>
              <label className="text-sm font-medium">Events (comma-separated; empty = all)</label>
              <input
                type="text"
                value={events}
                onChange={(e) => setEvents(e.target.value)}
                placeholder="invoice.posted, payment.received"
                className="mt-1 w-full rounded border bg-background px-2 py-1 text-sm"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={() => create.mutate()} disabled={!url || create.isPending}>Create</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
