import { useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { DataTable, type Column } from '@/components/data-table';
import { useDebouncedValue } from '@/lib/use-debounced-value';
import { useProducts, type Product } from '@/features/products/api';

export function ProductsPage() {
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const search = useDebouncedValue(searchInput, 300);

  useEffect(() => setPage(1), [search]);

  const { data, isLoading } = useProducts({ page, pageSize: 10, search: search || undefined });

  const columns: Column<Product>[] = [
    { key: 'code', header: 'Code' },
    { key: 'sku', header: 'SKU', render: (p) => p.sku ?? '-' },
    { key: 'name', header: 'Name' },
    { key: 'productType', header: 'Type', render: (p) => <Badge variant="secondary">{p.productType}</Badge> },
    {
      key: 'salesPrice',
      header: 'Sales price',
      className: 'text-right',
      render: (p) => (p.salesPrice != null ? Number(p.salesPrice).toFixed(2) : '-'),
    },
    {
      key: 'isActive',
      header: 'Active',
      render: (p) => <Badge variant={p.isActive ? 'default' : 'secondary'}>{p.isActive ? 'Yes' : 'No'}</Badge>,
    },
  ];

  const meta = data?.meta;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Products</h1>
        <p className="text-sm text-muted-foreground">
          Goods, services, fees and subscriptions. (Create uses the same dialog pattern as Partners.)
        </p>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="pl-9"
          placeholder="Search products..."
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
        />
      </div>

      <DataTable columns={columns} data={data?.data ?? []} loading={isLoading} getRowId={(p) => p.id} />

      {meta && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>{meta.total} record(s)</span>
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
