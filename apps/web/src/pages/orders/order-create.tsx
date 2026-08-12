import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ChevronRight, Loader2, Plus, Save, StickyNote, Trash2, User, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { money } from '@/lib/format';
import { PERMISSIONS } from '@erp/shared';
import { useAuthStore } from '@/stores/auth.store';
import { usePartners, type Partner } from '@/features/partners/api';
import { useCreateOrder, useOrderSettings } from '@/features/orders/api';
import { usePaymentTerms } from '@/features/accounting/api';
import { ORDER_TYPE_LABELS, sourceDef } from './line-source';
import { OrderLinePicker } from './OrderLinePicker';
import type { CreateOrderInput, OrderLineInput, OrderType } from '@/features/orders/types';

const selectClass =
  'flex h-10 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50';

const inputClass = 'h-9 text-sm';

/** Display labels for the payment method (mirrors InvoicePaymentMode). */
export const PAYMENT_MODE_LABELS: Record<string, string> = {
  cash: 'Cash',
  card: 'Card',
  mobile_money: 'Mobile Money',
  mixed: 'Mixed',
  credit: 'Credit (house account)',
};

interface DraftLine extends OrderLineInput {
  _key: string;
}

/**
 * Odoo-style order form: prominent customer header, an editable order-lines
 * table (Product | Description | Qty | Unit Price | Disc % | Taxes | Subtotal)
 * with an inline “Add a line” row, and a totals footer. Line source follows the
 * org setting (menu / products / both); taxes are computed server-side on save.
 */
