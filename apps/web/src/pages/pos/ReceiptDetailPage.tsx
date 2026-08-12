import { useAuthStore } from '@/stores/auth.store';
import { useNavigate, useParams } from 'react-router-dom';
import { Printer } from 'lucide-react';
import { PERMISSIONS } from '@erp/shared';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { money, date, useOrgCurrency } from '@/lib/format';

import { useReceipt } from '@/pages/pos/api';

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="font-medium">{value}</div>
    </div>
  );
}

export function ReceiptDetailPage() {
  const { invoiceId: id } = useParams<{ invoiceId: string }>();
  const navigate = useNavigate();
  const { data: receipt, isLoading } = useReceipt(id);
    const has = useAuthStore((s) => s.hasPermission);
    const currency = useOrgCurrency();

  if (isLoading || !receipt) {
    return <div className="text-sm text-muted-foreground">Loading...</div>;
  }

  const lines = receipt.lines ?? [];

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="flex items-center justify-between print:hidden">
        <Button variant="outline" onClick={() => navigate('/pos/receipts')}>
          Back
        </Button>
        <div className="flex gap-2">
          {has(PERMISSIONS.pos.reports) && (
            <Button variant="outline" onClick={() => window.print()}>
              <Printer className="mr-2 h-4 w-4" /> Print
            </Button>
          )}
        </div>
      </div>

      <Card>
        <CardContent className="space-y-6 pt-6">
          <div className="flex items-start justify-between border-b pb-4">
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-2xl font-semibold">Payment Receipt</h1>
                {receipt.settlementStatus === 'written_off' && <Badge variant="destructive">written off</Badge>}
              </div>
              <p className="text-sm text-muted-foreground">{receipt.documentNumber}</p>
            </div>
            <div className="text-right text-sm text-muted-foreground">{date(receipt.issueDate)}</div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Received from" value={receipt.partner?.name ?? '-'} />
            <Field label="Method" value={receipt.paymentMode?.replace(/_/g, ' ') ?? '—'} />
            <Field label="Reference" value={receipt.documentNumber} />
            <Field label="Status" value={receipt.paymentStatus?.replace(/_/g, ' ') ?? '—'} />
          </div>

          <div className="rounded-md bg-muted/50 p-4 text-center">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Amount received</div>
            <div className="text-3xl font-semibold">{money(receipt.amountPaid, currency)}</div>
          </div>

          {/* Cash change: shown only when the customer overpaid in cash. */}
          {Number((receipt as any).amountTendered ?? 0) > Number(receipt.amountPaid) && (
            <div className="grid grid-cols-3 gap-4 rounded-md border p-4">
              <Field label="Bill total" value={money((receipt as any).totalAmount, currency)} />
              <Field label="Cash tendered" value={money((receipt as any).amountTendered, currency)} />
              <Field
                label="Change given"
                value={money(Math.max(0, Number((receipt as any).amountTendered) - Number((receipt as any).totalAmount)), currency)}
              />
            </div>
          )}

          {lines.length > 0 && (
            <div>
              <div className="mb-2 text-sm font-medium">Items</div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Description</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lines.map((l: any) => (
                    <TableRow key={l.id}>
                      <TableCell>{l.description}</TableCell>
                      <TableCell className="text-right">{l.quantity}</TableCell>
                      <TableCell className="text-right">{money(l.total, currency)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {Number(receipt.amountResidual) > 0 && (
            <p className="text-sm text-muted-foreground">
              Balance due: {money(receipt.amountResidual, currency)}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
