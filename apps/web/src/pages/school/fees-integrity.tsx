/**
 * Fees ⇄ accounting integrity screens:
 *
 *   JournalTrail          the journal behind a receipt, invoice or settlement
 *   ApplicationFeeDialog  admission fee: charge → pay → waive, on the real ledger
 *   MomoGatewaysCard      per-school MTN / Airtel credentials (write-only secrets)
 *   MomoClearingCard      what the provider still holds, and recording payouts
 *   SchoolTermClosePage   term-scoped close preview, close and reopen
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  BookOpen,
  ChevronDown,
  ChevronRight,
  Lock,
  Unlock,
  AlertTriangle,
  CheckCircle2,
  Save,
  Banknote,
  Copy,
} from 'lucide-react';
import {
  useFeeJournal,
  useApplicationFee,
  useChargeApplicationFee,
  usePayApplicationFee,
  useWaiveApplicationFee,
  useMomoGateways,
  useUpsertMomoGateway,
  useMomoClearing,
  useMomoSettlements,
  useRecordMomoSettlement,
  useTerms,
  useTermCloseStatus,
  useTermClosePreview,
  useCloseTerm,
  useReopenTerm,
  type MomoGateway,
  type TermCloseSnapshot,
} from '@/features/school/api';
import { useAccounts } from '@/features/accounting/api';
import { getApiBaseUrl } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { notify } from '@/lib/notify';
import { apiError, money, sel, Stat } from './fees-shared';

const fmtDate = (d?: string | null) => (d ? new Date(d).toLocaleDateString() : '—');

/* ══════════════════ Journal trail ══════════════════ */

