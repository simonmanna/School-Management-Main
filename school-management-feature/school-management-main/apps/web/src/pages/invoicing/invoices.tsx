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
import { useInvoices, type Invoice } from '@/features/invoicing/api';

const statusVariant: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  posted: 'default',
  paid: 'default',
  draft: 'secondary',
  cancelled: 'destructive',
};

export function InvoicesPage() {
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const search = useDebouncedValue(searchInput, 300);
  const hasPermission = useAuthStore((s) => s.hasPermission);

  useEffect(() => setPage(1), [search]);
  const { data, isLoading } = useInvoices({ page, pageSize: 10, search: search || undefined });

  const columns: Column<Invoice>[] = [
    {
      key: 'documentNumber',
      header: 'Invoice #',
      render: (inv) => (
        <Link to={`/invoices/${inv.id}`} className="font-medium text-primary hover:underline">
          {inv.documentNumber}
        </Link>
      ),
    },
    { key: 'partner', header: 'Customer', render: (inv) => inv.partner?.name ?? '-' },
    { key: 'issueDate', header: 'Date', render: (inv) => date(inv.issueDate) },
    { key: 'totalAmount', header: 'Total', className: 'text-right', render: (inv) => money(inv.totalAmount) },
    { key: 'amountResidual', header: 'Due', className: 'text-right', render: (inv) => money(inv.amountResidual) },
    {
      key: 'status',
      header: 'Status',
      render: (inv) => <Badge variant={statusVariant[inv.status] ?? 'secondary'}>{inv.status}</Badge>,
    },
    {
      key: 'paymentStatus',
      header: 'Payment',
      render: (inv) => <span className="text-sm text-muted-foreground">{statusLabel(inv.paymentStatus)}</span>,
    },
  ];

  const meta = data?.meta;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Invoices</h1>
          <p className="text-sm text-muted-foreground">Sales invoices — post to the ledger and collect payment.</p>
        </div>
        {hasPermission(PERMISSIONS.invoice.create) && (
          <Button onClick={() => navigate('/invoices/new')}>
            <Plus className="h-4 w-4" /> New Invoice
          </Button>
        )}
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="pl-9"
          placeholder="Search invoices..."
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
        />
      </div>

      <DataTable columns={columns} data={data?.data ?? []} loading={isLoading} getRowId={(i) => i.id} />

      {meta && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>{meta.total} invoice(s)</span>
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
