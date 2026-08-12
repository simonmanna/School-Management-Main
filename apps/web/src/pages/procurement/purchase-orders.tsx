import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import { Plus, Search, Truck, CreditCard, X, Receipt } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { DataTable, type Column } from '@/components/data-table';
import { api } from '@/lib/api';
import { notify } from '@/lib/notify';
import { useAuthStore } from '@/stores/auth.store';
import { useDebouncedValue } from '@/lib/use-debounced-value';
import { money, date } from '@/lib/format';
import type { PaginatedResult } from '@erp/shared';

interface PurchaseOrder {
  id: string;
  orderNumber: string;
  partnerId: string;
  status: string;
  paymentType: string;
  paymentStatus: string | null;
  totalAmount: number | string;
  totalPaid: number | string;
  orderDate: string;
  currencyCode: string;
}

const STATUS_LABELS: Record<string, string> = {
  active: 'Active',
  partially_received: 'Partially received',
  received: 'Received',
  cancelled: 'Cancelled',
};

const PAYMENT_TYPE_LABELS: Record<string, string> = {
  cash: 'Cash',
  credit: 'Credit',
};

const PAYMENT_STATUS_LABELS: Record<string, string> = {
  not_paid: 'Unpaid',
  paid: 'Paid',
  partial: 'Partial',
};

const STATUS_FILTERS = ['all', 'active', 'partially_received', 'received', 'cancelled'] as const;

