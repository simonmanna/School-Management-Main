import { useParams } from 'react-router-dom';
import { useSupplierLedger } from '@/features/invoicing/api';
import { money, date } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useNavigate } from 'react-router-dom';

export function SupplierLedgerPage() {
  const { partnerId } = useParams();
  const navigate = useNavigate();
  const { data, isLoading } = useSupplierLedger(partnerId);

  if (isLoading) {
    return (
      <div className="space-y-6 p-4 md:p-6">
        <div className="flex items-center justify-between">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-10 w-32" />
        </div>
        <Card><CardContent className="p-0"><Skeleton className="h-64 w-full" /></CardContent></Card>
      </div>
    );
  }

  if (!data) {
    return <div className="p-6 text-center text-muted-foreground">Supplier not found.</div>;
  }

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-gray-900">Supplier Ledger</h1>
          <p className="text-sm text-gray-500">Transaction history and balance</p>
        </div>
        <Button variant="outline" onClick={() => navigate('/suppliers')}>Back to Suppliers</Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardContent className="pt-6">
            <div className="text-sm text-muted-foreground">Opening Balance</div>
            <div className="text-2xl font-bold">{money(data.openingBalance)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-sm text-muted-foreground">Closing Balance</div>
            <div className="text-2xl font-bold">{money(data.closingBalance)}</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Reference</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className="text-right">Debit</TableHead>
                <TableHead className="text-right">Credit</TableHead>
                <TableHead className="text-right">Balance</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.transactions.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                    No transactions found.
                  </TableCell>
                </TableRow>
              ) : (
                data.transactions.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell className="text-sm">{date(t.date)}</TableCell>
                    <TableCell>
                      <Badge variant={t.type === 'payment' ? 'default' : t.type === 'payment_void' ? 'destructive' : 'secondary'}>
                        {t.type}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{t.reference}</TableCell>
                    <TableCell className="text-sm">{t.description}</TableCell>
                    <TableCell className="text-right">{t.debit ? money(t.debit) : '-'}</TableCell>
                    <TableCell className="text-right">{t.credit ? money(t.credit) : '-'}</TableCell>
                    <TableCell className="text-right font-medium">{money(t.balance)}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
