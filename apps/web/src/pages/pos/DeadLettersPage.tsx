import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Loader2, CheckCircle2, Trash2, Inbox } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { api } from '@/lib/api';
import { notify } from '@/lib/notify';

interface DeadLetter {
  id: string;
  opId: string;
  deviceName: string;
  deviceSeq: number;
  opType: string;
  occurredAt: string | null;
  error: string;
  httpStatus: number | null;
  status: string;
  payload: Record<string, unknown>;
  resolutionNote: string | null;
  resolvedAt: string | null;
  createdAt: string;
}

/** Best-effort money read for the summary line — payload shapes vary by op type. */
function opAmount(dl: DeadLetter): number | null {
  const p = dl.payload as any;
  if (Array.isArray(p?.tenders)) return p.tenders.reduce((s: number, t: any) => s + (Number(t?.amount) || 0), 0);
  if (typeof p?.amount === 'number') return p.amount;
  if (typeof p?.openingFloat === 'number') return p.openingFloat;
  return null;
}

/**
 * Rejected offline operations (sync P5).
 *
 * These were rung up on a device, very likely printed and handed to a
 * customer, then refused by the server on sync. There is no "retry" — they
 * failed a business rule, and blind replay is how you double-post. A manager
 * says what happened and it gets audited.
 */
export function DeadLettersPage() {
  const qc = useQueryClient();
  const [status, setStatus] = useState<'open' | 'all'>('open');
  const [resolving, setResolving] = useState<{ dl: DeadLetter; action: 'resolved' | 'discarded' } | null>(null);
  const [note, setNote] = useState('');

  const q = useQuery({
    queryKey: ['sync-dead-letters', status] as const,
    queryFn: async (): Promise<DeadLetter[]> => (await api.get(`/sync/dead-letters?status=${status}`)).data,
    refetchInterval: 30_000,
  });

  const resolve = useMutation({
    mutationFn: async () => {
      if (!resolving) return null;
      return (await api.post(`/sync/dead-letters/${resolving.dl.id}/resolve`, {
        status: resolving.action,
        note: note.trim(),
      })).data;
    },
    onSuccess: () => {
      notify.success('Recorded');
      setResolving(null);
      setNote('');
      qc.invalidateQueries({ queryKey: ['sync-dead-letters'] });
    },
    onError: (e: any) => notify.error(e?.response?.data?.message ?? 'Failed'),
  });

  const rows = q.data ?? [];
  const openCount = rows.filter((r) => r.status === 'open').length;

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <Inbox className="h-6 w-6" /> Rejected offline sales
          </h1>
          <p className="text-muted-foreground">
            Operations a device sent on sync that the server refused. Each one may be
            real money that never got recorded.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant={status === 'open' ? 'default' : 'outline'} size="sm" onClick={() => setStatus('open')}>
            Open{openCount > 0 ? ` (${openCount})` : ''}
          </Button>
          <Button variant={status === 'all' ? 'default' : 'outline'} size="sm" onClick={() => setStatus('all')}>
            All
          </Button>
        </div>
      </div>

      {q.isLoading ? (
        <Skeleton className="h-32 w-full" />
      ) : rows.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
            <CheckCircle2 className="h-8 w-8 text-emerald-500" />
            <p className="font-medium">Nothing rejected</p>
            <p className="text-sm text-muted-foreground">
              Every operation pushed by every device has been accepted.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {rows.map((dl) => {
            const amount = opAmount(dl);
            return (
              <Card key={dl.id} className={dl.status === 'open' ? 'border-rose-400/40' : undefined}>
                <CardHeader className="pb-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <CardTitle className="flex items-center gap-2 text-base">
                      {dl.status === 'open' && <AlertTriangle className="h-4 w-4 text-rose-500" />}
                      <code className="font-mono text-sm">{dl.opType}</code>
                      {amount != null && (
                        <span className="font-semibold">{amount.toLocaleString()}</span>
                      )}
                    </CardTitle>
                    <span className="text-xs text-muted-foreground">
                      {dl.deviceName} · seq {dl.deviceSeq} ·{' '}
                      {dl.occurredAt ? new Date(dl.occurredAt).toLocaleString() : 'no timestamp'}
                    </span>
                  </div>
                  <CardDescription className="text-rose-400">
                    {dl.httpStatus ? `HTTP ${dl.httpStatus} — ` : ''}{dl.error}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <details className="text-xs">
                    <summary className="cursor-pointer text-muted-foreground">Payload</summary>
                    <pre className="mt-2 max-h-48 overflow-auto rounded-md border bg-muted/40 p-2">
                      {JSON.stringify(dl.payload, null, 2)}
                    </pre>
                  </details>
                  {dl.status === 'open' ? (
                    <div className="flex justify-end gap-2">
                      <Button size="sm" variant="outline" onClick={() => { setResolving({ dl, action: 'resolved' }); setNote(''); }}>
                        <CheckCircle2 className="h-3.5 w-3.5" /> Mark handled
                      </Button>
                      <Button size="sm" variant="ghost" className="text-rose-400" onClick={() => { setResolving({ dl, action: 'discarded' }); setNote(''); }}>
                        <Trash2 className="h-3.5 w-3.5" /> Discard
                      </Button>
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      <span className="font-medium capitalize">{dl.status}</span>
                      {dl.resolvedAt ? ` on ${new Date(dl.resolvedAt).toLocaleString()}` : ''}
                      {dl.resolutionNote ? ` — "${dl.resolutionNote}"` : ''}
                    </p>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={!!resolving} onOpenChange={(open) => !open && setResolving(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {resolving?.action === 'resolved' ? 'Mark as handled' : 'Discard this operation'}
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {resolving?.action === 'resolved'
              ? 'Use this once the sale has been re-entered manually, or you confirmed it was already recorded.'
              : 'Use this only if the operation must never post — a duplicate, a test, or a cancelled sale.'}
          </p>
          <div className="grid gap-1.5">
            <Label htmlFor="dl-note">What happened? (recorded in the audit log)</Label>
            <Input
              id="dl-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={resolving?.action === 'resolved' ? 'Re-rang as INV-2026-000123' : 'Duplicate of INV-2026-000123'}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setResolving(null)}>Cancel</Button>
            <Button
              variant={resolving?.action === 'discarded' ? 'destructive' : 'default'}
              disabled={!note.trim() || resolve.isPending}
              onClick={() => resolve.mutate()}
            >
              {resolve.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Confirm
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default DeadLettersPage;
