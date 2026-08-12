import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft, ChevronRight, ClipboardList, FileText, Loader2, MoreHorizontal,
  Receipt, RotateCcw, XCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Textarea } from '@/components/ui/textarea';
import { money, dateTime, statusLabel, useOrgCurrency } from '@/lib/format';
import { PERMISSIONS } from '@erp/shared';
import { useAuthStore } from '@/stores/auth.store';
import {
  useBillOrder, useCancelOrder, useOrder, useReopenOrder,
} from '@/features/orders/api';
import { usePaymentTerms } from '@/features/accounting/api';
import { ORDER_TYPE_LABELS } from './line-source';
import { PAYMENT_MODE_LABELS } from './order-create';
import type { OrderDetail, OrderLine } from '@/features/orders/types';

/** InventoryDetailPage-style InfoRow (dl/dt/dd, uppercase text-xs label). */
function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start py-2.5 gap-4">
      <dt className="w-36 flex-shrink-0 text-xs text-muted-foreground font-semibold pt-0.5 uppercase tracking-wide">{label}</dt>
      <dd className="text-sm flex-1">{value ?? <span className="text-muted-foreground">—</span>}</dd>
    </div>
  );
}

/** Resolve a PaymentTerm id to its display name from the org master list. */
function PaymentTermName({ id }: { id: string }) {
  const { data } = usePaymentTerms();
  const term = (data ?? []).find((t) => t.id === id);
  return term ? <span>{term.name}</span> : <code className="text-xs bg-muted px-1.5 py-0.5 rounded font-mono">{id.slice(0, 8)}…</code>;
}

