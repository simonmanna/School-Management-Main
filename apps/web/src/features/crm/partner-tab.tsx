import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Handshake, Plus, Receipt, ShoppingBag, CalendarClock, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { money, date, dateTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/stores/auth.store';
import {
  useCrmDeals, useCrmActivities, useCrmPartner360, useCompleteActivity, STAGE_META, dealCurrency,
  type ActivityType,
} from './api';
import { DealFormDialog } from './deal-form';

const ACTIVITY_LABEL: Record<ActivityType, string> = {
  call: 'Call',
  email: 'Email',
  meeting: 'Meeting',
  note: 'Note',
  task: 'Task',
  deal_stage_change: 'Stage change',
};

/** CRM 360 tab shown on customer / partner detail pages: this partner's deals,
 *  activity timeline and a one-click deal creator. */
export function CrmPartnerTab({ partnerId }: { partnerId: string }) {
  const navigate = useNavigate();
  const hasWrite = useAuthStore((s) => s.hasPermission('crm:deal:write'));
  const [formOpen, setFormOpen] = useState(false);
  const completeActivity = useCompleteActivity();

  const { data: deals, isLoading: dealsLoading } = useCrmDeals({ partnerId, page: 1, pageSize: 20 });
  const { data: activities, isLoading: actsLoading } = useCrmActivities({ partnerId, page: 1, pageSize: 15 });
  const { data: spend, isLoading: spendLoading } = useCrmPartner360(partnerId);

  return (
    <div className="space-y-6">
      {/* C1 — spend stats from POS documents */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="flex items-start justify-between px-5 py-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Total spent</p>
              <p className="mt-1 text-xl font-bold">{spendLoading ? '…' : money(spend?.totalSpent ?? 0, 'IDR')}</p>
            </div>
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-indigo-100 text-indigo-700"><Receipt className="h-4.5 w-4.5" /></div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-start justify-between px-5 py-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Orders</p>
              <p className="mt-1 text-xl font-bold">{spendLoading ? '…' : String(spend?.orderCount ?? 0)}</p>
            </div>
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-sky-100 text-sky-700"><ShoppingBag className="h-4.5 w-4.5" /></div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-start justify-between px-5 py-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Last order</p>
              <p className="mt-1 text-xl font-bold">{spendLoading ? '…' : (spend?.lastOrderAt ? date(spend.lastOrderAt) : '—')}</p>
            </div>
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-violet-100 text-violet-700"><CalendarClock className="h-4.5 w-4.5" /></div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-start justify-between px-5 py-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Open receivable</p>
              <p className={cn('mt-1 text-xl font-bold', (spend?.openReceivable ?? 0) > 0 ? 'text-amber-600' : '')}>
                {spendLoading ? '…' : money(spend?.openReceivable ?? 0, 'IDR')}
              </p>
            </div>
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-700"><AlertCircle className="h-4.5 w-4.5" /></div>
          </CardContent>
        </Card>
      </div>
      {/* Deals */}
      <Card>
        <CardHeader className="pb-3 px-5 pt-4 bg-muted/30 border-b rounded-t-lg flex flex-row items-center justify-between">
          <CardTitle className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Deals</CardTitle>
          {hasWrite && (
            <Button size="sm" className="h-8" onClick={() => setFormOpen(true)}>
              <Plus className="mr-1.5 h-4 w-4" /> New Deal
            </Button>
          )}
        </CardHeader>
        <CardContent className="p-0">
          {dealsLoading ? (
            <div className="p-6"><Skeleton className="h-32 w-full" /></div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Deal</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Stage</TableHead>
                  <TableHead>Owner</TableHead>
                  <TableHead>Expected close</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(deals?.data ?? []).length === 0 ? (
                  <TableRow><TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                    No deals for this partner yet.
                  </TableCell></TableRow>
                ) : deals?.data.map((d) => (
                  <TableRow key={d.id} className="cursor-pointer hover:bg-muted/50" onClick={() => navigate(`/crm/deals/${d.id}`)}>
                    <TableCell className="font-medium">{d.name}</TableCell>
                    <TableCell className="text-right font-medium">{money(d.amount, dealCurrency(d))}</TableCell>
                    <TableCell><Badge variant="secondary" className={`text-xs capitalize ${STAGE_META[d.stage].chip}`}>{d.stage}</Badge></TableCell>
                    <TableCell className="text-sm">{d.owner?.name ?? '—'}</TableCell>
                    <TableCell className="text-sm">{d.expectedClose ? date(d.expectedClose) : '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Timeline */}
      <Card>
        <CardHeader className="pb-3 px-5 pt-4 bg-muted/30 border-b rounded-t-lg">
          <CardTitle className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Activity timeline</CardTitle>
        </CardHeader>
        <CardContent className="px-5 py-4">
          {actsLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : (activities?.data ?? []).length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">No activity logged for this partner.</p>
          ) : (
            <ul className="space-y-3">
              {activities?.data.map((a) => (
                <li key={a.id} className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground">{a.title}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {ACTIVITY_LABEL[a.type]} · {dateTime(a.occurredAt)}
                      {a.dueAt ? ` · due ${date(a.dueAt)}` : ''}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {a.type === 'task' && a.status !== 'done' && (
                      <Button variant="outline" size="sm" className="h-7 px-2 text-[11px]" onClick={() => completeActivity.mutate(a.id)}>
                        Complete
                      </Button>
                    )}
                    {a.status === 'done' && <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 text-[10px]">Done</Badge>}
                    {a.dealId && (
                      <Button variant="ghost" size="sm" className="h-7 px-2 text-[11px]" onClick={() => navigate(`/crm/deals/${a.dealId}`)}>
                        <Handshake className={cn('mr-1 h-3 w-3')} /> Deal
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <DealFormDialog open={formOpen} onOpenChange={setFormOpen} presetPartnerId={partnerId} onSaved={(dealId) => navigate(`/crm/deals/${dealId}`)} />
    </div>
  );
}
