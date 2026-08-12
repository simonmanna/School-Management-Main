import { useState } from 'react';
import { FileText, Lock, Unlock, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { useFiscalPeriods, useClosePeriod, useLockPeriod, useReopenPeriod } from '@/features/accounting/api';
import { format } from 'date-fns';
import { notify } from '@/lib/notify';

const STATUS_BADGES: Record<string, { label: string; variant: string }> = {
  open: { label: 'Open', variant: 'bg-emerald-100 text-emerald-800 border-emerald-200' },
  closed: { label: 'Closed', variant: 'bg-amber-100 text-amber-800 border-amber-200' },
  locked: { label: 'Locked', variant: 'bg-gray-100 text-gray-700 border-gray-200' },
};

export function YearEndClosePage() {
  const [page, setPage] = useState(1);
  const { data, isLoading } = useFiscalPeriods({ page });
  const closeMut = useClosePeriod();
  const lockMut = useLockPeriod();
  const reopenMut = useReopenPeriod();

  const periods = data?.data ?? [];
  const meta = data?.meta;

  const handleAction = async (id: string, action: 'close' | 'lock' | 'reopen') => {
    try {
      if (action === 'close') await closeMut.mutateAsync(id);
      else if (action === 'lock') await lockMut.mutateAsync(id);
      else await reopenMut.mutateAsync(id);
    } catch (e: any) {
      notify.error('Action failed', e?.response?.data?.message ?? e.message);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="border-l-4 border-[#3b82f6] pl-4 space-y-1">
          <h1 className="text-3xl font-bold tracking-tight text-gray-900">Year-End Close</h1>
          <p className="text-sm text-gray-500">
            Close periods, lock them permanently, and post retained earnings.
          </p>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-2 pt-4 px-5 bg-muted/30 border-b rounded-t-lg flex-row items-center justify-between">
          <CardTitle className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
            Fiscal Periods
          </CardTitle>
          {meta && (
            <span className="text-[10px] text-muted-foreground">{meta.total} period{meta.total !== 1 ? 's' : ''}</span>
          )}
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/30">
                <TableHead className="text-[10px] font-bold text-muted-foreground uppercase">Period</TableHead>
                <TableHead className="text-[10px] font-bold text-muted-foreground uppercase">Start</TableHead>
                <TableHead className="text-[10px] font-bold text-muted-foreground uppercase">End</TableHead>
                <TableHead className="text-[10px] font-bold text-muted-foreground uppercase">Status</TableHead>
                <TableHead className="text-[10px] font-bold text-muted-foreground uppercase">Closed At</TableHead>
                <TableHead className="text-[10px] font-bold text-muted-foreground uppercase text-right pr-4">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <TableRow key={`s-${i}`}>
                    {Array.from({ length: 6 }).map((_, j) => (
                      <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                    ))}
                  </TableRow>
                ))
              ) : periods.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-12 text-muted-foreground">
                    <FileText className="h-8 w-8 mx-auto mb-2 opacity-30" />
                    <p className="font-medium text-sm">No fiscal periods defined</p>
                    <p className="text-xs">Create periods from the Fiscal Periods page to enable year-end close.</p>
                  </TableCell>
                </TableRow>
              ) : (
                periods.map((p) => {
                  const badge = STATUS_BADGES[p.status] ?? { label: p.status, variant: 'bg-gray-100 text-gray-700' };
                  return (
                    <TableRow key={p.id} className="hover:bg-muted/20">
                      <TableCell className="text-xs font-medium">{p.name}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {format(new Date(p.startDate), 'MMM d, yyyy')}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {format(new Date(p.endDate), 'MMM d, yyyy')}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={`text-[10px] font-medium ${badge.variant}`}>
                          {badge.label}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {p.closedAt ? format(new Date(p.closedAt), 'MMM d, yyyy HH:mm') : '—'}
                      </TableCell>
                      <TableCell className="text-right pr-4">
                        <div className="flex items-center justify-end gap-1.5">
                          {p.status === 'open' && (
                            <Button size="sm" variant="outline" className="h-7 text-[10px] gap-1"
                              onClick={() => handleAction(p.id, 'close')} disabled={closeMut.isPending}>
                              <FileText className="h-3 w-3" /> Close
                            </Button>
                          )}
                          {p.status === 'closed' && (
                            <>
                              <Button size="sm" variant="outline" className="h-7 text-[10px] gap-1"
                                onClick={() => handleAction(p.id, 'lock')} disabled={lockMut.isPending}>
                                <Lock className="h-3 w-3" /> Lock
                              </Button>
                              <Button size="sm" variant="outline" className="h-7 text-[10px] gap-1"
                                onClick={() => handleAction(p.id, 'reopen')} disabled={reopenMut.isPending}>
                                <Unlock className="h-3 w-3" /> Reopen
                              </Button>
                            </>
                          )}
                          {p.status === 'locked' && (
                            <span className="text-[10px] text-muted-foreground italic">Permanent</span>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Info Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card className="border-blue-200">
          <CardHeader className="pb-2 pt-4 px-5 bg-blue-50/50 border-b rounded-t-lg">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-blue-500" />
              <CardTitle className="text-xs font-bold text-blue-700 uppercase tracking-wider">Close</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="p-4 text-xs text-muted-foreground space-y-2">
            <p>• Zeroes out all revenue and expense accounts into Retained Earnings.</p>
            <p>• Posts a single closing journal entry with source type <code className="bg-muted px-1 rounded">period_close</code>.</p>
            <p>• After closing, no more transactions can post to that period (until reopened).</p>
          </CardContent>
        </Card>
        <Card className="border-amber-200">
          <CardHeader className="pb-2 pt-4 px-5 bg-amber-50/50 border-b rounded-t-lg">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              <CardTitle className="text-xs font-bold text-amber-700 uppercase tracking-wider">Lock</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="p-4 text-xs text-muted-foreground space-y-2">
            <p>• Permanently prevents any posting to that period's date range.</p>
            <p>• <strong>Irreversible</strong> — a locked period cannot be unlocked.</p>
            <p>• Use after final audit sign-off for the period.</p>
          </CardContent>
        </Card>
      </div>

      {meta && meta.totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>{meta.total} periods</span>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              Previous
            </Button>
            <span className="text-xs font-medium">Page {meta.page} of {meta.totalPages}</span>
            <Button variant="outline" size="sm" disabled={page >= meta.totalPages} onClick={() => setPage((p) => p + 1)}>
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
