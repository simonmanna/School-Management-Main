import { useQuery } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { api } from '@/lib/api';
import { date, money } from '@/lib/format';

interface GRNProduct {
  id: string;
  code: string;
  name: string;
}

interface GRNLine {
  id: string;
  productId: string | null;
  description: string;
  quantity: number;
  unitCost: number;
  batchNumber: string | null;
  expiryDate: string | null;
  notes: string | null;
  lineNumber: number;
  product: GRNProduct | null;
}

interface GRNWarehouse {
  id: string;
  code: string;
  name: string;
}

interface GRNPartner {
  id: string;
  name: string;
}

interface GRNDetail {
  id: string;
  receiptNumber: string;
  status: 'draft' | 'posted' | 'cancelled';
  receivedAt: string;
  notes: string | null;
  postedAt: string | null;
  postedById: string | null;
  createdAt: string;
  updatedAt: string;
  lines: GRNLine[];
  order: { orderNumber: string } | null;
  warehouse: GRNWarehouse | null;
  partner: GRNPartner | null;
}

const STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  posted: 'Posted',
  cancelled: 'Cancelled',
};

const BADGE_VARIANTS: Record<string, 'default' | 'secondary' | 'destructive'> = {
  draft: 'secondary',
  posted: 'default',
  cancelled: 'destructive',
};

