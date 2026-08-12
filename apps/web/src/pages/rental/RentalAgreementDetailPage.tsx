import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { ArrowLeft, CalendarDays, CheckCircle2, Plus, X, Layers, Banknote } from 'lucide-react';
import {
  useRentalAgreement,
  useConfirmAgreement,
  useCheckoutAgreement,
  useCancelAgreement,
  useRentalDeposit,
  useCollectDeposit,
  useRefundDeposit,
  useExtendLine,
  useSwapUnit,
  useRentalReturns,
} from '@/features/rental/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { date } from '@/lib/format';

const fmt = (n: number | string) => `Rp ${Number(n || 0).toLocaleString('id-ID')}`;

const STATUS_STYLES: Record<string, string> = {
  draft: 'bg-muted text-muted-foreground',
  pending_approval: 'bg-amber-100 text-amber-800',
  confirmed: 'bg-blue-100 text-blue-800',
  checked_out: 'bg-emerald-100 text-emerald-800',
  overdue: 'bg-red-100 text-red-800',
  closed: 'bg-muted text-muted-foreground',
  cancelled: 'bg-muted text-muted-foreground',
};

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start gap-4 py-2.5">
      <dt className="w-40 flex-shrink-0 pt-0.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="flex-1 text-sm">{value ?? <span className="text-muted-foreground">—</span>}</dd>
    </div>
  );
}

