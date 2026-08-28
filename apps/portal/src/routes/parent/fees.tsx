import { useState } from 'react';
import { Smartphone, Info, Clock, CheckCircle2, XCircle, FileText, AlertTriangle } from 'lucide-react';
import { useActiveStudent } from '@/stores/auth.store';
import {
  useBalanceExplainer, usePayQuote, usePayments, usePay, useOutstanding, useStatement,
} from '@/lib/portal-api';
import { formatCurrency } from '@/lib/utils';
import { apiErrorMessage } from '@/lib/api';
import { notify } from '@/lib/notify';
import {
  Button, Card, CardContent, CardHeader, CardTitle, Input, Badge, Skeleton, Empty, PageTitle, Stat,
} from '@/components/ui';

/**
 * Fees — the screen the portal exists for.
 *
 * Every figure comes from `SchoolFinanceQueryService`, the one canonical fee
 * calculation the bursar's screens read. The portal computes nothing: a balance
 * that disagrees with the receipt book by even a little is worse than no portal
 * at all, and the fastest way to get there is a frontend doing its own
 * "invoice total minus payments" arithmetic.
 */
export default function ParentFees() {
  const active = useActiveStudent();
  const id = active?.studentProfileId;

  const { data: explain, isLoading } = useBalanceExplainer(id);
  const { data: owed } = useOutstanding(id);
  const { data: quote } = usePayQuote(id);
  const { data: payments } = usePayments(id);
  const pay = usePay();

  const [amount, setAmount] = useState('');
  const [phone, setPhone] = useState('');
  const [provider, setProvider] = useState<'mtn' | 'airtel'>('mtn');
  const [showStatement, setShowStatement] = useState(false);

  if (!id) return <Empty title="No pupil selected" />;
  if (isLoading) return <div className="space-y-3"><Skeleton className="h-24" /><Skeleton className="h-40" /></div>;

  const outstanding = Number(owed?.outstanding ?? explain?.summary.outstanding ?? 0);
  const overdue = Number(owed?.overdue ?? 0);
  const providers = quote?.providers;
  const canPay = !!providers && (providers.mtn || providers.airtel);

  const submit = async () => {
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) {
      notify.error('Enter the amount you want to pay.');
      return;
    }
    try {
      const res = await pay.mutateAsync({ studentProfileId: id, provider, amount: value, phone: phone.trim() });
      // Deliberately NOT "payment successful". Initiating only sends a prompt;
      // the money is not recorded until the provider confirms on the callback,
      // and telling a parent it worked before then is how a family arrives at
      // the office believing they have paid.
      notify.success('Check your phone', res.message ?? 'Approve the prompt to complete the payment.');
      setAmount('');
    } catch (e) {
      notify.error(apiErrorMessage(e, 'Could not start the payment.'));
    }
  };

  return (
    <div className="space-y-4">
      <PageTitle sub={active?.name}>Fees</PageTitle>

      {/* Balance and "due now" are different questions. A family paying by
          instalments is not a defaulter, and one number for both makes them
          look like one. */}
      <div className="grid grid-cols-2 gap-3">
        <Stat
          label="Outstanding"
          value={formatCurrency(outstanding)}
          tone={outstanding > 0 ? 'default' : 'good'}
          sub={outstanding > 0 ? 'Total still owed' : 'Nothing owed'}
        />
        <Stat
          label="Overdue"
          value={formatCurrency(overdue)}
          tone={overdue > 0 ? 'bad' : 'good'}
          sub={
            overdue > 0
              ? `${owed?.overdueInvoiceCount ?? 0} invoice${(owed?.overdueInvoiceCount ?? 0) === 1 ? '' : 's'} past due`
              : owed?.nextDueDate
                ? `Next due ${new Date(owed.nextDueDate).toLocaleDateString()}`
                : 'Nothing past due'
          }
        />
      </div>

      {overdue > 0 && (
        <div className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/5 p-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
          <p className="text-sm">
            {formatCurrency(overdue)} was due on or before today. Please settle it or speak to the
            bursar about a payment plan.
          </p>
        </div>
      )}

      {explain && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Info className="h-4 w-4" /> How this is worked out
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            {/* The server's own sentence, rendered as written. The bursar reads
                the same one at the window, so the two cannot contradict. */}
            <p className="pb-3 text-sm text-muted-foreground">{explain.headline}</p>
            <dl className="divide-y text-sm">
              <Line label="Billed" value={explain.summary.billed} />
              <Line label="Paid" value={explain.summary.paid} />
              {/* Waived money is shown on its own line and never folded into
                  "paid" — telling a bursary family they paid money they never
                  paid is the exact defect that split these fields apart. */}
              {explain.summary.waived > 0 && <Line label="Bursary / waived" value={explain.summary.waived} />}
              {explain.summary.credited > 0 && <Line label="Credit applied" value={explain.summary.credited} />}
              {explain.summary.adjusted !== 0 && <Line label="Adjustments" value={explain.summary.adjusted} />}
              <Line label="Outstanding" value={explain.summary.outstanding} strong />
            </dl>

            <Button
              variant="outline"
              size="sm"
              className="mt-3 w-full"
              onClick={() => setShowStatement((v) => !v)}
            >
              <FileText className="h-4 w-4" /> {showStatement ? 'Hide' : 'View'} full statement
            </Button>
          </CardContent>
        </Card>
      )}

      {showStatement && <StatementCard studentProfileId={id} />}

      {outstanding > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Smartphone className="h-4 w-4" /> Pay by mobile money
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 pt-0">
            {!canPay ? (
              <p className="text-sm text-muted-foreground">
                Mobile money is not switched on for this school yet. Pay at the school office
                or by bank transfer.
              </p>
            ) : (
              <>
                <div className="flex gap-2">
                  {providers?.mtn && (
                    <Button
                      type="button"
                      variant={provider === 'mtn' ? 'default' : 'outline'}
                      className="flex-1"
                      onClick={() => setProvider('mtn')}
                    >
                      MTN
                    </Button>
                  )}
                  {providers?.airtel && (
                    <Button
                      type="button"
                      variant={provider === 'airtel' ? 'default' : 'outline'}
                      className="flex-1"
                      onClick={() => setProvider('airtel')}
                    >
                      Airtel
                    </Button>
                  )}
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="amount" className="text-sm font-medium">Amount</label>
                  <Input
                    id="amount"
                    type="number"
                    inputMode="numeric"
                    min={1}
                    placeholder={String(outstanding)}
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                  />
                  <div className="flex flex-wrap gap-3 pt-1">
                    {overdue > 0 && (
                      <button
                        type="button"
                        className="text-sm font-medium text-primary hover:underline"
                        onClick={() => setAmount(String(overdue))}
                      >
                        Pay the overdue {formatCurrency(overdue)}
                      </button>
                    )}
                    <button
                      type="button"
                      className="text-sm font-medium text-primary hover:underline"
                      onClick={() => setAmount(String(outstanding))}
                    >
                      Pay all {formatCurrency(outstanding)}
                    </button>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="phone" className="text-sm font-medium">Phone number</label>
                  <Input
                    id="phone"
                    type="tel"
                    inputMode="tel"
                    placeholder="07XX XXX XXX"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                  />
                </div>

                <Button size="lg" className="w-full" disabled={pay.isPending || !phone.trim()} onClick={submit}>
                  {pay.isPending ? 'Starting…' : 'Pay now'}
                </Button>
                <p className="text-xs text-muted-foreground">
                  Your phone will prompt you to approve. The payment is recorded only once the
                  network confirms it — watch the list below.
                </p>
              </>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle className="text-base">Your recent payments</CardTitle></CardHeader>
        <CardContent className="space-y-2 pt-0">
          {(payments ?? []).length === 0 && (
            <p className="text-sm text-muted-foreground">No payment attempts from this portal yet.</p>
          )}
          {(payments ?? []).map((p) => (
            <div key={p.id} className="flex items-center gap-3 rounded-lg border p-3">
              <PaymentIcon status={p.status} />
              <div className="min-w-0 flex-1">
                <div className="font-medium">{formatCurrency(Number(p.amount))}</div>
                <div className="truncate text-xs text-muted-foreground">
                  {p.provider.toUpperCase()} · {new Date(p.createdAt).toLocaleString()}
                </div>
                {p.failureReason && <div className="text-xs text-destructive">{p.failureReason}</div>}
              </div>
              <Badge variant={badgeTone(p.status)}>{statusWord(p.status)}</Badge>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

/** The ledger the bursar prints, rendered for a phone. */
function StatementCard({ studentProfileId }: { studentProfileId: string }) {
  const { data, isLoading } = useStatement(studentProfileId);

  if (isLoading) return <Skeleton className="h-40 w-full" />;
  if (!data) return null;

  const rows = data.ledger?.rows ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          Statement{data.term?.name ? ` · ${data.term.name}` : ''}
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No transactions in this term yet.</p>
        ) : (
          // Wide content scrolls inside its own box; the page itself never
          // scrolls sideways on a phone.
          <div className="-mx-1 overflow-x-auto">
            <table className="w-full min-w-[30rem] text-sm">
              <thead className="border-b text-left text-muted-foreground">
                <tr>
                  <th className="px-2 py-1 font-medium">Date</th>
                  <th className="px-2 py-1 font-medium">Detail</th>
                  <th className="px-2 py-1 text-right font-medium">Charge</th>
                  <th className="px-2 py-1 text-right font-medium">Paid</th>
                  <th className="px-2 py-1 text-right font-medium">Balance</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className="border-b last:border-0">
                    <td className="whitespace-nowrap px-2 py-1.5">{new Date(r.date).toLocaleDateString()}</td>
                    <td className="px-2 py-1.5">{r.description || r.ledgerType}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{r.debit ? formatCurrency(r.debit) : '—'}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{r.credit ? formatCurrency(r.credit) : '—'}</td>
                    <td className="px-2 py-1.5 text-right font-medium tabular-nums">{formatCurrency(r.balance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="pt-3 text-xs text-muted-foreground">
          Generated {new Date(data.generatedAt).toLocaleString()}.
        </p>
      </CardContent>
    </Card>
  );
}

function Line({ label, value, strong }: { label: string; value: number | string; strong?: boolean }) {
  return (
    <div className={`flex justify-between py-2 ${strong ? 'font-semibold' : ''}`}>
      <dt className={strong ? '' : 'text-muted-foreground'}>{label}</dt>
      <dd className="tabular-nums">{formatCurrency(Number(value))}</dd>
    </div>
  );
}

/** Provider vocabulary a family has not agreed to learn. */
function statusWord(status: string): string {
  const s = status.toLowerCase();
  if (s.includes('success') || s.includes('complete')) return 'paid';
  if (s.includes('fail') || s.includes('reject')) return 'failed';
  if (s.includes('pending') || s.includes('request')) return 'waiting for you';
  return status;
}

function badgeTone(status: string) {
  const s = status.toLowerCase();
  if (s.includes('success') || s.includes('complete')) return 'success' as const;
  if (s.includes('fail') || s.includes('reject')) return 'destructive' as const;
  return 'secondary' as const;
}

function PaymentIcon({ status }: { status: string }) {
  const s = status.toLowerCase();
  if (s.includes('success') || s.includes('complete')) {
    return <CheckCircle2 className="h-5 w-5 shrink-0 text-[hsl(var(--success))]" />;
  }
  if (s.includes('fail') || s.includes('reject')) {
    return <XCircle className="h-5 w-5 shrink-0 text-destructive" />;
  }
  return <Clock className="h-5 w-5 shrink-0 text-muted-foreground" />;
}