export function JournalTrail({ journalEntryId, label = 'Accounting entry' }: { journalEntryId?: string | null; label?: string }) {
  const [open, setOpen] = useState(false);
  const { data, isLoading, isError } = useFeeJournal(open ? journalEntryId : null);
  if (!journalEntryId) return null;

  const dr = (data?.lines ?? []).reduce((t, l) => t + l.debit, 0);
  const cr = (data?.lines ?? []).reduce((t, l) => t + l.credit, 0);

  return (
    <div className="rounded-md border print:hidden">
      <button
        type="button"
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium hover:bg-muted/40"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        <BookOpen className="h-4 w-4" /> {label}
        {data && <span className="ml-auto font-mono text-xs text-muted-foreground">{data.entryNumber}</span>}
      </button>
      {open && (
        <div className="border-t p-3 text-sm">
          {isLoading && <p className="text-muted-foreground">Loading…</p>}
          {isError && <p className="text-muted-foreground">This entry is not available to you.</p>}
          {data && (
            <>
              <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <Badge variant={data.status === 'posted' ? 'outline' : 'secondary'}>{data.status}</Badge>
                <span>{data.journal?.name ?? data.journal?.code}</span>
                <span>· {fmtDate(data.postingDate)}</span>
                {data.description && <span>· {data.description}</span>}
                <Link className="ml-auto underline" to={`/journal-entries/${data.id}`}>Open in accounting</Link>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Account</TableHead>
                    <TableHead className="text-right">Debit</TableHead>
                    <TableHead className="text-right">Credit</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.lines.map((l, i) => (
                    <TableRow key={i}>
                      <TableCell>
                        <span className="font-mono text-xs">{l.accountCode}</span> {l.accountName}
                        {l.description && <div className="text-xs text-muted-foreground">{l.description}</div>}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{l.debit ? money(l.debit) : ''}</TableCell>
                      <TableCell className="text-right tabular-nums">{l.credit ? money(l.credit) : ''}</TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="border-t-2 font-semibold">
                    <TableCell>Total</TableCell>
                    <TableCell className="text-right tabular-nums">{money(dr)}</TableCell>
                    <TableCell className="text-right tabular-nums">{money(cr)}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/* ══════════════════ Admission / application fee ══════════════════ */

const feeBadge = (state?: string) => {
  switch (state) {
    case 'paid':
      return <Badge className="bg-emerald-600">Fee paid</Badge>;
    case 'pending':
      return <Badge variant="secondary">Fee due</Badge>;
    case 'waived':
      return <Badge variant="outline">Fee waived</Badge>;
    default:
      return <Badge variant="outline" className="text-muted-foreground">No fee</Badge>;
  }
};
export { feeBadge as applicationFeeBadge };

export function ApplicationFeeDialog({
  application,
  onClose,
}: {
  application: { id: string; applicationNumber?: string; applicantFirstName?: string; applicantLastName?: string } | null;
  onClose: () => void;
}) {
  const { data, isLoading } = useApplicationFee(application?.id);
  const charge = useChargeApplicationFee();
  const pay = usePayApplicationFee();
  const waive = useWaiveApplicationFee();

  const [chargeAmount, setChargeAmount] = useState('');
  const [payAmount, setPayAmount] = useState('');
  const [method, setMethod] = useState<'cash' | 'bank' | 'mobile_money' | 'card'>('cash');
  const [reference, setReference] = useState('');

  const inv = data?.invoice && data.invoice.status !== 'cancelled' ? data.invoice : null;
  const state = data?.feeStatus;
  const canWaive = !!inv && inv.amountPaid <= 0 && state === 'pending';
  const canCharge = !inv || (inv.amountPaid <= 0 && state !== 'paid');
  const busy = charge.isPending || pay.isPending || waive.isPending;

  const doCharge = async () => {
    if (!application) return;
    const amount = Number(chargeAmount);
    if (!(amount > 0)) return notify.error('Enter a fee amount above zero');
    try {
      await charge.mutateAsync({ applicationId: application.id, amount });
      notify.success('Application fee invoiced and posted');
      setChargeAmount('');
    } catch (e) {
      notify.error(apiError(e, 'Could not charge the fee'));
    }
  };

  const doPay = async () => {
    if (!application || !inv) return;
    const amount = payAmount ? Number(payAmount) : undefined;
    if (amount !== undefined && !(amount > 0)) return notify.error('Enter an amount above zero');
    try {
      await pay.mutateAsync({ applicationId: application.id, amount, paymentMethod: method, reference: reference || undefined });
      notify.success('Payment received and receipted');
      setPayAmount('');
      setReference('');
    } catch (e) {
      notify.error(apiError(e, 'Could not record the payment'));
    }
  };

  const doWaive = async () => {
    if (!application) return;
    const reason = window.prompt('Reason for waiving the application fee (recorded permanently):');
    if (!reason?.trim()) return;
    try {
      await waive.mutateAsync({ applicationId: application.id, reason: reason.trim() });
      notify.success('Fee waived — the invoice was voided and its journal reversed');
    } catch (e) {
      notify.error(apiError(e, 'Could not waive the fee'));
    }
  };

  return (
    <Dialog open={!!application} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            Application fee · {application?.applicantFirstName} {application?.applicantLastName}
            <span className="ml-2 font-mono text-xs text-muted-foreground">{application?.applicationNumber}</span>
          </DialogTitle>
        </DialogHeader>

        {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}

        {data && (
          <div className="space-y-4 text-sm">
            <div className="flex items-center gap-2">
              {feeBadge(state)}
              {inv && <span className="font-mono text-xs text-muted-foreground">{inv.documentNumber}</span>}
            </div>

            {inv && (
              <div className="grid grid-cols-3 gap-2">
                <Stat label="Charged" value={money(inv.totalAmount)} />
                <Stat label="Paid" value={money(inv.amountPaid)} tone="emerald" />
                <Stat label="Outstanding" value={money(inv.amountResidual)} tone={inv.amountResidual > 0 ? 'rose' : 'emerald'} />
              </div>
            )}

            {inv && inv.payments.length > 0 && (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Receipt</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Method</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {inv.payments.map((p) => (
                    <TableRow key={p.allocationId}>
                      <TableCell className="font-mono text-xs">{p.paymentNumber}</TableCell>
                      <TableCell>{fmtDate(p.paymentDate)}</TableCell>
                      <TableCell className="capitalize">{p.paymentMethod?.replace('_', ' ')}</TableCell>
                      <TableCell className="text-right tabular-nums">{money(p.amount)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}

            {inv && inv.amountResidual > 0 && (
              <div className="space-y-2 rounded-md border p-3">
                <p className="font-medium">Receive payment</p>
                <div className="grid gap-2 sm:grid-cols-3">
                  <div>
                    <Label className="text-xs">Amount</Label>
                    <Input
                      inputMode="numeric"
                      placeholder={String(inv.amountResidual)}
                      value={payAmount}
                      onChange={(e) => setPayAmount(e.target.value.replace(/[^\d.]/g, ''))}
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Method</Label>
                    <select className={sel} value={method} onChange={(e) => setMethod(e.target.value as typeof method)}>
                      <option value="cash">Cash</option>
                      <option value="bank">Bank</option>
                      <option value="mobile_money">Mobile money</option>
                      <option value="card">Card</option>
                    </select>
                  </div>
                  <div>
                    <Label className="text-xs">Reference</Label>
                    <Input placeholder="Slip / txn no." value={reference} onChange={(e) => setReference(e.target.value)} />
                  </div>
                </div>
                <Button onClick={doPay} disabled={busy}>
                  <Banknote className="h-4 w-4" /> Receive {money(payAmount ? Number(payAmount) : inv.amountResidual)}
                </Button>
              </div>
            )}

            {canCharge && state !== 'waived' && (
              <div className="space-y-2 rounded-md border p-3">
                <p className="font-medium">{inv ? 'Re-charge (replaces the unpaid invoice)' : 'Charge application fee'}</p>
                <div className="flex gap-2">
                  <Input
                    inputMode="numeric"
                    placeholder="Amount"
                    value={chargeAmount}
                    onChange={(e) => setChargeAmount(e.target.value.replace(/[^\d.]/g, ''))}
                  />
                  <Button onClick={doCharge} disabled={busy}>Post invoice</Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Posts Dr Accounts Receivable / Cr Admission Fee Revenue against the guardian.
                </p>
              </div>
            )}

            {inv && <JournalTrail journalEntryId={inv.journalEntryId} label="Invoice journal" />}
          </div>
        )}

        <DialogFooter>
          {canWaive && (
            <Button variant="outline" onClick={doWaive} disabled={busy}>Waive fee</Button>
          )}
          <Button variant="ghost" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ══════════════════ Mobile money gateways ══════════════════ */

const PROVIDER_FIELDS: Record<'mtn' | 'airtel', Array<{ key: string; label: string }>> = {
  mtn: [
    { key: 'subscriptionKey', label: 'Subscription key' },
    { key: 'accessToken', label: 'Access token' },
  ],
  airtel: [
    { key: 'accessToken', label: 'Access token' },
    { key: 'country', label: 'Country code (e.g. UG)' },
  ],
};

export function MomoGatewaysCard() {
  const { data: gateways } = useMomoGateways();
  const { data: accounts } = useAccounts();
  const clearingOptions = (accounts?.data ?? []).filter((a: any) =>
    ['mobile_money', 'current_asset', 'bank'].includes(a.category?.key ?? ''),
  );
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Gateways</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-2">
        {(['mtn', 'airtel'] as const).map((p) => (
          <GatewayForm key={p} provider={p} gateway={gateways?.find((g) => g.provider === p)} clearingOptions={clearingOptions} />
        ))}
      </CardContent>
    </Card>
  );
}

function GatewayForm({
  provider,
  gateway,
  clearingOptions,
}: {
  provider: 'mtn' | 'airtel';
  gateway?: MomoGateway;
  clearingOptions: Array<{ id: string; code: string; name: string }>;
}) {
  const upsert = useUpsertMomoGateway();
  const [form, setForm] = useState<Record<string, string>>({});
  const [creds, setCreds] = useState<Record<string, string>>({});
  const [secret, setSecret] = useState('');
  const v = (k: keyof MomoGateway, fallback = '') => form[k] ?? String(gateway?.[k] ?? fallback);
  const base = getApiBaseUrl();
  const callbackUrl = `${base.startsWith('http') ? base : `${window.location.origin}${base}`}/school/mobile-money/${provider}/callback`;

  const save = async () => {
    try {
      await upsert.mutateAsync({
        provider,
        label: form.label,
        environment: (form.environment as 'sandbox' | 'production') || undefined,
        baseUrl: form.baseUrl,
        merchantCode: form.merchantCode,
        currency: form.currency,
        clearingAccountId: form.clearingAccountId === undefined ? undefined : form.clearingAccountId || null,
        isActive: form.isActive === undefined ? undefined : form.isActive === 'true',
        credentials: Object.keys(creds).length ? creds : undefined,
        callbackSecret: secret || undefined,
      });
      notify.success(`${provider.toUpperCase()} gateway saved`);
      setForm({});
      setCreds({});
      setSecret('');
    } catch (e) {
      notify.error(apiError(e, 'Could not save the gateway'));
    }
  };

  return (
    <div className="space-y-2 rounded-md border p-3 text-sm">
      <div className="flex items-center justify-between">
        <p className="font-medium">{provider === 'mtn' ? 'MTN MoMo' : 'Airtel Money'}</p>
        {gateway ? (
          <Badge variant={gateway.isActive ? 'default' : 'secondary'}>{gateway.isActive ? 'Active' : 'Inactive'}</Badge>
        ) : (
          <Badge variant="outline">Not set up</Badge>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label className="text-xs">Environment</Label>
          <select className={sel} value={v('environment', 'sandbox')} onChange={(e) => setForm({ ...form, environment: e.target.value })}>
            <option value="sandbox">Sandbox</option>
            <option value="production">Production</option>
          </select>
        </div>
        <div>
          <Label className="text-xs">Currency</Label>
          <Input value={v('currency', 'UGX')} onChange={(e) => setForm({ ...form, currency: e.target.value.toUpperCase() })} />
        </div>
        <div className="col-span-2">
          <Label className="text-xs">API base URL</Label>
          <Input placeholder="https://…" value={v('baseUrl')} onChange={(e) => setForm({ ...form, baseUrl: e.target.value })} />
        </div>
        <div>
          <Label className="text-xs">Merchant code</Label>
          <Input value={v('merchantCode')} onChange={(e) => setForm({ ...form, merchantCode: e.target.value })} />
        </div>
        <div>
          <Label className="text-xs">Status</Label>
          <select className={sel} value={v('isActive', 'true')} onChange={(e) => setForm({ ...form, isActive: e.target.value })}>
            <option value="true">Active</option>
            <option value="false">Inactive</option>
          </select>
        </div>
        {PROVIDER_FIELDS[provider].map((f) => (
          <div key={f.key}>
            <Label className="text-xs">
              {f.label} {gateway?.credentialKeys.includes(f.key) && <span className="text-emerald-600">· set</span>}
            </Label>
            <Input
              type="password"
              autoComplete="off"
              placeholder={gateway?.credentialKeys.includes(f.key) ? '•••••• (leave blank to keep)' : ''}
              value={creds[f.key] ?? ''}
              onChange={(e) => setCreds({ ...creds, [f.key]: e.target.value })}
            />
          </div>
        ))}
        <div>
          <Label className="text-xs">
            Callback secret {gateway?.hasCallbackSecret && <span className="text-emerald-600">· set</span>}
          </Label>
          <Input
            type="password"
            autoComplete="off"
            placeholder={gateway?.hasCallbackSecret ? '•••••• (leave blank to keep)' : 'HMAC secret'}
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
          />
        </div>
        <div className="col-span-2">
          <Label className="text-xs">Clearing account (where collections sit until payout)</Label>
          <select
            className={sel}
            value={form.clearingAccountId ?? gateway?.clearingAccount?.id ?? ''}
            onChange={(e) => setForm({ ...form, clearingAccountId: e.target.value })}
          >
            <option value="">Default · Mobile Money Clearing (MOMO-CLR)</option>
            {clearingOptions.map((a) => (
              <option key={a.id} value={a.id}>{a.code} · {a.name}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="flex items-center gap-2 rounded bg-muted/50 p-2 text-xs">
        <span className="truncate font-mono">{callbackUrl}</span>
        <Button
          size="sm"
          variant="ghost"
          className="ml-auto"
          onClick={() => navigator.clipboard.writeText(callbackUrl).then(() => notify.success('Callback URL copied'))}
        >
          <Copy className="h-3.5 w-3.5" />
        </Button>
      </div>
      <Button size="sm" onClick={save} disabled={upsert.isPending}>
        <Save className="h-4 w-4" /> Save
      </Button>
    </div>
  );
}

/* ══════════════════ Clearing position & settlement ══════════════════ */

export function MomoClearingCard() {
  const { data: positions } = useMomoClearing();
  const { data: settlements } = useMomoSettlements();
  const { data: accounts } = useAccounts();
  const record = useRecordMomoSettlement();
  const bankAccounts = (accounts?.data ?? []).filter((a: any) => ['bank', 'cash'].includes(a.category?.key ?? ''));

  const [provider, setProvider] = useState<'mtn' | 'airtel'>('mtn');
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [form, setForm] = useState({ reference: '', date: new Date().toISOString().slice(0, 10), charges: '', gross: '', bankAccountId: '', notes: '' });

  const position = positions?.find((p) => p.provider === provider);
  const pickedRows = (position?.unsettled ?? []).filter((r) => picked[r.id]);
  const pickedTotal = pickedRows.reduce((t, r) => t + Number(r.amount), 0);
  const gross = pickedRows.length ? pickedTotal : Number(form.gross || 0);
  const charges = Number(form.charges || 0);

  const submit = async () => {
    if (!form.reference.trim()) return notify.error('Enter the payout reference from the provider statement');
    if (!(gross > 0)) return notify.error('Select collections or enter a gross amount');
    if (!form.bankAccountId) return notify.error('Choose the bank account the payout landed in');
    try {
      await record.mutateAsync({
        provider,
        reference: form.reference.trim(),
        settlementDate: form.date,
        grossAmount: gross,
        charges,
        bankAccountId: form.bankAccountId,
        requestIds: pickedRows.length ? pickedRows.map((r) => r.id) : undefined,
        notes: form.notes || undefined,
      });
      notify.success('Payout recorded — clearing swept to bank');
      setPicked({});
      setForm({ ...form, reference: '', charges: '', gross: '', notes: '' });
    } catch (e) {
      notify.error(apiError(e, 'Could not record the payout'));
    }
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Clearing & payouts</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <p className="text-muted-foreground">
          Mobile-money receipts post to a clearing account, not cash. When the provider pays out, record it here:
          Dr Bank (net) + Dr Charges / Cr Clearing (gross). The clearing balance is then exactly what the provider still holds.
        </p>

        <div className="grid gap-2 md:grid-cols-2">
          {(positions ?? []).map((p) => (
            <div key={p.provider} className="rounded-md border p-2">
              <div className="mb-1 flex items-center gap-2 font-medium uppercase">
                {p.provider}
                {Math.abs(p.variance) <= 0.01 ? (
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                ) : (
                  <AlertTriangle className="h-4 w-4 text-amber-600" />
                )}
              </div>
              <div className="grid grid-cols-3 gap-2">
                <Stat label="GL clearing" value={money(p.glBalance)} />
                <Stat label="Unsettled receipts" value={money(p.unsettledCollections)} />
                <Stat label="Variance" value={money(p.variance)} tone={Math.abs(p.variance) <= 0.01 ? 'emerald' : 'rose'} />
              </div>
            </div>
          ))}
          {positions?.length === 0 && <p className="text-muted-foreground">Set up a gateway to see its clearing position.</p>}
        </div>

        <div className="space-y-2 rounded-md border p-3">
          <p className="font-medium">Record a payout</p>
          <div className="grid gap-2 sm:grid-cols-3">
            <div>
              <Label className="text-xs">Provider</Label>
              <select className={sel} value={provider} onChange={(e) => { setProvider(e.target.value as 'mtn' | 'airtel'); setPicked({}); }}>
                <option value="mtn">MTN</option>
                <option value="airtel">Airtel</option>
              </select>
            </div>
            <div>
              <Label className="text-xs">Payout reference</Label>
              <Input value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} />
            </div>
            <div>
              <Label className="text-xs">Date</Label>
              <Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
            </div>
            <div>
              <Label className="text-xs">Gross {pickedRows.length ? '(from selection)' : ''}</Label>
              <Input
                inputMode="numeric"
                disabled={pickedRows.length > 0}
                value={pickedRows.length ? String(pickedTotal) : form.gross}
                onChange={(e) => setForm({ ...form, gross: e.target.value.replace(/[^\d.]/g, '') })}
              />
            </div>
            <div>
              <Label className="text-xs">Provider charges</Label>
              <Input inputMode="numeric" value={form.charges} onChange={(e) => setForm({ ...form, charges: e.target.value.replace(/[^\d.]/g, '') })} />
            </div>
            <div>
              <Label className="text-xs">Bank account</Label>
              <select className={sel} value={form.bankAccountId} onChange={(e) => setForm({ ...form, bankAccountId: e.target.value })}>
                <option value="">Select…</option>
                {bankAccounts.map((a: any) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
              </select>
            </div>
          </div>
          <div className="text-xs text-muted-foreground">Net to bank: {money(Math.max(0, gross - charges))}</div>

          {(position?.unsettled ?? []).length > 0 && (
            <div className="max-h-56 overflow-auto rounded border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8" />
                    <TableHead>Reference</TableHead>
                    <TableHead>Phone</TableHead>
                    <TableHead>Received</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {position!.unsettled.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell>
                        <input
                          type="checkbox"
                          aria-label={`Include ${r.providerRef}`}
                          checked={!!picked[r.id]}
                          onChange={(e) => setPicked({ ...picked, [r.id]: e.target.checked })}
                        />
                      </TableCell>
                      <TableCell className="font-mono text-xs">{r.providerRef}</TableCell>
                      <TableCell className="font-mono text-xs">{r.msisdn}</TableCell>
                      <TableCell>{fmtDate(r.settledAt)}</TableCell>
                      <TableCell className="text-right tabular-nums">{money(r.amount)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          <Button onClick={submit} disabled={record.isPending}>Record payout</Button>
        </div>

        {(settlements ?? []).length > 0 && (
          <div className="space-y-2">
            <p className="font-medium">Recorded payouts</p>
            {(settlements ?? []).map((s) => (
              <div key={s.id} className="space-y-1 rounded-md border p-2">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="uppercase">{s.provider}</span>
                  <span className="font-mono text-xs">{s.reference}</span>
                  <span className="text-muted-foreground">{fmtDate(s.settlementDate)}</span>
                  <span className="ml-auto tabular-nums">
                    {money(s.grossAmount)} − {money(s.charges)} = <strong>{money(s.netAmount)}</strong>
                  </span>
                </div>
                <JournalTrail journalEntryId={s.journalEntryId} label="Payout journal" />
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/* ══════════════════ Term financial close ══════════════════ */

const SOURCE_LABELS: Record<string, string> = {
  school_fee: 'Tuition',
  school_penalty: 'Penalties',
  school_meal: 'Meals',
  school_transport: 'Transport',
  library_fine: 'Library fines',
  school_admission_fee: 'Admission fees',
};

function SnapshotView({ s }: { s: TermCloseSnapshot }) {
  const ok = Math.abs(s.residualVariance) <= 0.01;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Stat label="Billed" value={money(s.billed)} />
        <Stat label="Collected" value={money(s.collected)} tone="emerald" />
        <Stat label="Waived" value={money(s.waived)} />
        <Stat label="Credits applied" value={money(s.credited)} />
        <Stat label="Adjustments (net)" value={money(s.adjusted)} />
        <Stat label="Outstanding" value={money(s.balance)} tone={s.balance > 0 ? 'rose' : 'emerald'} />
        <Stat label="Invoices" value={String(s.invoiceCount)} />
        <Stat label="Payers" value={String(s.studentCount)} />
      </div>
      <div className={`flex items-center gap-2 text-sm ${ok ? 'text-emerald-700' : 'text-rose-700'}`}>
        {ok ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
        Stored invoice balances {ok ? 'agree with' : `differ by ${money(s.residualVariance)} from`} the transactions behind them.
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Source</TableHead>
            <TableHead className="text-right">Invoices</TableHead>
            <TableHead className="text-right">Billed</TableHead>
            <TableHead className="text-right">Outstanding</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {Object.entries(s.bySource).map(([k, r]) => (
            <TableRow key={k}>
              <TableCell>{SOURCE_LABELS[k] ?? k}</TableCell>
              <TableCell className="text-right">{r.invoices}</TableCell>
              <TableCell className="text-right tabular-nums">{money(r.billed)}</TableCell>
              <TableCell className="text-right tabular-nums">{money(r.outstanding)}</TableCell>
            </TableRow>
          ))}
          {Object.keys(s.bySource).length === 0 && (
            <TableRow><TableCell colSpan={4} className="text-muted-foreground">No fee invoices in this term.</TableCell></TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}

export function SchoolTermClosePage() {
  const { data: terms } = useTerms();
  const allTerms = useMemo(() => (terms?.data ?? []) as any[], [terms]);
  const [termId, setTermId] = useState('');
  const effectiveTerm = termId || allTerms.find((t) => t.isCurrent)?.id || '';
  const status = useTermCloseStatus(effectiveTerm || undefined);
  const preview = useTermClosePreview(effectiveTerm || undefined);
  const close = useCloseTerm();
  const reopen = useReopenTerm();
  const [confirmClose, setConfirmClose] = useState(false);
  const [reopenReason, setReopenReason] = useState('');
  const [showReopen, setShowReopen] = useState(false);

  const isClosed = status.data?.status === 'closed';
  const frozen = status.data?.snapshot as TermCloseSnapshot | undefined;

  const doClose = async () => {
    try {
      await close.mutateAsync(effectiveTerm);
      notify.success('Term closed — fee postings against it are now blocked');
      setConfirmClose(false);
    } catch (e) {
      notify.error(apiError(e, 'Could not close the term'));
    }
  };
  const doReopen = async () => {
    if (!reopenReason.trim()) return notify.error('A reason is required to reopen a closed term');
    try {
      await reopen.mutateAsync({ termId: effectiveTerm, reason: reopenReason.trim() });
      notify.success('Term reopened');
      setShowReopen(false);
      setReopenReason('');
    } catch (e) {
      notify.error(apiError(e, 'Could not reopen the term'));
    }
  };

  return (
    <div className="space-y-4 p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Term financial close</h1>
          <p className="text-sm text-muted-foreground">
            Freeze a term&apos;s fee totals and block further billing, collection, penalties and refunds against its
            invoices. Separate from the accounting fiscal period — the org&apos;s books stay governed by posting dates.
          </p>
        </div>
        <select className={`${sel} max-w-xs`} value={effectiveTerm} onChange={(e) => setTermId(e.target.value)}>
          <option value="">Select term…</option>
          {allTerms.map((t) => <option key={t.id} value={t.id}>{t.name}{t.isCurrent ? ' (current)' : ''}</option>)}
        </select>
      </div>

      {effectiveTerm && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              {isClosed ? <Lock className="h-4 w-4 text-rose-600" /> : <Unlock className="h-4 w-4 text-emerald-600" />}
              {isClosed ? `Closed ${fmtDate(status.data?.closedAt)}` : 'Open'}
            </CardTitle>
            {isClosed ? (
              <Button variant="outline" onClick={() => setShowReopen(true)}>
                <Unlock className="h-4 w-4" /> Reopen
              </Button>
            ) : (
              <Button variant="destructive" onClick={() => setConfirmClose(true)} disabled={!preview.data}>
                <Lock className="h-4 w-4" /> Close term
              </Button>
            )}
          </CardHeader>
          <CardContent>
            {isClosed && frozen ? (
              <>
                <p className="mb-2 text-xs text-muted-foreground">Frozen totals as of {fmtDate(frozen.computedAt ?? status.data?.closedAt)}.</p>
                <SnapshotView s={frozen} />
              </>
            ) : preview.isLoading ? (
              <p className="text-sm text-muted-foreground">Computing term totals…</p>
            ) : preview.data ? (
              <>
                <p className="mb-2 text-xs text-muted-foreground">Live preview — exactly what closing now would freeze.</p>
                <SnapshotView s={preview.data} />
              </>
            ) : (
              <p className="text-sm text-muted-foreground">{apiError(preview.error, 'Totals unavailable.')}</p>
            )}
          </CardContent>
        </Card>
      )}

      <Dialog open={confirmClose} onOpenChange={setConfirmClose}>
        <DialogContent>
          <DialogHeader><DialogTitle>Close this term?</DialogTitle></DialogHeader>
          <p className="text-sm">
            The totals above are frozen as the permanent record, and no fee transaction can post against this
            term&apos;s invoices until a different user reopens it.
          </p>
          {preview.data && Math.abs(preview.data.residualVariance) > 0.01 && (
            <p className="text-sm text-rose-700">
              Stored balances disagree with transactions by {money(preview.data.residualVariance)}. Investigate before closing.
            </p>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmClose(false)}>Cancel</Button>
            <Button variant="destructive" onClick={doClose} disabled={close.isPending}>Close term</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showReopen} onOpenChange={setShowReopen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Reopen term</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">Maker-checker: the person who closed the term cannot reopen it.</p>
          <Label className="text-xs">Reason (recorded permanently)</Label>
          <Input value={reopenReason} onChange={(e) => setReopenReason(e.target.value)} />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setShowReopen(false)}>Cancel</Button>
            <Button onClick={doReopen} disabled={reopen.isPending}>Reopen</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
