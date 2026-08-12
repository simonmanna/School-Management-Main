import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Eye, Plus, Search, X } from 'lucide-react';
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

const paymentLabel: Record<string, string> = {
  cash: 'Cash',
  card: 'Card',
  mobile_money: 'Mobile Money',
  mixed: 'Mixed',
  credit: 'Credit',
};

const settlementLabel: Record<string, string> = {
  unsettled: 'Unsettled',
  partially_settled: 'Partially Paid',
  settled: 'Settled',
  written_off: 'Written Off',
};

const settlementColor: Record<string, string> = {
  unsettled: 'bg-slate-100 text-slate-600',
  partially_settled: 'bg-amber-50 text-amber-700',
  settled: 'bg-emerald-50 text-emerald-700',
  written_off: 'bg-rose-50 text-rose-700',
};

const selectClass = 'h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring';

export function InvoicesPage() {
  const navigate = useNavigate();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const search = useDebouncedValue(searchInput, 300);
  const [filterStatus, setFilterStatus] = useState('');
  const [filterPayment, setFilterPayment] = useState('');
  const [filterSettlement, setFilterSettlement] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const hasActiveFilters = filterStatus || filterPayment || filterSettlement || dateFrom || dateTo;

  useEffect(() => setPage(1), [search, filterStatus, filterPayment, filterSettlement, dateFrom, dateTo]);

  const { data, isLoading } = useInvoices({
    page,
    pageSize: 10,
    search: search || undefined,
    status: filterStatus || undefined,
    paymentStatus: filterPayment || undefined,
    settlementStatus: filterSettlement || undefined,
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
  });

  const clearFilters = () => {
    setFilterStatus('');
    setFilterPayment('');
    setFilterSettlement('');
    setDateFrom('');
    setDateTo('');
  };

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
        { key: 'paymentTerm', header: 'Terms', render: (inv) => <span className="text-sm">{inv.paymentTermName ?? '—'}</span> },
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
    {
      key: 'discount',
      header: 'Discount',
      className: 'text-right',
      render: (inv) => {
        const hasDiscount = Number(inv.discountTotal) > 0;
        if (!hasDiscount) return <span className="text-slate-300">—</span>;
        const typeLabel = inv.discountType === 'fixed_amount'
          ? ` (fixed)`
          : inv.discountValue && Number(inv.discountValue) > 0
            ? ` (${Number(inv.discountValue).toFixed(1)}%)`
            : '';
        return (
          <div className="text-right">
            <div className="text-amber-700 font-medium">-{money(inv.discountTotal)}</div>
            {inv.discountReason ? <div className="text-[10px] text-slate-400">{inv.discountReason}</div> : null}
            {typeLabel ? <div className="text-[10px] text-slate-400">{typeLabel.trim()}</div> : null}
          </div>
        );
      },
    },
    {
      key: 'paymentMode',
      header: 'Method',
      className: 'text-center',
      render: (inv) => (
        <span className="text-xs text-muted-foreground">
          {inv.paymentMode ? paymentLabel[inv.paymentMode] ?? inv.paymentMode : '—'}
        </span>
      ),
    },
    {
      key: 'settlementStatus',
      header: 'Settlement',
      className: 'text-center',
      render: (inv) => (
        <span
          className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold ${
            settlementColor[inv.settlementStatus] ?? ''
          }`}
        >
          {settlementLabel[inv.settlementStatus] ?? inv.settlementStatus}
        </span>
      ),
    },
    {
      key: 'actions',
      header: '',
      className: 'w-12',
      render: (inv) => (
        <Button variant="ghost" size="sm" onClick={() => navigate(`/invoices/${inv.id}`)}>
          <Eye className="h-4 w-4" />
        </Button>
      ),
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

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9 h-9"
            placeholder="Search invoices..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
        </div>
        <select className={selectClass} value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
          <option value="">All statuses</option>
          <option value="draft">Draft</option>
          <option value="posted">Posted</option>
          <option value="paid">Paid</option>
          <option value="cancelled">Cancelled</option>
        </select>
        <select className={selectClass} value={filterPayment} onChange={(e) => setFilterPayment(e.target.value)}>
          <option value="">All payments</option>
          <option value="unpaid">Unpaid</option>
          <option value="paid">Paid</option>
          <option value="partially_paid">Partially Paid</option>
        </select>
        <select className={selectClass} value={filterSettlement} onChange={(e) => setFilterSettlement(e.target.value)}>
          <option value="">All settlements</option>
          <option value="unsettled">Unsettled</option>
          <option value="partially_settled">Partially Paid</option>
          <option value="settled">Settled</option>
          <option value="written_off">Written Off</option>
        </select>
        <input
          type="date"
          className={selectClass}
          value={dateFrom}
          onChange={(e) => setDateFrom(e.target.value)}
          title="From date"
        />
        <span className="text-xs text-muted-foreground">—</span>
        <input
          type="date"
          className={selectClass}
          value={dateTo}
          onChange={(e) => setDateTo(e.target.value)}
          title="To date"
        />
        {hasActiveFilters && (
          <Button variant="ghost" size="sm" onClick={clearFilters} className="h-9 gap-1">
            <X className="h-3.5 w-3.5" /> Clear
          </Button>
        )}
      </div>

      <DataTable
        columns={columns}
        data={data?.data ?? []}
        loading={isLoading}
        getRowId={(i) => i.id}
        cellClassName="py-1.5 px-3"
        headerRowClassName="h-10"
      />

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
