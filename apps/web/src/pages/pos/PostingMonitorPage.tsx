import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Loader2, CheckCircle2, Trash2, Inbox, RefreshCw, ListChecks } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { api } from '@/lib/api';
import { notify } from '@/lib/notify';

interface InventoryException {
  id: string;
  invoiceNumber: string | null;
  invoiceId: string | null;
  productId: string | null;
  menuItemId: string | null;
  description: string | null;
  quantity: string | number;
  kind: string;
  reason: string;
  status: string;
  resolutionNote: string | null;
  resolvedAt: string | null;
  createdAt: string;
  payload: Record<string, unknown> | null;
}

interface StockPostingJob {
  id: string;
  invoiceNumber: string;
  invoiceId: string;
  orderId: string | null;
  status: string;
  attempts: number;
  maxAttempts: number;
  lastError: string | null;
  nextRetryAt: string;
  createdAt: string;
  processedAt: string | null;
}

interface Counts {
  jobs: { pending: number; processing: number; failed: number; doneWithReview: number };
  exceptions: { open: number };
}

/**
 * Posting Monitor (accounting hardening, Phase 1).
 *
 * Surfaces the durable inventory-posting queue and the exception work-queue that
 * replaced the old silent `stock_reconcile_needed` audit marker. A sale is never
 * blocked by stock, but every deduction that could not post is now visible and
 * actionable: retry a failed job (safe — it deducted nothing), or resolve an
 * exception once the drift has been corrected with a manual stock adjustment.
 */