export function PurchaseOrdersPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const org = useAuthStore((s) => s.organization);
  const [status, setStatus] = useState<string>('all');
  const [paymentType, setPaymentType] = useState<string>('all');
  const [paymentStatus, setPaymentStatus] = useState<string>('all');
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const search = useDebouncedValue(searchInput, 300);

  useEffect(() => setPage(1), [search]);

  const queryParams: Record<string, string | number> = { page, pageSize: 25 };
  if (status !== 'all') queryParams.status = status;
  if (paymentType !== 'all') queryParams.paymentType = paymentType;
  if (paymentStatus !== 'all') queryParams.paymentStatus = paymentStatus;
  if (search) queryParams.search = search;

  const { data, isLoading } = useQuery<PaginatedResult<PurchaseOrder>>({
    queryKey: ['purchase-orders', queryParams],
    queryFn: async () =>
      (await api.get<PaginatedResult<PurchaseOrder>>('/procurement/purchase-orders', { params: queryParams })).data,
  });

  const cancelMut = useMutation({
    mutationFn: async (id: string) =>
      (await api.post(`/procurement/purchase-orders/${id}/cancel`, { reason: '' })).data,
    onSuccess: () => {
      notify.success('Purchase cancelled');
      qc.invalidateQueries({ queryKey: ['purchase-orders'] });
    },
    onError: (e: any) => notify.error(e?.response?.data?.message ?? 'Failed'),
  });

  const columns: Column<PurchaseOrder>[] = [
    {
      key: 'orderNumber',
      header: 'Order #',
      render: (po) => (
        <Link to={`/procurement/purchase-orders/${po.id}`} className="font-medium text-primary hover:underline">
          {po.orderNumber}
        </Link>
      ),
    },
    {
      key: 'orderDate',
      header: 'Date',
      render: (po) => <span className="text-sm text-muted-foreground">{date(po.orderDate)}</span>,
    },
    {
      key: 'paymentType',
      header: 'Type',
      render: (po) => (
        <span className="text-xs text-muted-foreground">{PAYMENT_TYPE_LABELS[po.paymentType] ?? po.paymentType}</span>
      ),
    },
    {
      key: 'totalAmount',
      header: 'Total',
      className: 'text-right',
      render: (po) => (
        <span className="font-medium">{money(po.totalAmount, po.currencyCode ?? org?.currencyCode)}</span>
      ),
    },
    {
      key: 'paymentStatus',
      header: 'Payment',
      render: (po) =>
        po.paymentType === 'credit' ? (
          <Badge variant="outline" className="text-xs">
            {PAYMENT_STATUS_LABELS[po.paymentStatus ?? 'not_paid']}
          </Badge>
        ) : (
          <span className="text-xs text-muted-foreground">&mdash;</span>
        ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (po) => (
        <Badge
          variant={
            po.status === 'cancelled' ? 'destructive' : po.status === 'received' ? 'default' : 'secondary'
          }
        >
          {STATUS_LABELS[po.status] ?? po.status}
        </Badge>
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      className: 'text-right',
      render: (po) => (
        <div className="flex justify-end gap-1">
          {(po.status === 'active' || po.status === 'partially_received') && (
            <Button
              size="sm"
              variant="default"
              onClick={(e) => {
                e.stopPropagation();
                navigate(`/procurement/purchase-orders/${po.id}/receive`);
              }}
            >
              <Truck className="mr-1 h-3 w-3" />
              Receive
            </Button>
          )}
          {po.status === 'received' && po.paymentType === 'credit' && po.paymentStatus !== 'paid' && (
            <Button
              size="sm"
              variant="outline"
              onClick={(e) => {
                e.stopPropagation();
                navigate(`/procurement/purchase-orders/${po.id}/pay`);
              }}
            >
              <CreditCard className="h-3 w-3" />
            </Button>
          )}
          {po.status === 'received' && po.paymentType === 'cash' && (
            <Badge variant="secondary" className="text-xs">
              <Receipt className="h-3 w-3" />
            </Badge>
          )}
          {!['received', 'cancelled'].includes(po.status) && (
            <Button
              size="sm"
              variant="ghost"
              onClick={(e) => {
                e.stopPropagation();
                if (confirm('Cancel this purchase?')) cancelMut.mutate(po.id);
              }}
            >
              <X className="h-3 w-3 text-destructive" />
            </Button>
          )}
        </div>
      ),
    },
  ];

  const meta = data?.meta;
  const rows = data?.data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{t('procurement.purchaseOrders.title')}</h1>
          <p className="text-sm text-muted-foreground">{t('procurement.purchaseOrders.description')}</p>
        </div>
        <Button asChild>
          <Link to="/procurement/purchase-orders/new">
            <Plus className="mr-2 h-4 w-4" />
            New Purchase
          </Link>
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Search orders..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
        </div>

        <Select
          value={paymentType}
          onValueChange={(v) => { setPaymentType(v); setPage(1); }}
        >
          <SelectTrigger className="w-[130px]">
            <SelectValue placeholder="All types" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            <SelectItem value="cash">Cash</SelectItem>
            <SelectItem value="credit">Credit</SelectItem>
          </SelectContent>
        </Select>

        <Select
          value={paymentStatus}
          onValueChange={(v) => { setPaymentStatus(v); setPage(1); }}
        >
          <SelectTrigger className="w-[150px]">
            <SelectValue placeholder="All payments" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All payments</SelectItem>
            <SelectItem value="not_paid">Unpaid</SelectItem>
            <SelectItem value="partial">Partial</SelectItem>
            <SelectItem value="paid">Paid</SelectItem>
          </SelectContent>
        </Select>

        <div className="flex flex-wrap gap-2">
          {STATUS_FILTERS.map((s) => (
            <Button
              key={s}
              variant={status === s ? 'default' : 'outline'}
              size="sm"
              onClick={() => {
                setStatus(s);
                setPage(1);
              }}
            >
              {s === 'all' ? 'All' : STATUS_LABELS[s] ?? s}
            </Button>
          ))}
        </div>
      </div>

      <DataTable
        columns={columns}
        data={rows}
        loading={isLoading}
        getRowId={(po) => po.id}
        emptyMessage={
          <span>
            {t('procurement.purchaseOrders.noData')}{' '}
            <Link to="/procurement/purchase-orders/new" className="text-primary underline">
              Create one
            </Link>
            .
          </span>
        }
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
