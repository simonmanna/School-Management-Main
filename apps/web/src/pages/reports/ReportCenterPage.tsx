/**
 * Report Center — unified report hub.
 * Tabs: Sales · Item Sales · Expenses · Purchases · Cash Flow Summary · Cash Flow Detailed
 *
 * Permission-gated via `report:accounting` (all accounting reports share this).
 */
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  BarChart3, ArrowLeft, Download, FileText,
  TrendingUp, TrendingDown, Wallet, Receipt, ShoppingCart, DollarSign,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuthStore } from '@/stores/auth.store';
import { useSalesReport, useSoldItems, useCategories } from '../pos/api';
import type { SoldItem, SalesReportRow } from '../pos/types';
import {
  usePurchasesReport, useExpensesReport, useExpenseStats,
  useCashFlowSummary, usePaymentsInbound, usePaymentsOutbound,
} from './api';
import '../pos/pos-pro.css';
import { exportCSV } from '@/lib/export-csv';
import { exportPDF } from '@/lib/export-pdf';

const fmt = (n: number | string | null | undefined) =>
  `UGX ${Number(n || 0).toLocaleString()}`;

const todayIso = () => new Date().toISOString().slice(0, 10);

function weekStartFromDay(isoDate: string): string {
  const d = new Date(isoDate + 'T12:00:00');
  if (Number.isNaN(d.getTime())) return isoDate;
  const dow = d.getDay();
  const diff = d.getDate() - dow + (dow === 0 ? -6 : 1);
  d.setDate(diff);
  return d.toISOString().slice(0, 10);
}

function monthStart(ym: string): string {
  return ym + '-01';
}

const ORDER_TYPES = [
  { value: '', label: 'All Types' },
  { value: 'dine_in', label: 'Dine In' },
  { value: 'takeaway', label: 'Takeaway' },
  { value: 'delivery', label: 'Delivery' },
];

const OrderTypeSelect: React.FC<{
  value: string | undefined;
  onChange: (v: string | undefined) => void;
}> = ({ value, onChange }) => (
  <div>
    <Label>Order Type</Label>
    <select
      className="flex h-9 w-full rounded-md border border-slate-200 bg-white px-3 py-1 text-sm shadow-sm"
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value || undefined)}
    >
    {ORDER_TYPES.map((ot) => (
      <option key={ot.value} value={ot.value}>{ot.label}</option>
    ))}
    </select>
  </div>
);

const QuickPresets: React.FC<{
  fromDate: string; setFromDate: (d: string) => void;
  toDate: string; setToDate: (d: string) => void;
}> = ({ fromDate, setFromDate, toDate, setToDate }) => {
  const presets = [
    { label: 'Today', get: () => { const t = todayIso(); return { f: t, t }; } },
    { label: 'Yesterday', get: () => { const d = new Date(); d.setDate(d.getDate() - 1); const s = d.toISOString().slice(0, 10); return { f: s, t: s }; } },
    { label: 'This Week', get: () => { const s = weekStartFromDay(todayIso()); return { f: s, t: todayIso() }; } },
    { label: 'This Month', get: () => { const s = monthStart(todayIso().slice(0, 7)); return { f: s, t: todayIso() }; } },
    { label: 'Last 7 Days', get: () => { const d = new Date(); d.setDate(d.getDate() - 6); return { f: d.toISOString().slice(0, 10), t: todayIso() }; } },
    { label: 'Last 30 Days', get: () => { const d = new Date(); d.setDate(d.getDate() - 29); return { f: d.toISOString().slice(0, 10), t: todayIso() }; } },
    { label: 'This Year', get: () => { const y = todayIso().slice(0, 4); return { f: `${y}-01-01`, t: todayIso() }; } },
  ];
  return (
    <div className="flex flex-wrap gap-1.5">
      {presets.map((p) => {
        const { f, t } = p.get();
        const active = fromDate === f && toDate === t;
        return (
          <button
            key={p.label}
            className={'pos-reports-tab ' + (active ? 'active' : '')}
            style={{ fontSize: 12, padding: '2px 8px' }}
            onClick={() => { setFromDate(f); setToDate(t); }}
          >{p.label}</button>
        );
      })}
    </div>
  );
};

const DateRange: React.FC<{
  fromDate: string; setFromDate: (d: string) => void;
  toDate: string; setToDate: (d: string) => void;
}> = ({ fromDate, setFromDate, toDate, setToDate }) => (
  <div className="flex items-end gap-2 flex-wrap">
    <div>
      <Label>From</Label>
      <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
    </div>
    <div>
      <Label>To</Label>
      <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
    </div>
  </div>
);

const StatCard: React.FC<{
  title: string; value: string; sub?: string; icon: typeof DollarSign; accent?: boolean;
}> = ({ title, value, sub, icon: Icon, accent }) => (
  <div className="pos-report-card">
    <div className="flex items-center gap-2 mb-1">
      <div className={`rounded-lg p-1.5 ${accent ? 'bg-emerald-100 text-emerald-700' : 'bg-blue-100 text-blue-700'}`}>
        <Icon className="h-4 w-4" />
      </div>
      <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">{title}</h3>
    </div>
    <div className={`text-lg font-bold ${accent ? 'text-emerald-600' : 'text-slate-800'}`}>{value}</div>
    {sub && <p className="text-sm text-slate-500 mt-0.5">{sub}</p>}
  </div>
);

