import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Archive, Kanban, LayoutList, Plus, RefreshCw, Search, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { money, date } from '@/lib/format';
import { useAuthStore } from '@/stores/auth.store';
import { useCrmDeletedDeals, useCrmDeals, useCrmUsers, useDeleteDeal, useRestoreDeal, DEAL_STAGES, STAGE_META, dealCurrency, type CrmDeal, type DealStage } from '@/features/crm/api';
import { DealsKanban } from '@/features/crm/kanban';
import { DealFormDialog } from '@/features/crm/deal-form';

const PAGE_SIZE = 50;

export function DealsPage() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const hasWrite = useAuthStore((s) => s.hasPermission('crm:deal:write'));

  const [view, setView] = useState<'kanban' | 'list'>('kanban');
  const [showArchived, setShowArchived] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<CrmDeal | null>(null);

  const [q, setQ] = useState('');
  const [stage, setStage] = useState<DealStage | ''>('');
  const [ownerId, setOwnerId] = useState('');
  const [myDeals, setMyDeals] = useState(false);
  const [page, setPage] = useState(1);

  const effectiveOwner = myDeals ? user?.id : (ownerId || undefined);

  const { data, isLoading } = useCrmDeals({
    page,
    pageSize: PAGE_SIZE,
    q: q || undefined,
    stage,
    ownerId: effectiveOwner,
  });
  const { data: deleted, isLoading: deletedLoading } = useCrmDeletedDeals();
  const { data: users } = useCrmUsers();
  const deleteDeal = useDeleteDeal();
  const restoreDeal = useRestoreDeal();

  const deals = data?.data ?? [];
  const meta = data?.meta;

  const totals = useMemo(() => {
    const map = new Map<DealStage, number>();
    for (const s of DEAL_STAGES) map.set(s, 0);
    for (const d of deals) map.set(d.stage, (map.get(d.stage) ?? 0) + 1);
    return map;
  }, [deals]);

  const filterChip = (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative w-64">
        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          className="pl-8"
          placeholder="Search deals…"
          value={q}
          onChange={(e) => { setQ(e.target.value); setPage(1); }}
        />
      </div>
      <Select value={stage} onValueChange={(v) => { setStage(v as DealStage | ''); setPage(1); }}>
        <SelectTrigger className="w-40"><SelectValue placeholder="All stages" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="__all__">All stages</SelectItem>
          {DEAL_STAGES.map((s) => (
            <SelectItem key={s} value={s} className="capitalize">{STAGE_META[s].label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={ownerId} onValueChange={(v) => { setOwnerId(v === '__all__' ? '' : v); setPage(1); }}>
        <SelectTrigger className="w-44"><SelectValue placeholder="All owners" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="__all__">All owners</SelectItem>
          {users?.map((u) => (
            <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button
        variant={myDeals ? 'default' : 'outline'}
        size="sm"
        onClick={() => { setMyDeals((v) => !v); setPage(1); }}
        className="h-9"
      >
        My deals
      </Button>
      <Button
        variant={showArchived ? 'default' : 'outline'}
        size="sm"
        onClick={() => setShowArchived((v) => !v)}
        className="h-9"
      >
        <Archive className="mr-1.5 h-4 w-4" /> Archived ({deleted?.length ?? 0})
      </Button>
    </div>
  );

  if (showArchived) {
    return (
      <div className="space-y-6 px-2 md:px-4 py-3 mx-auto">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">Archived Deals</h1>
            <p className="text-sm text-muted-foreground">Soft-deleted deals can be restored back to the pipeline.</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => setShowArchived(false)}>
            <RefreshCw className="mr-1.5 h-4 w-4" /> Back to pipeline
          </Button>
        </div>
        <Card>
          <CardContent className="p-0">
            {deletedLoading ? (
              <div className="p-6"><Skeleton className="h-40 w-full" /></div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Deal</TableHead>
                    <TableHead>Partner</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>Stage</TableHead>
                    <TableHead>Deleted</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {deleted?.length === 0 ? (
                    <TableRow><TableCell colSpan={6} className="py-8 text-center text-muted-foreground">Nothing archived.</TableCell></TableRow>
                  ) : deleted?.map((d) => (
                    <TableRow key={d.id}>
                      <TableCell className="font-medium">{d.name}</TableCell>
                      <TableCell className="text-sm">{d.partner?.name ?? '—'}</TableCell>
                      <TableCell className="text-right">{money(d.amount, dealCurrency(d))}</TableCell>
                      <TableCell><Badge variant="secondary" className={`text-xs capitalize ${STAGE_META[d.stage].chip}`}>{d.stage}</Badge></TableCell>
                      <TableCell className="text-sm">{d.deletedAt ? date(d.deletedAt) : '—'}</TableCell>
                      <TableCell className="text-right">
                        {hasWrite && (
                          <Button variant="outline" size="sm" className="h-8" onClick={() => restoreDeal.mutate(d.id)}>
                            Restore
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6 px-2 md:px-4 py-3 mx-auto">
      {/* Header bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Deals</h1>
          <p className="text-sm text-muted-foreground">Sales pipeline — drag deals between stages to update them.</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center rounded-lg border bg-muted/40 p-0.5">
            <Button variant={view === 'kanban' ? 'default' : 'ghost'} size="sm" className="h-8 gap-1.5" onClick={() => setView('kanban')}>
              <Kanban className="h-4 w-4" /> Kanban
            </Button>
            <Button variant={view === 'list' ? 'default' : 'ghost'} size="sm" className="h-8 gap-1.5" onClick={() => setView('list')}>
              <LayoutList className="h-4 w-4" /> List
            </Button>
          </div>
          {hasWrite && (
            <Button onClick={() => { setEditing(null); setFormOpen(true); }}>
              <Plus className="mr-1.5 h-4 w-4" /> New Deal
            </Button>
          )}
        </div>
      </div>

      {/* Filters */}
      {filterChip}

      {/* Kanban */}
      {view === 'kanban' && (
        <DealsKanban deals={deals} loading={isLoading} />
      )}

      {/* List */}
      {view === 'list' && (
        <Card>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-6"><Skeleton className="h-48 w-full" /></div>
            ) : (
              <>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Deal</TableHead>
                      <TableHead>Customer</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead>Stage</TableHead>
                      <TableHead>Owner</TableHead>
                      <TableHead>Expected close</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {deals.length === 0 ? (
                      <TableRow><TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
                        No deals match the current filters.
                      </TableCell></TableRow>
                    ) : deals.map((d) => (
                      <TableRow key={d.id} className="cursor-pointer hover:bg-muted/50" onClick={() => navigate(`/crm/deals/${d.id}`)}>
                        <TableCell className="font-medium">{d.name}</TableCell>
                        <TableCell className="text-sm">{d.partner?.name ?? '—'}</TableCell>
                        <TableCell className="text-right font-medium">{money(d.amount, dealCurrency(d))}</TableCell>
                        <TableCell><Badge variant="secondary" className={`text-xs capitalize ${STAGE_META[d.stage].chip}`}>{d.stage}</Badge></TableCell>
                        <TableCell className="text-sm">{d.owner?.name ?? '—'}</TableCell>
                        <TableCell className="text-sm">{d.expectedClose ? date(d.expectedClose) : '—'}</TableCell>
                        <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                          <div className="flex justify-end gap-1">
                            {hasWrite && (
                              <>
                                <Button variant="ghost" size="sm" className="h-8" onClick={() => { setEditing(d); setFormOpen(true); }}>
                                  Edit
                                </Button>
                                <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" title="Delete (archive)" onClick={() => deleteDeal.mutate(d.id)}>
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {meta && meta.totalPages > 1 && (
                  <div className="flex items-center justify-between border-t px-4 py-3">
                    <span className="text-xs text-muted-foreground">
                      Page {meta.page} of {meta.totalPages} · {meta.total} deals
                    </span>
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Prev</Button>
                      <Button variant="outline" size="sm" disabled={page >= meta.totalPages} onClick={() => setPage((p) => p + 1)}>Next</Button>
                    </div>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* Stage summary strip */}
      {view === 'kanban' && !isLoading && (
        <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
          {DEAL_STAGES.map((s) => (
            <span key={s} className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1">
              <span className={`h-1.5 w-1.5 rounded-full ${STAGE_META[s].dot}`} />
              {STAGE_META[s].label}: <b className="text-foreground">{totals.get(s) ?? 0}</b>
            </span>
          ))}
        </div>
      )}

      <DealFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        deal={editing}
        onSaved={(dealId) => navigate(`/crm/deals/${dealId}`)}
      />
    </div>
  );
}
