import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { DataTable, type Column } from '@/components/data-table';
import { useDebouncedValue } from '@/lib/use-debounced-value';
import { money, date, statusLabel } from '@/lib/format';
import { useSupplierPayments, type Payment } from '@/features/invoicing/api';

const statusVariant: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  posted: 'default',
  cancelled: 'destructive',
};

export function SupplierPaymentsPage() {
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const search = useDebouncedValue(searchInput, 300);

  useEffect(() => setPage(1), [search]);
  const { data, isLoading } = useSupplierPayments({ page, pageSize: 12, search: search || undefined });

  const columns: Column<Payment>[] = [
    {
      key: 'paymentNumber',
      header: 'Voucher #',
      render: (p) => (
        <Link to={`/payments/${p.id}`} className="font-medium text-primary hover:underline">
          {p.paymentNumber}
        </Link>
      ),
    },
    { key: 'partner', header: 'Supplier', render: (p) => p.partner?.name ?? '-' },
    { key: 'paymentDate', header: 'Date', render: (p) => date(p.paymentDate) },
    { key: 'paymentMethod', header: 'Method', render: (p) => <Badge variant="secondary">{statusLabel(p.paymentMethod)}</Badge> },
    { key: 'amount', header: 'Amount', className: 'text-right', render: (p) => money(p.amount) },
    {
      key: 'status',
      header: 'Status',
      render: (p) => <Badge variant={statusVariant[p.status] ?? 'secondary'}>{p.status}</Badge>,
    },
  ];

  const meta = data?.meta;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Supplier Payments</h1>
        <p className="text-sm text-muted-foreground">
          Payments to suppliers. Record a new one from an expense's "Pay supplier".
        </p>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="pl-9"
          placeholder="Search payments..."
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
        />
      </div>

      <DataTable columns={columns} data={data?.data ?? []} loading={isLoading} getRowId={(p) => p.id} />

      {meta && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>{meta.total} payment(s)</span>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              Previous
            </Button>
            <span>
              Page {meta.page} of {meta.totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= meta.totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
