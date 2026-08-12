import { useState } from 'react';
import { ChevronRight, ArrowLeft, Edit, Package, MapPin, ArrowRightLeft, FileText, AlertTriangle, TrendingDown, Activity, ShoppingCart, UtensilsCrossed, RefreshCw, MoreHorizontal, BookOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { formatCurrency } from '@/lib/utils';
import { date, dateTime } from '@/lib/format';
import { useNavigate, useParams } from 'react-router-dom';
import { useInventoryItemDetail, type InventoryItemDetail } from '@/features/inventory/api';

function getTotalQuantity(data: InventoryItemDetail): number {
  return data.items.reduce((s, i) => s + Number(i.quantity), 0);
}

function isLowStock(data: InventoryItemDetail): boolean {
  const qty = getTotalQuantity(data);
  const min = Number(data.product.minQuantity ?? 0);
  return min > 0 && qty <= min && qty > 0;
}

function isOutOfStock(data: InventoryItemDetail): boolean {
  return getTotalQuantity(data) <= 0;
}

function StockStatusBanner({ data }: { data: InventoryItemDetail }) {
  const totalQty = getTotalQuantity(data);
  const low = isLowStock(data);
  const out = isOutOfStock(data);
  if (out) return (
    <div className="flex items-center gap-2 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
      <TrendingDown className="h-4 w-4 flex-shrink-0" />
      <span className="font-semibold">Out of Stock</span>
      <span className="text-red-600">— Current quantity is 0. Create a purchase to restock.</span>
    </div>
  );
  if (low) return (
    <div className="flex items-center gap-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-700">
      <AlertTriangle className="h-4 w-4 flex-shrink-0" />
      <span className="font-semibold">Low Stock</span>
      <span className="text-amber-600">— Quantity ({totalQty}) is below minimum ({data.product.minQuantity}).</span>
    </div>
  );
  return null;
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start py-2.5 gap-4">
      <dt className="w-36 flex-shrink-0 text-xs text-muted-foreground font-semibold pt-0.5 uppercase tracking-wide">{label}</dt>
      <dd className="text-sm flex-1">{value ?? <span className="text-muted-foreground">—</span>}</dd>
    </div>
  );
}

const TXN_COLORS: Record<string, { bg: string; text: string; label: string }> = {
  receipt: { bg: 'bg-blue-50', text: 'text-blue-700', label: 'Receipt' },
  issue: { bg: 'bg-purple-50', text: 'text-purple-700', label: 'Issue' },
  adjustment_in: { bg: 'bg-amber-50', text: 'text-amber-700', label: 'Adj In' },
  adjustment_out: { bg: 'bg-amber-50', text: 'text-amber-700', label: 'Adj Out' },
  transfer_in: { bg: 'bg-slate-50', text: 'text-slate-700', label: 'Transfer In' },
  transfer_out: { bg: 'bg-slate-50', text: 'text-slate-700', label: 'Transfer Out' },
  waste: { bg: 'bg-red-50', text: 'text-red-700', label: 'Waste' },
  return_in: { bg: 'bg-emerald-50', text: 'text-emerald-700', label: 'Return In' },
  return_to_supplier: { bg: 'bg-emerald-50', text: 'text-emerald-700', label: 'Return Out' },
  expiry_write_off: { bg: 'bg-red-50', text: 'text-red-700', label: 'Expired' },
  opening_balance: { bg: 'bg-gray-50', text: 'text-gray-700', label: 'Opening' },
};

function TxnTypePill({ type }: { type: string }) {
  const c = TXN_COLORS[type] ?? { bg: 'bg-gray-50', text: 'text-gray-700', label: type };
  return <span className={`inline-flex items-center px-2.5 py-0.5 rounded text-xs font-semibold ${c.bg} ${c.text}`}>{c.label}</span>;
}

function PoStatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    active: 'bg-blue-50 text-blue-700',
    received: 'bg-emerald-50 text-emerald-700',
    partially_received: 'bg-amber-50 text-amber-700',
    cancelled: 'bg-red-50 text-red-700',
    draft: 'bg-gray-50 text-gray-700',
  };
  return <span className={`inline-flex px-2.5 py-0.5 rounded text-xs font-semibold ${map[status] ?? 'bg-gray-50 text-gray-700'}`}>{status.replace(/_/g, ' ')}</span>;
}

