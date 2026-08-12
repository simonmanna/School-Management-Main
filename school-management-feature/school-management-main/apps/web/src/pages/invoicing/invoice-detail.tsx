import { useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { PERMISSIONS } from '@erp/shared';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
import { money, date, statusLabel } from '@/lib/format';
import { useAuthStore } from '@/stores/auth.store';
import {
  useCancelInvoice,
  useCreatePayment,
  useInvoice,
  usePostInvoice,
} from '@/features/invoicing/api';

const selectClass =
  'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm';

function SummaryRow({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className={`flex justify-between ${bold ? 'font-semibold' : ''}`}>
      <span className={bold ? '' : 'text-muted-foreground'}>{label}</span>
      <span>{value}</span>
    </div>
  );
}

export function InvoiceDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data: inv, isLoading } = useInvoice(id);
  const postInvoice = usePostInvoice();
  const cancelInvoice = useCancelInvoice();
  const createPayment = useCreatePayment();
  const has = useAuthStore((s) => s.hasPermission);

  const [payOpen, setPayOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('cash');

  if (isLoading || !inv) {
    return <div className="text-sm text-muted-foreground">Loading...</div>;
  }

  const isDraft = inv.status === 'draft';
  const residual = Number(inv.amountResidual);
  const canPay = inv.status === 'posted' && residual > 0;

  const openPay = () => {
    setAmount(inv.amountResidual);
    setMethod('cash');
    setPayOpen(true);
  };

  const submitPayment = async (e: FormEvent) => {
    e.preventDefault();
    await createPayment.mutateAsync({
      partnerId: inv.partnerId,
      paymentDate: new Date().toISOString().slice(0, 10),
      amount: Number(amount),
      paymentMethod: method,
      allocations: [{ documentId: inv.id, amount: Number(amount) }],
    });
    setPayOpen(false);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold">{inv.documentNumber}</h1>
            <Badge variant={inv.status === 'cancelled' ? 'destructive' : 'default'}>{inv.status}</Badge>
            <Badge variant="outline">{statusLabel(inv.paymentStatus)}</Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            {inv.partner?.name} · {date(inv.issueDate)}
            {inv.dueDate ? ` · due ${date(inv.dueDate)}` : ''}
          </p>
        </div>
        <div className="flex flex-wrap gap-2 print:hidden">
          <Button variant="outline" onClick={() => navigate('/invoices')}>
            Back
          </Button>
          <Button variant="outline" onClick={() => window.print()}>
            Print
          </Button>
          {isDraft && has(PERMISSIONS.invoice.post) && (
            <Button onClick={() => postInvoice.mutate(inv.id)} disabled={postInvoice.isPending}>
              Post
            </Button>
          )}
          {canPay && has(PERMISSIONS.payment.create) && <Button onClick={openPay}>Register payment</Button>}
          {inv.status !== 'cancelled' && has(PERMISSIONS.invoice.cancel) && (
            <Button variant="outline" onClick={() => cancelInvoice.mutate(inv.id)} disabled={cancelInvoice.isPending}>
              Void
            </Button>
          )}
        </div>
      </div>

      <Card>
        <CardContent className="pt-6">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Description</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="text-right">Unit price</TableHead>
                <TableHead className="text-right">Disc %</TableHead>
                <TableHead className="text-right">Net</TableHead>
                <TableHead className="text-right">Tax</TableHead>
                <TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {inv.lines.map((l) => (
                <TableRow key={l.id}>
                  <TableCell>{l.description}</TableCell>
                  <TableCell className="text-right">{money(l.quantity)}</TableCell>
                  <TableCell className="text-right">{money(l.unitPrice)}</TableCell>
                  <TableCell className="text-right">{money(l.discountPercent)}</TableCell>
                  <TableCell className="text-right">{money(l.subtotal)}</TableCell>
                  <TableCell className="text-right">{money(l.taxAmount)}</TableCell>
                  <TableCell className="text-right">{money(l.total)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          <div className="mt-4 flex justify-end">
            <div className="w-64 space-y-1 text-sm">
              <SummaryRow label="Subtotal" value={money(inv.subtotal)} />
              <SummaryRow label="Tax" value={money(inv.taxAmount)} />
              <SummaryRow label="Total" value={money(inv.totalAmount)} bold />
              <SummaryRow label="Paid" value={money(inv.amountPaid)} />
              <SummaryRow label="Balance due" value={money(inv.amountResidual)} bold />
            </div>
          </div>
        </CardContent>
      </Card>

      <Dialog open={payOpen} onOpenChange={setPayOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Register payment</DialogTitle>
            <DialogDescription>Record a payment against {inv.documentNumber}.</DialogDescription>
          </DialogHeader>
          <form onSubmit={submitPayment} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="amount">Amount</Label>
              <Input
                id="amount"
                type="number"
                step="any"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="method">Method</Label>
              <select id="method" className={selectClass} value={method} onChange={(e) => setMethod(e.target.value)}>
                <option value="cash">Cash</option>
                <option value="bank">Bank</option>
                <option value="mobile_money">Mobile Money</option>
                <option value="card">Card</option>
              </select>
            </div>
            <DialogFooter>
              <Button type="submit" disabled={createPayment.isPending}>
                {createPayment.isPending ? 'Saving...' : 'Save payment'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
