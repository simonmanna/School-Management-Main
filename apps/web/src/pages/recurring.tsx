import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Pause, Play, StopCircle, Plus } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { api } from '@/lib/api';
import { notify } from '@/lib/notify';

interface Recurring {
  id: string;
  name: string;
  documentType: string;
  frequency: string;
  status: 'active' | 'paused' | 'ended';
  nextRunAt: string;
  lastRunAt: string | null;
}

export function RecurringPage() {
  const qc = useQueryClient();
  const list = useQuery<Recurring[]>({
    queryKey: ['recurring'],
    queryFn: async () => (await api.get<Recurring[]>('/recurring')).data,
  });
  const act = useMutation({
    mutationFn: async (vars: { id: string; op: 'pause' | 'resume' | 'end' }) => {
      await api.patch(`/recurring/${vars.id}/${vars.op}`);
    },
    onSuccess: () => {
      notify.success('Updated');
      qc.invalidateQueries({ queryKey: ['recurring'] });
    },
    onError: (e: any) => notify.error(e?.response?.data?.message ?? 'Failed'),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Recurring Documents</h1>
        <Button>
          <Plus className="mr-2 h-4 w-4" />New Recurring
        </Button>
      </div>
      {list.isLoading && <Skeleton className="h-32 w-full" />}
      {list.data && list.data.length === 0 && (
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            No recurring templates yet
          </CardContent>
        </Card>
      )}
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {list.data?.map((r) => (
          <Card key={r.id}>
            <CardHeader>
              <div className="flex items-start justify-between">
                <div>
                  <CardTitle className="text-base">{r.name}</CardTitle>
                  <CardDescription className="capitalize">
                    {r.documentType.replace('_', ' ')} · {r.frequency}
                  </CardDescription>
                </div>
                <Badge variant={r.status === 'active' ? 'default' : r.status === 'paused' ? 'secondary' : 'outline'}>
                  {r.status}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div>
                <div className="text-xs text-muted-foreground">Next run</div>
                <div>{new Date(r.nextRunAt).toLocaleString()}</div>
              </div>
              {r.lastRunAt && (
                <div>
                  <div className="text-xs text-muted-foreground">Last run</div>
                  <div>{new Date(r.lastRunAt).toLocaleString()}</div>
                </div>
              )}
              <div className="flex gap-2 border-t pt-3">
                {r.status === 'active' && (
                  <Button size="sm" variant="outline" onClick={() => act.mutate({ id: r.id, op: 'pause' })}>
                    <Pause className="mr-1 h-3 w-3" />Pause
                  </Button>
                )}
                {r.status === 'paused' && (
                  <Button size="sm" variant="outline" onClick={() => act.mutate({ id: r.id, op: 'resume' })}>
                    <Play className="mr-1 h-3 w-3" />Resume
                  </Button>
                )}
                {r.status !== 'ended' && (
                  <Button size="sm" variant="outline" onClick={() => act.mutate({ id: r.id, op: 'end' })}>
                    <StopCircle className="mr-1 h-3 w-3" />End
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
