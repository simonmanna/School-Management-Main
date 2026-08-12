import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft, Check, CheckCircle2, ChevronRight, Handshake, Mail,
  MessageSquare, Pencil, Phone, Plus, Trash2, Users, Clock, FileText,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { money, date, dateTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/stores/auth.store';
import {
  useCrmDeal, useChangeStage, useDeleteDeal, useCreateActivity, useCompleteActivity, useDeleteActivity,
  DEAL_STAGES, STAGE_META, dealCurrency, ACTIVITY_TYPES, type ActivityType,
} from '@/features/crm/api';
import { DealFormDialog } from '@/features/crm/deal-form';

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start py-2.5 gap-4">
      <dt className="w-36 flex-shrink-0 text-xs text-muted-foreground font-semibold pt-0.5 uppercase tracking-wide">{label}</dt>
      <dd className="text-sm flex-1">{value ?? <span className="text-muted-foreground">—</span>}</dd>
    </div>
  );
}

const ACTIVITY_ICON: Record<ActivityType, React.ComponentType<{ className?: string }>> = {
  call: Phone,
  email: Mail,
  meeting: Users,
  note: MessageSquare,
  task: CheckCircle2,
  deal_stage_change: Handshake,
};

function StageStepper({ current, onChange }: { current: string; onChange: (s: any) => void }) {
  const idx = DEAL_STAGES.indexOf(current as any);
  return (
    <div className="flex items-center gap-1 overflow-x-auto pb-1">
      {DEAL_STAGES.map((s, i) => {
        const active = i <= idx;
        const isCurrent = s === current;
        return (
          <div key={s} className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => onChange(s)}
              title={`Move to ${STAGE_META[s].label}`}
              className={cn(
                'flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold capitalize transition-colors',
                isCurrent
                  ? `${STAGE_META[s].chip} border-transparent`
                  : active
                    ? 'border-primary/40 text-primary hover:bg-primary/10'
                    : 'border-muted text-muted-foreground hover:bg-muted',
              )}
            >
              {isCurrent && <Check className="h-3 w-3" />}
              {STAGE_META[s].label}
            </button>
            {i < DEAL_STAGES.length - 1 && <ChevronRight className="h-3 w-3 text-muted-foreground/40" />}
          </div>
        );
      })}
    </div>
  );
}

function ActivityComposer({ dealId, partnerId }: { dealId: string; partnerId: string }) {
  const createActivity = useCreateActivity();
  const [type, setType] = useState<ActivityType>('note');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [dueAt, setDueAt] = useState('');

  const canSubmit = title.trim().length > 0;

  const submit = () => {
    if (!canSubmit) return;
    createActivity.mutate(
      {
        type: type as 'call' | 'email' | 'meeting' | 'note' | 'task',
        title: title.trim(),
        ...(body.trim() ? { body: body.trim() } : {}),
        dealId,
        partnerId,
        ...(type === 'task' && dueAt ? { dueAt: `${dueAt}T00:00:00.000Z` } : {}),
      },
      { onSuccess: () => { setTitle(''); setBody(''); setDueAt(''); setType('note'); } },
    );
  };

  return (
    <Card>
      <CardHeader className="pb-3 px-5 pt-4 bg-muted/30 border-b rounded-t-lg">
        <CardTitle className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Log activity</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 px-5 py-4">
        <div className="grid grid-cols-3 gap-2">
          {ACTIVITY_TYPES.map((t) => {
            const Icon = ACTIVITY_ICON[t];
            return (
              <button
                key={t}
                type="button"
                onClick={() => setType(t)}
                className={cn(
                  'flex items-center justify-center gap-1.5 rounded-md border px-2 py-1.5 text-xs font-medium capitalize transition-colors',
                  type === t ? 'border-primary bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted',
                )}
              >
                <Icon className="h-3.5 w-3.5" /> {t === 'deal_stage_change' ? 'stage' : t}
              </button>
            );
          })}
        </div>
        <Input placeholder={type === 'task' ? 'Task title (e.g. Send proposal)' : `Short ${type} summary…`} value={title} onChange={(e) => setTitle(e.target.value)} />
        <Textarea rows={2} placeholder="Details (optional)" value={body} onChange={(e) => setBody(e.target.value)} />
        {type === 'task' && (
          <div className="flex items-center gap-2">
            <Label htmlFor="act-due" className="text-xs text-muted-foreground">Due</Label>
            <Input id="act-due" type="date" className="w-44" value={dueAt} onChange={(e) => setDueAt(e.target.value)} />
          </div>
        )}
        <Button size="sm" disabled={!canSubmit} onClick={submit}>
          <Plus className="mr-1.5 h-4 w-4" /> Add {type === 'task' ? 'task' : type}
        </Button>
      </CardContent>
    </Card>
  );
}

