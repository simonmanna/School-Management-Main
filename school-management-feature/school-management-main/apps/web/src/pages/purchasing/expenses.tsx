import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Plus, Search } from 'lucide-react';
import { PERMISSIONS } from '@erp/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { DataTable, type Column } from '@/components/data-table';
import { useDebouncedValue } from '@/lib/use-debounced-value';
import { money, date, statusLabel } from '@/lib/format';
import { useAuthStore } from '@/stores/auth.store';
import { useExpenses, type Invoice } from '@/features/invoicing/api';

const statusVariant: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  posted: 'default',
  paid: 'default',
  draft: 'secondary',
  cancelled: 'destructive',
};

export function ExpensesPage() {
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const search = useDebouncedValue(searchInput, 300);
  const hasPermission = useAuthStore((s) => s.hasPermission);

  useEffect(() => setPage(1), [search]);
  const { data, isLoading } = useExpenses({ page, pageSize: 10, search: search || undefined });

  const columns: Column<Invoice>[] = [
    {
      key: 'documentNumber',
      header: 'Bill #',
      render: (b) => (
        <Link to={`/expenses/${b.id}`} className="font-medium text-primary hover:underline">
          {b.documentNumber}
        </Link>
      ),
    },
    { key: 'partner', header: 'Supplier', render: (b) => b.partner?.name ?? '-' },
    { key: 'issueDate', header: 'Date', render: (b) => date(b.issueDate) },
    { key: 'totalAmount', header: 'Total', className: 'text-right', render: (b) => money(b.totalAmount) },
    { key: 'amountResidual', header: 'Due', className: 'text-right', render: (b) => money(b.amountResidual) },
    {
      key: 'status',
      header: 'Status',
      render: (b) => <Badge variant={statusVariant[b.status] ?? 'secondary'}>{b.status}</Badge>,
    },
    {
      key: 'paymentStatus',
      header: 'Payment',
      render: (b) => <span className="text-sm text-muted-foreground">{statusLabel(b.paymentStatus)}</span>,
    },
  ];

  const meta = data?.meta;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Expenses</h1>
          <p className="text-sm text-muted-foreground">Vendor bills — post to the ledger and pay suppliers.</p>
        </div>
        {hasPermission(PERMISSIONS.expense.create) && (
          <Button onClick={() => navigate('/expenses/new')}>
            <Plus className="h-4 w-4" /> New Expense
          </Button>
        )}
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="pl-9"
          placeholder="Search expenses..."
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
        />
      </div>

      <DataTable columns={columns} data={data?.data ?? []} loading={isLoading} getRowId={(b) => b.id} />

      {meta && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>{meta.total} bill(s)</span>
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
