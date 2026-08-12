import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Send, X } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Link } from 'react-router-dom';
import { api } from '@/lib/api';
import { notify } from '@/lib/notify';
import { useAuthStore } from '@/stores/auth.store';
import { formatMoney } from '@/lib/format';

interface DebitNote {
  id: string;
  noteNumber: string;
  direction: 'outbound' | 'inbound';
  partnerId: string;
  partner?: { name: string };
  totalAmount: number | string;
  currencyCode: string;
  status: 'draft' | 'posted' | 'cancelled';
  reason: string;
  issueDate: string;
}

export function DebitNotesPage() {
  const qc = useQueryClient();
  const org = useAuthStore((s) => s.organization);
  const list = useQuery<DebitNote[]>({
    queryKey: ['debit-notes'],
    queryFn: async () => (await api.get<DebitNote[]>('/procurement/debit-notes')).data,
  });
  const act = useMutation({
    mutationFn: async (vars: { id: string; action: 'post' | 'cancel' }) =>
      (await api.patch(`/procurement/debit-notes/${vars.id}/${vars.action}`)).data,
    onSuccess: () => {
      notify.success('Updated');
      qc.invalidateQueries({ queryKey: ['debit-notes'] });
    },
    onError: (e: any) => notify.error(e?.response?.data?.message ?? 'Failed'),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Debit Notes</h1>
          <p className="text-sm text-muted-foreground">
            Increases to AR (outbound to customers) or AP (inbound from suppliers). Posts via PostingService.
          </p>
        </div>
        <Button asChild>
          <Link to="/procurement/debit-notes/new"><Plus className="mr-2 h-4 w-4" />New debit note</Link>
        </Button>
      </div>

      {list.isLoading && <Skeleton className="h-32 w-full" />}
      {list.data && list.data.length === 0 && (
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            No debit notes yet.
          </CardContent>
        </Card>
      )}

      <div className="grid gap-3 md:grid-cols-2">
        {list.data?.map((n) => (
          <Card key={n.id}>
            <CardHeader>
              <div className="flex items-start justify-between">
                <div>
                  <CardTitle className="text-base">{n.noteNumber}</CardTitle>
                  <CardDescription>
                    {n.direction === 'outbound' ? 'To customer' : 'From supplier'} · {n.partner?.name ?? n.partnerId} · {n.reason.replace('_', ' ')}
                  </CardDescription>
                </div>
                <Badge variant={n.direction === 'outbound' ? 'default' : 'secondary'}>{n.direction}</Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Total</span>
                <span className="font-semibold">{formatMoney(n.totalAmount, n.currencyCode ?? org?.currencyCode)}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Status</span>
                <Badge variant={n.status === 'cancelled' ? 'destructive' : n.status === 'posted' ? 'default' : 'outline'}>
                  {n.status}
                </Badge>
              </div>
              <div className="flex gap-1 border-t pt-2">
                {n.status === 'draft' && (
                  <>
                    <Button size="sm" onClick={() => act.mutate({ id: n.id, action: 'post' })}>
                      <Send className="mr-1 h-3 w-3" />Post
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => act.mutate({ id: n.id, action: 'cancel' })}>
                      <X className="mr-1 h-3 w-3 text-destructive" />Cancel
                    </Button>
                  </>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
