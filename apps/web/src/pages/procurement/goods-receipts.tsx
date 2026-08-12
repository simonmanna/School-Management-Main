import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { Eye, Plus, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { DataTable, type Column } from '@/components/data-table';
import { api } from '@/lib/api';
import { useDebouncedValue } from '@/lib/use-debounced-value';
import { date } from '@/lib/format';
import type { PaginatedResult } from '@erp/shared';

interface GRN {
  id: string;
  receiptNumber: string;
  status: 'draft' | 'posted' | 'cancelled';
  receivedAt: string;
  notes: string | null;
  order?: { orderNumber: string };
  lines?: Array<unknown>;
}

const STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  posted: 'Posted',
  cancelled: 'Cancelled',
};

const STATUS_FILTERS = ['all', 'draft', 'posted', 'cancelled'] as const;

export function GoodsReceiptsPage() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<string>('all');
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const search = useDebouncedValue(searchInput, 300);

  useEffect(() => setPage(1), [search, status]);

  const queryParams: Record<string, string | number> = { page, pageSize: 25 };
  if (status !== 'all') queryParams.status = status;
  if (search) queryParams.search = search;

  const { data, isLoading } = useQuery<PaginatedResult<GRN>>({
    queryKey: ['goods-receipts', queryParams],
    queryFn: async () =>
      (await api.get<PaginatedResult<GRN>>('/procurement/goods-receipts', { params: queryParams })).data,
  });

  const columns: Column<GRN>[] = [
    {
      key: 'receiptNumber',
      header: 'Receipt #',
      render: (g) => (
        <Link to={`/procurement/goods-receipts/${g.id}`} className="font-medium text-primary hover:underline">
          {g.receiptNumber}
        </Link>
      ),
    },
    {
      key: 'receivedAt',
      header: 'Date',
      render: (g) => <span className="text-sm text-muted-foreground">{date(g.receivedAt)}</span>,
    },
    {
      key: 'orderNumber',
      header: 'PO',
      render: (g) =>
        g.order?.orderNumber ? (
          <span className="text-sm text-muted-foreground">{g.order.orderNumber}</span>
        ) : (
          <span className="text-xs text-muted-foreground">&mdash;</span>
        ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (g) => (
        <Badge
          variant={g.status === 'posted' ? 'default' : g.status === 'cancelled' ? 'destructive' : 'secondary'}
        >
          {STATUS_LABELS[g.status] ?? g.status}
        </Badge>
      ),
    },
    {
      key: 'lines',
      header: 'Items',
      render: (g) => <span className="text-sm text-muted-foreground">{g.lines?.length ?? 0}</span>,
    },
    {
      key: 'notes',
      header: 'Notes',
      className: 'max-w-[200px]',
      render: (g) => (
        <span className="text-sm text-muted-foreground truncate block">{g.notes ?? '—'}</span>
      ),
    },
    {
      key: 'actions',
      header: '',
      className: 'w-12',
      render: (g) => (
        <Button variant="ghost" size="sm" onClick={() => navigate(`/procurement/goods-receipts/${g.id}`)}>
          <Eye className="h-4 w-4" />
        </Button>
      ),
    },
  ];

  const meta = data?.meta;
  const rows = data?.data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Goods Receipts</h1>
          <p className="text-sm text-muted-foreground">Stock received against purchases (auto-generated)</p>
        </div>
        <Button asChild>
          <Link to="/procurement/goods-receipts/new">
            <Plus className="mr-2 h-4 w-4" />
            New Receipt
          </Link>
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Search receipts..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
        </div>

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
        getRowId={(g) => g.id}
        emptyMessage="No goods receipts found."
      />

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
