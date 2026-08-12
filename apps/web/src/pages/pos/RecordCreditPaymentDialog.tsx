/**
 * Collect against an open credit (house-account) invoice.
 *
 * Posts to the POS billing path (`POST /pos/invoices/:id/payments`), which is
 * the only one that keeps a POS sale consistent: it advances settlementStatus,
 * issues the partial/settlement receipt and closes the order. Partial payments
 * are allowed here because a credit invoice's GL counter is AR, so collecting
 * less than the balance simply leaves the rest sitting in AR.
 */
import { useEffect, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { money, useOrgCurrency } from '@/lib/format';
import { useOpenSession, useReceivePayment } from '@/pages/pos/api';

const METHODS = [
  { value: 'cash', label: 'Cash' },
  { value: 'mobile_money', label: 'Mobile Money' },
  { value: 'card', label: 'Card' },
  { value: 'bank', label: 'Bank' },
] as const;

type Method = (typeof METHODS)[number]['value'];

export interface CreditPaymentTarget {
  invoiceId: string;
  invoiceNumber: string;
  partnerName: string;
  amountResidual: number;
}

interface Props {
  target: CreditPaymentTarget | null;
  onClose: () => void;
  onPaid?: (settled: boolean) => void;
}

export function RecordCreditPaymentDialog({ target, onClose, onPaid }: Props) {
  const currency = useOrgCurrency();
  const receivePayment = useReceivePayment();
  const { data: openSession } = useOpenSession();

  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<Method>('cash');
  const [reference, setReference] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Reset to "pay it all, in cash" every time a new invoice is opened.
  useEffect(() => {
    if (!target) return;
    setAmount(String(target.amountResidual));
    setMethod('cash');
    setReference('');
    setError(null);
  }, [target]);

  if (!target) return null;

  const residual = target.amountResidual;
  const amt = Number(amount);
  const remainder = Number.isFinite(amt) ? residual - amt : residual;
  const isPartial = Number.isFinite(amt) && amt > 0 && amt < residual - 0.01;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!Number.isFinite(amt) || amt <= 0) { setError('Enter an amount greater than zero.'); return; }
    if (amt > residual + 0.01) { setError(`Amount exceeds the ${money(residual, currency)} still due.`); return; }
    setError(null);
    try {
      await receivePayment.mutateAsync({
        invoiceId: target.invoiceId,
        tenders: [{ method, amount: amt, reference: reference.trim() || undefined }],
        allowPartial: isPartial,
        // Cash goes into whichever drawer is open so the shift reconciles.
        cashSessionId: method === 'cash' ? openSession?.id : undefined,
      });
      toast.success(
        isPartial
          ? `${money(amt, currency)} received — ${money(remainder, currency)} still owed on ${target.invoiceNumber}`
          : `${target.invoiceNumber} settled in full`,
      );
      onPaid?.(!isPartial);
      onClose();
    } catch (err: any) {
      setError(err?.response?.data?.message || err?.message || 'Payment failed');
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle>Record payment</DialogTitle>
          <DialogDescription>
            {target.partnerName} owes {money(residual, currency)} on {target.invoiceNumber}.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="credit-amount">Amount received</Label>
            <Input
              id="credit-amount"
              type="number"
              step="any"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="text-right font-mono text-lg"
              autoFocus
              required
            />
            <div className="flex items-center gap-2 text-xs">
              <button
                type="button"
                className="rounded bg-slate-100 px-2 py-0.5 font-semibold text-slate-700 hover:bg-slate-200"
                onClick={() => setAmount(String(residual))}
              >
                Pay full {money(residual, currency)}
              </button>
              {isPartial ? (
                <span className="font-medium text-amber-600">
                  {money(remainder, currency)} will stay outstanding
                </span>
              ) : null}
            </div>
          </div>

          <div className="space-y-2">
            <Label>Method</Label>
            <div className="grid grid-cols-4 gap-2">
              {METHODS.map((m) => (
                <button
                  key={m.value}
                  type="button"
                  onClick={() => setMethod(m.value)}
                  className={`rounded-md border-2 px-2 py-2 text-xs font-semibold transition-colors ${
                    method === m.value
                      ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
                      : 'border-slate-200 text-slate-600 hover:border-slate-300'
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          {method !== 'cash' ? (
            <div className="space-y-2">
              <Label htmlFor="credit-reference">Reference (optional)</Label>
              <Input
                id="credit-reference"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                placeholder="e.g. MTN-12345"
                className="font-mono"
              />
            </div>
          ) : null}

          {method === 'cash' && !openSession?.id ? (
            <p className="text-xs text-amber-600">
              No shift is open — the payment will post to the ledger but will not show on a Z-report.
            </p>
          ) : null}

          {error ? <p className="text-sm font-medium text-rose-600">{error}</p> : null}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={receivePayment.isPending} className="bg-emerald-600 hover:bg-emerald-700">
              {receivePayment.isPending ? 'Saving…' : `Receive ${money(Number.isFinite(amt) ? amt : 0, currency)}`}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
