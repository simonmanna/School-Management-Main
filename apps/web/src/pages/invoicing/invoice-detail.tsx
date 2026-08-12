import { useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { PERMISSIONS } from '@erp/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { money, date, statusLabel } from '@/lib/format';
import { useAuthStore } from '@/stores/auth.store';
import { useCancelInvoice, useCreatePayment, useInvoice, usePostInvoice } from '@/features/invoicing/api';
import { useJournalEntry } from '@/features/accounting/api';
import { usePartner } from '@/features/partners/api';
import { useOpenSession, useReceivePayment } from '@/pages/pos/api';
import { Skeleton } from '@/components/ui/skeleton';

/** Display labels for the back-office invoice payment method (InvoicePaymentMode). */
const PAYMENT_MODE_LABELS: Record<string, string> = {
  cash: 'Cash',
  card: 'Card',
  mobile_money: 'Mobile Money',
  mixed: 'Mixed',
  credit: 'Credit (house account)',
};

const selectClass = 'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm';

function SummaryRow({ label, value, bold, accent }: { label: string; value: string; bold?: boolean; accent?: boolean }) {
  return (
    <div className={`flex justify-between gap-8 text-sm ${bold ? 'font-bold' : ''} ${accent ? 'text-red-700' : ''}`}>
      <span className={bold ? '' : 'text-muted-foreground'}>{label}</span>
      <span className={bold ? 'font-bold' : ''}>{value}</span>
    </div>
  );
}

/** Odoo file-tab: bold uppercase micro-label row. */
function TabBtn({ active, children, onClick }: { active: boolean; children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`-mb-px flex items-center gap-2 border-b-2 px-4 py-2.5 text-xs font-bold uppercase tracking-wider transition-colors ${
        active ? 'border-sky-600 text-sky-700' : 'border-transparent text-muted-foreground hover:text-sky-700'
      }`}
    >
      {children}
    </button>
  );
}

function InfoCell({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="py-1.5">
      <dt className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground/80">{label}</dt>
      <dd className="mt-0.5 text-sm text-sky-900">{value ?? '-'}</dd>
    </div>
  );
}

/** Render a tax rate stored as fraction (0.15) or percent (15). */
function rateLabel(rate: string | number | undefined | null): string {
  const n = Number(rate ?? 0);
  if (!n) return '';
  return `${n <= 1 ? Math.round(n * 1000) / 10 : n}%`;
}

