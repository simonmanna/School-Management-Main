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
  useCreateSupplierPayment,
  useExpense,
  usePostExpense,
  useVoidExpense,
} from '@/features/invoicing/api';

const selectClass = 'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm';

function SummaryRow({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className={`flex justify-between ${bold ? 'font-semibold' : ''}`}>
      <span className={bold ? '' : 'text-muted-foreground'}>{label}</span>
      <span>{value}</span>
    </div>
  );
}

export function ExpenseDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data: bill, isLoading } = useExpense(id);
  const postExpense = usePostExpense();
  const voidExpense = useVoidExpense();
  const paySupplier = useCreateSupplierPayment();
  const has = useAuthStore((s) => s.hasPermission);

  const [payOpen, setPayOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('cash');

  if (isLoading || !bill) {
    return <div className="text-sm text-muted-foreground">Loading...</div>;
  }

  const isDraft = bill.status === 'draft';
  const residual = Number(bill.amountResidual);
  const canPay = bill.status === 'posted' && residual > 0;

  const openPay = () => {
    setAmount(bill.amountResidual);
    setMethod('cash');
    setPayOpen(true);
  };

  const submitPayment = async (e: FormEvent) => {
    e.preventDefault();
    await paySupplier.mutateAsync({
      partnerId: bill.partnerId,
      paymentDate: new Date().toISOString().slice(0, 10),
      amount: Number(amount),
      paymentMethod: method,
      allocations: [{ documentId: bill.id, amount: Number(amount) }],
    });
    setPayOpen(false);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold">{bill.documentNumber}</h1>
            <Badge variant={bill.status === 'cancelled' ? 'destructive' : 'default'}>{bill.status}</Badge>
            <Badge variant="outline">{statusLabel(bill.paymentStatus)}</Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            {bill.partner?.name} · {date(bill.issueDate)}
            {bill.dueDate ? ` · due ${date(bill.dueDate)}` : ''}
          </p>
        </div>
        <div className="flex flex-wrap gap-2 print:hidden">
          <Button variant="outline" onClick={() => navigate('/expenses')}>
            Back
          </Button>
          <Button variant="outline" onClick={() => window.print()}>
            Print
          </Button>
          {isDraft && has(PERMISSIONS.expense.post) && (
            <Button onClick={() => postExpense.mutate(bill.id)} disabled={postExpense.isPending}>
              Post
            </Button>
          )}
          {canPay && has(PERMISSIONS.payment.create) && <Button onClick={openPay}>Pay supplier</Button>}
          {bill.status !== 'cancelled' && has(PERMISSIONS.expense.cancel) && (
            <Button variant="outline" onClick={() => voidExpense.mutate(bill.id)} disabled={voidExpense.isPending}>
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
                <TableHead className="text-right">Net</TableHead>
                <TableHead className="text-right">Tax</TableHead>
                <TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {bill.lines.map((l) => (
                <TableRow key={l.id}>
                  <TableCell>{l.description}</TableCell>
                  <TableCell className="text-right">{money(l.quantity)}</TableCell>
                  <TableCell className="text-right">{money(l.unitPrice)}</TableCell>
                  <TableCell className="text-right">{money(l.subtotal)}</TableCell>
                  <TableCell className="text-right">{money(l.taxAmount)}</TableCell>
                  <TableCell className="text-right">{money(l.total)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          <div className="mt-4 flex justify-end">
            <div className="w-64 space-y-1 text-sm">
              <SummaryRow label="Subtotal" value={money(bill.subtotal)} />
              <SummaryRow label="Tax" value={money(bill.taxAmount)} />
              <SummaryRow label="Total" value={money(bill.totalAmount)} bold />
              <SummaryRow label="Paid" value={money(bill.amountPaid)} />
              <SummaryRow label="Balance due" value={money(bill.amountResidual)} bold />
            </div>
          </div>
        </CardContent>
      </Card>

      <Dialog open={payOpen} onOpenChange={setPayOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Pay supplier</DialogTitle>
            <DialogDescription>Record a payment for {bill.documentNumber}.</DialogDescription>
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
                <option value="cheque">Cheque</option>
              </select>
            </div>
            <DialogFooter>
              <Button type="submit" disabled={paySupplier.isPending}>
                {paySupplier.isPending ? 'Saving...' : 'Save payment'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
