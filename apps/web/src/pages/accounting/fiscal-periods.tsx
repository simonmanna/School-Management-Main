import { useState } from 'react';
import { ChevronRight, Plus, Lock, LockOpen, RotateCcw, CheckCircle2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  useFiscalPeriods,
  useCreateFiscalPeriod,
  useClosePeriod,
  useReopenPeriod,
  useLockPeriod,
  useUnlockPeriod,
  type FiscalPeriod,
} from '@/features/accounting/api';
import { useAuthStore } from '@/stores/auth.store';
import { cn } from '@/lib/utils';

type PeriodAction = 'close' | 'lock' | 'reopen' | 'unlock';

/** What each lifecycle action does, shown before the user confirms it. */
const ACTION_COPY: Record<PeriodAction, { title: string; body: string; confirm: string; needsReason: boolean }> = {
  close: {
    title: 'Close period',
    body: 'Posts the closing entry that moves this period’s income and expenses into retained earnings. Nothing can be posted into the period while it is closed.',
    confirm: 'Close period',
    needsReason: false,
  },
  lock: {
    title: 'Lock period',
    body: 'Locking is final for day-to-day work: the period can only be unlocked by an administrator, with a recorded reason.',
    confirm: 'Lock period',
    needsReason: false,
  },
  reopen: {
    title: 'Reopen period',
    body: 'Reverses the closing entry and allows posting into this period again. The reason is kept in the audit log.',
    confirm: 'Reopen period',
    needsReason: true,
  },
  unlock: {
    title: 'Unlock period',
    body: 'Break-glass: reopens a locked period and reverses its closing entry. Later closed or locked periods must be reopened first. The reason is kept in the audit log.',
    confirm: 'Unlock period',
    needsReason: true,
  },
};

const STATUS_BADGE: Record<FiscalPeriod['status'], { label: string; className: string }> = {
  open: { label: 'Open', className: 'bg-emerald-100 text-emerald-700 hover:bg-emerald-100' },
  closed: { label: 'Closed', className: 'bg-amber-100 text-amber-700 hover:bg-amber-100' },
  locked: { label: 'Locked', className: 'bg-slate-100 text-slate-600 hover:bg-slate-100' },
};