export function InvoiceDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data: inv, isLoading } = useInvoice(id);
  const { data: partner } = usePartner(inv?.partnerId);
  const postInvoice = usePostInvoice();
  const cancelInvoice = useCancelInvoice();
  const createPayment = useCreatePayment();
  /* POS sales settle through the POS billing path, not the generic payment
   * endpoint — see submitPayment. */
  const receivePosPayment = useReceivePayment();
  const { data: openSession } = useOpenSession();
  const has = useAuthStore((s) => s.hasPermission);
  const currency = useAuthStore((s) => s.organization?.currencyCode ?? 'IDR');

  const [activeTab, setActiveTab] = useState<'lines' | 'journal' | 'info' | 'payments'>('lines');
  const [payOpen, setPayOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('cash');
  const [reference, setReference] = useState('');
  const [payError, setPayError] = useState<string | null>(null);

  const entry = useJournalEntry(inv?.journalEntryId ?? undefined);

  const receiptRows = (inv?.allocations ?? [])
    .filter(a => a.payment?.direction === 'inbound')
    .sort((a, b) =>
      new Date(b.payment!.paymentDate).getTime() -
      new Date(a.payment!.paymentDate).getTime()
    )
    .map(a => ({
      id: a.paymentId,
      paymentDate: a.payment!.paymentDate,
      paymentMethod: a.payment!.paymentMethod,
      reference: a.payment!.reference ?? null,
      amount: a.amount,
      paymentNumber: (a.payment! as any).paymentNumber,
    }));

  if (isLoading) {
    return (
      <div className="max-w-[1600px] mx-auto space-y-4 px-4">
        <div className="flex items-center gap-3">
          <div className="h-4 w-20 bg-sky-200 rounded" />
          <Skeleton className="h-6 w-64" />
        </div>
        <div className="rounded-lg border border-sky-100 bg-white shadow-sm">
          <div className="flex divide-x divide-sky-100">
            <div className="w-1/2 p-6 space-y-3">
              <div className="h-3 w-24 bg-sky-100 rounded" />
              <div className="h-4 w-48 bg-sky-200 rounded" />
              <div className="h-3 w-full bg-sky-50 rounded mt-4" />
              <div className="h-3 w-3/4 bg-sky-50 rounded" />
            </div>
            <div className="w-1/2 p-6 space-y-3">
              <div className="h-3 w-24 bg-sky-100 rounded" />
              <div className="h-4 w-32 bg-sky-200 rounded" />
              <div className="h-3 w-full bg-sky-50 rounded mt-2" />
              <div className="h-3 w-2/3 bg-sky-50 rounded" />
            </div>
          </div>
          <div className="border-t border-sky-100 p-0">
            <div className="p-4 space-y-3">
              {[1, 2, 3].map(i => (
                <div key={i} className="flex gap-4 items-center">
                  <Skeleton className="h-3 w-8 shrink-0 bg-sky-50" />
                  <Skeleton className="h-3 flex-1 bg-sky-50" />
                  <Skeleton className="h-3 w-16 bg-sky-50" />
                  <Skeleton className="h-3 w-20 bg-sky-50" />
                  <Skeleton className="h-3 w-16 bg-sky-50" />
                  <Skeleton className="h-3 w-20 bg-sky-50" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!inv) {
    return (
      <div className="max-w-[1600px] mx-auto space-y-4 px-4">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/invoices')} className="flex items-center text-sm text-sky-700 hover:text-sky-900 gap-1">
            <ArrowLeft className="h-4 w-4" /> Invoices
          </button>
        </div>
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-8 text-center">
          <h1 className="text-xl font-semibold text-destructive">Not Found</h1>
          <p className="mt-2 text-sm text-muted-foreground">Invoice not found or you don't have permission to view it.</p>
          <Button variant="outline" className="mt-4" onClick={() => navigate('/invoices')}>
            <ArrowLeft className="mr-2 h-4 w-4" /> Back to Invoices
          </Button>
        </div>
      </div>
    );
  }

  const isDraft = inv.status === 'draft';
  const residual = Number(inv.amountResidual);
  const canPay = inv.status === 'posted' && residual > 0;
  /** POS sale (Invoice table) rather than a back-office Document. */
  const isPosInvoice = (inv as any).source === 'pos';
  /** Sold on account and still owed — the receivable the cashier chases. */
  const isOpenCredit = (inv as any).paymentMode === 'credit' && residual > 0;
  const canModify = inv.status !== 'cancelled';
  const paid = residual <= 0.005;

  // Odoo-style Draft | Posted state switch in the title bar; paid/cancelled keep a badge.
  const stateSwitch =
    inv.status === 'cancelled' ? (
      <Badge className="bg-red-100 text-red-700 border-red-200">Cancelled</Badge>
    ) : paid ? (
      <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200">Paid</Badge>
    ) : (
      <div className="flex overflow-hidden rounded-md border border-white/40 bg-white/10 shadow-sm">
        <span
          className={`px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider ${
            inv.status === 'draft' ? 'bg-white text-sky-700' : 'text-white/80'
          }`}
        >
          Draft
        </span>
        <span
          className={`px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider ${
            inv.status === 'posted' ? 'bg-white text-sky-700' : 'text-white/80'
          }`}
        >
          Posted
        </span>
      </div>
    );

  // Odoo-style per-tax breakdown (aggregate line taxAmount by tax name+rate).
  const taxGroups = new Map<string, { label: string; amount: number }>();
  for (const l of inv.lines) {
    if ((l.lineType ?? 'product') === 'product' && l.tax && Number(l.taxAmount) > 0) {
      const key = `${l.tax.id}`;
      const g = taxGroups.get(key) ?? { label: `${l.tax.name} ${rateLabel(l.tax.rate)}`.trim(), amount: 0 };
      g.amount += Number(l.taxAmount);
      taxGroups.set(key, g);
    }
  }

  const openPay = () => {
    setAmount(inv.amountResidual);
    setMethod('cash');
    setReference('');
    setPayError(null);
    setPayOpen(true);
  };

  const submitPayment = async (e: FormEvent) => {
    e.preventDefault();
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) { setPayError('Enter an amount greater than zero.'); return; }
    if (amt > residual + 0.01) { setPayError(`Amount exceeds the ${money(residual, currency)} still due.`); return; }
    setPayError(null);
    try {
      if (isPosInvoice) {
        /* A POS sale lives in the Invoice table, not Document — the generic
         * payment endpoint allocates by documentId and would not find it. The
         * POS path also advances settlementStatus, issues the partial/settlement
         * receipt and closes the order, which the generic one never does. */
        await receivePosPayment.mutateAsync({
          invoiceId: inv.id,
          tenders: [{ method: method as 'cash' | 'bank' | 'card' | 'mobile_money', amount: amt, reference: reference.trim() || undefined }],
          allowPartial: amt < residual - 0.01,
          cashSessionId: method === 'cash' ? openSession?.id : undefined,
        });
      } else {
        await createPayment.mutateAsync({
          partnerId: inv.partnerId,
          paymentDate: new Date().toISOString().slice(0, 10),
          amount: amt,
          paymentMethod: method,
          allocations: [{ documentId: inv.id, amount: amt }],
        });
      }
      setPayOpen(false);
    } catch (err: any) {
      setPayError(err?.response?.data?.message || err?.message || 'Payment failed');
    }
  };

  const primaryAddress = partner?.addresses?.find(a => a.isPrimary) ?? partner?.addresses?.[0];
  const addressLines = primaryAddress
    ? [
        primaryAddress.line1,
        primaryAddress.line2,
        [primaryAddress.city, primaryAddress.state].filter(Boolean).join(', '),
        primaryAddress.postalCode,
        primaryAddress.country,
      ].filter(Boolean)
    : [];

  const journalTotalDebit = entry?.data?.lines?.reduce((s, l) => s + Number(l.debit || 0), 0) ?? 0;
  const journalTotalCredit = entry?.data?.lines?.reduce((s, l) => s + Number(l.credit || 0), 0) ?? 0;
  const balanced = Math.abs(journalTotalDebit - journalTotalCredit) < 0.01;

  return (
    <div className="max-w-[1600px] mx-auto space-y-0 px-1 md:px-2">
      {/* Breadcrumb */}
      <div className="flex items-center gap-3 mb-4">
        <button
          onClick={() => navigate('/invoices')}
          className="flex items-center gap-1 text-sm text-sky-700 hover:text-sky-900"
        >
          <ArrowLeft className="h-4 w-4" /> Invoices
        </button>
        <span className="text-sky-300">/</span>
        <span className="font-mono text-sm text-sky-900 font-semibold">{inv.documentNumber}</span>
      </div>

      {/* Title bar */}
      <div className="rounded-t-lg bg-gradient-to-r from-sky-400 to-sky-500 px-6 py-3 flex items-center justify-between shadow-sm gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <h1 className="text-white font-bold text-base tracking-wide whitespace-nowrap">CUSTOMER INVOICE</h1>
          <span className="font-mono text-xs text-white/85 bg-white/15 rounded px-2 py-0.5 truncate">{inv.documentNumber}</span>
          {inv.invoicingJournalName ? (
            <span className="font-mono text-xs text-white/85 bg-white/15 rounded px-2 py-0.5 truncate">({inv.invoicingJournalName})</span>
          ) : null}
          {stateSwitch}
          {isOpenCredit ? (
            <Badge className="bg-amber-100 text-amber-800 border-amber-200 whitespace-nowrap">
              On account — {money(residual, currency)} due
            </Badge>
          ) : null}
        </div>
        <div className="flex gap-2 shrink-0">
          {isDraft && has(PERMISSIONS.invoice.post) && (
            <Button
              size="sm"
              className="bg-white text-sky-700 hover:bg-sky-50 font-semibold shadow-sm"
              onClick={() => postInvoice.mutate(inv.id)}
              disabled={postInvoice.isPending}
            >
              {postInvoice.isPending ? 'Posting...' : 'Confirm'}
            </Button>
          )}
          {canModify && has(PERMISSIONS.invoice.cancel) && (
            <Button
              size="sm"
              variant="outline"
              className="bg-white/15 border-white/40 text-white hover:bg-white/25"
              onClick={() => setCancelOpen(true)}
            >
              Cancel
            </Button>
          )}
          {canPay && has(PERMISSIONS.payment.create) && (
            <Button size="sm" className="bg-white text-sky-700 hover:bg-sky-50 font-semibold shadow-sm" onClick={openPay}>
              Register Payment
            </Button>
          )}
        </div>
      </div>

      {/* Document card */}
      <div className="bg-white border border-t-0 border-sky-100 shadow-sm rounded-b-lg overflow-hidden">
        {/* Odoo header: customer left, meta right */}
        <div className="grid grid-cols-1 md:grid-cols-2 divide-x divide-sky-100">
          <div className="p-5 bg-sky-50/30">
            <p className="text-[11px] text-sky-500 font-bold uppercase tracking-wider mb-2">Customer</p>
            <p className="font-bold text-base text-sky-900">{inv.partner?.name ?? '—'}</p>
            {partner?.taxNumber && (
              <p className="text-xs text-sky-500 mt-0.5">TIN: {partner.taxNumber}</p>
            )}
            {addressLines.length > 0 && (
              <div className="mt-2 text-xs text-sky-700/80 leading-relaxed">
                {addressLines.map((l, i) => (
                  <p key={i}>{l}</p>
                ))}
              </div>
            )}
            {!addressLines.length && <p className="text-xs text-sky-400 mt-1">Customer</p>}
          </div>

          <div className="p-5 bg-sky-50/20">
            <table className="w-full text-sm">
              <tbody className="divide-y divide-sky-100">
                <tr>
                  <th className="text-left text-sky-600 font-medium py-1.5 w-32 align-top">Invoice Date</th>
                  <td className="text-right text-sky-800 py-1.5 font-semibold">{date(inv.issueDate)}</td>
                </tr>
                <tr>
                  <th className="text-left text-sky-600 font-medium py-1.5 align-top">Payment Terms</th>
                  <td className="text-right text-sky-800 py-1.5">{inv.paymentTermName ?? '-'}</td>
                </tr>
                <tr>
                  <th className="text-left text-sky-600 font-medium py-1.5 align-top">Currency</th>
                  <td className="text-right text-sky-800 py-1.5 font-semibold">{currency}</td>
                </tr>
                <tr>
                  <th className="text-left text-sky-600 font-medium py-1.5 align-top">Due Date</th>
                  <td className="text-right text-sky-800 py-1.5 font-semibold">{inv.dueDate ? date(inv.dueDate) : '-'}</td>
                </tr>
                <tr>
                  <th className="text-left text-sky-600 font-medium py-1.5 align-top">Source Doc</th>
                  <td className="text-right text-sky-800 py-1.5">{inv.sourceDocument ?? inv.reference ?? '-'}</td>
                </tr>
                <tr>
                  <th className="text-left text-sky-600 font-medium py-1.5 align-top">Salesperson</th>
                  <td className="text-right text-sky-800 py-1.5">{inv.salespersonName ?? '-'}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* Odoo file tabs */}
        <div className="border-b border-sky-200 px-4 bg-sky-50/40 flex gap-1 overflow-x-auto">
          <TabBtn active={activeTab === 'lines'} onClick={() => setActiveTab('lines')}>Invoice Lines</TabBtn>
          <TabBtn active={activeTab === 'journal'} onClick={() => setActiveTab('journal')}>Journal Items</TabBtn>
          <TabBtn active={activeTab === 'info'} onClick={() => setActiveTab('info')}>Other Info</TabBtn>
          <TabBtn active={activeTab === 'payments'} onClick={() => setActiveTab('payments')}>
            Payments{receiptRows.length ? ` (${receiptRows.length})` : ''}
          </TabBtn>
        </div>

        {/* INVOICE LINES tab */}
        {activeTab === 'lines' && (
          <div>
            <div className="flex flex-col lg:flex-row">
              <div className="flex-1 overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-sky-50 hover:bg-sky-50">
                      <TableHead className="text-sky-700 font-bold text-xs uppercase tracking-wider">Product</TableHead>
                      <TableHead className="text-sky-700 font-bold text-xs uppercase tracking-wider">Account</TableHead>
                      <TableHead className="w-20 text-right text-sky-700 font-bold text-xs uppercase tracking-wider">Qty</TableHead>
                      <TableHead className="w-28 text-right text-sky-700 font-bold text-xs uppercase tracking-wider">Unit Price</TableHead>
                      <TableHead className="w-28 text-right text-sky-700 font-bold text-xs uppercase tracking-wider">Tax</TableHead>
                      <TableHead className="w-28 text-right text-sky-700 font-bold text-xs uppercase tracking-wider">Discount</TableHead>
                      <TableHead className="w-32 text-right text-sky-700 font-bold text-xs uppercase tracking-wider">Amount</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {inv.lines.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={7} className="py-10 text-center text-sky-400">
                          No line items found.
                        </TableCell>
                      </TableRow>
                    ) : inv.lines.map((l) => {
                      const isSection = (l.lineType ?? 'product') === 'section';
                      const isNote = (l.lineType ?? 'product') === 'note';
                      if (isSection || isNote) {
                        return (
                          <TableRow key={l.id} className={isSection ? 'bg-sky-50/60' : 'bg-transparent'}>
                            <TableCell
                              colSpan={7}
                              className={`${isSection ? 'py-1.5 text-[13px] font-bold uppercase tracking-wide text-sky-900 border-b border-sky-100' : 'py-1 text-[13px] italic text-slate-500'}`}
                            >
                              {isSection ? '▬ ' : ''}{l.description || (isSection ? 'Section' : 'Note')}
                            </TableCell>
                          </TableRow>
                        );
                      }
                      const hasDiscount = Number(l.discountAmount || l.discountPercent) > 0;
                      const discountLabel = l.discountType === 'fixed_amount'
                        ? `-${money(l.discountAmount)}`
                        : l.discountPercent && Number(l.discountPercent) > 0
                          ? `${Number(l.discountPercent).toFixed(1)}%`
                          : '-';
                      return (
                        <TableRow key={l.id} className="hover:bg-sky-50/40">
                          <TableCell className="font-semibold text-sm text-sky-900">
                            {l.description}
                            {l.discountReason ? <div className="text-[10px] text-slate-500 mt-0.5">({l.discountReason})</div> : null}
                          </TableCell>
                          <TableCell className="text-sm text-sky-700">
                            {l.account ? (
                              <span className="inline-flex items-center gap-1.5">
                                <code className="text-[11px] bg-sky-50 border border-sky-100 px-1.5 py-0.5 rounded font-mono text-sky-700 font-semibold">{l.account.code}</code>
                                <span className="text-xs text-sky-600">{l.account.name}</span>
                              </span>
                            ) : '-'}
                          </TableCell>
                          <TableCell className="text-right text-sm text-sky-800">{money(l.quantity)}</TableCell>
                          <TableCell className="text-right text-sm text-sky-800">{money(l.unitPrice)}</TableCell>
                          <TableCell className="text-right text-sm text-sky-700">
                            {l.tax && Number(l.taxAmount) > 0 ? `${l.tax.name} ${rateLabel(l.tax.rate)}`.trim() : '-'}
                          </TableCell>
                          <TableCell className={`text-right text-sm font-medium ${hasDiscount ? 'text-amber-700' : 'text-sky-400'}`}>{discountLabel}</TableCell>
                          <TableCell className="text-right text-sm font-bold text-sky-900">{money(l.total)}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>

              {/* Odoo right totals panel */}
              <div className="w-full lg:w-80 border-t lg:border-t-0 lg:border-l border-sky-100 bg-gradient-to-b from-sky-50/60 to-sky-100/30 p-4 shrink-0">
                <div className="space-y-2">
                  <SummaryRow label="Untaxed Amount" value={money(inv.subtotal)} />
                  {taxGroups.size > 0 ? (
                    [...taxGroups.values()].map(g => (
                      <SummaryRow key={g.label} label={g.label} value={money(g.amount)} />
                    ))
                  ) : (
                    inv.taxAmount && Number(inv.taxAmount) > 0 ? (
                      <SummaryRow label="Taxes" value={money(inv.taxAmount)} />
                    ) : null
                  )}
                  {inv.discountTotal && Number(inv.discountTotal) > 0 && (
                    <SummaryRow
                      label={`Discount ${inv.discountType === 'fixed_amount' ? '(fixed)' : inv.discountType === 'percentage' ? `(${inv.discountValue ? Number(inv.discountValue).toFixed(1) : 'pct'}%)` : ''}`}
                      value={`-${money(inv.discountTotal)}`}
                    />
                  )}
                  <div className="border-t-2 border-sky-200 pt-2">
                    <SummaryRow label="TOTAL" value={money(inv.totalAmount)} bold />
                  </div>
                  <SummaryRow label="Total Paid" value={money(inv.amountPaid)} />
                  <SummaryRow label="Amount Due" value={money(inv.amountResidual)} bold accent={residual > 0.005} />
                </div>
                {inv.notes ? (
                  <div className="mt-4 rounded border border-sky-100 bg-white/70 p-3">
                    <p className="text-[11px] font-bold uppercase tracking-wider text-sky-600 mb-1">Terms &amp; Conditions</p>
                    <p className="text-xs text-sky-800/80 whitespace-pre-wrap">{inv.notes}</p>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        )}

        {/* JOURNAL ITEMS tab */}
        {activeTab === 'journal' && (
          <div className="p-0">
            {!inv.journalEntryId ? (
              <div className="p-10 text-center">
                <p className="text-sm text-sky-400">No journal entry yet — the invoice posts to the ledger when confirmed.
                Journal items appear here (Account · Label · Debit · Credit) once the invoice is confirmed.</p>
              </div>
            ) : entry?.isLoading ? (
              <div className="p-10 text-center">
                <Skeleton className="h-6 w-56 mx-auto" />
              </div>
            ) : entry?.data?.lines?.length ? (
              <Table>
                <TableHeader>
                  <TableRow className="bg-sky-50 hover:bg-sky-50">
                    <TableHead className="w-10 text-sky-700 font-bold text-xs uppercase tracking-wider">#</TableHead>
                    <TableHead className="text-sky-700 font-bold text-xs uppercase tracking-wider">Account</TableHead>
                    <TableHead className="text-sky-700 font-bold text-xs uppercase tracking-wider">Label</TableHead>
                    <TableHead className="w-36 text-right text-sky-700 font-bold text-xs uppercase tracking-wider">Debit</TableHead>
                    <TableHead className="w-36 text-right text-sky-700 font-bold text-xs uppercase tracking-wider">Credit</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {entry.data.lines.map((l, i) => (
                    <TableRow key={l.id} className="hover:bg-sky-50/40">
                      <TableCell className="text-xs text-muted-foreground font-mono">{i + 1}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5">
                          <code className="text-[11px] bg-primary/5 px-1.5 py-0.5 rounded font-mono text-primary font-semibold">{l.account.code}</code>
                          <span className="text-sm font-medium text-sky-900">{l.account.name}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-sm text-sky-700">{l.description ?? '-'}</TableCell>
                      <TableCell className="text-right font-semibold text-sm text-emerald-700">{Number(l.debit) ? money(l.debit) : ''}</TableCell>
                      <TableCell className="text-right text-sm text-sky-800">{Number(l.credit) ? money(l.credit) : ''}</TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="bg-sky-50/60">
                    <TableCell colSpan={3} className="text-right text-xs font-bold text-sky-700 uppercase tracking-wider">Totals {balanced ? '· Balanced' : '· NOT Balanced'}</TableCell>
                    <TableCell className="text-right font-bold text-sm text-emerald-700">{money(journalTotalDebit)}</TableCell>
                    <TableCell className="text-right font-bold text-sm text-sky-900">{money(journalTotalCredit)}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            ) : (
              <div className="p-10 text-center">
                <p className="text-sm text-sky-400">Journal entry has no lines.</p>
              </div>
            )}
          </div>
        )}

        {/* OTHER INFO tab */}
        {activeTab === 'info' && (
          <div className="p-5">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-2">
              <dl>
                <InfoCell label="Payment Terms" value={inv.paymentTermName ?? '-'} />
                <InfoCell label="Fiscal Position" value={inv.fiscalPositionName ?? '-'} />
                <InfoCell label="Invoicing Journal" value={inv.invoicingJournalName ?? '-'} />
                <InfoCell label="Payment Method" value={inv.paymentMode ? PAYMENT_MODE_LABELS[inv.paymentMode] ?? inv.paymentMode : '-'} />
              </dl>
              <dl>
                <InfoCell label="Salesperson" value={inv.salespersonName ?? '-'} />
                <InfoCell label="Source Document" value={inv.sourceDocument ?? '-'} />
                <InfoCell label="Reference" value={inv.reference ?? '-'} />
                <InfoCell label="Payment Status" value={statusLabel(inv.paymentStatus)} />
              </dl>
              <dl>
                <InfoCell label="Delivery Date" value={inv.deliveryDate ? date(inv.deliveryDate) : '-'} />
                <InfoCell label="Delivery Address" value={inv.deliveryAddress ?? '-'} />
                <InfoCell
                  label="Incoterm"
                  value={inv.incoterm ? `${inv.incoterm}${inv.incotermLocation ? ' · ' + inv.incotermLocation : ''}` : '-'}
                />
              </dl>
            </div>
          </div>
        )}

        {/* PAYMENTS tab */}
        {activeTab === 'payments' && (
          <div>
            {receiptRows.length === 0 ? (
              <div className="px-4 py-6 text-sm text-sky-400">No payments recorded for this invoice.</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="bg-sky-50/60 hover:bg-sky-50/60">
                    <TableHead className="w-16 text-sky-700 font-bold text-xs uppercase tracking-wider">Sr.</TableHead>
                    <TableHead className="text-sky-700 font-bold text-xs uppercase tracking-wider">Date</TableHead>
                    <TableHead className="text-sky-700 font-bold text-xs uppercase tracking-wider">Method</TableHead>
                    <TableHead className="text-sky-700 font-bold text-xs uppercase tracking-wider">Ref.</TableHead>
                    <TableHead className="w-36 text-right text-sky-700 font-bold text-xs uppercase tracking-wider">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {receiptRows.map((p, i) => (
                    <TableRow key={p.id} className="hover:bg-sky-50/40">
                      <TableCell className="text-sky-600 text-sm font-mono">{i + 1}</TableCell>
                      <TableCell className="text-sm text-sky-800">{date(p.paymentDate || '')}</TableCell>
                      <TableCell className="text-sm text-sky-800 capitalize">{p.paymentMethod?.replace(/_/g, ' ') ?? p.paymentMethod}</TableCell>
                      <TableCell className="font-mono text-xs text-sky-700">{p.paymentNumber ?? p.reference ?? '-'}</TableCell>
                      <TableCell className="text-right text-sm font-bold text-sky-900">{money(p.amount)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
            <div className="border-t border-sky-100 bg-gradient-to-r from-sky-50/60 to-sky-100/40 px-4 py-3 flex justify-end">
              <div className="w-80 space-y-2">
                <SummaryRow label="Total Paid" value={money(inv.amountPaid)} />
                <SummaryRow label="Amount Due" value={money(inv.amountResidual)} bold accent={residual > 0.005} />
              </div>
            </div>
          </div>
        )}
      </div>
      {/* / Document card */}

      {/* Payment Dialog */}
      {canModify && (
        <Dialog open={payOpen} onOpenChange={setPayOpen}>
          <DialogContent className="border-sky-100">
            <DialogHeader className="border-b border-sky-100 pb-3">
              <DialogTitle className="text-sky-900">Register Payment</DialogTitle>
              <DialogDescription className="text-sky-600">
                Record a payment against {inv.documentNumber}. {money(residual, currency)} is still due —
                pay it in full or part of it now.
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={submitPayment} className="space-y-4 pt-2">
              <div className="space-y-2">
                <Label htmlFor="amount" className="text-sky-800">Amount</Label>
                <Input
                  id="amount"
                  type="number"
                  step="any"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  required
                  className="border-sky-200 focus-visible:ring-sky-400"
                />
                <div className="flex items-center gap-2 text-xs">
                  <button
                    type="button"
                    className="rounded bg-sky-100 px-2 py-0.5 font-semibold text-sky-700 hover:bg-sky-200"
                    onClick={() => setAmount(inv.amountResidual)}
                  >
                    Pay full {money(residual, currency)}
                  </button>
                  {Number(amount) > 0 && Number(amount) < residual - 0.01 ? (
                    <span className="text-amber-600 font-medium">
                      {money(residual - Number(amount), currency)} will stay outstanding
                    </span>
                  ) : null}
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="method" className="text-sky-800">Method</Label>
                <select id="method" className={selectClass + ' border-sky-200'} value={method} onChange={(e) => setMethod(e.target.value)}>
                  <option value="cash">Cash</option>
                  <option value="bank">Bank</option>
                  <option value="mobile_money">Mobile Money</option>
                  <option value="card">Card</option>
                </select>
              </div>
              {isPosInvoice && method !== 'cash' ? (
                <div className="space-y-2">
                  <Label htmlFor="pay-reference" className="text-sky-800">Reference (optional)</Label>
                  <Input
                    id="pay-reference"
                    value={reference}
                    onChange={(e) => setReference(e.target.value)}
                    placeholder="e.g. MTN-12345"
                    className="border-sky-200 font-mono focus-visible:ring-sky-400"
                  />
                </div>
              ) : null}
              {payError ? <p className="text-sm font-medium text-rose-600">{payError}</p> : null}
              <DialogFooter>
                <Button
                  type="submit"
                  disabled={createPayment.isPending || receivePosPayment.isPending}
                  className="bg-sky-600 hover:bg-sky-700 text-white"
                >
                  {createPayment.isPending || receivePosPayment.isPending ? 'Saving...' : 'Save Payment'}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      )}

      {/* Cancel confirm */}
      <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <DialogContent className="border-sky-100 max-w-md">
          <DialogHeader className="border-b border-sky-100 pb-3">
            <DialogTitle className="text-sky-900">Cancel Invoice</DialogTitle>
            <DialogDescription className="text-sky-600">
              This will cancel {inv.documentNumber} and prevent further changes or payments.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelOpen(false)}>Keep</Button>
            <Button
              className="bg-red-600 hover:bg-red-700 text-white"
              disabled={cancelInvoice.isPending}
              onClick={() => cancelInvoice.mutate(inv.id, { onSuccess: () => setCancelOpen(false) })}
            >
              {cancelInvoice.isPending ? 'Cancelling...' : 'Cancel Invoice'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}