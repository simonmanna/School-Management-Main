import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Eye } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { DataTable, type Column } from '@/components/data-table';
import { useDebouncedValue } from '@/lib/use-debounced-value';
import { money, date, useOrgCurrency } from '@/lib/format';
import { useReceipts } from '@/pages/pos/api';
import type { Receipt } from '@/pages/pos/types';

const settlementColor: Record<string, string> = {
  unsettled: 'bg-slate-100 text-slate-600',
  partially_settled: 'bg-amber-50 text-amber-700',
  settled: 'bg-emerald-50 text-emerald-700',
  written_off: 'bg-rose-50 text-rose-700',
};

const methodLabel: Record<string, string> = {
  cash: 'Cash',
  card: 'Card',
  mobile_money: 'Mobile Money',
  mixed: 'Mixed',
  credit: 'Credit',
};

export function ReceiptsPage() {
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const search = useDebouncedValue(searchInput, 300);

  useEffect(() => setPage(1), [search]);
  const { data, isLoading } = useReceipts({ page, pageSize: 20, search: search || undefined });
  const currency = useOrgCurrency();

  const columns: Column<Receipt>[] = [
    {
      key: 'invoiceNumber',
      header: 'Receipt #',
      render: (r) => (
        <span className="font-medium text-primary">{r.documentNumber}</span>
      ),
    },
    { key: 'partner', header: 'Customer', render: (r) => r.partner?.name ?? '-' },
    { key: 'issueDate', header: 'Date', render: (r) => date(r.issueDate) },
    {
      key: 'paymentMode',
      header: 'Method',
      className: 'text-center',
      render: (r) => (
        <span className="text-xs text-muted-foreground">
          {r.paymentMode ? methodLabel[r.paymentMode] ?? r.paymentMode : '—'}
        </span>
      ),
    },
    { key: 'totalAmount', header: 'Total', className: 'text-right', render: (r) => money(r.totalAmount, currency) },
    {
      key: 'settlementStatus',
      header: 'Settlement',
      className: 'text-center',
      render: (r) => (
        <span
          className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold ${
            settlementColor[r.settlementStatus] ?? ''
          }`}
        >
          {r.settlementStatus}
        </span>
      ),
    },
    {
      key: 'actions',
      header: '',
      className: 'w-12 text-right',
      render: (r) => (
        <Button variant="ghost" size="sm" onClick={() => navigate(`/pos/receipts/${r.id}`)}>
          <Eye className="h-4 w-4" />
        </Button>
      ),
    },
  ];

  const meta = data?.meta;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Receipts</h1>
        <p className="text-sm text-muted-foreground">
          POS transaction receipts. Click the eye icon to view any receipt's full detail.
        </p>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="pl-9"
          placeholder="Search by receipt # or customer…"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
        />
      </div>

      <DataTable columns={columns} data={data?.data ?? []} loading={isLoading} getRowId={(r) => r.id} compact />

      {meta && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>{meta.total} receipt(s)</span>
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
