import { useState } from 'react';
import { RefreshCw, Package, DollarSign, BarChart3 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { useInventoryValuation, type InventoryValuationItem } from '@/features/accounting/api';
import { money } from '@/lib/format';
import { format } from 'date-fns';

export function InventoryValuationPage() {
  const today = new Date().toISOString().slice(0, 10);
  const [asOf, setAsOf] = useState(today);
  const { data, isLoading, refetch, isRefetching } = useInventoryValuation(asOf);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="border-l-4 border-[#3b82f6] pl-4 space-y-1">
          <h1 className="text-3xl font-bold tracking-tight text-gray-900">Inventory Valuation</h1>
          <p className="text-sm text-gray-500">Stock value by product, category, and valuation account.</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isRefetching} className="gap-1.5">
          <RefreshCw className={`h-3.5 w-3.5 ${isRefetching ? 'animate-spin' : ''}`} /> Refresh
        </Button>
      </div>

      <div className="flex flex-wrap items-end gap-3 p-3 bg-white border rounded-lg shadow-sm">
        <div className="space-y-1 min-w-[150px]">
          <Label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">As Of</Label>
          <Input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} className="h-9 text-xs" />
        </div>
      </div>

      {/* Summary Cards */}
      {data && !isLoading && (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <Card>
            <CardHeader className="p-3 pb-1 flex flex-row items-center gap-2">
              <Package className="h-4 w-4 text-blue-500" />
              <CardTitle className="text-[10px] font-bold text-muted-foreground uppercase">Products</CardTitle>
            </CardHeader>
            <CardContent className="p-3 pt-0">
              <span className="text-2xl font-bold">{data.summary.totalItems.toLocaleString()}</span>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="p-3 pb-1 flex flex-row items-center gap-2">
              <DollarSign className="h-4 w-4 text-emerald-500" />
              <CardTitle className="text-[10px] font-bold text-muted-foreground uppercase">Total Value</CardTitle>
            </CardHeader>
            <CardContent className="p-3 pt-0">
              <span className="text-2xl font-bold text-emerald-600">{money(data.summary.totalValue)}</span>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="p-3 pb-1 flex flex-row items-center gap-2">
              <BarChart3 className="h-4 w-4 text-amber-500" />
              <CardTitle className="text-[10px] font-bold text-muted-foreground uppercase">Total Qty</CardTitle>
            </CardHeader>
            <CardContent className="p-3 pt-0">
              <span className="text-2xl font-bold">{data.summary.totalQty.toLocaleString()}</span>
            </CardContent>
          </Card>
        </div>
      )}

      <Card>
        <CardHeader className="pb-2 pt-4 px-5 bg-muted/30 border-b rounded-t-lg flex-row items-center justify-between">
          <CardTitle className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
            Valuation Items
          </CardTitle>
          {data && (
            <span className="text-[10px] text-muted-foreground">
              As of {format(new Date(data.asOf), 'MMM d, yyyy')}
            </span>
          )}
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/30">
                <TableHead className="text-[10px] font-bold text-muted-foreground uppercase">Product</TableHead>
                <TableHead className="text-[10px] font-bold text-muted-foreground uppercase">SKU</TableHead>
                <TableHead className="text-[10px] font-bold text-muted-foreground uppercase">Category</TableHead>
                <TableHead className="text-[10px] font-bold text-muted-foreground uppercase text-right">Unit Cost</TableHead>
                <TableHead className="text-[10px] font-bold text-muted-foreground uppercase text-right">On Hand</TableHead>
                <TableHead className="text-[10px] font-bold text-muted-foreground uppercase text-right pr-5">Total Value</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={`s-${i}`}>
                    {Array.from({ length: 6 }).map((_, j) => (
                      <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                    ))}
                  </TableRow>
                ))
              ) : !data || data.items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-12 text-muted-foreground">
                    <Package className="h-8 w-8 mx-auto mb-2 opacity-30" />
                    <p className="font-medium text-sm">No inventory tracked</p>
                    <p className="text-xs">Enable inventory tracking on products and record stock movements.</p>
                  </TableCell>
                </TableRow>
              ) : (
                data.items.map((item: InventoryValuationItem, idx: number) => (
                  <TableRow key={item.productId ?? idx} className="hover:bg-muted/20">
                    <TableCell className="text-xs font-medium">{item.productName}</TableCell>
                    <TableCell className="text-xs text-muted-foreground font-mono">{item.sku}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{item.categoryName}</TableCell>
                    <TableCell className="text-right text-xs font-semibold">{money(item.unitCost)}</TableCell>
                    <TableCell className="text-right text-xs font-semibold">{item.onHandQty.toLocaleString()}</TableCell>
                    <TableCell className="text-right text-xs font-bold text-emerald-600 pr-5">{money(item.totalValue)}</TableCell>
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
