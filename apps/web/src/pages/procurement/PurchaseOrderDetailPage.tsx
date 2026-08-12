import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { useState } from 'react';
import {
  ArrowLeft, Truck, CreditCard, X, Package, Receipt,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { api } from '@/lib/api';
import { notify } from '@/lib/notify';
import { formatMoney, date } from '@/lib/format';

interface POLine {
  id: string; productId: string | null; description: string;
  quantity: number; unitPrice: number; receivedQuantity: number;
  lineNumber: number; taxRate: number;
  subtotal: number; notes: string | null;
}

interface PO {
  id: string; orderNumber: string; partnerId: string;
  status: string; orderDate: string; description: string | null;
  expectedDeliveryDate: string | null; currencyCode: string;
  totalAmount: number; subtotal: number; taxAmount: number;
  totalPaid: number | null; paymentType: string; paymentStatus: string | null;
  notes: string | null; terms: string | null;
  lines: POLine[];
  receipts?: any[];
  payments?: any[];
  request?: any;
}

const STATUS_BADGE: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  active: 'default', partially_received: 'default', received: 'default',
  cancelled: 'destructive',
};

const STATUS_LABELS: Record<string, string> = {
  active: 'Active', partially_received: 'Partially Received',
  received: 'Received', cancelled: 'Cancelled',
};

const PAYMENT_STATUS_LABELS: Record<string, string> = {
  not_paid: 'Unpaid', paid: 'Paid', partial: 'Partial',
};