function TabOverview({ data }: { data: OrderDetail }) {
  const currency = useAuthStore((s) => s.organization?.currencyCode ?? 'IDR');
  const qty = (l: OrderLine) => Number(l.quantity);
  const totalQty = data.items.reduce((s, l) => s + qty(l), 0);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      {/* Order header card */}
      <div className="lg:col-span-2 rounded-lg border bg-card shadow-sm">
        <div className="rounded-t-lg bg-muted/30 border-b px-5 py-3">
          <h2 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Order Information</h2>
        </div>
        <div className="px-5 py-2">
          <dl className="divide-y">
            <InfoRow label="Order Number" value={
              <code className="text-xs bg-muted px-2 py-0.5 rounded font-mono text-primary font-semibold">{data.orderNumber}</code>
            } />
            <InfoRow label="Customer" value={data.partnerName ? <span className="font-semibold">{data.partnerName}</span> : null} />
            <InfoRow label="Type" value={ORDER_TYPE_LABELS[data.orderType] ?? data.orderType} />
            <InfoRow label="Transaction" value={data.transactionKind ? <Badge variant="outline" className="text-xs font-mono">{data.transactionKind}</Badge> : null} />
            <InfoRow label="Opened" value={dateTime(data.openedAt)} />
            <InfoRow label="Payment terms" value={data.paymentTermId ? <PaymentTermName id={data.paymentTermId} /> : null} />
            <InfoRow label="Payment method" value={data.paymentMethod ? PAYMENT_MODE_LABELS[data.paymentMethod] ?? data.paymentMethod : null} />
            <InfoRow label="Guests" value={data.guestCount != null ? String(data.guestCount) : null} />
            <InfoRow label="Notes" value={data.notes ?? null} />
          </dl>
        </div>
      </div>

      {/* Totals card */}
      <div className="rounded-lg border bg-card shadow-sm">
        <div className="rounded-t-lg bg-muted/30 border-b px-5 py-3">
          <h2 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Totals</h2>
        </div>
        <div className="px-5 py-3 space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Items</span>
            <span className="font-semibold tabular-nums">{totalQty}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Subtotal</span>
            <span className="tabular-nums">{money(data.subtotal, currency)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Discount</span>
            <span className="tabular-nums text-amber-700">-{money(data.discountTotal, currency)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Tax</span>
            <span className="tabular-nums">{money(data.taxAmount, currency)}</span>
          </div>
          <Separator />
          <div className="flex justify-between text-base font-bold">
            <span>Total</span>
            <span className="tabular-nums">{money(data.totalAmount, currency)}</span>
          </div>
        </div>
      </div>

      {/* Lines card */}
      <div className="lg:col-span-3 rounded-lg border bg-card shadow-sm">
        <div className="rounded-t-lg bg-muted/30 border-b px-5 py-3 flex items-center justify-between">
          <h2 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
            Order Lines ({data.items.length})
          </h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/20 text-xs uppercase tracking-wider text-muted-foreground">
                <th className="px-5 py-2.5 text-left font-semibold">#</th>
                <th className="px-3 py-2.5 text-left font-semibold">Item</th>
                <th className="px-3 py-2.5 text-right font-semibold">Qty</th>
                <th className="px-3 py-2.5 text-right font-semibold">Unit Price</th>
                <th className="px-3 py-2.5 text-right font-semibold">Discount</th>
                <th className="px-5 py-2.5 text-right font-semibold">Line Total</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {data.items.map((l) => {
                const q = qty(l);
                const lineTotal = Number(l.unitPrice) * q - Number(l.discountAmount ?? 0);
                const disc = Number(l.discountAmount ?? 0) > 0
                  ? <span className="text-amber-700">-{money(l.discountAmount, currency)}</span>
                  : <span className="text-slate-300">—</span>;
                return (
                  <tr key={l.id} className="hover:bg-muted/40">
                    <td className="px-5 py-2.5 text-muted-foreground">{String(l.lineNumber).padStart(2, '0')}</td>
                    <td className="px-3 py-2.5">
                      <span className="font-medium">{l.description}</span>
                      {l.note && <span className="block text-xs text-muted-foreground">{l.note}</span>}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{q}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{money(l.unitPrice, currency)}</td>
                    <td className="px-3 py-2.5 text-right">{disc}</td>
                    <td className="px-5 py-2.5 text-right font-semibold tabular-nums">{money(lineTotal, currency)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function TabBilling({ data }: { data: OrderDetail }) {
  const navigate = useNavigate();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const currency = useOrgCurrency();
  const billOrder = useBillOrder();
  const [billPending, setBillPending] = useState(false);
  const editable = !data.invoiceId && data.status !== 'cancelled' && data.status !== 'closed';

  const doBill = async () => {
    setBillPending(true);
    try {
      await billOrder.mutateAsync({ id: data.id });
    } finally {
      setBillPending(false);
    }
  };

  if (data.invoiceId) {
    return (
      <div className="rounded-lg border bg-card shadow-sm">
        <div className="rounded-t-lg bg-muted/30 border-b px-5 py-3">
          <h2 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Invoice</h2>
        </div>
        <div className="p-5">
          {data.invoice ? (
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-primary/10 rounded-lg"><FileText className="h-5 w-5 text-primary" /></div>
                <div>
                  <button
                    className="font-semibold text-primary hover:underline"
                    onClick={() => navigate(`/invoices/${data.invoice!.id}`)}
                  >
                    {data.invoice.invoiceNumber}
                  </button>
                  <p className="text-xs text-muted-foreground">
                    {statusLabel(data.invoice.status)} · {money(data.invoice.totalAmount, currency)}
                  </p>
                </div>
              </div>
              <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200">Invoiced</Badge>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              This order is linked to an invoice (ID {data.invoiceId.slice(0, 8)}…).
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border bg-card shadow-sm">
      <div className="rounded-t-lg bg-muted/30 border-b px-5 py-3">
        <h2 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Billing</h2>
      </div>
      <div className="p-5 space-y-4">
        <p className="text-sm text-muted-foreground">
          Billing posts this order through the same spine as POS sales: order items
          deduct stock, taxes are recomputed, an <code className="text-xs font-mono">INV-</code> invoice
          is created and the receivable is posted to the ledger. The order becomes read-only.
        </p>
        {hasPermission(PERMISSIONS.orders.invoice) && editable && (
          <Button onClick={doBill} disabled={billPending || billOrder.isPending}>
            {billPending || billOrder.isPending
              ? <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              : <Receipt className="mr-1 h-4 w-4" />}
            Generate Invoice
          </Button>
        )}
      </div>
    </div>
  );
}

export function OrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const currency = useOrgCurrency();
  const { data, isLoading, refetch, isRefetching } = useOrder(id);
  const cancelOrder = useCancelOrder();
  const reopenOrder = useReopenOrder();
  const [cancelReason, setCancelReason] = useState('');
  const [tab, setTab] = useState('overview');

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
        <div className="text-center">
          <ClipboardList className="h-12 w-12 opacity-30 mx-auto mb-2" />
          <p className="font-semibold">Order not found</p>
        </div>
      </div>
    );
  }

  const editable = !data.invoiceId && data.status !== 'cancelled' && data.status !== 'closed';
  const isCancelled = data.status === 'cancelled';

  const doCancel = async () => {
    await cancelOrder.mutateAsync({ id: data.id, reason: cancelReason || undefined });
    setCancelReason('');
    refetch();
  };

  const doReopen = async () => {
    await reopenOrder.mutateAsync(data.id);
    refetch();
  };

  return (
    <div className="flex flex-col h-full">
      <div className="px-6 py-4 border-b bg-white shadow-sm">
        {/* Breadcrumb */}
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-3">
          <button onClick={() => navigate('/orders')} className="hover:text-primary transition-colors font-medium">
            Orders
          </button>
          <ChevronRight className="h-3 w-3" />
          <span className="font-semibold">{data.orderNumber}</span>
        </div>

        {/* Header bar */}
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => navigate('/orders')} className="h-8 w-8 flex-shrink-0 hover:bg-muted">
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div className="p-2 bg-primary/10 rounded-lg flex-shrink-0">
              <ClipboardList className="h-5 w-5 text-primary" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-xl font-bold">{data.orderNumber}</h1>
                <Badge variant="outline" className="text-xs font-mono">{data.transactionKind}</Badge>
                <Badge
                  variant={data.status === 'cancelled' ? 'destructive' : data.status === 'closed' ? 'outline' : 'default'}
                  className="text-xs"
                >
                  {statusLabel(data.status)}
                </Badge>
                {data.invoiceId && <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 text-xs">Invoiced</Badge>}
              </div>
              <p className="text-sm text-muted-foreground mt-0.5">
                {ORDER_TYPE_LABELS[data.orderType] ?? data.orderType}
                {data.partnerName ? ` · ${data.partnerName}` : ''}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <Button variant="outline" size="icon" className="h-9 w-9" onClick={() => refetch()} disabled={isRefetching}>
              <RotateCcw className={`h-4 w-4 ${isRefetching ? 'animate-spin' : ''}`} />
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" className="h-9 w-9"><MoreHorizontal className="h-4 w-4" /></Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuLabel>Actions</DropdownMenuLabel>
                {isCancelled && hasPermission(PERMISSIONS.orders.update) && (
                  <DropdownMenuItem onClick={doReopen} disabled={reopenOrder.isPending}>
                    <RotateCcw className="h-4 w-4 mr-2 text-primary" /> Reopen
                  </DropdownMenuItem>
                )}
                {editable && hasPermission(PERMISSIONS.orders.cancel) && (
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <DropdownMenuItem onSelect={(e) => e.preventDefault()} className="text-destructive">
                        <XCircle className="h-4 w-4 mr-2" /> Cancel Order
                      </DropdownMenuItem>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Cancel order {data.orderNumber}?</AlertDialogTitle>
                        <AlertDialogDescription>
                          The order stays in the ledger as cancelled (soft-delete style). This cannot be undone —
                          but you can reopen it later.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <Textarea
                        rows={2}
                        value={cancelReason}
                        onChange={(e) => setCancelReason(e.target.value)}
                        placeholder="Reason (optional)"
                      />
                      <AlertDialogFooter>
                        <AlertDialogCancel>Back</AlertDialogCancel>
                        <AlertDialogAction
                          className="bg-destructive hover:bg-destructive/90"
                          onClick={doCancel}
                          disabled={cancelOrder.isPending}
                        >
                          {cancelOrder.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <XCircle className="mr-1 h-4 w-4" />}
                          Cancel order
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => navigate('/orders/new')}>
                  <ClipboardList className="h-4 w-4 mr-2 text-primary" /> New Order
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {/* Header strip */}
        <div className="flex items-center gap-6 mt-3 pt-3 border-t">
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Total:</span>
            <span className="font-bold text-sm">{money(data.totalAmount, currency)}</span>
          </div>
          <Separator orientation="vertical" className="h-4" />
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Lines:</span>
            <span className="font-semibold text-sm">{data.items.length}</span>
          </div>
          <Separator orientation="vertical" className="h-4" />
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Opened:</span>
            <span className="font-semibold text-sm">{dateTime(data.openedAt)}</span>
          </div>
        </div>
      </div>

      {/* Gradient tab bar — InventoryDetailPage pattern */}
      <div className="flex-1 overflow-auto">
        <Tabs value={tab} onValueChange={setTab} className="h-full flex flex-col">
          <div className="px-2 py-1 bg-gradient-to-r from-primary to-indigo-600 shadow-lg sticky top-0 z-10 mx-2 mt-1 rounded-xl border border-white/10">
            <TabsList className="bg-transparent p-0 h-auto gap-2 rounded-none w-full justify-start border-none">
              <TabsTrigger
                value="overview"
                className="relative px-4 py-2 rounded-lg text-sm font-medium text-white/80 hover:bg-white/15 hover:text-white transition-all duration-300 data-[state=active]:bg-white data-[state=active]:text-indigo-600 data-[state=active]:shadow-lg data-[state=active]:font-bold data-[state=active]:scale-105"
              >
                <span className="flex items-center gap-2"><FileText className="h-4 w-4" /><span className="hidden sm:inline">Overview</span></span>
              </TabsTrigger>
              <TabsTrigger
                value="billing"
                className="relative px-4 py-2 rounded-lg text-sm font-medium text-white/80 hover:bg-white/15 hover:text-white transition-all duration-300 data-[state=active]:bg-white data-[state=active]:text-indigo-600 data-[state=active]:shadow-lg data-[state=active]:font-bold data-[state=active]:scale-105"
              >
                <span className="flex items-center gap-2"><Receipt className="h-4 w-4" /><span className="hidden sm:inline">Billing</span></span>
              </TabsTrigger>
            </TabsList>
          </div>
          <div className="flex-1 overflow-auto py-2 px-2">
            <TabsContent value="overview" className="mt-0 outline-none"><TabOverview data={data} /></TabsContent>
            <TabsContent value="billing" className="mt-0 outline-none"><TabBilling data={data} /></TabsContent>
          </div>
        </Tabs>
      </div>
    </div>
  );
}