export function RentalAgreementDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { data: agreement } = useRentalAgreement(id);
  const { data: deposit } = useRentalDeposit(id);
  const { data: returnsData } = useRentalReturns({ agreementId: id });
  const confirm = useConfirmAgreement();
  const checkout = useCheckoutAgreement();
  const cancel = useCancelAgreement();
  const collect = useCollectDeposit();
  const refund = useRefundDeposit();
  const extendLine = useExtendLine();
  const swapUnit = useSwapUnit();

  const [collectOpen, setCollectOpen] = useState(false);
  const [collectAmt, setCollectAmt] = useState('');
  const [refundOpen, setRefundOpen] = useState(false);
  const [refundAmt, setRefundAmt] = useState('');
  const [extendFor, setExtendFor] = useState('');
  const [extendLineId, setExtendLineId] = useState('');

  const lines = agreement?.lines ?? [];
  const returns = returnsData?.items ?? [];

  const run = async (fn: () => Promise<unknown>, msg: string) => {
    try {
      await fn();
      toast.success(msg);
    } catch (e: any) {
      toast.error(e?.response?.data?.message ?? msg + ' failed');
    }
  };

  if (!agreement) {
    return (
      <div className="space-y-4 p-6">
        <button onClick={() => navigate('/rental/agreements')} className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Agreements
        </button>
        <p className="text-sm text-muted-foreground">Loading agreement…</p>
      </div>
    );
  }

  return (
    <div className="space-y-4 p-6">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-2 text-sm text-muted-foreground">
        <button onClick={() => navigate('/rental/agreements')} className="hover:text-foreground">Rentals</button>
        <span>/</span>
        <span>Agreements</span>
        <span>/</span>
        <span className="text-foreground">{agreement.agreementNumber}</span>
      </nav>

      {/* Header bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <CalendarDays className="h-5 w-5 text-primary" />
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-semibold">{agreement.agreementNumber}</h1>
              <Badge variant="outline" className={STATUS_STYLES[agreement.status] ?? ''}>{agreement.status}</Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              {date(agreement.startAt)} → {date(agreement.dueAt)} · Partner {agreement.partnerId.slice(0, 8)}…
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          {agreement.status === 'pending_approval' && (
            <Button size="sm" onClick={() => run(() => confirm.mutateAsync(agreement.id), 'Agreement confirmed')}>
              <CheckCircle2 className="h-4 w-4" /> Confirm
            </Button>
          )}
          {agreement.status === 'confirmed' && (
            <Button size="sm" onClick={() => run(() => checkout.mutateAsync({ id: agreement.id }), 'Checked out')}>
              <Layers className="h-4 w-4" /> Checkout
            </Button>
          )}
          {(agreement.status === 'draft' || agreement.status === 'confirmed') && (
            <Button size="sm" variant="destructive" onClick={() => run(() => cancel.mutateAsync(agreement.id), 'Agreement cancelled')}>
              <X className="h-4 w-4" /> Cancel
            </Button>
          )}
        </div>
      </div>

      <Tabs defaultValue="lines">
        <TabsList>
          <TabsTrigger value="lines">Lines</TabsTrigger>
          <TabsTrigger value="deposit">Deposit</TabsTrigger>
          <TabsTrigger value="returns">Returns ({returns.length})</TabsTrigger>
          <TabsTrigger value="summary">Summary</TabsTrigger>
        </TabsList>

        <TabsContent value="lines" className="space-y-4">
          <Card>
            <CardHeader className="bg-muted/30 border-b rounded-t-lg">
              <CardTitle className="text-sm">Rental lines</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="divide-y">
                {lines.length === 0 && <p className="p-6 text-sm text-muted-foreground">No lines.</p>}
                {lines.map((l) => (
                  <div key={l.id} className="flex items-center justify-between px-4 py-3">
                    <div>
                      <p className="text-sm font-medium">{l.product?.name ?? l.productId.slice(0, 8)}</p>
                      <p className="text-xs text-muted-foreground">Qty {l.quantity} · {l.ratePeriod} · due {date(l.dueAt)}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-medium">{fmt(l.lineTotal)}</span>
                      <div className="flex gap-1">
                        <button
                          className="rounded border px-2 py-1 text-xs hover:bg-muted"
                          onClick={() => { setExtendLineId(l.id); setExtendFor(''); }}
                          title="Extend due date"
                        >
                          Extend
                        </button>
                        <button
                          className="rounded border px-2 py-1 text-xs hover:bg-muted"
                          onClick={() => {
                            const to = window.prompt('Swap to unit ID (leave empty to pick first available):', '');
                            run(() => swapUnit.mutateAsync({ agreementId: agreement.id, lineId: l.id, toUnitId: to ?? '' }), 'Unit swapped');
                          }}
                          title="Swap unit"
                        >
                          Swap
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {extendLineId && (
            <Card>
              <CardHeader className="bg-muted/30 border-b rounded-t-lg">
                <CardTitle className="text-sm">Extend line</CardTitle>
              </CardHeader>
              <CardContent className="flex items-end gap-2 p-4">
                <label className="flex-1">
                  <span className="mb-1 block text-xs font-medium text-muted-foreground">New due date</span>
                  <input type="date" value={extendFor} onChange={(e) => setExtendFor(e.target.value)} className="w-full rounded-md border bg-card px-3 py-2 text-sm" />
                </label>
                <Button
                  size="sm"
                  onClick={() => run(
                    () => extendLine.mutateAsync({ agreementId: agreement.id, lineId: extendLineId, newDueAt: new Date(extendFor + 'T23:59:59').toISOString() }),
                    'Line extended',
                  )}
                  disabled={!extendFor}
                >
                  Apply
                </Button>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="deposit" className="space-y-4">
          <Card>
            <CardHeader className="bg-muted/30 border-b rounded-t-lg">
              <CardTitle className="text-sm">Deposit ledger</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <dl className="grid grid-cols-2 gap-4 p-4 lg:grid-cols-4">
                <div className="rounded-lg border p-3">
                  <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Collected</dt>
                  <dd className="mt-1 text-lg font-semibold">{fmt(deposit?.totalCollected ?? 0)}</dd>
                </div>
                <div className="rounded-lg border p-3">
                  <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Applied</dt>
                  <dd className="mt-1 text-lg font-semibold">{fmt(deposit?.totalApplied ?? 0)}</dd>
                </div>
                <div className="rounded-lg border p-3">
                  <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Refunded</dt>
                  <dd className="mt-1 text-lg font-semibold">{fmt(deposit?.totalRefunded ?? 0)}</dd>
                </div>
                <div className="rounded-lg border p-3">
                  <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Forfeited</dt>
                  <dd className="mt-1 text-lg font-semibold">{fmt(deposit?.totalForfeited ?? 0)}</dd>
                </div>
              </dl>
              <div className="flex gap-2 px-4 pb-4">
                <Button size="sm" variant="outline" onClick={() => setCollectOpen((v) => !v)}>
                  <Plus className="h-4 w-4" /> Collect
                </Button>
                <Button size="sm" variant="outline" onClick={() => setRefundOpen((v) => !v)}>
                  <Banknote className="h-4 w-4" /> Refund
                </Button>
              </div>
              {collectOpen && (
                <div className="flex items-end gap-2 border-t px-4 py-3">
                  <input
                    type="number"
                    placeholder="Amount"
                    value={collectAmt}
                    onChange={(e) => setCollectAmt(e.target.value)}
                    className="w-40 rounded-md border bg-card px-3 py-2 text-sm"
                  />
                  <Button size="sm" onClick={() => run(() => collect.mutateAsync({ agreementId: agreement.id, method: 'cash', amount: Number(collectAmt) }), 'Deposit collected')}>
                    Collect
                  </Button>
                </div>
              )}
              {refundOpen && (
                <div className="flex items-end gap-2 border-t px-4 py-3">
                  <input
                    type="number"
                    placeholder="Amount"
                    value={refundAmt}
                    onChange={(e) => setRefundAmt(e.target.value)}
                    className="w-40 rounded-md border bg-card px-3 py-2 text-sm"
                  />
                  <Button size="sm" onClick={() => run(() => refund.mutateAsync({ agreementId: agreement.id, method: 'cash', amount: Number(refundAmt) }), 'Deposit refunded')}>
                    Refund
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="returns">
          <Card>
            <CardHeader className="bg-muted/30 border-b rounded-t-lg">
              <CardTitle className="text-sm">Returns for this agreement</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="divide-y">
                {returns.length === 0 && <p className="p-6 text-sm text-muted-foreground">No returns recorded.</p>}
                {returns.map((r) => (
                  <div key={r.id} className="flex items-center justify-between px-4 py-3">
                    <div>
                      <p className="text-sm font-medium">{r.returnNumber}</p>
                      <p className="text-xs text-muted-foreground">{date(r.receivedAt)} · {r.lines.length} line(s)</p>
                    </div>
                    <Badge variant="outline">{r.lines.every((l) => l.isMissing) ? 'missing' : r.lines.some((l) => l.damages.length > 0) ? 'damaged' : 'ok'}</Badge>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="summary">
          <Card>
            <CardHeader className="bg-muted/30 border-b rounded-t-lg">
              <CardTitle className="text-sm">Agreement summary</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="divide-y">
                <InfoRow label="Number" value={agreement.agreementNumber} />
                <InfoRow label="Status" value={<Badge variant="outline" className={STATUS_STYLES[agreement.status] ?? ''}>{agreement.status}</Badge>} />
                <InfoRow label="Start" value={date(agreement.startAt)} />
                <InfoRow label="Due" value={date(agreement.dueAt)} />
                <InfoRow label="Fees total" value={fmt(agreement.lines?.reduce((s, l) => s + Number(l.lineTotal), 0) ?? 0)} />
                <InfoRow label="Late fees" value={fmt(agreement.lateFeeTotal ?? 0)} />
                <InfoRow label="Damage charges" value={fmt(agreement.damageTotal ?? 0)} />
                <InfoRow label="Deposit applied" value={fmt(agreement.depositApplied ?? 0)} />
                <InfoRow label="Settlement" value={fmt(agreement.settlementTotal ?? 0)} />
              </dl>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