export function PostingMonitorPage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<'exceptions' | 'jobs'>('exceptions');
  const [exStatus, setExStatus] = useState<'open' | 'all'>('open');
  const [jobStatus, setJobStatus] = useState<'failed' | 'all'>('failed');
  const [resolving, setResolving] = useState<{ ex: InventoryException; action: 'resolved' | 'discarded' } | null>(null);
  const [note, setNote] = useState('');

  const countsQ = useQuery({
    queryKey: ['posting-monitor', 'counts'] as const,
    queryFn: async (): Promise<Counts> => (await api.get('/pos/posting-monitor/counts')).data,
    refetchInterval: 30_000,
  });

  const exQ = useQuery({
    queryKey: ['posting-monitor', 'exceptions', exStatus] as const,
    queryFn: async (): Promise<InventoryException[]> =>
      (await api.get(`/pos/posting-monitor/exceptions?status=${exStatus}`)).data,
    refetchInterval: 30_000,
    enabled: tab === 'exceptions',
  });

  const jobsQ = useQuery({
    queryKey: ['posting-monitor', 'jobs', jobStatus] as const,
    queryFn: async (): Promise<StockPostingJob[]> =>
      (await api.get(`/pos/posting-monitor/jobs?status=${jobStatus}`)).data,
    refetchInterval: 30_000,
    enabled: tab === 'jobs',
  });

  const resolve = useMutation({
    mutationFn: async () => {
      if (!resolving) return null;
      return (await api.post(`/pos/posting-monitor/exceptions/${resolving.ex.id}/resolve`, {
        status: resolving.action,
        note: note.trim(),
      })).data;
    },
    onSuccess: () => {
      notify.success('Recorded');
      setResolving(null);
      setNote('');
      qc.invalidateQueries({ queryKey: ['posting-monitor'] });
    },
    onError: (e: any) => notify.error(e?.response?.data?.message ?? 'Failed'),
  });

  const retry = useMutation({
    mutationFn: async (id: string) => (await api.post(`/pos/posting-monitor/jobs/${id}/retry`, {})).data,
    onSuccess: () => {
      notify.success('Re-queued');
      qc.invalidateQueries({ queryKey: ['posting-monitor'] });
    },
    onError: (e: any) => notify.error(e?.response?.data?.message ?? 'Failed'),
  });

  const counts = countsQ.data;
  const openEx = counts?.exceptions.open ?? 0;
  const failedJobs = counts?.jobs.failed ?? 0;

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <ListChecks className="h-6 w-6" /> Posting monitor
          </h1>
          <p className="text-muted-foreground">
            Inventory postings that ran out-of-band after a sale. The sale is never
            blocked by stock — but nothing drifts silently: failures land here.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant={tab === 'exceptions' ? 'default' : 'outline'} size="sm" onClick={() => setTab('exceptions')}>
            Exceptions{openEx > 0 ? ` (${openEx})` : ''}
          </Button>
          <Button variant={tab === 'jobs' ? 'default' : 'outline'} size="sm" onClick={() => setTab('jobs')}>
            Jobs{failedJobs > 0 ? ` (${failedJobs} failed)` : ''}
          </Button>
        </div>
      </div>

      {tab === 'exceptions' ? (
        <>
          <div className="flex gap-2">
            <Button variant={exStatus === 'open' ? 'default' : 'outline'} size="sm" onClick={() => setExStatus('open')}>Open</Button>
            <Button variant={exStatus === 'all' ? 'default' : 'outline'} size="sm" onClick={() => setExStatus('all')}>All</Button>
          </div>
          {exQ.isLoading ? (
            <Skeleton className="h-32 w-full" />
          ) : (exQ.data ?? []).length === 0 ? (
            <EmptyState label="No inventory exceptions" hint="Every sale's stock deducted cleanly." />
          ) : (
            <div className="space-y-3">
              {(exQ.data ?? []).map((ex) => (
                <Card key={ex.id} className={ex.status === 'open' ? 'border-rose-400/40' : undefined}>
                  <CardHeader className="pb-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <CardTitle className="flex items-center gap-2 text-base">
                        {ex.status === 'open' && <AlertTriangle className="h-4 w-4 text-rose-500" />}
                        <code className="font-mono text-sm">{ex.kind}</code>
                        <span className="font-medium">{ex.description ?? ex.productId ?? ex.menuItemId ?? 'line'}</span>
                        <span className="text-muted-foreground">× {Number(ex.quantity)}</span>
                      </CardTitle>
                      <span className="text-xs text-muted-foreground">
                        {ex.invoiceNumber ?? 'no invoice'} · {new Date(ex.createdAt).toLocaleString()}
                      </span>
                    </div>
                    <CardDescription className="text-rose-400">{ex.reason}</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {ex.payload && (
                      <details className="text-xs">
                        <summary className="cursor-pointer text-muted-foreground">Details</summary>
                        <pre className="mt-2 max-h-48 overflow-auto rounded-md border bg-muted/40 p-2">
                          {JSON.stringify(ex.payload, null, 2)}
                        </pre>
                      </details>
                    )}
                    {ex.status === 'open' ? (
                      <div className="flex justify-end gap-2">
                        <Button size="sm" variant="outline" onClick={() => { setResolving({ ex, action: 'resolved' }); setNote(''); }}>
                          <CheckCircle2 className="h-3.5 w-3.5" /> Mark corrected
                        </Button>
                        <Button size="sm" variant="ghost" className="text-rose-400" onClick={() => { setResolving({ ex, action: 'discarded' }); setNote(''); }}>
                          <Trash2 className="h-3.5 w-3.5" /> Discard
                        </Button>
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        <span className="font-medium capitalize">{ex.status}</span>
                        {ex.resolvedAt ? ` on ${new Date(ex.resolvedAt).toLocaleString()}` : ''}
                        {ex.resolutionNote ? ` — "${ex.resolutionNote}"` : ''}
                      </p>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </>
      ) : (
        <>
          <div className="flex gap-2">
            <Button variant={jobStatus === 'failed' ? 'default' : 'outline'} size="sm" onClick={() => setJobStatus('failed')}>Failed</Button>
            <Button variant={jobStatus === 'all' ? 'default' : 'outline'} size="sm" onClick={() => setJobStatus('all')}>All</Button>
          </div>
          {jobsQ.isLoading ? (
            <Skeleton className="h-32 w-full" />
          ) : (jobsQ.data ?? []).length === 0 ? (
            <EmptyState label="No jobs" hint="Nothing pending or failed in the inventory-posting queue." />
          ) : (
            <div className="space-y-3">
              {(jobsQ.data ?? []).map((job) => (
                <Card key={job.id} className={job.status === 'failed' ? 'border-rose-400/40' : undefined}>
                  <CardHeader className="pb-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <CardTitle className="flex items-center gap-2 text-base">
                        <StatusDot status={job.status} />
                        <code className="font-mono text-sm">{job.invoiceNumber}</code>
                        <span className="text-xs text-muted-foreground">attempt {job.attempts}/{job.maxAttempts}</span>
                      </CardTitle>
                      <span className="text-xs text-muted-foreground">{new Date(job.createdAt).toLocaleString()}</span>
                    </div>
                    {job.lastError && <CardDescription className="text-amber-500">{job.lastError}</CardDescription>}
                  </CardHeader>
                  {job.status === 'failed' && (
                    <CardContent className="flex justify-end">
                      <Button size="sm" variant="outline" disabled={retry.isPending} onClick={() => retry.mutate(job.id)}>
                        {retry.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Retry
                      </Button>
                    </CardContent>
                  )}
                </Card>
              ))}
            </div>
          )}
        </>
      )}

      <Dialog open={!!resolving} onOpenChange={(open) => !open && setResolving(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{resolving?.action === 'resolved' ? 'Mark as corrected' : 'Discard this exception'}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {resolving?.action === 'resolved'
              ? 'Use this once the stock drift has been corrected — e.g. a manual stock adjustment or count was posted.'
              : 'Use this only if the line must never deduct — a test, a duplicate, or an untracked item.'}
          </p>
          <div className="grid gap-1.5">
            <Label htmlFor="ex-note">What happened? (recorded in the audit log)</Label>
            <Input
              id="ex-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={resolving?.action === 'resolved' ? 'Posted stock adjustment ADJ-2026-000045' : 'Untracked promo item'}
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

function EmptyState({ label, hint }: { label: string; hint: string }) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
        <CheckCircle2 className="h-8 w-8 text-emerald-500" />
        <p className="font-medium">{label}</p>
        <p className="text-sm text-muted-foreground">{hint}</p>
      </CardContent>
    </Card>
  );
}

function StatusDot({ status }: { status: string }) {
  const cls =
    status === 'failed' ? 'text-rose-500'
    : status === 'done' ? 'text-emerald-500'
    : status === 'processing' ? 'text-sky-500'
    : 'text-amber-500';
  return <Inbox className={`h-4 w-4 ${cls}`} />;
}

export default PostingMonitorPage;
