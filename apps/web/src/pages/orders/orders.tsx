import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Eye, Plus, Search, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { DataTable, type Column } from '@/components/data-table';
import { useDebouncedValue } from '@/lib/use-debounced-value';
import { money, dateTime, useOrgCurrency, statusLabel } from '@/lib/format';
import { useOrders } from '@/features/orders/api';
import type { Order } from '@/features/orders/types';
import { ORDER_TYPE_LABELS } from './line-source';

const statusVariant: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  confirmed: 'default',
  in_progress: 'default',
  ready: 'secondary',
  completed: 'secondary',
  cancelled: 'destructive',
  closed: 'outline',
};

const orderTypes = Object.entries(ORDER_TYPE_LABELS) as Array<[string, string]>;

const selectClass = 'h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring';

export function OrdersPage() {
  const navigate = useNavigate();
  const currency = useOrgCurrency();
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const search = useDebouncedValue(searchInput, 300);
  const [filterStatus, setFilterStatus] = useState('');
  const [filterOrderType, setFilterOrderType] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const hasActiveFilters = filterStatus || filterOrderType || dateFrom || dateTo;

  useEffect(() => setPage(1), [search, filterStatus, filterOrderType, dateFrom, dateTo]);

  const { data, isLoading } = useOrders({
    page,
    pageSize: 10,
    search: search || undefined,
    status: filterStatus || undefined,
    orderType: filterOrderType || undefined,
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
  });

  const clearFilters = () => {
    setFilterStatus('');
    setFilterOrderType('');
    setDateFrom('');
    setDateTo('');
  };

  const columns: Column<Order>[] = [
    {
      key: 'orderNumber',
      header: 'Order #',
      render: (o) => (
        <Link to={`/orders/${o.id}`} className="font-medium text-primary hover:underline">
          {o.orderNumber}
        </Link>
      ),
    },
    { key: 'partnerName', header: 'Customer', render: (o) => o.partnerName ?? '-' },
    {
      key: 'orderType',
      header: 'Type',
      render: (o) => <span className="text-sm">{ORDER_TYPE_LABELS[o.orderType] ?? o.orderType}</span>,
    },
    { key: 'openedAt', header: 'Date', render: (o) => dateTime(o.openedAt) },
    { key: 'totalAmount', header: 'Total', className: 'text-right', render: (o) => money(o.totalAmount, currency) },
    {
      key: 'status',
      header: 'Status',
      render: (o) => (
        <Badge variant={statusVariant[o.status] ?? 'secondary'}>{statusLabel(o.status)}</Badge>
      ),
    },
    {
      key: 'invoiceId',
      header: 'Billed',
      render: (o) =>
        o.invoiceId ? <Badge variant="outline">Invoiced</Badge> : <span className="text-sm text-muted-foreground">—</span>,
    },
    {
      key: 'actions',
      header: '',
      render: (o) => (
        <Button variant="ghost" size="sm" onClick={() => navigate(`/orders/${o.id}`)}>
          <Eye className="mr-1 h-3.5 w-3.5" /> View
        </Button>
      ),
    },
  ];

  const meta = data?.meta;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Orders</h1>
          <p className="text-sm text-muted-foreground">
            Operational orders — café, retail, rental and repair share one document.
          </p>
        </div>
        <Button onClick={() => navigate('/orders/new')}>
          <Plus className="mr-1 h-4 w-4" /> New Order
        </Button>
      </div>

      {/* Filter bar — mirrors the invoices list pattern */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search order # or customer…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="h-9 w-72 pl-8"
          />
        </div>
        <select
          className={selectClass}
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
        >
          <option value="">All statuses</option>
          <option value="confirmed">Confirmed</option>
          <option value="in_progress">In progress</option>
          <option value="ready">Ready</option>
          <option value="completed">Completed</option>
          <option value="cancelled">Cancelled</option>
          <option value="closed">Closed</option>
        </select>
        <select
          className={selectClass}
          value={filterOrderType}
          onChange={(e) => setFilterOrderType(e.target.value)}
        >
          <option value="">All types</option>
          {orderTypes.map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
        <Input
          type="date"
          value={dateFrom}
          onChange={(e) => setDateFrom(e.target.value)}
          className="h-9 w-40"
          title="Opened from"
        />
        <Input
          type="date"
          value={dateTo}
          onChange={(e) => setDateTo(e.target.value)}
          className="h-9 w-40"
          title="Opened to"
        />
        {hasActiveFilters && (
          <Button variant="ghost" size="sm" onClick={clearFilters}>
            <X className="mr-1 h-3.5 w-3.5" /> Clear
          </Button>
        )}
      </div>

      <DataTable
        columns={columns}
        data={data?.rows ?? []}
        loading={isLoading}
        getRowId={(o) => o.id}
        cellClassName="py-1.5 px-3"
        headerRowClassName="h-10"
        emptyMessage="No orders found. Create one with “New Order”."
      />

      {meta && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>{meta.total} order(s)</span>
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