/* ───── Sales Report Tab ───── */

const SalesReportTab: React.FC<{
  fromDate: string; setFromDate: (d: string) => void;
  toDate: string; setToDate: (d: string) => void;
  orderType: string | undefined; setOrderType: (v: string | undefined) => void;
}> = ({ fromDate, setFromDate, toDate, setToDate, orderType, setOrderType }) => {
  const { data: _raw, isLoading } = useSalesReport(fromDate, toDate, undefined, undefined, undefined, orderType);
  const rows: SalesReportRow[] = (_raw ?? []) as SalesReportRow[];
  const totals = rows.reduce(
    (s: { subtotal: number; discount: number; totalAmount: number }, r: SalesReportRow) => ({
      subtotal: s.subtotal + Number(r.subtotal),
      discount: s.discount + Number(r.discount),
      totalAmount: s.totalAmount + Number(r.totalAmount),
    }),
    { subtotal: 0, discount: 0, totalAmount: 0 },
  );
  const hdr = ['Order #', 'Invoice #', 'Sale Date', 'Time', 'Subtotal', 'Discount', 'Total Amount', 'Waiter'];
  return (
    <div className="space-y-4">
      <div className="flex items-end gap-2 flex-wrap">
        <DateRange fromDate={fromDate} setFromDate={setFromDate} toDate={toDate} setToDate={setToDate} />
        <OrderTypeSelect value={orderType} onChange={setOrderType} />
      </div>
      <QuickPresets fromDate={fromDate} setFromDate={setFromDate} toDate={toDate} setToDate={setToDate} />
      <div className="pos-report-card">
        <div className="flex items-center justify-between mb-2">
          <h3>Sales Report — {fromDate} → {toDate}</h3>
          {rows.length > 0 && (
            <div className="flex gap-1">
              <Button variant="outline" size="sm" onClick={() => {
                const d = rows.map((r: SalesReportRow) => [r.orderNumber, r.invoiceNumber, new Date(r.saleDate).toLocaleDateString(), r.time || new Date(r.saleDate).toLocaleTimeString(), String(Number(r.subtotal).toFixed(2)), String(Number(r.discount).toFixed(2)), String(Number(r.totalAmount).toFixed(2)), r.waiterName ?? '—']);
                exportCSV(`sales-report-${fromDate}-${toDate}.csv`, hdr, d);
              }}><Download className="h-3.5 w-3.5 mr-1" /> CSV</Button>
              <Button variant="outline" size="sm" onClick={() => {
                const d = rows.map((r: SalesReportRow) => [r.orderNumber, r.invoiceNumber, new Date(r.saleDate).toLocaleDateString(), r.time || new Date(r.saleDate).toLocaleTimeString(), fmt(r.subtotal), fmt(r.discount), fmt(r.totalAmount), r.waiterName ?? '—']);
                exportPDF(`sales-report-${fromDate}-${toDate}.pdf`, `Sales Report — ${fromDate} → ${toDate}`, hdr, d);
              }}><FileText className="h-3.5 w-3.5 mr-1" /> PDF</Button>
            </div>
          )}
        </div>
        {isLoading ? <p className="text-sm text-slate-500">Loading…</p> : null}
        {rows.length === 0 && !isLoading ? <p className="text-sm text-slate-500">No sales in this date range.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left border-b border-slate-200 text-slate-600">
                <th className="py-2 pr-3">Order #</th><th className="py-2 pr-3">Invoice #</th><th className="py-2 pr-3">Sale Date</th>
                <th className="py-2 pr-3">Time</th>
                <th className="py-2 pr-3 text-right">Subtotal</th><th className="py-2 pr-3 text-right">Discount</th><th className="py-2 pr-3 text-right">Total Amount</th>
                <th className="py-2 pr-3">Waiter</th>
              </tr></thead>
              <tbody>{rows.map((r: SalesReportRow, i: number) => (
                <tr key={i} className="border-b border-slate-100">
                  <td className="py-2 pr-3 font-mono text-sm">{r.orderNumber}</td>
                  <td className="py-2 pr-3 font-mono text-sm">{r.invoiceNumber}</td>
                  <td className="py-2 pr-3 text-sm">{new Date(r.saleDate).toLocaleDateString()}</td>
                  <td className="py-2 pr-3 text-sm">{r.time || new Date(r.saleDate).toLocaleTimeString()}</td>
                  <td className="py-2 pr-3 text-right font-mono">{fmt(r.subtotal)}</td>
                  <td className="py-2 pr-3 text-right font-mono">{fmt(r.discount)}</td>
                  <td className="py-2 pr-3 text-right font-mono font-bold">{fmt(r.totalAmount)}</td>
                  <td className="py-2 pr-3 text-sm">{r.waiterName ?? '—'}</td>
                </tr>
              ))}</tbody>
              <tfoot><tr className="border-t-2 border-slate-300 font-bold text-slate-800">
                <td className="py-2 pr-3" colSpan={4}>Total</td>
                <td className="py-2 pr-3 text-right font-mono">{fmt(totals.subtotal)}</td>
                <td className="py-2 pr-3 text-right font-mono">{fmt(totals.discount)}</td>
                <td className="py-2 pr-3 text-right font-mono">{fmt(totals.totalAmount)}</td>
                <td className="py-2 pr-3" />
              </tr></tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

/* ───── Item Sales Report Tab ───── */

const ItemsReportTab: React.FC<{
  fromDate: string; setFromDate: (d: string) => void;
  toDate: string; setToDate: (d: string) => void;
  categoryId: string | undefined; setCategoryId: (id: string | undefined) => void;
  orderType: string | undefined; setOrderType: (v: string | undefined) => void;
  categories: Array<{ id: string; name: string }>;
}> = ({ fromDate, setFromDate, toDate, setToDate, categoryId, setCategoryId, orderType, setOrderType, categories }) => {
  const { data: _raw, isLoading } = useSoldItems(fromDate, toDate, categoryId, undefined, orderType);
  const items: SoldItem[] = (_raw ?? []) as SoldItem[];
  const grandTotal = items.reduce((s: number, i: SoldItem) => s + Number(i.totalAmount), 0);
  const hdr = ['Order #', 'Invoice #', 'Sale Date', 'Time', 'Item', 'Category', 'Unit Price', 'Discount %', 'Qty', 'Total Amount', 'Waiter'];
  return (
    <div className="space-y-4">
      <div className="flex items-end gap-2 flex-wrap">
        <DateRange fromDate={fromDate} setFromDate={setFromDate} toDate={toDate} setToDate={setToDate} />
        <div>
          <Label>Category</Label>
          <select className="flex h-9 rounded-md border border-slate-200 bg-white px-3 py-1 text-sm shadow-sm"
            value={categoryId ?? ''} onChange={(e) => setCategoryId(e.target.value || undefined)}>
            <option value="">All Categories</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <OrderTypeSelect value={orderType} onChange={setOrderType} />
      </div>
      <QuickPresets fromDate={fromDate} setFromDate={setFromDate} toDate={toDate} setToDate={setToDate} />
      <div className="pos-report-card">
        <div className="flex items-center justify-between mb-2">
          <h3>Item Sales Report — {fromDate} → {toDate}</h3>
          {items.length > 0 && (
            <div className="flex gap-1">
              <Button variant="outline" size="sm" onClick={() => {
                const d = items.map((it: SoldItem) => [it.orderNumber, it.invoiceNumber, new Date(it.saleDate).toLocaleDateString(), it.time || new Date(it.saleDate).toLocaleTimeString(), it.item, it.categoryName ?? '—', String(Number(it.unitPrice).toFixed(2)), it.discountPercent, String(Number(it.quantity).toFixed(2)), String(Number(it.totalAmount).toFixed(2)), it.waiterName ?? '—']);
                exportCSV(`items-report-${fromDate}-${toDate}.csv`, hdr, d);
              }}><Download className="h-3.5 w-3.5 mr-1" /> CSV</Button>
              <Button variant="outline" size="sm" onClick={() => {
                const d = items.map((it: SoldItem) => [it.orderNumber, it.invoiceNumber, new Date(it.saleDate).toLocaleDateString(), it.time || new Date(it.saleDate).toLocaleTimeString(), it.item, it.categoryName ?? '—', fmt(it.unitPrice), `${it.discountPercent}%`, String(Number(it.quantity).toFixed(2)), fmt(it.totalAmount), it.waiterName ?? '—']);
                exportPDF(`items-report-${fromDate}-${toDate}.pdf`, `Item Sales Report — ${fromDate} → ${toDate}`, hdr, d);
              }}><FileText className="h-3.5 w-3.5 mr-1" /> PDF</Button>
            </div>
          )}
        </div>
        {isLoading ? <p className="text-sm text-slate-500">Loading…</p> : null}
        {items.length === 0 && !isLoading ? <p className="text-sm text-slate-500">No items sold in this date range.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left border-b border-slate-200 text-slate-600">
                <th className="py-2 pr-3">Order #</th><th className="py-2 pr-3">Invoice #</th><th className="py-2 pr-3">Sale Date</th>
                <th className="py-2 pr-3">Time</th>
                <th className="py-2 pr-3">Item</th><th className="py-2 pr-3">Category</th><th className="py-2 pr-3 text-right">Unit Price</th>
                <th className="py-2 pr-3 text-right">Disc %</th><th className="py-2 pr-3 text-right">Qty</th><th className="py-2 pr-3 text-right">Total</th>
                <th className="py-2 pr-3">Waiter</th>
              </tr></thead>
              <tbody>{items.map((it: SoldItem, i: number) => (
                <tr key={i} className="border-b border-slate-100">
                  <td className="py-2 pr-3 font-mono text-sm">{it.orderNumber}</td>
                  <td className="py-2 pr-3 font-mono text-sm">{it.invoiceNumber}</td>
                  <td className="py-2 pr-3 text-sm">{new Date(it.saleDate).toLocaleDateString()}</td>
                  <td className="py-2 pr-3 text-sm">{it.time || new Date(it.saleDate).toLocaleTimeString()}</td>
                  <td className="py-2 pr-3 font-semibold">{it.item}</td>
                  <td className="py-2 pr-3 text-sm">{it.categoryName ?? '—'}</td>
                  <td className="py-2 pr-3 text-right font-mono">{fmt(it.unitPrice)}</td>
                  <td className="py-2 pr-3 text-right font-mono">{it.discountPercent}%</td>
                  <td className="py-2 pr-3 text-right font-mono">{Number(it.quantity).toFixed(2)}</td>
                  <td className="py-2 pr-3 text-right font-mono font-bold">{fmt(it.totalAmount)}</td>
                  <td className="py-2 pr-3 text-sm">{it.waiterName ?? '—'}</td>
                </tr>
              ))}</tbody>
              <tfoot><tr className="border-t-2 border-slate-300 font-bold text-slate-800">
                <td className="py-2 pr-3" colSpan={8}>Total ({items.length} items)</td>
                <td className="py-2 pr-3 text-right font-mono">{fmt(grandTotal)}</td>
                <td className="py-2 pr-3" />
              </tr></tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

/* ───── Expenses Report Tab ───── */

const ExpensesReportTab: React.FC<{
  fromDate: string; setFromDate: (d: string) => void;
  toDate: string; setToDate: (d: string) => void;
  categoryId: string; setCategoryId: (id: string) => void;
}> = ({ fromDate, setFromDate, toDate, setToDate, categoryId, setCategoryId }) => {
  const { data: stats } = useExpenseStats(fromDate, toDate);
  const { data: pageData, isLoading } = useExpensesReport(fromDate, toDate, categoryId || undefined);
  const rows: any[] = pageData?.data ?? [];
  const total = pageData?.meta?.total ?? 0;
  const amountSum = rows.reduce((s: number, r: any) => s + Number(r.amount), 0);

  return (
    <div className="space-y-4">
      <div className="flex items-end gap-2 flex-wrap">
        <DateRange fromDate={fromDate} setFromDate={setFromDate} toDate={toDate} setToDate={setToDate} />
        <div>
          <Label>Category</Label>
          <select className="flex h-9 rounded-md border border-slate-200 bg-white px-3 py-1 text-sm shadow-sm"
            value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">All categories</option>
          </select>
        </div>
      </div>
      <QuickPresets fromDate={fromDate} setFromDate={setFromDate} toDate={toDate} setToDate={setToDate} />
      {stats && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard title="Total Expenses" value={fmt(stats.grandTotal)} sub={`${stats.count ?? 0} entries`} icon={Receipt} />
          <StatCard title="Total Paid" value={fmt(stats.totalPaid)} sub={`${stats.totalPaidCount ?? 0} paid`} icon={DollarSign} accent />
          <StatCard title="Total Unpaid" value={fmt(stats.totalUnpaid)} sub={`${stats.totalUnpaidCount ?? 0} unpaid`} icon={Wallet} />
          <StatCard title="Partially Paid" value={fmt(stats.totalPartiallyPaid)} sub={`${stats.totalPartiallyPaidCount ?? 0} partial`} icon={TrendingUp} />
        </div>
      )}
      <div className="pos-report-card">
        <div className="flex items-center justify-between mb-2">
          <h3>Expenses Report — {fromDate} → {toDate}</h3>
          {rows.length > 0 && (
            <Button variant="outline" size="sm" onClick={() => {
              const hdr = ['Code', 'Date', 'Title', 'Category', 'Amount', 'Status', 'Created By', 'Paid At', 'Notes'];
              const data = rows.map((r: any) => [r.expenseCode, r.expenseDate?.slice(0, 10) ?? '', r.title, r.categoryName ?? r.category?.name ?? '—', String(r.amount), r.status, r.createdBy?.staff ? `${r.createdBy.staff.firstName} ${r.createdBy.staff.lastName}` : '—', r.paidAt ? r.paidAt.slice(0, 10) : '', r.notes ?? '']);
              exportCSV(`expenses-report-${fromDate}-${toDate}.csv`, hdr, data);
            }}><Download className="h-3.5 w-3.5 mr-1" /> CSV</Button>
          )}
        </div>
        {isLoading ? <p className="text-sm text-slate-500">Loading…</p> : null}
        {rows.length === 0 && !isLoading ? <p className="text-sm text-slate-500">No expenses in this date range.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left border-b border-slate-200 text-slate-600">
                <th className="py-2 pr-3">Code</th><th className="py-2 pr-3">Date</th><th className="py-2 pr-3">Title</th>
                <th className="py-2 pr-3">Category</th><th className="py-2 pr-3 text-right">Amount</th><th className="py-2 pr-3">Status</th>
              </tr></thead>
              <tbody>{rows.map((r: any, i: number) => (
                <tr key={r.id ?? i} className="border-b border-slate-100">
                  <td className="py-2 pr-3 font-mono text-sm">{r.expenseCode}</td>
                  <td className="py-2 pr-3 text-sm">{r.expenseDate?.slice(0, 10) ?? '—'}</td>
                  <td className="py-2 pr-3 font-semibold">{r.title}</td>
                  <td className="py-2 pr-3 text-sm">{r.categoryName ?? r.category?.name ?? '—'}</td>
                  <td className="py-2 pr-3 text-right font-mono font-bold">{fmt(r.amount)}</td>
                  <td className="py-2 pr-3"><span className="inline-block px-2 py-0.5 rounded-full text-sm font-semibold bg-slate-100 text-slate-600">{r.status}</span></td>
                </tr>
              ))}</tbody>
              <tfoot><tr className="border-t-2 border-slate-300 font-bold text-slate-800">
                <td className="py-2 pr-3" colSpan={4}>Total ({total} expenses)</td>
                <td className="py-2 pr-3 text-right font-mono">{fmt(amountSum)}</td>
                <td className="py-2 pr-3" />
              </tr></tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

/* ───── Purchases Report Tab ───── */

const PurchasesReportTab: React.FC<{
  fromDate: string; setFromDate: (d: string) => void;
  toDate: string; setToDate: (d: string) => void;
}> = ({ fromDate, setFromDate, toDate, setToDate }) => {
  const { data, isLoading } = usePurchasesReport(fromDate, toDate);
  const rows = data?.data ?? [];
  const totalCount = data?.meta?.total ?? 0;
  const totals = rows.reduce((s: { subtotal: number; tax: number; total: number }, r: any) => ({
    subtotal: s.subtotal + Number(r.subtotal),
    tax: s.tax + Number(r.taxAmount),
    total: s.total + Number(r.totalAmount),
  }), { subtotal: 0, tax: 0, total: 0 });
  const hdr = ['PO #', 'Date', 'Supplier', 'Status', 'Payment Type', 'Payment Status', 'Subtotal', 'Tax', 'Total'];

  return (
    <div className="space-y-4">
      <DateRange fromDate={fromDate} setFromDate={setFromDate} toDate={toDate} setToDate={setToDate} />
      <QuickPresets fromDate={fromDate} setFromDate={setFromDate} toDate={toDate} setToDate={setToDate} />
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard title="PO Subtotal" value={fmt(totals.subtotal)} sub={`${totalCount} orders`} icon={ShoppingCart} />
        <StatCard title="Tax" value={fmt(totals.tax)} sub="Total tax" icon={Receipt} />
        <StatCard title="Grand Total" value={fmt(totals.total)} sub="Total purchase value" icon={DollarSign} accent />
      </div>
      <div className="pos-report-card">
        <div className="flex items-center justify-between mb-2">
          <h3>Purchases Report — {fromDate} → {toDate}</h3>
          {rows.length > 0 && (
            <div className="flex gap-1">
              <Button variant="outline" size="sm" onClick={() => {
                const d = rows.map((r: any) => [r.orderNumber, r.orderDate?.slice(0, 10) ?? '—', r.partner?.name ?? '—', r.status, r.paymentType ?? '—', r.paymentStatus ?? '—', String(Number(r.subtotal).toFixed(2)), String(Number(r.taxAmount).toFixed(2)), String(Number(r.totalAmount).toFixed(2))]);
                exportCSV(`purchases-report-${fromDate}-${toDate}.csv`, hdr, d);
              }}><Download className="h-3.5 w-3.5 mr-1" /> CSV</Button>
              <Button variant="outline" size="sm" onClick={() => {
                const d = rows.map((r: any) => [r.orderNumber, r.orderDate?.slice(0, 10) ?? '—', r.partner?.name ?? '—', r.status, r.paymentType ?? '—', r.paymentStatus ?? '—', fmt(r.subtotal), fmt(r.taxAmount), fmt(r.totalAmount)]);
                exportPDF(`purchases-report-${fromDate}-${toDate}.pdf`, `Purchases Report — ${fromDate} → ${toDate}`, hdr, d);
              }}><FileText className="h-3.5 w-3.5 mr-1" /> PDF</Button>
            </div>
          )}
        </div>
        {isLoading ? <p className="text-sm text-slate-500">Loading…</p> : null}
        {rows.length === 0 && !isLoading ? <p className="text-sm text-slate-500">No purchases in this date range.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left border-b border-slate-200 text-slate-600">
                <th className="py-2 pr-3">PO #</th><th className="py-2 pr-3">Date</th><th className="py-2 pr-3">Supplier</th>
                <th className="py-2 pr-3">Status</th><th className="py-2 pr-3">Payment Type</th><th className="py-2 pr-3 text-right">Subtotal</th>
                <th className="py-2 pr-3 text-right">Tax</th><th className="py-2 pr-3 text-right">Total</th>
              </tr></thead>
              <tbody>{rows.map((r: any) => (
                <tr key={r.id} className="border-b border-slate-100">
                  <td className="py-2 pr-3 font-mono text-sm">{r.orderNumber}</td>
                  <td className="py-2 pr-3 text-sm">{r.orderDate?.slice(0, 10) ?? '—'}</td>
                  <td className="py-2 pr-3">{r.partner?.name ?? '—'}</td>
                  <td className="py-2 pr-3"><span className="inline-block px-2 py-0.5 rounded-full text-sm font-semibold bg-slate-100 text-slate-600">{r.status}</span></td>
                  <td className="py-2 pr-3 text-sm capitalize">{r.paymentType ?? '—'}</td>
                  <td className="py-2 pr-3 text-right font-mono">{fmt(r.subtotal)}</td>
                  <td className="py-2 pr-3 text-right font-mono">{fmt(r.taxAmount)}</td>
                  <td className="py-2 pr-3 text-right font-mono font-bold">{fmt(r.totalAmount)}</td>
                </tr>
              ))}</tbody>
              <tfoot><tr className="border-t-2 border-slate-300 font-bold text-slate-800">
                <td className="py-2 pr-3" colSpan={5}>Total ({totalCount} orders)</td>
                <td className="py-2 pr-3 text-right font-mono">{fmt(totals.subtotal)}</td>
                <td className="py-2 pr-3 text-right font-mono">{fmt(totals.tax)}</td>
                <td className="py-2 pr-3 text-right font-mono">{fmt(totals.total)}</td>
              </tr></tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

/* ───── Cash Flow Summary Tab ───── */

const CashFlowSummaryTab: React.FC<{
  fromDate: string; setFromDate: (d: string) => void;
  toDate: string; setToDate: (d: string) => void;
}> = ({ fromDate, setFromDate, toDate, setToDate }) => {
  const { data: cf, isLoading } = useCashFlowSummary(fromDate, toDate);
  const sections = [
    { label: 'Opening Cash', value: cf?.openingCash, color: 'text-slate-700' },
    { label: 'Operating', value: cf?.operating, color: 'text-blue-600' },
    { label: 'Investing', value: cf?.investing, color: 'text-amber-600' },
    { label: 'Financing', value: cf?.financing, color: 'text-violet-600' },
    { label: 'Net Cash Flow', value: cf?.netCashFlow, color: 'text-indigo-600', accent: true },
    { label: 'Closing Cash', value: cf?.closingCash, color: 'text-emerald-600', accent: true },
  ];

  return (
    <div className="space-y-4">
      <DateRange fromDate={fromDate} setFromDate={setFromDate} toDate={toDate} setToDate={setToDate} />
      <QuickPresets fromDate={fromDate} setFromDate={setFromDate} toDate={toDate} setToDate={setToDate} />
      {isLoading ? <p className="text-sm text-slate-500">Loading…</p> : null}
      {!isLoading && !cf ? <p className="text-sm text-slate-500">No cash flow data available.</p> : cf && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {sections.map((s) => (
              <StatCard key={s.label} title={s.label} value={fmt(s.value)} icon={Wallet} accent={s.accent} />
            ))}
          </div>
          {!cf.reconciled && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-700 text-sm">
              Reconciliation check failed. The closing balance may not match the ledger.
            </div>
          )}
          <div className="pos-report-card">
            <div className="flex items-center justify-between mb-2">
              <h3>Cash Flow Statement (Direct Method) — {fromDate} → {toDate}</h3>
              <div className="flex gap-1">
                <Button variant="outline" size="sm" onClick={() => {
                  const hdr = ['Metric', 'Amount'];
                  const data = sections.map((s) => [s.label, String(Number(s.value || 0).toFixed(2))]);
                  exportCSV(`cash-flow-summary-${fromDate}-${toDate}.csv`, hdr, data);
                }}><Download className="h-3.5 w-3.5 mr-1" /> CSV</Button>
                <Button variant="outline" size="sm" onClick={() => {
                  const hdr = ['Metric', 'Amount'];
                  const data = sections.map((s) => [s.label, fmt(s.value)]);
                  exportPDF(`cash-flow-summary-${fromDate}-${toDate}.pdf`, `Cash Flow Summary — ${fromDate} → ${toDate}`, hdr, data);
                }}><FileText className="h-3.5 w-3.5 mr-1" /> PDF</Button>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-left border-b border-slate-200 text-slate-600">
                  <th className="py-2 pr-3">Metric</th><th className="py-2 pr-3 text-right">Amount (UGX)</th>
                </tr></thead>
                <tbody>{sections.map((s) => (
                  <tr key={s.label} className={`border-b border-slate-100 ${s.accent ? 'font-semibold text-slate-800' : ''}`}>
                    <td className={`py-2 pr-3 ${s.color}`}>{s.label}</td>
                    <td className={`py-2 pr-3 text-right font-mono ${s.color}`}>{fmt(s.value)}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
            <p className="text-sm text-slate-400 mt-2">
              Source: Accounting GL · reconciled = {cf.reconciled ? 'Yes' : 'No'}
            </p>
          </div>
        </>
      )}
    </div>
  );
};

/* ───── Cash Flow Detailed Tab ───── */

const CashFlowDetailedTab: React.FC<{
  fromDate: string; setFromDate: (d: string) => void;
  toDate: string; setToDate: (d: string) => void;
}> = ({ fromDate, setFromDate, toDate, setToDate }) => {
  const [direction, setDirection] = useState<'inbound' | 'outbound'>('inbound');
  const { data: inboundData, isLoading: inboundLoading } = usePaymentsInbound(fromDate, toDate);
  const { data: outboundData, isLoading: outboundLoading } = usePaymentsOutbound(fromDate, toDate);
  const inboundRows = (inboundData?.data ?? []).map((p: any) => ({ id: p.id, paymentNumber: p.paymentNumber, partnerName: p.partner?.name ?? '—', paymentDate: p.paymentDate?.slice(0, 10) ?? '—', paymentMethod: p.paymentMethod ?? '—', amount: p.amount, reference: p.reference, direction: 'inbound' as const }));
  const outboundRows = (outboundData?.data ?? []).map((p: any) => ({ id: p.id, paymentNumber: p.paymentNumber, partnerName: p.partner?.name ?? '—', paymentDate: p.paymentDate?.slice(0, 10) ?? '—', paymentMethod: p.paymentMethod ?? '—', amount: p.amount, reference: p.reference, direction: 'outbound' as const }));
  const visibleRows = direction === 'inbound' ? inboundRows : outboundRows;
  const isLoading = direction === 'inbound' ? inboundLoading : outboundLoading;
  const grandInbound = inboundRows.reduce((s: number, r: any) => s + Number(r.amount), 0);
  const grandOutbound = outboundRows.reduce((s: number, r: any) => s + Number(r.amount), 0);
  const net = grandInbound - grandOutbound;
  const hdr = ['Direction', 'Payment #', 'Date', 'Partner', 'Method', 'Amount', 'Reference'];

  return (
    <div className="space-y-4">
      <DateRange fromDate={fromDate} setFromDate={setFromDate} toDate={toDate} setToDate={setToDate} />
      <QuickPresets fromDate={fromDate} setFromDate={setFromDate} toDate={toDate} setToDate={setToDate} />
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard title="Inbound (Receipts)" value={fmt(grandInbound)} sub={`${inboundRows.length} payments`} icon={TrendingUp} />
        <StatCard title="Outbound (Payments)" value={fmt(grandOutbound)} sub={`${outboundRows.length} payments`} icon={TrendingDown} />
        <StatCard title="Net Cash Flow" value={fmt(net)} sub="Inbound − Outbound" icon={Wallet} accent={net >= 0} />
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <button className={'pos-reports-tab ' + (direction === 'inbound' ? 'active' : '')} onClick={() => setDirection('inbound')}>
          <TrendingUp className="h-3.5 w-3.5 inline mr-1" /> Inbound ({inboundRows.length})
        </button>
        <button className={'pos-reports-tab ' + (direction === 'outbound' ? 'active' : '')} onClick={() => setDirection('outbound')}>
          <TrendingDown className="h-3.5 w-3.5 inline mr-1" /> Outbound ({outboundRows.length})
        </button>
        {visibleRows.length > 0 && (
          <div className="ml-auto flex gap-1">
            <Button variant="outline" size="sm" onClick={() => {
              const data = visibleRows.map((r: any) => [r.direction, r.paymentNumber, r.paymentDate, r.partnerName, r.paymentMethod, String(Number(r.amount).toFixed(2)), r.reference ?? '']);
              exportCSV(`cash-flow-${direction}-${fromDate}-${toDate}.csv`, hdr, data);
            }}><Download className="h-3.5 w-3.5 mr-1" /> CSV</Button>
            <Button variant="outline" size="sm" onClick={() => {
              const data = visibleRows.map((r: any) => [r.direction, r.paymentNumber, r.paymentDate, r.partnerName, r.paymentMethod, fmt(r.amount), r.reference ?? '']);
              exportPDF(`cash-flow-${direction}-${fromDate}-${toDate}.pdf`, `Cash Flow ${direction === 'inbound' ? 'Inbound' : 'Outbound'} — ${fromDate} → ${toDate}`, hdr, data);
            }}><FileText className="h-3.5 w-3.5 mr-1" /> PDF</Button>
          </div>
        )}
      </div>
      <div className="pos-report-card">
        <h3>{direction === 'inbound' ? 'Inbound Payments' : 'Outbound Payments'} — {fromDate} → {toDate}</h3>
        {isLoading ? <p className="text-sm text-slate-500">Loading…</p> : null}
        {visibleRows.length === 0 && !isLoading ? <p className="text-sm text-slate-500">No payments in this date range.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left border-b border-slate-200 text-slate-600">
                <th className="py-2 pr-3">Payment #</th><th className="py-2 pr-3">Date</th><th className="py-2 pr-3">Partner</th>
                <th className="py-2 pr-3">Method</th><th className="py-2 pr-3 text-right">Amount</th><th className="py-2 pr-3">Reference</th>
              </tr></thead>
              <tbody>{visibleRows.map((r: any) => (
                <tr key={r.id} className="border-b border-slate-100">
                  <td className="py-2 pr-3 font-mono text-sm">{r.paymentNumber}</td>
                  <td className="py-2 pr-3 text-sm">{r.paymentDate}</td>
                  <td className="py-2 pr-3">{r.partnerName}</td>
                  <td className="py-2 pr-3 text-sm capitalize">{r.paymentMethod}</td>
                  <td className={'py-2 pr-3 text-right font-mono font-bold ' + (r.direction === 'inbound' ? 'text-emerald-600' : 'text-rose-600')}>{fmt(r.amount)}</td>
                  <td className="py-2 pr-3 text-sm text-slate-500">{r.reference ?? '—'}</td>
                </tr>
              ))}</tbody>
              <tfoot><tr className="border-t-2 border-slate-300 font-bold text-slate-800">
                <td className="py-2 pr-3" colSpan={4}>{direction === 'inbound' ? 'Total Inbound' : 'Total Outbound'} ({visibleRows.length} payments)</td>
                <td className={'py-2 pr-3 text-right font-mono ' + (direction === 'inbound' ? 'text-emerald-600' : 'text-rose-600')}>{fmt(direction === 'inbound' ? grandInbound : grandOutbound)}</td>
                <td className="py-2 pr-3" />
              </tr></tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

/* ───── Page Shell ───── */

type ReportTab = 'sales' | 'items' | 'expenses' | 'purchases' | 'cf-summary' | 'cf-detailed';

const ReportCenterPage: React.FC = () => {
  const navigate = useNavigate();
  const permissions = useAuthStore((s) => s.permissions);
  const [tab, setTab] = useState<ReportTab>('sales');
  const denied = !permissions.includes('report:accounting');

  const [salesFrom, setSalesFrom] = useState(todayIso());
  const [salesTo, setSalesTo] = useState(todayIso());
  const [salesOrderType, setSalesOrderType] = useState<string | undefined>();
  const [itemsFrom, setItemsFrom] = useState(todayIso());
  const [itemsTo, setItemsTo] = useState(todayIso());
  const [itemsCategoryId, setItemsCategoryId] = useState<string | undefined>();
  const [itemsOrderType, setItemsOrderType] = useState<string | undefined>();
  const { data: categories } = useCategories();
  const [expFrom, setExpFrom] = useState(todayIso());
  const [expTo, setExpTo] = useState(todayIso());
  const [expCategoryId, setExpCategoryId] = useState('');
  const [poFrom, setPoFrom] = useState(todayIso());
  const [poTo, setPoTo] = useState(todayIso());
  const [cfFrom, setCfFrom] = useState(todayIso());
  const [cfTo, setCfTo] = useState(todayIso());

  return (
    <div className="pos-reports-shell">
      <div className="pos-reports-header">
        <div>
          <Button variant="outline" size="sm" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-4 w-4 mr-1" /> Back
          </Button>
          <h1 className="text-2xl font-bold mt-2 flex items-center gap-2">
            <BarChart3 className="h-6 w-6" /> Reports
          </h1>
          <p className="text-sm text-slate-600">Sales, expenses, purchases, and cash flow overview.</p>
        </div>
      </div>
      {denied ? (
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-rose-700">
          You don't have <code>report:accounting</code> permission.
        </div>
      ) : (
        <>
          <div className="pos-reports-tabs pos-reports-tabs-wide">
            <button className={'pos-reports-tab' + (tab === 'sales' ? ' active' : '')} onClick={() => setTab('sales')}>Sales Report</button>
            <button className={'pos-reports-tab' + (tab === 'items' ? ' active' : '')} onClick={() => setTab('items')}>Item Sales</button>
            <button className={'pos-reports-tab' + (tab === 'expenses' ? ' active' : '')} onClick={() => setTab('expenses')}>Expenses</button>
            <button className={'pos-reports-tab' + (tab === 'purchases' ? ' active' : '')} onClick={() => setTab('purchases')}>Purchases</button>
            <button className={'pos-reports-tab' + (tab === 'cf-summary' ? ' active' : '')} onClick={() => setTab('cf-summary')}>Cash Flow Summary</button>
            <button className={'pos-reports-tab' + (tab === 'cf-detailed' ? ' active' : '')} onClick={() => setTab('cf-detailed')}>Cash Flow Detailed</button>
          </div>
          {tab === 'sales' && <SalesReportTab fromDate={salesFrom} setFromDate={setSalesFrom} toDate={salesTo} setToDate={setSalesTo} orderType={salesOrderType} setOrderType={setSalesOrderType} />}
          {tab === 'items' && <ItemsReportTab fromDate={itemsFrom} setFromDate={setItemsFrom} toDate={itemsTo} setToDate={setItemsTo} categoryId={itemsCategoryId} setCategoryId={setItemsCategoryId} orderType={itemsOrderType} setOrderType={setItemsOrderType} categories={categories ?? []} />}
          {tab === 'expenses' && <ExpensesReportTab fromDate={expFrom} setFromDate={setExpFrom} toDate={expTo} setToDate={setExpTo} categoryId={expCategoryId} setCategoryId={setExpCategoryId} />}
          {tab === 'purchases' && <PurchasesReportTab fromDate={poFrom} setFromDate={setPoFrom} toDate={poTo} setToDate={setPoTo} />}
          {tab === 'cf-summary' && <CashFlowSummaryTab fromDate={cfFrom} setFromDate={setCfFrom} toDate={cfTo} setToDate={setCfTo} />}
          {tab === 'cf-detailed' && <CashFlowDetailedTab fromDate={cfFrom} setFromDate={setCfFrom} toDate={cfTo} setToDate={setCfTo} />}
        </>
      )}
    </div>
  );
};

export default ReportCenterPage;