export function PurchaseOrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [rejectReason, setRejectReason] = useState('');
  const [showCancel, setShowCancel] = useState(false);

  const po = useQuery<PO>({
    queryKey: ['purchase-order', id],
    queryFn: async () => (await api.get<PO>(`/procurement/purchase-orders/${id}`)).data,
    enabled: !!id,
  });

  const cancelMut = useMutation({
    mutationFn: async () =>
      (await api.post(`/procurement/purchase-orders/${id}/cancel`, { reason: rejectReason })).data,
    onSuccess: () => {
      notify.success('PO cancelled');
      qc.invalidateQueries({ queryKey: ['purchase-order', id] });
      qc.invalidateQueries({ queryKey: ['purchase-orders'] });
      setShowCancel(false);
    },
    onError: (e: any) => notify.error(e?.response?.data?.message ?? 'Failed'),
  });

  if (po.isLoading) return <Skeleton className="h-96 w-full" />;
  if (po.error || !po.data) return <Card><CardContent className="p-8 text-center text-destructive">Purchase not found</CardContent></Card>;

  const data = po.data;
  const totalReceived = data.lines.reduce((s, l) => s + Number(l.receivedQuantity), 0);
  const totalOrdered = data.lines.reduce((s, l) => s + Number(l.quantity), 0);
  const totalPaid = Number(data.totalPaid ?? 0);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate('/procurement/purchase-orders')}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-semibold">{data.orderNumber}</h1>
              <Badge variant={STATUS_BADGE[data.status] ?? 'secondary'}>
                {STATUS_LABELS[data.status] ?? data.status}
              </Badge>
              {data.paymentType === 'cash' && (
                <Badge variant="outline" className="border-yellow-400 text-yellow-700">
                  Cash
                </Badge>
              )}
              {data.paymentType === 'credit' && (
                <Badge variant="outline" className="border-blue-400 text-blue-700">
                  Credit
                </Badge>
              )}
            </div>
            <p className="text-sm text-muted-foreground">{data.description ?? ''} · {date(data.orderDate)}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {/* Step 2: Receive (active or partially received) */}
          {(data.status === 'active' || data.status === 'partially_received') && (
            <Button size="sm" onClick={() => navigate(`/procurement/purchase-orders/${id}/receive`)}>
              <Truck className="mr-1 h-3 w-3" />Receive
            </Button>
          )}
          {/* Step 3: Pay (credit + received + unpaid) */}
          {data.status === 'received' &&
            data.paymentType === 'credit' &&
            data.paymentStatus !== 'paid' && (
            <Button size="sm" variant="outline" onClick={() => navigate(`/procurement/purchase-orders/${id}/pay`)}>
              <CreditCard className="mr-1 h-3 w-3" />Pay
            </Button>
          )}
          {/* Cancel */}
          {!['received', 'cancelled'].includes(data.status) && (
            <Button size="sm" variant="ghost" onClick={() => setShowCancel(true)}>
              <X className="mr-1 h-3 w-3 text-destructive" />Cancel
            </Button>
          )}
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Total Amount</CardTitle></CardHeader>
          <CardContent className="pt-0">
            <p className="text-2xl font-bold text-amber-700">{formatMoney(data.totalAmount, data.currencyCode)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Items</CardTitle></CardHeader>
          <CardContent className="pt-0">
            <p className="flex items-center gap-2 text-2xl font-bold text-sky-600">
              <Package className="h-5 w-5" />{totalOrdered}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Received</CardTitle></CardHeader>
          <CardContent className="pt-0">
            <p className={`text-2xl font-bold ${totalReceived >= totalOrdered ? 'text-emerald-600' : 'text-amber-600'}`}>
              {totalReceived} / {totalOrdered}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">
            {data.paymentType === 'credit' ? 'Paid' : 'Payment'}
          </CardTitle></CardHeader>
          <CardContent className="pt-0">
            {data.paymentType === 'cash' ? (
              <p className="text-2xl font-bold text-emerald-600">
                <Receipt className="mr-1 inline h-5 w-5" />Auto-paid
              </p>
            ) : (
              <p className={`text-2xl font-bold ${totalPaid >= Number(data.totalAmount) ? 'text-emerald-600' : 'text-amber-600'}`}>
                {formatMoney(totalPaid, data.currencyCode)} / {formatMoney(data.totalAmount, data.currencyCode)}
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Main content */}
      <div className="grid gap-4 md:grid-cols-3">
        {/* Left: lines table */}
        <div className="md:col-span-2 space-y-4">
          <Card>
            <CardHeader><CardTitle>Order Lines</CardTitle></CardHeader>
            <CardContent className="p-0">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="px-3 py-2 text-left">#</th>
                    <th className="px-3 py-2 text-left">Item</th>
                    <th className="px-3 py-2 text-right">Qty</th>
                    <th className="px-3 py-2 text-right">Received</th>
                    <th className="px-3 py-2 text-right">Unit Price</th>
                    <th className="px-3 py-2 text-right">Subtotal</th>
                  </tr>
                </thead>
                <tbody>
                  {data.lines.map((ln) => (
                    <tr key={ln.id} className="border-b hover:bg-muted/30">
                      <td className="px-3 py-2 text-muted-foreground">{ln.lineNumber}</td>
                      <td className="px-3 py-2">
                        <div className="font-medium">{ln.description}</div>
                        {ln.notes && <div className="text-xs text-muted-foreground">{ln.notes}</div>}
                      </td>
                      <td className="px-3 py-2 text-right font-mono">{Number(ln.quantity)}</td>
                      <td className="px-3 py-2 text-right font-mono">{Number(ln.receivedQuantity)}</td>
                      <td className="px-3 py-2 text-right font-mono">{formatMoney(ln.unitPrice)}</td>
                      <td className="px-3 py-2 text-right font-mono">{formatMoney(ln.subtotal)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t font-medium">
                    <td colSpan={4}></td>
                    <td className="px-3 py-2 text-right">Subtotal</td>
                    <td className="px-3 py-2 text-right font-mono">{formatMoney(data.subtotal)}</td>
                  </tr>
                  {Number(data.taxAmount) > 0 && (
                    <tr>
                      <td colSpan={4}></td>
                      <td className="px-3 py-2 text-right text-muted-foreground">Tax</td>
                      <td className="px-3 py-2 text-right font-mono">{formatMoney(data.taxAmount)}</td>
                    </tr>
                  )}
                  <tr className="border-t font-bold">
                    <td colSpan={4}></td>
                    <td className="px-3 py-2 text-right">Total</td>
                    <td className="px-3 py-2 text-right font-mono">{formatMoney(data.totalAmount, data.currencyCode)}</td>
                  </tr>
                </tfoot>
              </table>
            </CardContent>
          </Card>

          {data.notes && (
            <Card>
              <CardHeader><CardTitle>Notes</CardTitle></CardHeader>
              <CardContent><p className="text-sm text-muted-foreground whitespace-pre-wrap">{data.notes}</p></CardContent>
            </Card>
          )}
        </div>

        {/* Right: details */}
        <div className="space-y-4">
          <Card>
            <CardHeader><CardTitle>Details</CardTitle></CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Status</span>
                <Badge variant={STATUS_BADGE[data.status] ?? 'secondary'}>{STATUS_LABELS[data.status] ?? data.status}</Badge>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Payment</span>
                <span>{data.paymentType === 'cash' ? 'Cash (auto-paid)' : 'Credit'}</span>
              </div>
              {data.paymentType === 'credit' && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Payment Status</span>
                  <Badge variant="outline" className="text-xs">
                    {PAYMENT_STATUS_LABELS[data.paymentStatus ?? 'not_paid']}
                  </Badge>
                </div>
              )}
              {data.description && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Description</span>
                  <span>{data.description}</span>
                </div>
              )}
              {data.expectedDeliveryDate && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Expected Delivery</span>
                  <span>{date(data.expectedDeliveryDate)}</span>
                </div>
              )}
              {data.terms && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Terms</span>
                  <span>{data.terms}</span>
                </div>
              )}
            </CardContent>
          </Card>

          {data.receipts && data.receipts.length > 0 && (
            <Card>
              <CardHeader><CardTitle>Goods Receipts</CardTitle></CardHeader>
              <CardContent className="space-y-2 text-sm">
                {data.receipts.map((r: any) => (
                  <div key={r.id} className="flex flex-col gap-1 rounded border p-2">
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-xs font-semibold">{r.receiptNumber}</span>
                      <Badge variant="outline" className="text-xs">{r.status}</Badge>
                    </div>
                    {r.receivedAt && (
                      <div className="text-xs text-muted-foreground">Received: {date(r.receivedAt)}</div>
                    )}
                    {r.lines && r.lines.length > 0 && (
                      <div className="text-xs text-muted-foreground">
                        {r.lines.length} line(s) · {r.lines.reduce((s: number, l: any) => s + Number(l.quantity), 0)} units
                      </div>
                    )}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {data.payments && data.payments.length > 0 && (
            <Card>
              <CardHeader><CardTitle>Payments</CardTitle></CardHeader>
              <CardContent className="space-y-2 text-sm">
                {data.payments.map((p: any) => (
                  <div key={p.id} className="flex justify-between items-center">
                    <span className="font-mono text-xs">{p.reference ?? p.id.slice(0, 8)}</span>
                    <span className="font-semibold">{formatMoney(p.amount, data.currencyCode)}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {data.request && (
            <Card>
              <CardHeader><CardTitle>Source Purchase Request</CardTitle></CardHeader>
              <CardContent>
                <div className="text-sm space-y-1">
                  <div>
                    <span className="text-muted-foreground">Request: </span>
                    <Link to={`/procurement/purchase-requests/${data.request.id}`} className="font-mono text-primary underline">
                      {data.request.requestNumber}
                    </Link>
                  </div>
                  {data.request.description && (
                    <div><span className="text-muted-foreground">Description: </span>{data.request.description}</div>
                  )}
                  <div>
                    <span className="text-muted-foreground">Status: </span>
                    <Badge variant="outline" className="text-xs">{data.request.status}</Badge>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* Cancel dialog */}
      <Dialog open={showCancel} onOpenChange={setShowCancel}>
        <DialogContent>
          <DialogHeader><DialogTitle>Cancel Purchase</DialogTitle></DialogHeader>
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">Are you sure you want to cancel {data.orderNumber}?</p>
            <Textarea
              placeholder="Reason for cancellation"
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCancel(false)}>Keep</Button>
            <Button variant="destructive" onClick={() => cancelMut.mutate()} disabled={cancelMut.isPending}>
              Cancel PO
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