function TabOverview({ data }: { data: InventoryItemDetail }) {
  const { product } = data;
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <Card>
        <CardHeader className="pb-2 pt-4 px-5 bg-muted/30 border-b rounded-t-lg">
          <CardTitle className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Item Details</CardTitle>
        </CardHeader>
        <CardContent className="px-5 pb-4">
          <dl className="divide-y">
            <InfoRow label="Item Code" value={<code className="text-xs bg-muted px-2 py-0.5 rounded font-mono text-primary font-semibold">{product.code}</code>} />
            <InfoRow label="Name" value={<span className="font-semibold">{product.name}</span>} />
            <InfoRow label="Description" value={product.description} />
            <InfoRow label="SKU" value={product.sku ? <code className="text-xs bg-muted px-1.5 py-0.5 rounded font-mono">{product.sku}</code> : null} />
            <InfoRow label="Barcode" value={product.barcode ? <code className="text-xs bg-muted px-1.5 py-0.5 rounded font-mono">{product.barcode}</code> : null} />
            <InfoRow label="Category" value={product.category?.name ? <span className="font-semibold">{product.category.name}</span> : null} />
            <InfoRow label="Product Type" value={product.productType ? <Badge variant="secondary" className="text-xs capitalize">{product.productType}</Badge> : null} />
            <InfoRow label="Costing Method" value={product.costingMethod ? <Badge variant="outline" className="text-xs font-mono">{product.costingMethod}</Badge> : null} />
            <InfoRow label="Stock Policy" value={product.stockPolicy ? <Badge variant="outline" className="text-xs capitalize">{product.stockPolicy}</Badge> : null} />
            <InfoRow label="Status" value={product.isActive ? <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 text-xs">Active</Badge> : <Badge variant="secondary" className="text-xs">Inactive</Badge>} />
            <InfoRow label="Batch Tracking" value={product.batchTracking ? <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 text-xs">Enabled</Badge> : <Badge variant="outline" className="text-xs text-muted-foreground">Disabled</Badge>} />
            <InfoRow label="Track Inventory" value={product.trackInventory ? <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 text-xs">Yes</Badge> : <Badge variant="secondary" className="text-xs">No</Badge>} />
            <InfoRow label="Default Supplier" value={product.supplier?.name ?? null} />
          </dl>
        </CardContent>
      </Card>

      <div className="space-y-4">
        <Card>
          <CardHeader className="pb-2 pt-4 px-5 bg-muted/30 border-b rounded-t-lg">
            <CardTitle className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Stock Summary</CardTitle>
          </CardHeader>
          <CardContent className="px-5 pb-4">
            <div className="grid grid-cols-2 gap-4 mb-2 mt-3">
              <div className="p-3 bg-muted/30 rounded-lg border">
                <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">On Hand</p>
                <p className={`text-2xl font-bold mt-0.5 ${isOutOfStock(data) ? 'text-destructive' : isLowStock(data) ? 'text-amber-600' : ''}`}>
                  {getTotalQuantity(data).toLocaleString()}
                </p>
              </div>
              <div className="p-3 bg-muted/30 rounded-lg border">
                <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Min. Level</p>
                <p className="text-2xl font-bold mt-0.5">{Number(product.minQuantity ?? 0).toLocaleString()}</p>
              </div>
            </div>
            <dl className="divide-y">
              <InfoRow label="Unit Cost" value={formatCurrency(product.costPrice)} />
              <InfoRow label="Sales Price" value={formatCurrency(product.salesPrice)} />
              <InfoRow label="Stock Value" value={<span className="font-bold text-emerald-600">{formatCurrency(data.totalValue)}</span>} />
              <InfoRow label="Reorder Qty" value={Number(product.reorderQty ?? 0) > 0 ? Number(product.reorderQty).toLocaleString() : null} />
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2 pt-4 px-5 bg-muted/30 border-b rounded-t-lg">
            <CardTitle className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Usage Stats</CardTitle>
          </CardHeader>
          <CardContent className="px-5 pb-4">
            <div className="grid grid-cols-2 gap-3">
              {[
                { label: 'Locations', value: data.items.length, icon: MapPin },
                { label: 'Ledger Entries', value: data.recentLedger.length, icon: ArrowRightLeft },
                { label: 'Menu Items', value: data.menuProducts.length, icon: UtensilsCrossed },
                { label: 'PO Lines', value: data.purchaseOrderLines.length, icon: ShoppingCart },
              ].map(({ label, value: v, icon: Icon }) => (
                <div key={label} className="flex items-center gap-2.5 p-3 bg-muted/30 rounded-lg border">
                  <div className="p-1.5 bg-primary/10 rounded-md"><Icon className="h-4 w-4 text-primary" /></div>
                  <div>
                    <p className="text-lg font-bold leading-none">{v}</p>
                    <p className="text-xs text-muted-foreground mt-0.5 font-medium uppercase tracking-wide">{label}</p>
                  </div>
                </div>
              ))}
            </div>
            <dl className="divide-y mt-4">
              <InfoRow label="Created" value={date(product.createdAt)} />
              <InfoRow label="Last Updated" value={date(product.updatedAt)} />
            </dl>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function TabStockMoves({ data }: { data: InventoryItemDetail }) {
  const logs = data.recentLedger;
  if (logs.length === 0) return (
    <Card>
      <CardContent className="py-16 flex flex-col items-center text-muted-foreground gap-2">
        <ArrowRightLeft className="h-10 w-10 opacity-30" />
        <p className="font-semibold">No stock movements yet</p>
        <p className="text-xs">Movements will appear here after purchases, adjustments, or usage</p>
      </CardContent>
    </Card>
  );
  return (
    <Card>
      <CardHeader className="pb-2 pt-4 px-5 flex-row items-center justify-between bg-muted/30 border-b rounded-t-lg">
        <CardTitle className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Stock Movements</CardTitle>
        <p className="text-xs text-muted-foreground font-medium">{logs.length} records (last 100)</p>
      </CardHeader>
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/30">
            <TableHead className="text-xs font-bold text-muted-foreground uppercase">Date</TableHead>
            <TableHead className="text-xs font-bold text-muted-foreground uppercase">Type</TableHead>
            <TableHead className="text-xs font-bold text-muted-foreground uppercase">Location</TableHead>
            <TableHead className="text-xs font-bold text-muted-foreground uppercase text-right">Change</TableHead>
            <TableHead className="text-xs font-bold text-muted-foreground uppercase text-right">Before</TableHead>
            <TableHead className="text-xs font-bold text-muted-foreground uppercase text-right">After</TableHead>
            <TableHead className="text-xs font-bold text-muted-foreground uppercase">Batch</TableHead>
            <TableHead className="text-xs font-bold text-muted-foreground uppercase">Reference</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {logs.map((log) => (
            <TableRow key={log.id} className="hover:bg-muted/20">
              <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{dateTime(log.createdAt)}</TableCell>
              <TableCell><TxnTypePill type={log.type} /></TableCell>
              <TableCell className="text-sm">{log.location?.name ?? '—'}</TableCell>
              <TableCell className="text-right">
                <span className={`font-bold text-sm ${log.quantityChange >= 0 ? 'text-emerald-600' : 'text-destructive'}`}>
                  {log.quantityChange >= 0 ? '+' : ''}{log.quantityChange.toLocaleString()}
                </span>
              </TableCell>
              <TableCell className="text-right text-sm text-muted-foreground">{log.qtyBefore.toLocaleString()}</TableCell>
              <TableCell className="text-right text-sm font-semibold">{log.balanceAfter.toLocaleString()}</TableCell>
              <TableCell className="text-xs text-muted-foreground font-mono">{log.batch?.batchNumber ?? '—'}</TableCell>
              <TableCell className="text-xs text-muted-foreground">{log.referenceType ?? log.notes ?? '—'}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}

function TabLocations({ data }: { data: InventoryItemDetail }) {
  const locations = data.items;
  const totalQty = getTotalQuantity(data);
  if (locations.length === 0) return (
    <Card>
      <CardContent className="py-16 flex flex-col items-center text-muted-foreground gap-2">
        <MapPin className="h-10 w-10 opacity-30" />
        <p className="font-semibold">No location stock records</p>
        <p className="text-xs">Stock will be tracked per location once received via purchases</p>
      </CardContent>
    </Card>
  );
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4 p-4 bg-white rounded-lg border shadow-sm">
        <div>
          <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Total Across All Locations</p>
          <p className="text-2xl font-bold">{totalQty.toLocaleString()}</p>
        </div>
        <Separator orientation="vertical" className="h-10" />
        <div>
          <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Total Locations</p>
          <p className="text-2xl font-bold">{locations.length}</p>
        </div>
        <Separator orientation="vertical" className="h-10" />
        <div>
          <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Stock Value</p>
          <p className="text-2xl font-bold text-emerald-600">{formatCurrency(data.totalValue)}</p>
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {locations.map((ls) => {
          const minQty = Number(data.product.minQuantity ?? 0);
          const isLow = minQty > 0 && ls.quantity <= minQty;
          const pct = totalQty > 0 ? Math.round((ls.quantity / totalQty) * 100) : 0;
          return (
            <Card key={ls.id} className={`border shadow-sm ${isLow ? 'border-amber-400 bg-amber-50/30' : ''}`}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <div className={`p-1.5 rounded-lg ${isLow ? 'bg-amber-100' : 'bg-primary/10'}`}>
                      <MapPin className={`h-3.5 w-3.5 ${isLow ? 'text-amber-600' : 'text-primary'}`} />
                    </div>
                    <div>
                      <p className="font-semibold text-sm">{ls.location.name}</p>
                      <p className="text-xs text-muted-foreground capitalize">{ls.location.type.replace(/_/g, ' ')}</p>
                    </div>
                  </div>
                  {isLow && <Badge variant="outline" className="text-xs border-amber-400 text-amber-600 bg-amber-50 font-semibold">Low Stock</Badge>}
                </div>
                <div className="grid grid-cols-2 gap-3 mb-3">
                  <div className="p-2 bg-muted/30 rounded border">
                    <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">On Hand</p>
                    <p className={`text-lg font-bold ${isLow ? 'text-amber-600' : ''}`}>{ls.quantity.toLocaleString()}</p>
                  </div>
                  <div className="p-2 bg-muted/30 rounded border">
                    <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Minimum</p>
                    <p className="text-lg font-bold">{minQty.toLocaleString()}</p>
                  </div>
                </div>
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-xs text-muted-foreground"><span>{pct}% of total stock</span></div>
                  <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                    <div className={`h-full rounded-full transition-all ${isLow ? 'bg-amber-500' : 'bg-primary'}`} style={{ width: `${pct}%` }} />
                  </div>
                </div>
                <p className="text-xs text-muted-foreground mt-2 flex items-center gap-1"><RefreshCw className="h-3 w-3" />Updated: {dateTime(data.product.updatedAt)}</p>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function TabTransactions({ data }: { data: InventoryItemDetail }) {
  const txns = data.recentLedger;
  if (txns.length === 0) return (
    <Card>
      <CardContent className="py-16 flex flex-col items-center text-muted-foreground gap-2">
        <Activity className="h-10 w-10 opacity-30" />
        <p className="font-semibold">No transactions yet</p>
      </CardContent>
    </Card>
  );
  return (
    <Card>
      <CardHeader className="pb-2 pt-4 px-5 flex-row items-center justify-between bg-muted/30 border-b rounded-t-lg">
        <CardTitle className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Transaction History</CardTitle>
        <p className="text-xs text-muted-foreground font-medium">{txns.length} records</p>
      </CardHeader>
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/30">
            <TableHead className="text-xs font-bold text-muted-foreground uppercase">Date</TableHead>
            <TableHead className="text-xs font-bold text-muted-foreground uppercase">Type</TableHead>
            <TableHead className="text-xs font-bold text-muted-foreground uppercase text-right">Quantity</TableHead>
            <TableHead className="text-xs font-bold text-muted-foreground uppercase text-right">Unit Cost</TableHead>
            <TableHead className="text-xs font-bold text-muted-foreground uppercase text-right">Total</TableHead>
            <TableHead className="text-xs font-bold text-muted-foreground uppercase">Batch</TableHead>
            <TableHead className="text-xs font-bold text-muted-foreground uppercase">Reference</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {txns.map((t) => (
            <TableRow key={t.id} className="hover:bg-muted/20">
              <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{dateTime(t.createdAt)}</TableCell>
              <TableCell><TxnTypePill type={t.type} /></TableCell>
              <TableCell className="text-right">
                <span className={`font-bold text-sm ${t.quantityChange >= 0 ? 'text-emerald-600' : 'text-destructive'}`}>
                  {t.quantityChange >= 0 ? '+' : ''}{t.quantityChange.toLocaleString()}
                </span>
              </TableCell>
              <TableCell className="text-right text-sm">{t.unitCost ? formatCurrency(t.unitCost) : '—'}</TableCell>
              <TableCell className="text-right text-sm font-semibold">{t.totalValue ? formatCurrency(t.totalValue) : '—'}</TableCell>
              <TableCell className="text-xs font-mono text-muted-foreground">{t.batch?.batchNumber ?? '—'}</TableCell>
              <TableCell className="text-xs text-muted-foreground">{t.referenceType ?? t.notes ?? '—'}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}

function TabMenuUsage({ data }: { data: InventoryItemDetail }) {
  const items = data.menuProducts;
  if (items.length === 0) return (
    <Card>
      <CardContent className="py-16 flex flex-col items-center text-muted-foreground gap-2">
        <UtensilsCrossed className="h-10 w-10 opacity-30" />
        <p className="font-semibold">Not used in any menu items</p>
        <p className="text-xs">Configure this product as an ingredient in menu item recipes</p>
      </CardContent>
    </Card>
  );
  return (
    <Card>
      <CardHeader className="pb-2 pt-4 px-5 bg-muted/30 border-b rounded-t-lg">
        <CardTitle className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Menu Items Using This Product</CardTitle>
      </CardHeader>
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/30">
            <TableHead className="text-xs font-bold text-muted-foreground uppercase">Menu Item</TableHead>
            <TableHead className="text-xs font-bold text-muted-foreground uppercase">Code</TableHead>
            <TableHead className="text-xs font-bold text-muted-foreground uppercase text-right">Qty Used</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((mp) => (
            <TableRow key={mp.id} className="hover:bg-muted/20">
              <TableCell className="font-semibold text-sm">{mp.menuItem.name}</TableCell>
              <TableCell>{mp.menuItem.code && <code className="text-xs bg-muted px-1.5 py-0.5 rounded font-mono text-primary font-semibold">{mp.menuItem.code}</code>}</TableCell>
              <TableCell className="text-right font-bold text-sm">{Number(mp.quantity).toLocaleString()}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}

function TabPurchaseOrders({ data }: { data: InventoryItemDetail }) {
  const poItems = data.purchaseOrderLines;
  if (poItems.length === 0) return (
    <Card>
      <CardContent className="py-16 flex flex-col items-center text-muted-foreground gap-2">
        <ShoppingCart className="h-10 w-10 opacity-30" />
        <p className="font-semibold">No purchases found</p>
        <p className="text-xs">This item hasn't been ordered yet</p>
      </CardContent>
    </Card>
  );
  return (
    <Card>
      <CardHeader className="pb-2 pt-4 px-5 flex-row items-center justify-between bg-muted/30 border-b rounded-t-lg">
        <CardTitle className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Purchase History</CardTitle>
        <p className="text-xs text-muted-foreground font-medium">{poItems.length} purchase lines</p>
      </CardHeader>
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/30">
            <TableHead className="text-xs font-bold text-muted-foreground uppercase">PO Number</TableHead>
            <TableHead className="text-xs font-bold text-muted-foreground uppercase">Supplier</TableHead>
            <TableHead className="text-xs font-bold text-muted-foreground uppercase">Date</TableHead>
            <TableHead className="text-xs font-bold text-muted-foreground uppercase">Status</TableHead>
            <TableHead className="text-xs font-bold text-muted-foreground uppercase text-right">Ordered</TableHead>
            <TableHead className="text-xs font-bold text-muted-foreground uppercase text-right">Received</TableHead>
            <TableHead className="text-xs font-bold text-muted-foreground uppercase text-right">Unit Price</TableHead>
            <TableHead className="text-xs font-bold text-muted-foreground uppercase text-right">Total</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {poItems.map((poi) => (
            <TableRow key={poi.id} className="hover:bg-muted/20">
              <TableCell><code className="text-xs bg-muted px-1.5 py-0.5 rounded font-mono font-bold text-primary">{poi.order.orderNumber}</code></TableCell>
              <TableCell className="text-sm">{poi.order.partner.name}</TableCell>
              <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{date(poi.order.createdAt)}</TableCell>
              <TableCell><PoStatusBadge status={poi.order.status} /></TableCell>
              <TableCell className="text-right font-bold text-sm">{Number(poi.quantity).toLocaleString()}</TableCell>
              <TableCell className="text-right text-sm"><span className={Number(poi.receivedQuantity) < Number(poi.quantity) ? 'text-amber-600 font-bold' : 'text-emerald-600 font-bold'}>{Number(poi.receivedQuantity).toLocaleString()}</span></TableCell>
              <TableCell className="text-right text-sm">{formatCurrency(poi.unitPrice)}</TableCell>
              <TableCell className="text-right font-bold text-sm">{formatCurrency(poi.subtotal)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}

/** Lookup label for an account mapping key. */
const ACCOUNT_LABELS: Record<string, string> = {
  sales_revenue: 'Sales Revenue (Income)',
  accounts_receivable: 'Accounts Receivable',
  cogs: 'Cost of Goods Sold (Expense)',
  stock_valuation: 'Stock Valuation (Inventory)',
  grni_accrued: 'GRNI Accrued',
  stock_adjustment_income: 'Stock Adjustment Income',
  stock_adjustment_expense: 'Stock Adjustment Expense',
  default_cash: 'Cash (Default)',
};

interface AccField {
  key: string;
  label: string;
  mappingKey: string;
  productOverride: string | null;
  categoryField: string | null;
}

function TabAccounting({ data }: { data: InventoryItemDetail }) {
  const p = data.product;
  const fields: AccField[] = [
    { key: 'income',  label: 'Income (Revenue)',  mappingKey: 'sales_revenue',          productOverride: p.incomeAccountOverrideId, categoryField: 'incomeAccountId' },
    { key: 'expense', label: 'Expense (COGS)',     mappingKey: 'cogs',                   productOverride: p.expenseAccountOverrideId, categoryField: 'expenseAccountId' },
    { key: 'inventory', label: 'Inventory (Stock)', mappingKey: 'stock_valuation',       productOverride: p.inventoryAccountOverrideId, categoryField: 'inventoryAccountId' },
    { key: 'cogs_sep', label: 'COGS (separate)',   mappingKey: 'cogs',                   productOverride: p.cogsAccountOverrideId, categoryField: 'cogsAccountId' },
    { key: 'shrinkage', label: 'Shrinkage / Adj Loss', mappingKey: 'stock_adjustment_expense', productOverride: p.shrinkageAccountOverrideId, categoryField: 'shrinkageAccountId' },
    { key: 'variance', label: 'Adj Gain / Variance', mappingKey: 'stock_adjustment_income',    productOverride: p.varianceGainAccountOverrideId, categoryField: 'varianceGainAccountId' },
    { key: 'damage',   label: 'Damage Write-Off',   mappingKey: 'stock_adjustment_expense', productOverride: p.damageAccountOverrideId, categoryField: 'damageAccountId' },
    { key: 'expiry',   label: 'Expiry Write-Off',   mappingKey: 'stock_adjustment_expense', productOverride: p.expiryAccountOverrideId, categoryField: 'expiryAccountId' },
  ];
  const overrideCount = fields.filter((f) => f.productOverride).length;

  return (
    <div className="space-y-4">
      <Card className="bg-blue-50 border-blue-200">
        <CardContent className="p-4 flex items-start gap-3">
          <BookOpen className="h-5 w-5 text-blue-600 mt-0.5 flex-shrink-0" />
          <div>
            <p className="font-semibold text-blue-800 text-sm">Account Resolution Chain</p>
            <ol className="text-xs text-blue-700 space-y-0.5 list-decimal list-inside mt-1">
              <li><strong>Product override</strong> — set below</li>
              <li><strong>Category default</strong> — <code className="bg-blue-100 px-1 rounded">{p.category?.name ?? '—'}</code></li>
              <li><strong>Org Account Mapping</strong> — Accounting &gt; Account Mappings</li>
            </ol>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2 pt-4 px-5 flex-row items-center justify-between bg-muted/30 border-b rounded-t-lg">
          <CardTitle className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Product-Level Account Overrides</CardTitle>
          <p className="text-xs text-muted-foreground font-medium">{overrideCount} override{overrideCount !== 1 ? 's' : ''} active</p>
        </CardHeader>
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/30">
              <TableHead className="text-xs font-bold text-muted-foreground uppercase">Account</TableHead>
              <TableHead className="text-xs font-bold text-muted-foreground uppercase">Override (Product)</TableHead>
              <TableHead className="text-xs font-bold text-muted-foreground uppercase">Category Default</TableHead>
              <TableHead className="text-xs font-bold text-muted-foreground uppercase">Org Map Key</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {fields.map((f) => (
              <TableRow key={f.key} className="hover:bg-muted/20">
                <TableCell className="font-semibold text-sm">{f.label}</TableCell>
                <TableCell>
                  {f.productOverride ? (
                    <Badge className="bg-indigo-100 text-indigo-700 border-indigo-200 font-mono text-xs">{f.productOverride}</Badge>
                  ) : (
                    <span className="text-xs text-muted-foreground italic">Inherited</span>
                  )}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground font-mono">{f.categoryField}</TableCell>
                <TableCell>
                  <Badge variant="outline" className="text-xs font-mono text-muted-foreground">{f.mappingKey}</Badge>
                  <p className="text-[10px] text-muted-foreground mt-0.5">{ACCOUNT_LABELS[f.mappingKey] ?? f.mappingKey}</p>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <Card>
        <CardContent className="p-4 flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Configure per-movement-type posting rules at <strong className="text-foreground">Accounting &gt; Posting Rules</strong>
          </p>
          <Button variant="outline" size="sm" onClick={() => window.open('/accounts/posting-rules', '_self')}>
            <BookOpen className="h-4 w-4 mr-1" /> Posting Rules
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

export default function InventoryDetailPage() {
  const navigate = useNavigate();
  const { productId } = useParams<{ productId: string }>();
  const { data, isLoading, refetch, isRefetching } = useInventoryItemDetail(productId);
  const [activeTab, setActiveTab] = useState('overview');

  const tabs = [
    { id: 'overview', label: 'Overview', icon: FileText, count: null },
    { id: 'stock-moves', label: 'Stock Moves', icon: ArrowRightLeft, count: data?.recentLedger.length },
    { id: 'locations', label: 'Locations & Qty', icon: MapPin, count: data?.items.length },
    { id: 'transactions', label: 'Transactions', icon: Activity, count: data?.recentLedger.length },
    { id: 'menu-usage', label: 'Menu Usage', icon: UtensilsCrossed, count: data?.menuProducts.length },
    { id: 'purchases', label: 'Purchases', icon: ShoppingCart, count: data?.purchaseOrderLines.length },
    { id: 'accounting', label: 'Accounting', icon: BookOpen, count: null },
  ];

  if (isLoading) {
    return (
      <div className="p-6 space-y-4 min-h-screen">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        <div className="text-center"><Package className="h-12 w-12 opacity-30 mx-auto mb-2" /><p className="font-semibold">Item not found</p></div>
      </div>
    );
  }

  return (
    <TooltipProvider>
      <div className="flex flex-col h-full">
        <div className="px-6 py-4 border-b bg-white shadow-sm">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-3">
            <button onClick={() => navigate('/inventory')} className="hover:text-primary transition-colors font-medium">Inventory</button>
            <ChevronRight className="h-3 w-3" />
            <span className="font-semibold">{data.product.name}</span>
          </div>
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <Button variant="ghost" size="icon" onClick={() => navigate('/products')} className="h-8 w-8 flex-shrink-0 hover:bg-muted">
                <ArrowLeft className="h-4 w-4" />
              </Button>
              <div className="p-2 bg-primary/10 rounded-lg flex-shrink-0"><Package className="h-5 w-5 text-primary" /></div>
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h1 className="text-xl font-bold">{data.product.name}</h1>
                  <code className="text-xs bg-muted px-2 py-0.5 rounded font-mono text-muted-foreground font-semibold">{data.product.code}</code>
                  {!data.product.isActive && <Badge variant="secondary" className="text-xs">Inactive</Badge>}
                  {isOutOfStock(data) && <Badge variant="destructive" className="text-xs">Out of Stock</Badge>}
                  {isLowStock(data) && !isOutOfStock(data) && <Badge variant="outline" className="text-xs border-amber-400 text-amber-600 bg-amber-50 font-semibold">Low Stock</Badge>}
                </div>
                {data.product.category && <p className="text-sm text-muted-foreground mt-0.5">{data.product.category.name}</p>}
              </div>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="outline" size="icon" className="h-9 w-9" onClick={() => refetch()} disabled={isRefetching}>
                    <RefreshCw className={`h-4 w-4 ${isRefetching ? 'animate-spin' : ''}`} />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Refresh</TooltipContent>
              </Tooltip>
              <Button variant="outline" size="sm" className="border-primary text-primary hover:bg-primary/10 font-semibold" onClick={() => navigate(`/products/${productId}/edit`)}>
                <Edit className="h-4 w-4 mr-1.5" /> Edit
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="icon" className="h-9 w-9"><MoreHorizontal className="h-4 w-4" /></Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-44">
                  <DropdownMenuItem onClick={() => navigate('/inventory/adjustments')}><Package className="h-4 w-4 mr-2 text-primary" />New Adjustment</DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => navigate('/procurement/purchase-orders')}><ShoppingCart className="h-4 w-4 mr-2 text-primary" />Purchases</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
          <div className="flex items-center gap-6 mt-3 pt-3 border-t">
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Qty On Hand:</span>
              <span className={`font-bold text-sm ${isOutOfStock(data) ? 'text-destructive' : isLowStock(data) ? 'text-amber-600' : 'text-emerald-600'}`}>
                {getTotalQuantity(data).toLocaleString()}
              </span>
            </div>
            <Separator orientation="vertical" className="h-4" />
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Unit Cost:</span>
              <span className="font-semibold text-sm">{formatCurrency(data.product.costPrice)}</span>
            </div>
            <Separator orientation="vertical" className="h-4" />
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Stock Value:</span>
              <span className="font-bold text-sm text-emerald-600">{formatCurrency(data.totalValue)}</span>
            </div>
          </div>
          {(isOutOfStock(data) || isLowStock(data)) && (
            <div className="mt-2"><StockStatusBanner data={data} /></div>
          )}
        </div>

        <div className="flex-1 overflow-auto">
          <Tabs value={activeTab} onValueChange={setActiveTab} className="h-full flex flex-col">
            <div className="px-2 py-1 bg-gradient-to-r from-primary to-indigo-600 shadow-lg sticky top-0 z-10 mx-2 mt-1 rounded-xl border border-white/10">
              <TabsList className="bg-transparent p-0 h-auto gap-2 rounded-none w-full justify-start border-none">
                {tabs.map((tab) => (
                  <TabsTrigger key={tab.id} value={tab.id}
                    className="relative px-4 py-2 rounded-lg text-sm font-medium text-white/80 hover:bg-white/15 hover:text-white transition-all duration-300 data-[state=active]:bg-white data-[state=active]:text-indigo-600 data-[state=active]:shadow-lg data-[state=active]:font-bold data-[state=active]:scale-105"
                  >
                    <span className="flex items-center gap-2">
                      <tab.icon className="h-4 w-4" />
                      <span className="hidden sm:inline">{tab.label}</span>
                      {tab.count !== null && tab.count !== undefined && tab.count > 0 && (
                        <span className={`ml-1 px-2 py-0.5 rounded-full text-[10px] font-bold tracking-tighter ${tab.id === activeTab ? 'bg-indigo-100 text-indigo-700' : 'bg-white/20 text-white'}`}>
                          {tab.count}
                        </span>
                      )}
                    </span>
                  </TabsTrigger>
                ))}
              </TabsList>
            </div>
            <div className="flex-1 overflow-auto py-2 px-2">
              <TabsContent value="overview" className="mt-0 outline-none"><TabOverview data={data} /></TabsContent>
              <TabsContent value="stock-moves" className="mt-0 outline-none"><TabStockMoves data={data} /></TabsContent>
              <TabsContent value="locations" className="mt-0 outline-none"><TabLocations data={data} /></TabsContent>
              <TabsContent value="transactions" className="mt-0 outline-none"><TabTransactions data={data} /></TabsContent>
              <TabsContent value="menu-usage" className="mt-0 outline-none"><TabMenuUsage data={data} /></TabsContent>
              <TabsContent value="purchases" className="mt-0 outline-none"><TabPurchaseOrders data={data} /></TabsContent>
              <TabsContent value="accounting" className="mt-0 outline-none"><TabAccounting data={data} /></TabsContent>
            </div>
          </Tabs>
        </div>
      </div>
    </TooltipProvider>
  );
}
