import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Plus, Check, X, Send } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Link } from 'react-router-dom';
import { api } from '@/lib/api';
import { notify } from '@/lib/notify';

interface PurchaseRequest {
  id: string;
  requestNumber: string;
  description: string | null;
  status: string;
  neededBy: string | null;
  createdAt: string;
  _count?: { orders: number };
}

export function PurchaseRequestsPage() {
  const qc = useQueryClient();
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const list = useQuery<PurchaseRequest[]>({
    queryKey: ['purchase-requests'],
    queryFn: async () => (await api.get<PurchaseRequest[]>('/procurement/purchase-requests')).data,
  });
  const act = useMutation({
    mutationFn: async (vars: { id: string; action: 'submit' | 'approve' }) =>
      (await api.patch(`/procurement/purchase-requests/${vars.id}/${vars.action}`)).data,
    onSuccess: () => {
      notify.success('Updated');
      qc.invalidateQueries({ queryKey: ['purchase-requests'] });
    },
  });
  const reject = useMutation({
    mutationFn: async () => (await api.patch(`/procurement/purchase-requests/${rejectingId}/reject`, { reason: rejectReason })).data,
    onSuccess: () => {
      notify.success('Rejected');
      setRejectingId(null);
      setRejectReason('');
      qc.invalidateQueries({ queryKey: ['purchase-requests'] });
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Purchase Requests</h1>
          <p className="text-sm text-muted-foreground">Internal requests for goods/services. Approved PRs convert into POs.</p>
        </div>
        <Button asChild>
          <Link to="/procurement/purchase-requests/new"><Plus className="mr-2 h-4 w-4" />New PR</Link>
        </Button>
      </div>

      {list.isLoading && <Skeleton className="h-32 w-full" />}
      {list.data && list.data.length === 0 && (
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            No purchase requests yet.
          </CardContent>
        </Card>
      )}

      <div className="grid gap-3 md:grid-cols-2">
        {list.data?.map((pr) => (
          <Card key={pr.id}>
            <CardHeader>
              <div className="flex items-start justify-between">
                <div>
                  <CardTitle className="text-base">{pr.requestNumber}</CardTitle>
                  <CardDescription>
                    {pr.description ?? '—'}
                    {pr.neededBy && ` · needed by ${new Date(pr.neededBy).toLocaleDateString()}`}
                  </CardDescription>
                </div>
                <Badge variant={pr.status === 'approved' ? 'default' : pr.status === 'rejected' ? 'destructive' : 'secondary'}>
                  {pr.status}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Created {new Date(pr.createdAt).toLocaleDateString()}</span>
                <span>{pr._count?.orders ?? 0} PO(s)</span>
              </div>
              <div className="flex flex-wrap gap-1 border-t pt-2">
                {pr.status === 'draft' && (
                  <Button size="sm" onClick={() => act.mutate({ id: pr.id, action: 'submit' })}>
                    <Send className="mr-1 h-3 w-3" />Submit
                  </Button>
                )}
                {pr.status === 'submitted' && (
                  <>
                    <Button size="sm" onClick={() => act.mutate({ id: pr.id, action: 'approve' })}>
                      <Check className="mr-1 h-3 w-3" />Approve
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setRejectingId(pr.id)}>
                      <X className="mr-1 h-3 w-3 text-destructive" />Reject
                    </Button>
                  </>
                )}
                {pr.status === 'approved' && (
                  <Button size="sm" variant="outline" asChild>
                    <Link to={`/procurement/purchase-orders/new?requestId=${pr.id}`}>
                      Convert to PO
                    </Link>
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Dialog open={!!rejectingId} onOpenChange={(o) => !o && setRejectingId(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Reject purchase request</DialogTitle></DialogHeader>
          <Input
            placeholder="Reason for rejection (visible to requester)"
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectingId(null)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => reject.mutate()}
              disabled={!rejectReason || reject.isPending}
            >
              Reject
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
