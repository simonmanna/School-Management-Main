import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, X, MessageSquare } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/api';
import { notify } from '@/lib/notify';
import { entityTypeLabel } from '@/lib/approval-entity-types';
import { useState } from 'react';

interface Approval {
  id: string;
  entityType: string;
  entityId: string;
  snapshot: Record<string, unknown>;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  requiredCount: number;
  currentStep: number;
  workflow: { name: string; steps: { stepOrder: number; name: string }[] } | null;
  decisions: { approverId: string; status: string; comment: string | null; decidedAt: string; stepOrder?: number }[];
  createdAt: string;
  decidedAt: string | null;
}

function stepProgress(req: Approval): string | null {
  const steps = req.workflow?.steps;
  if (!steps?.length) return null;
  if (req.status !== 'pending') return req.workflow!.name;
  const sorted = [...steps].sort((a, b) => a.stepOrder - b.stepOrder);
  const idx = sorted.findIndex((s) => s.stepOrder === req.currentStep);
  const cur = idx >= 0 ? sorted[idx] : undefined;
  return `Step ${idx >= 0 ? idx + 1 : 1} of ${sorted.length}${cur ? ` — ${cur.name}` : ''}`;
}

export function ApprovalsPage() {
  const qc = useQueryClient();
  const [status, setStatus] = useState<'pending' | 'approved' | 'rejected' | 'cancelled'>('pending');
  const [comment, setComment] = useState<Record<string, string>>({});
  const list = useQuery<Approval[]>({
    queryKey: ['approvals', status],
    queryFn: async () => (await api.get<Approval[]>(`/approvals?status=${status}`)).data,
  });
  const decide = useMutation({
    mutationFn: async (vars: { id: string; status: 'approved' | 'rejected'; comment?: string }) => {
      await api.post(`/approvals/${vars.id}/decide`, { status: vars.status, comment: vars.comment });
    },
    onSuccess: () => {
      notify.success('Decision recorded');
      qc.invalidateQueries({ queryKey: ['approvals'] });
    },
    onError: (err: any) => notify.error(err?.response?.data?.message ?? 'Failed'),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Approvals</h1>
        <div className="flex gap-2">
          {(['pending', 'approved', 'rejected', 'cancelled'] as const).map((s) => (
            <Button
              key={s}
              variant={status === s ? 'default' : 'outline'}
              size="sm"
              onClick={() => setStatus(s)}
            >
              {s}
            </Button>
          ))}
        </div>
      </div>
      {list.isLoading && <Skeleton className="h-32 w-full" />}
      {list.data && list.data.length === 0 && (
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            No {status} requests
          </CardContent>
        </Card>
      )}
      {list.data?.map((req) => (
        <Card key={req.id}>
          <CardHeader>
            <div className="flex items-start justify-between gap-2">
              <div>
                <CardTitle className="text-base">
                  {entityTypeLabel(req.entityType)} · {String(req.snapshot.amount ?? '')}
                </CardTitle>
                <CardDescription>
                  {stepProgress(req) && (
                    <span className="mr-1 font-medium text-foreground">{stepProgress(req)} ·</span>
                  )}
                  Required {req.requiredCount} approval(s) at this step · {req.decisions.length} decision(s) ·{' '}
                  {new Date(req.createdAt).toLocaleString()}
                </CardDescription>
              </div>
              <span className="rounded bg-muted px-2 py-1 text-xs uppercase">{req.status}</span>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <pre className="overflow-x-auto rounded bg-muted p-2 text-xs">
              {JSON.stringify(req.snapshot, null, 2)}
            </pre>
            {req.decisions.length > 0 && (
              <div className="space-y-1 text-xs">
                {req.decisions.map((d, i) => (
                  <div key={i} className="flex items-center gap-2 text-muted-foreground">
                    <span className={`h-1.5 w-1.5 rounded-full ${d.status === 'approved' ? 'bg-emerald-500' : 'bg-red-500'}`} />
                    {d.status} by {d.approverId.slice(0, 8)} · {new Date(d.decidedAt).toLocaleString()}
                    {d.comment && <span>· "{d.comment}"</span>}
                  </div>
                ))}
              </div>
            )}
            {status === 'pending' && (
              <div className="flex items-center gap-2 border-t pt-3">
                <MessageSquare className="h-4 w-4 text-muted-foreground" />
                <input
                  type="text"
                  placeholder="Comment (optional)"
                  value={comment[req.id] ?? ''}
                  onChange={(e) => setComment((c) => ({ ...c, [req.id]: e.target.value }))}
                  className="flex-1 rounded border bg-background px-2 py-1 text-sm"
                />
                <Button
                  size="sm"
                  variant="outline"
                  disabled={decide.isPending}
                  onClick={() => decide.mutate({ id: req.id, status: 'rejected', comment: comment[req.id] })}
                >
                  <X className="mr-1 h-3 w-3" />Reject
                </Button>
                <Button
                  size="sm"
                  disabled={decide.isPending}
                  onClick={() => decide.mutate({ id: req.id, status: 'approved', comment: comment[req.id] })}
                >
                  <Check className="mr-1 h-3 w-3" />Approve
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