export default function GoodsReceiptDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();

  const { data: grn, isLoading } = useQuery<GRNDetail>({
    queryKey: ['goods-receipt', id],
    queryFn: async () => (await api.get<GRNDetail>(`/procurement/goods-receipts/${id}`)).data,
    enabled: !!id,
  });

  if (isLoading) {
    return (
      <div className="max-w-5xl mx-auto space-y-4 px-4">
        <div className="flex items-center gap-3">
          <div className="h-4 w-20 bg-sky-200 rounded" />
          <Skeleton className="h-6 w-64" />
        </div>
        <div className="rounded-lg border border-sky-100 bg-white shadow-sm">
          <div className="flex divide-x divide-sky-100">
            <div className="w-1/2 p-6 space-y-3">
              <div className="h-3 w-24 bg-sky-100 rounded" />
              <div className="h-4 w-48 bg-sky-200 rounded" />
              <div className="h-3 w-full bg-sky-50 rounded mt-4" />
              <div className="h-3 w-3/4 bg-sky-50 rounded" />
            </div>
            <div className="w-1/2 p-6 space-y-3">
              <div className="h-3 w-24 bg-sky-100 rounded" />
              <div className="h-4 w-32 bg-sky-200 rounded" />
              <div className="h-3 w-full bg-sky-50 rounded mt-2" />
              <div className="h-3 w-2/3 bg-sky-50 rounded" />
            </div>
          </div>
          <div className="border-t border-sky-100 p-0">
            <div className="p-4 space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="flex gap-4 items-center">
                  <Skeleton className="h-3 w-8 shrink-0 bg-sky-50" />
                  <Skeleton className="h-3 flex-1 bg-sky-50" />
                  <Skeleton className="h-3 w-16 bg-sky-50" />
                  <Skeleton className="h-3 w-20 bg-sky-50" />
                  <Skeleton className="h-3 w-16 bg-sky-50" />
                  <Skeleton className="h-3 w-20 bg-sky-50" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!grn) {
    return (
      <div className="max-w-5xl mx-auto space-y-4 px-4">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/procurement/goods-receipts')} className="flex items-center text-sm text-sky-700 hover:text-sky-900 gap-1">
            <ArrowLeft className="h-4 w-4" /> Goods Receipts
          </button>
        </div>
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-8 text-center">
          <h1 className="text-xl font-semibold text-destructive">Not Found</h1>
          <p className="mt-2 text-sm text-muted-foreground">Goods receipt not found or you don't have permission to view it.</p>
          <Button variant="outline" className="mt-4" onClick={() => navigate('/procurement/goods-receipts')}>
            <ArrowLeft className="mr-2 h-4 w-4" /> Back to Goods Receipts
          </Button>
        </div>
      </div>
    );
  }

  const totalQty = grn.lines.reduce((sum, l) => sum + Number(l.quantity), 0);
  const totalCost = grn.lines.reduce((sum, l) => sum + Number(l.quantity) * Number(l.unitCost), 0);

  return (
    <div className="max-w-[1600px] mx-auto space-y-0 px-1 md:px-2">
      <div className="flex items-center gap-3 mb-4">
        <button
          onClick={() => navigate('/procurement/goods-receipts')}
          className="flex items-center gap-1 text-sm text-sky-700 hover:text-sky-900"
        >
          <ArrowLeft className="h-4 w-4" /> Goods Receipts
        </button>
        <span className="text-sky-300">/</span>
        <span className="font-mono text-sm text-sky-900 font-semibold">{grn.receiptNumber}</span>
      </div>

      <div className="rounded-t-lg bg-gradient-to-r from-sky-400 to-sky-500 px-6 py-3 flex items-center justify-between shadow-sm">
        <h1 className="text-white font-bold text-base tracking-wide">GOODS RECEIPT NOTE</h1>
        <Badge variant={BADGE_VARIANTS[grn.status]} className="text-sm px-3 py-1">
          {STATUS_LABELS[grn.status] ?? grn.status}
        </Badge>
      </div>

      <div className="bg-white border border-t-0 border-sky-100 shadow-sm rounded-b-lg overflow-hidden">
        <div className="grid grid-cols-1 md:grid-cols-2 divide-x divide-sky-100">
          <div className="p-4 bg-sky-50/30">
            <p className="text-xs text-sky-500 font-bold uppercase tracking-wider mb-1">Supplier</p>
            <p className="font-bold text-base text-sky-900">{grn.partner?.name ?? '—'}</p>
            <p className="text-xs text-sky-400 mt-1">Partner</p>

            <div className="mt-4">
              <p className="text-xs text-sky-500 font-bold uppercase tracking-wider mb-1">Warehouse</p>
              <p className="font-semibold text-sm text-sky-900">
                {grn.warehouse ? `${grn.warehouse.code} — ${grn.warehouse.name}` : '—'}
              </p>
            </div>

            {grn.notes && (
              <div className="mt-4">
                <p className="text-xs text-sky-500 font-bold uppercase tracking-wider mb-1">Notes</p>
                <p className="text-sm text-sky-800">{grn.notes}</p>
              </div>
            )}
          </div>

          <div className="p-4 bg-sky-50/20">
            <table className="w-full text-sm">
              <tbody className="divide-y divide-sky-100">
                <tr>
                  <th className="text-left text-sky-600 font-medium py-2 w-28 align-top">Receipt No</th>
                  <td className="text-right font-bold text-sky-900 py-2">{grn.receiptNumber}</td>
                </tr>
                <tr>
                  <th className="text-left text-sky-600 font-medium py-2 align-top">Received Date</th>
                  <td className="text-right text-sky-800 py-2">{date(grn.receivedAt)}</td>
                </tr>
                <tr>
                  <th className="text-left text-sky-600 font-medium py-2 align-top">Status</th>
                  <td className="text-right text-sky-800 py-2">
                    <Badge variant={BADGE_VARIANTS[grn.status]}>
                      {STATUS_LABELS[grn.status] ?? grn.status}
                    </Badge>
                  </td>
                </tr>
                <tr>
                  <th className="text-left text-sky-600 font-medium py-2 align-top">PO Reference</th>
                  <td className="text-right text-sky-800 py-2">{grn.order?.orderNumber ?? '—'}</td>
                </tr>
                <tr>
                  <th className="text-left text-sky-600 font-medium py-2 align-top">Posted At</th>
                  <td className="text-right text-sky-800 py-2">{grn.postedAt ? date(grn.postedAt) : '—'}</td>
                </tr>
                <tr>
                  <th className="text-left text-sky-600 font-medium py-2 align-top">Created At</th>
                  <td className="text-right text-sky-800 py-2">{date(grn.createdAt)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div className="border-t border-sky-100">
          <Table>
            <TableHeader>
              <TableRow className="bg-sky-50 hover:bg-sky-50">
                <TableHead className="w-12 text-sky-700 font-bold text-xs uppercase tracking-wider">#</TableHead>
                <TableHead className="w-24 text-sky-700 font-bold text-xs uppercase tracking-wider">Product Code</TableHead>
                <TableHead className="text-sky-700 font-bold text-xs uppercase tracking-wider">Product Name</TableHead>
                <TableHead className="text-sky-700 font-bold text-xs uppercase tracking-wider">Description</TableHead>
                <TableHead className="w-24 text-right text-sky-700 font-bold text-xs uppercase tracking-wider">Qty</TableHead>
                <TableHead className="w-28 text-right text-sky-700 font-bold text-xs uppercase tracking-wider">Unit Cost</TableHead>
                <TableHead className="w-28 text-right text-sky-700 font-bold text-xs uppercase tracking-wider">Total</TableHead>
                <TableHead className="w-24 text-sky-700 font-bold text-xs uppercase tracking-wider">Batch #</TableHead>
                <TableHead className="w-28 text-sky-700 font-bold text-xs uppercase tracking-wider">Expiry</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {grn.lines.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="py-10 text-center text-sky-400">
                    No line items found.
                  </TableCell>
                </TableRow>
              ) : grn.lines.map((l, index) => {
                const lineTotal = Number(l.quantity) * Number(l.unitCost);
                return (
                  <TableRow key={l.id} className="hover:bg-sky-50/40">
                    <TableCell className="text-sky-600 text-sm font-mono">{index + 1}</TableCell>
                    <TableCell className="font-mono text-xs text-sky-700">
                      {l.product?.code ?? '—'}
                    </TableCell>
                    <TableCell className="font-semibold text-sm text-sky-900">
                      {l.product?.name ?? '—'}
                    </TableCell>
                    <TableCell className="text-sm text-sky-700">
                      {l.description}
                      {l.notes && <div className="text-[10px] text-slate-500 mt-0.5">({l.notes})</div>}
                    </TableCell>
                    <TableCell className="text-right text-sm text-sky-800">{Number(l.quantity).toLocaleString()}</TableCell>
                    <TableCell className="text-right text-sm text-sky-800">{money(l.unitCost)}</TableCell>
                    <TableCell className="text-right text-sm font-bold text-sky-900">{money(lineTotal)}</TableCell>
                    <TableCell className="font-mono text-xs text-sky-700">{l.batchNumber ?? '—'}</TableCell>
                    <TableCell className="text-xs text-sky-700">{l.expiryDate ? date(l.expiryDate) : '—'}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>

        <div className="border-t border-sky-100 bg-gradient-to-r from-sky-50/60 to-sky-100/40">
          <div className="flex justify-end">
            <div className="w-80 space-y-2 pt-3 pb-3 pr-4">
              <div className="flex justify-between gap-8">
                <span className="text-muted-foreground">Total Items</span>
                <span className="font-semibold">{grn.lines.length}</span>
              </div>
              <div className="flex justify-between gap-8">
                <span className="text-muted-foreground">Total Quantity</span>
                <span className="font-semibold">{totalQty.toLocaleString()}</span>
              </div>
              <div className="border-t-2 border-sky-200 pt-2">
                <div className="flex justify-between gap-8 font-bold text-sm">
                  <span>Total Cost</span>
                  <span>{money(totalCost)}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
