import { useNavigate, useParams } from 'react-router-dom';
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
import { money, date, statusLabel } from '@/lib/format';
import { useAuthStore } from '@/stores/auth.store';
import { usePayment, useVoidPayment } from '@/features/invoicing/api';

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="font-medium">{value}</div>
    </div>
  );
}

export function PaymentDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data: payment, isLoading } = usePayment(id);
  const voidPayment = useVoidPayment();
  const has = useAuthStore((s) => s.hasPermission);

  if (isLoading || !payment) {
    return <div className="text-sm text-muted-foreground">Loading...</div>;
  }

  const isOutbound = payment.direction === 'outbound';
  const title = isOutbound ? 'Payment Voucher' : 'Payment Receipt';
  const partyLabel = isOutbound ? 'Paid to' : 'Received from';
  const amountLabel = isOutbound ? 'Amount paid' : 'Amount received';
  const backTo = isOutbound ? '/supplier-payments' : '/payments';

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="flex items-center justify-between print:hidden">
        <Button variant="outline" onClick={() => navigate(backTo)}>
          Back
        </Button>
        <div className="flex gap-2">
          {payment.status === 'posted' && has(PERMISSIONS.payment.void) && (
            <Button variant="outline" onClick={() => voidPayment.mutate(payment.id)} disabled={voidPayment.isPending}>
              Void
            </Button>
          )}
          <Button variant="outline" onClick={() => window.print()}>
            Print
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="space-y-6 pt-6">
          <div className="flex items-start justify-between border-b pb-4">
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-2xl font-semibold">{title}</h1>
                {payment.status === 'cancelled' && <Badge variant="destructive">voided</Badge>}
              </div>
              <p className="text-sm text-muted-foreground">{payment.paymentNumber}</p>
            </div>
            <div className="text-right text-sm text-muted-foreground">{date(payment.paymentDate)}</div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Field label={partyLabel} value={payment.partner?.name ?? '-'} />
            <Field label="Method" value={statusLabel(payment.paymentMethod)} />
            <Field label="Reference" value={payment.reference ?? '-'} />
            <Field label="Status" value={statusLabel(payment.status)} />
          </div>

          <div className="rounded-md bg-muted/50 p-4 text-center">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">{amountLabel}</div>
            <div className="text-3xl font-semibold">{money(payment.amount)}</div>
          </div>

          {payment.allocations.length > 0 && (
            <div>
              <div className="mb-2 text-sm font-medium">Applied to</div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Document</TableHead>
                    <TableHead className="text-right">Amount applied</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {payment.allocations.map((a) => (
                    <TableRow key={a.id}>
                      <TableCell>{a.document.documentNumber}</TableCell>
                      <TableCell className="text-right">{money(a.amount)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {Number(payment.unallocatedAmount) > 0 && (
            <p className="text-sm text-muted-foreground">
              Unapplied {isOutbound ? 'on account' : 'credit'}: {money(payment.unallocatedAmount)}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