export function OrderCreatePage() {
  const navigate = useNavigate();
  const currency = useAuthStore((s) => s.organization?.currencyCode ?? 'IDR');
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const { data: settings } = useOrderSettings();
  const createOrder = useCreateOrder();

  const [orderType, setOrderType] = useState<OrderType>('takeaway');
  const [partnerId, setPartnerId] = useState('');
  const [guestCount, setGuestCount] = useState('');
  const [notes, setNotes] = useState('');
  const [paymentTermId, setPaymentTermId] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('');
  const [orderDate, setOrderDate] = useState('');
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);

  const paymentTermsQ = usePaymentTerms();
  const paymentTerms = (paymentTermsQ.data ?? []).filter((t) => t.isActive);

  const partnersQ = usePartners({ page: 1, pageSize: 200 }, { enabled: hasPermission(PERMISSIONS.orders.read) });
  const partners = (partnersQ.data?.data ?? []) as Partner[];
  const customers = partners.filter((p) => p.isCustomer !== false);

  const resolved = settings?.resolved ?? 'menu';
  const def = sourceDef(resolved);

  const totals = useMemo(() => {
    const subtotal = lines.reduce((sum, l) => sum + l.quantity * l.unitPrice, 0);
    const discount = lines.reduce((sum, l) => {
      const base = l.quantity * l.unitPrice;
      if (l.discountPercent) return sum + (base * l.discountPercent) / 100;
      return sum + (l.discountAmount ?? 0);
    }, 0);
    return { subtotal, discount, total: Math.max(0, subtotal - discount) };
  }, [lines]);

  const addLine = (line: OrderLineInput) => {
    setLines((prev) => [...prev, { ...line, _key: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}` }]);
  };

  const updateLine = (key: string, patch: Partial<OrderLineInput>) => {
    setLines((prev) => prev.map((l) => (l._key === key ? { ...l, ...patch } : l)));
  };

  const removeLine = (key: string) => {
    setLines((prev) => prev.filter((l) => l._key !== key));
  };

  const save = async () => {
    if (lines.length === 0) return;
    const result = await createOrder.mutateAsync({
      orderType,
      partnerId: partnerId || undefined,
      guestCount: guestCount ? Number(guestCount) : undefined,
      notes: notes || undefined,
      paymentTermId: paymentTermId || undefined,
      paymentMethod: (paymentMethod as CreateOrderInput['paymentMethod']) || undefined,
      openedAt: orderDate ? new Date(orderDate).toISOString() : undefined,
      lines: lines.map(({ _key: _, ...line }) => line),
    });
    navigate(`/orders/${result.id}`);
  };

  const keyboardQty = (l: DraftLine) => Number(l.quantity) || 0;

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-1 text-sm text-muted-foreground">
        <Link to="/orders" className="hover:text-primary">Orders</Link>
        <ChevronRight className="h-3.5 w-3.5" />
        <span className="text-foreground">New Order</span>
      </nav>

      {/* Header bar — InventoryDetailPage pattern */}
      <div className="flex items-center justify-between border-b pb-4">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold">New Order</h1>
          <Badge variant="secondary" className="text-xs">Draft</Badge>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => navigate('/orders')}>
            <X className="mr-1 h-4 w-4" /> Discard
          </Button>
          <Button onClick={save} disabled={createOrder.isPending || lines.length === 0}>
            {createOrder.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Save className="mr-1 h-4 w-4" />}
            Save Order
          </Button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-6">
          {/* Order header card */}
          <div className="rounded-lg border bg-card">
            <div className="border-b bg-muted/30 px-4 py-2 text-xs font-bold uppercase tracking-wider text-muted-foreground rounded-t-lg">
              Order header
            </div>
            <div className="grid gap-4 p-4 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label>Order type</Label>
                <select className={selectClass} value={orderType} onChange={(e) => setOrderType(e.target.value as OrderType)}>
                  {Object.entries(ORDER_TYPE_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label>Customer</Label>
                <select className={selectClass} value={partnerId} onChange={(e) => setPartnerId(e.target.value)}>
                  <option value="">Walk-in / no partner</option>
                  {customers.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label>Guest count</Label>
                <Input
                  type="number"
                  min={1}
                  value={guestCount}
                  onChange={(e) => setGuestCount(e.target.value)}
                  className={inputClass}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Order date</Label>
                <Input
                  type="date"
                  value={orderDate}
                  onChange={(e) => setOrderDate(e.target.value)}
                  className={inputClass}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Payment terms</Label>
                <select className={selectClass} value={paymentTermId} onChange={(e) => setPaymentTermId(e.target.value)}>
                  <option value="">— No term —</option>
                  {paymentTerms.map((t) => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label>Payment method</Label>
                <select className={selectClass} value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}>
                  <option value="">— Not set —</option>
                  {Object.entries(PAYMENT_MODE_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5 sm:col-span-3">
                <Label>
                  <StickyNote className="mr-1 inline h-3.5 w-3.5" /> Notes
                </Label>
                <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Kitchen or delivery notes…" />
              </div>
            </div>
          </div>

          {/* Order lines card — Odoo-style editable table */}
          <div className="rounded-lg border bg-card">
            <div className="flex items-center justify-between border-b bg-muted/30 px-4 py-2 rounded-t-lg">
              <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                Order lines ({lines.length})
              </span>
              <span className="text-xs text-muted-foreground">Source: {def.label}</span>
            </div>

            {lines.length === 0 ? (
              <div className="p-8 text-center text-sm text-muted-foreground">
                No lines yet — use “Add a line” to pick from {def.label.toLowerCase()}.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/30 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      <th className="px-4 py-2 w-[38%]">Item</th>
                      <th className="px-2 py-2 w-20">Qty</th>
                      <th className="px-2 py-2 w-28">Unit price</th>
                      <th className="px-2 py-2 w-20">Disc %</th>
                      <th className="px-2 py-2">Taxes</th>
                      <th className="px-4 py-2 text-right">Subtotal</th>
                      <th className="w-10" />
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {lines.map((line) => (
                      <tr key={line._key} className="group">
                        <td className="px-4 py-2">
                          <Input
                            value={line.description}
                            onChange={(e) => updateLine(line._key, { description: e.target.value })}
                            className={inputClass}
                            placeholder="Description"
                          />
                        </td>
                        <td className="px-2 py-2">
                          <Input
                            type="number"
                            min={0}
                            step={0.01}
                            value={keyboardQty(line)}
                            onChange={(e) => updateLine(line._key, { quantity: Number(e.target.value) || 0 })}
                            className={inputClass}
                          />
                        </td>
                        <td className="px-2 py-2">
                          <Input
                            type="number"
                            min={0}
                            step={0.01}
                            value={line.unitPrice}
                            onChange={(e) => updateLine(line._key, { unitPrice: Number(e.target.value) || 0 })}
                            className={inputClass}
                          />
                        </td>
                        <td className="px-2 py-2">
                          <Input
                            type="number"
                            min={0}
                            max={100}
                            step={0.01}
                            value={line.discountPercent ?? ''}
                            onChange={(e) => updateLine(line._key, { discountPercent: Number(e.target.value) || 0 })}
                            className={inputClass}
                          />
                        </td>
                        <td className="px-2 py-2 text-xs text-muted-foreground">Auto</td>
                        <td className="px-4 py-2 text-right font-semibold tabular-nums whitespace-nowrap">
                          {money(line.quantity * line.unitPrice, currency)}
                        </td>
                        <td className="px-2 py-2">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground hover:text-destructive"
                            onClick={() => removeLine(line._key)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Inline add-line row (Odoo “Add a line”) */}
            <div className="border-t px-4 py-2">
              <button
                type="button"
                onClick={() => setPickerOpen(true)}
                className="flex w-full items-center gap-2 rounded-md border border-dashed px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:border-primary hover:text-primary"
              >
                <Plus className="h-4 w-4" /> Add a line
              </button>
            </div>
          </div>
        </div>

        {/* Right: totals summary */}
        <div className="space-y-4">
          <div className="rounded-lg border bg-card">
            <div className="rounded-t-lg border-b bg-muted/30 px-4 py-2">
              <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Totals</span>
            </div>
            <dl className="space-y-2 p-4 text-sm">
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Subtotal</dt>
                <dd className="tabular-nums">{money(totals.subtotal, currency)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Discount</dt>
                <dd className="tabular-nums text-amber-700">-{money(totals.discount, currency)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Taxes</dt>
                <dd className="tabular-nums text-muted-foreground">Auto</dd>
              </div>
              <div className="flex justify-between border-t pt-2 text-base font-bold">
                <dt>Total</dt>
                <dd className="tabular-nums">{money(totals.total, currency)}</dd>
              </div>
              <p className="pt-2 text-xs text-muted-foreground">
                Taxes and authoritative totals are computed server-side on save.
              </p>
            </dl>
          </div>

          <div className="flex items-center gap-2 rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
            <User className="h-4 w-4 shrink-0" />
            <span>
              Billing this order later posts through the same spine as POS sales — stock deduction and receivables included.
            </span>
          </div>
        </div>
      </div>

      <OrderLinePicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        resolved={resolved}
        onPick={addLine}
      />
    </div>
  );
}