export function DealDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const hasWrite = useAuthStore((s) => s.hasPermission('crm:deal:write'));
  const [editOpen, setEditOpen] = useState(false);

  const { data: deal, isLoading } = useCrmDeal(id);
  const changeStage = useChangeStage();
  const deleteDeal = useDeleteDeal();
  const completeActivity = useCompleteActivity();
  const deleteActivity = useDeleteActivity();

  if (isLoading) {
    return (
      <div className="space-y-6 px-2 md:px-4 py-3 mx-auto">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-32 w-full rounded-xl" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  if (!deal) {
    return (
      <div className="space-y-6 px-2 md:px-4 py-3 mx-auto">
        <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-6 text-center">
          <h1 className="text-2xl font-semibold text-destructive">Not Found</h1>
          <p className="mt-2 text-sm text-muted-foreground">Deal not found or archived.</p>
          <Button variant="outline" className="mt-4" onClick={() => navigate('/crm/deals')}>
            <ArrowLeft className="mr-2 h-4 w-4" /> Back to deals
          </Button>
        </div>
      </div>
    );
  }

  const activities = deal.activities ?? [];

  return (
    <div className="space-y-6 px-2 md:px-4 py-3 mx-auto">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <button onClick={() => navigate('/crm')} className="hover:text-foreground transition-colors">CRM</button>
        <ChevronRight className="h-3.5 w-3.5" />
        <button onClick={() => navigate('/crm/deals')} className="hover:text-foreground transition-colors">Deals</button>
        <ChevronRight className="h-3.5 w-3.5" />
        <span className="text-foreground font-medium truncate">{deal.name}</span>
      </nav>

      {/* Gradient header */}
      <div className="rounded-xl bg-gradient-to-r from-indigo-600 to-violet-700 p-6 text-white shadow-lg">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-4">
            <div className="h-14 w-14 rounded-full bg-white/20 flex items-center justify-center backdrop-blur-sm">
              <Handshake className="h-7 w-7" />
            </div>
            <div>
              <h1 className="text-2xl font-bold">{deal.name}</h1>
              <div className="flex items-center gap-3 mt-1">
                <button
                  className="text-xs bg-white/20 px-2 py-0.5 rounded hover:bg-white/30 transition-colors"
                  onClick={() => navigate(`/customers/${deal.partnerId}`)}
                >
                  {deal.partner?.name ?? 'Partner'}
                </button>
                <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize ${STAGE_META[deal.stage].chip}`}>
                  {deal.stage}
                </span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {hasWrite && (
              <Button size="sm" variant="secondary" className="bg-white/20 text-white hover:bg-white/30 border-0" onClick={() => setEditOpen(true)}>
                <Pencil className="mr-1.5 h-4 w-4" /> Edit
              </Button>
            )}
            <Button size="sm" variant="secondary" className="bg-white/20 text-white hover:bg-white/30 border-0" onClick={() => navigate('/crm/deals')}>
              <ArrowLeft className="mr-1.5 h-4 w-4" /> Back
            </Button>
          </div>
        </div>
        <div className="mt-4 flex items-end justify-between">
          <div>
            <p className="text-xs uppercase tracking-wider text-white/70">Expected value</p>
            <p className="text-3xl font-bold">{money(deal.amount, dealCurrency(deal))}</p>
          </div>
          {deal.expectedClose && (
            <div className="text-right">
              <p className="text-xs uppercase tracking-wider text-white/70">Expected close</p>
              <p className="font-semibold">{date(deal.expectedClose)}</p>
            </div>
          )}
        </div>
      </div>

      {/* Stage stepper */}
      <Card>
        <CardContent className="px-5 py-4">
          <StageStepper current={deal.stage} onChange={(s) => hasWrite && changeStage.mutate({ id: deal.id, stage: s })} />
        </CardContent>
      </Card>

      <Tabs defaultValue="overview">
        <TabsList className="bg-muted/50 p-1">
          <TabsTrigger value="overview" className="data-[state=active]:bg-background">Overview</TabsTrigger>
          <TabsTrigger value="timeline" className="data-[state=active]:bg-background">Timeline ({activities.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card>
              <CardHeader className="pb-2 pt-4 px-5 bg-muted/30 border-b rounded-t-lg">
                <CardTitle className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Deal Info</CardTitle>
              </CardHeader>
              <CardContent className="px-5 pb-4">
                <dl className="divide-y">
                  <InfoRow label="Customer" value={deal.partner?.name} />
                  <InfoRow label="Value" value={<span className="font-semibold">{money(deal.amount, dealCurrency(deal))}</span>} />
                  <InfoRow label="Currency" value={deal.currencyCode} />
                  <InfoRow label="Stage" value={<Badge variant="secondary" className={`text-xs capitalize ${STAGE_META[deal.stage].chip}`}>{deal.stage}</Badge>} />
                  <InfoRow label="Owner" value={deal.owner?.name ?? 'Unassigned'} />
                  <InfoRow label="Expected close" value={deal.expectedClose ? date(deal.expectedClose) : null} />
                  <InfoRow label="Created" value={<span className="text-sm">{dateTime(deal.createdAt)}</span>} />
                  <InfoRow label="Updated" value={<span className="text-sm">{dateTime(deal.updatedAt)}</span>} />
                </dl>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2 pt-4 px-5 bg-muted/30 border-b rounded-t-lg">
                <CardTitle className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Notes</CardTitle>
              </CardHeader>
              <CardContent className="px-5 pb-4">
                {deal.notes ? (
                  <p className="whitespace-pre-wrap text-sm text-foreground">{deal.notes}</p>
                ) : (
                  <p className="text-sm text-muted-foreground">No notes yet.</p>
                )}
                {hasWrite && (
                  <div className="mt-4 border-t pt-3">
                    {deal.stage === 'won' ? (
                      <p className="text-xs text-muted-foreground">Won deals are archived permanently and cannot be deleted.</p>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-destructive hover:text-destructive"
                        onClick={() => {
                          if (window.confirm(`Archive deal “${deal.name}”? It can be restored from the archived view.`)) {
                            deleteDeal.mutate(deal.id);
                            navigate('/crm/deals');
                          }
                        }}
                      >
                        <Trash2 className="mr-1.5 h-4 w-4" /> Archive deal
                      </Button>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="timeline" className="mt-6 space-y-6">
          {hasWrite && <ActivityComposer dealId={deal.id} partnerId={deal.partnerId} />}

          <Card>
            <CardHeader className="pb-3 px-5 pt-4 bg-muted/30 border-b rounded-t-lg">
              <CardTitle className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Timeline</CardTitle>
            </CardHeader>
            <CardContent className="px-5 py-4">
              {activities.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">No activity yet — log a call, meeting or note.</p>
              ) : (
                <ul className="space-y-4">
                  {activities.map((a) => {
                    const Icon = ACTIVITY_ICON[a.type];
                    return (
                      <li key={a.id} className="flex gap-3">
                        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                          <Icon className="h-4 w-4" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <p className="text-sm font-medium text-foreground">{a.title}</p>
                            <span className="text-[11px] text-muted-foreground">{dateTime(a.occurredAt)}</span>
                          </div>
                          {a.body && <p className="mt-0.5 whitespace-pre-wrap text-sm text-muted-foreground">{a.body}</p>}
                          <div className="mt-1 flex flex-wrap items-center gap-2">
                            <Badge variant="outline" className="text-[10px] capitalize">{a.type.replace(/_/g, ' ')}</Badge>
                            {a.subjectType === 'Invoice' && a.subjectId && (
                              <Button variant="link" size="sm" className="h-6 px-1 text-[11px] text-primary" onClick={() => navigate(`/invoices/${a.subjectId}`)}>
                                <FileText className="mr-1 h-3 w-3" /> View invoice
                              </Button>
                            )}
                            {a.type === 'task' && (
                              <>
                                {a.dueAt && (
                                  <span className={cn('flex items-center gap-1 text-[11px]', a.status === 'done' ? 'text-emerald-600 line-through' : 'text-muted-foreground')}>
                                    <Clock className="h-3 w-3" /> Due {date(a.dueAt)}
                                  </span>
                                )}
                                {a.status !== 'done' ? (
                                  <Button variant="outline" size="sm" className="h-6 px-2 text-[11px]" onClick={() => completeActivity.mutate(a.id)}>
                                    <Check className="mr-1 h-3 w-3" /> Complete
                                  </Button>
                                ) : (
                                  <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 text-[10px]">Done</Badge>
                                )}
                              </>
                            )}
                            {hasWrite && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6 text-muted-foreground hover:text-destructive"
                                title="Delete activity"
                                onClick={() => deleteActivity.mutate(a.id)}
                              >
                                <Trash2 className="h-3 w-3" />
                              </Button>
                            )}
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <DealFormDialog open={editOpen} onOpenChange={setEditOpen} deal={deal} />
    </div>
  );
}