function FiscalPeriodsPage() {
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  const { data, isLoading } = useFiscalPeriods({ page });
  const createMutation = useCreateFiscalPeriod();
  const closeMutation = useClosePeriod();
  const reopenMutation = useReopenPeriod();
  const lockMutation = useLockPeriod();
  const unlockMutation = useUnlockPeriod();
  const can = useAuthStore((s) => s.hasPermission);
  const [pending, setPending] = useState<{ action: PeriodAction; period: FiscalPeriod } | null>(null);
  const [reason, setReason] = useState('');

  const periods = data?.data ?? [];
  const meta = data?.meta;

  function handleCreate() {
    if (!name || !startDate || !endDate) return;
    createMutation.mutate(
      { name, startDate, endDate },
      {
        onSuccess: () => {
          setCreateOpen(false);
          setName('');
          setStartDate('');
          setEndDate('');
        },
      },
    );
  }

  function ask(action: PeriodAction, period: FiscalPeriod) {
    setReason('');
    setPending({ action, period });
  }

  const busy =
    closeMutation.isPending || lockMutation.isPending || reopenMutation.isPending || unlockMutation.isPending;

  function confirmPending() {
    if (!pending) return;
    const { action, period } = pending;
    const done = { onSuccess: () => setPending(null) };
    if (action === 'close') closeMutation.mutate(period.id, done);
    else if (action === 'lock') lockMutation.mutate(period.id, done);
    else if (action === 'reopen') reopenMutation.mutate({ id: period.id, reason: reason.trim() }, done);
    else unlockMutation.mutate({ id: period.id, reason: reason.trim() }, done);
  }

  return (
    <div className="space-y-4">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-1.5 text-[11px] text-muted-foreground py-1">
        <button
          onClick={() => navigate('/accounts')}
          className="hover:text-foreground transition-colors"
        >
          Accounting
        </button>
        <ChevronRight className="h-3 w-3" />
        <span className="text-foreground font-medium truncate max-w-[300px]">Fiscal Periods</span>
      </nav>

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="border-l-4 border-[#3b82f6] pl-4 space-y-1">
          <h1 className="text-3xl font-bold tracking-tight text-gray-900">Fiscal Periods</h1>
          <p className="text-sm text-gray-500">
            Manage accounting periods — open, close, and lock periods to control posting windows.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)} className="gap-1.5">
          <Plus className="h-4 w-4" /> Create Period
        </Button>
      </div>

      {/* Table */}
      <Card>
        <CardHeader className="pb-2 pt-4 px-5 bg-muted/30 border-b rounded-t-lg flex-row items-center justify-between">
          <CardTitle className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
            Periods
          </CardTitle>
          {!isLoading && meta && (
            <span className="text-[10px] text-muted-foreground">
              {meta.total} period{meta.total !== 1 ? 's' : ''}
            </span>
          )}
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/30">
                <TableHead className="text-[10px] font-bold text-muted-foreground uppercase">
                  Name
                </TableHead>
                <TableHead className="text-[10px] font-bold text-muted-foreground uppercase">
                  Start Date
                </TableHead>
                <TableHead className="text-[10px] font-bold text-muted-foreground uppercase">
                  End Date
                </TableHead>
                <TableHead className="text-[10px] font-bold text-muted-foreground uppercase">
                  Status
                </TableHead>
                <TableHead className="text-[10px] font-bold text-muted-foreground uppercase text-right">
                  Actions
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <TableRow key={`s-${i}`}>
                    {Array.from({ length: 5 }).map((_, j) => (
                      <TableCell key={j}>
                        <Skeleton className="h-4 w-full" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : periods.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={5}
                    className="text-center py-12 text-muted-foreground"
                  >
                    <div className="flex flex-col items-center gap-1">
                      <Lock className="h-8 w-8 opacity-30" />
                      <p className="font-medium text-sm">No fiscal periods found</p>
                      <p className="text-xs">
                        Create your first accounting period to get started.
                      </p>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                periods.map((p) => {
                  const badge = STATUS_BADGE[p.status];
                  return (
                    <TableRow key={p.id} className="hover:bg-muted/20">
                      <TableCell className="text-xs font-medium">{p.name}</TableCell>
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                        {format(new Date(p.startDate), 'MMM d, yyyy')}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                        {format(new Date(p.endDate), 'MMM d, yyyy')}
                      </TableCell>
                      <TableCell>
                        <Badge className={cn('text-[10px] font-semibold px-2 py-0.5', badge.className)}>
                          {badge.label}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          {p.status === 'open' && can('fiscal_period:close') && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-7 text-[10px] gap-1 border-amber-300 text-amber-700 hover:bg-amber-50"
                              onClick={() => ask('close', p)}
                              disabled={busy}
                            >
                              <CheckCircle2 className="h-3 w-3" /> Close
                            </Button>
                          )}
                          {p.status === 'closed' && can('fiscal_period:reopen') && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-7 text-[10px] gap-1 border-emerald-300 text-emerald-700 hover:bg-emerald-50"
                              onClick={() => ask('reopen', p)}
                              disabled={busy}
                            >
                              <RotateCcw className="h-3 w-3" /> Reopen
                            </Button>
                          )}
                          {p.status === 'closed' && can('fiscal_period:lock') && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-7 text-[10px] gap-1 border-slate-300 text-slate-600 hover:bg-slate-50"
                              onClick={() => ask('lock', p)}
                              disabled={busy}
                            >
                              <Lock className="h-3 w-3" /> Lock
                            </Button>
                          )}
                          {p.status === 'locked' && can('fiscal_period:unlock') && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-7 text-[10px] gap-1 border-red-300 text-red-700 hover:bg-red-50"
                              onClick={() => ask('unlock', p)}
                              disabled={busy}
                            >
                              <LockOpen className="h-3 w-3" /> Unlock
                            </Button>
                          )}
                          {p.status === 'locked' && !can('fiscal_period:unlock') && (
                            <span className="text-[10px] text-muted-foreground italic px-2">
                              Locked
                            </span>
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

      {/* Pagination */}
      {meta && meta.totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>{meta.total} total periods</span>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              Previous
            </Button>
            <span className="text-xs font-medium">
              Page {meta.page} of {meta.totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= meta.totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      )}

      {/* Lifecycle confirmation */}
      <Dialog open={!!pending} onOpenChange={(o) => !o && setPending(null)}>
        <DialogContent className="max-w-md">
          {pending && (
            <>
              <DialogHeader>
                <DialogTitle>
                  {ACTION_COPY[pending.action].title}: {pending.period.name}
                </DialogTitle>
                <DialogDescription>{ACTION_COPY[pending.action].body}</DialogDescription>
              </DialogHeader>
              {ACTION_COPY[pending.action].needsReason && (
                <div className="space-y-2 py-2">
                  <Label htmlFor="period-reason">Reason</Label>
                  <Textarea
                    id="period-reason"
                    rows={3}
                    placeholder="e.g. Late supplier invoice for March must be booked in March"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">At least 5 characters.</p>
                </div>
              )}
              <DialogFooter>
                <Button variant="outline" onClick={() => setPending(null)}>
                  Cancel
                </Button>
                <Button
                  variant={pending.action === 'unlock' ? 'destructive' : 'default'}
                  onClick={confirmPending}
                  disabled={busy || (ACTION_COPY[pending.action].needsReason && reason.trim().length < 5)}
                >
                  {busy ? 'Working…' : ACTION_COPY[pending.action].confirm}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Create Period Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Create Fiscal Period</DialogTitle>
            <DialogDescription>
              Define a new accounting period. Once created, transactions can be posted within the
              date range.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="name">Period Name</Label>
              <Input
                id="name"
                placeholder="e.g. Q1 2026, January 2026"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="startDate">Start Date</Label>
                <Input
                  id="startDate"
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="endDate">End Date</Label>
                <Input
                  id="endDate"
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setCreateOpen(false);
                setName('');
                setStartDate('');
                setEndDate('');
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={handleCreate}
              disabled={!name || !startDate || !endDate || createMutation.isPending}
            >
              {createMutation.isPending ? 'Creating…' : 'Create Period'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default FiscalPeriodsPage;
