import { useAuthStore } from '@/stores/auth.store';
const orgCur = () => useAuthStore.getState().organization?.currencyCode ?? 'IDR';
// Odoo-style Orders panel: every OPEN order across all types, resumable in the
// terminal. Rows show time / ref / customer / type + table badges / amount /
// status, with search, type filters, pagination and a delete (cancel) action.
import React, { useMemo, useState } from 'react';
import { Search, Trash2, Plus, ChevronLeft, ChevronRight, ClipboardList, X, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useOrdersList, useCancelOrder, type OpenOrderRow } from './api';

const fmt = (n: number | string) => `${orgCur()} ${Number(n || 0).toLocaleString()}`;
const PAGE_SIZE = 8;

type TypeFilter = 'all' | 'dine_in' | 'takeaway' | 'delivery';

const TYPE_LABEL: Record<string, string> = { dine_in: 'Dine In', takeaway: 'Takeaway', delivery: 'Delivery' };
const TYPE_STYLE: Record<string, string> = {
  dine_in: 'bg-sky-100 text-sky-700',
  takeaway: 'bg-amber-100 text-amber-700',
  delivery: 'bg-violet-100 text-violet-700',
};

/**
 * Odoo maps a billed-but-unpaid order to "Payment"; everything else is "Ongoing".
 * (`served` is the legacy alias of `completed` — accepted while old Android
 * clients are still in the field.)
 */
const statusPill = (status: string) =>
  status === 'completed' || status === 'served'
    ? { label: 'Payment', cls: 'bg-indigo-500 text-white' }
    : { label: 'Ongoing', cls: 'bg-sky-500 text-white' };

const fmtWhen = (iso: string) => {
  const d = new Date(iso);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return { day: sameDay ? 'Today' : d.toLocaleDateString([], { day: '2-digit', month: 'short', year: 'numeric' }), time };
};

interface Props {
  open: boolean;
  activeOrderId?: string;
  onOpenOrder: (id: string) => void;
  onNewOrder: () => void;
  onClose: () => void;
}

export const OrdersListPanel: React.FC<Props> = ({ open, activeOrderId, onOpenOrder, onNewOrder, onClose }) => {
  const [filter, setFilter] = useState<TypeFilter>('all');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);

  const { data, isLoading } = useOrdersList(
    { orderType: filter === 'all' ? undefined : filter, search: search.trim() || undefined },
    open,
  );
  const cancel = useCancelOrder();

  const rows = data?.rows ?? [];
  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pageRows = useMemo(
    () => rows.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE),
    [rows, safePage],
  );

  const onDelete = async (e: React.MouseEvent, row: OpenOrderRow) => {
    e.stopPropagation();
    if (!window.confirm(`Delete order ${row.orderNumber}? This cannot be undone.`)) return;
    try {
      await cancel.mutateAsync({ orderId: row.id, reason: 'Deleted from Orders panel' });
      toast.success(`Order ${row.orderNumber} deleted`);
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Could not delete order');
    }
  };

  if (!open) return null;

  const FILTERS: Array<{ key: TypeFilter; label: string }> = [
    { key: 'all', label: 'Active' },
    { key: 'dine_in', label: 'Dine In' },
    { key: 'takeaway', label: 'Takeaway' },
    { key: 'delivery', label: 'Delivery' },
  ];

  return (
    <div className="flex flex-col h-full min-h-0 bg-white">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-200">
        <div className="flex items-center gap-2 text-slate-800 font-bold text-lg">
          <ClipboardList className="h-5 w-5 text-teal-600" /> Orders
          <span className="inline-flex items-center justify-center min-w-[28px] h-7 px-2 rounded-full bg-teal-500 text-white text-sm font-bold">
            {rows.length}
          </span>
        </div>
        <div className="flex-1" />
        <button
          type="button"
          onClick={onNewOrder}
          className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700"
        >
          <Plus className="h-4 w-4" /> New Order
        </button>
        <button type="button" onClick={onClose} className="pos-icon-btn" title="Back to selling">
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Toolbar: search + type filters */}
      <div className="flex flex-wrap items-center gap-2 px-4 py-2.5 border-b border-slate-200">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <input
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(0); }}
            placeholder="Search order number…"
            className="w-full h-9 pl-8 pr-3 rounded-lg border border-slate-300 text-sm focus:outline-none focus:border-teal-500"
          />
        </div>
        <div className="flex items-center gap-1.5">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => { setFilter(f.key); setPage(0); }}
              className={
                'h-9 px-3 rounded-lg text-sm font-semibold border transition-colors ' +
                (filter === f.key
                  ? 'bg-slate-800 text-white border-slate-800'
                  : 'bg-white text-slate-600 border-slate-300 hover:border-slate-400')
              }
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1 text-xs text-slate-500">
          <span className="tabular-nums">
            {rows.length === 0 ? '0' : `${safePage * PAGE_SIZE + 1}-${Math.min(rows.length, (safePage + 1) * PAGE_SIZE)}`} / {rows.length}
          </span>
          <button type="button" disabled={safePage <= 0} onClick={() => setPage((p) => Math.max(0, p - 1))}
            className="pos-icon-btn disabled:opacity-40"><ChevronLeft className="h-4 w-4" /></button>
          <button type="button" disabled={safePage >= pageCount - 1} onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
            className="pos-icon-btn disabled:opacity-40"><ChevronRight className="h-4 w-4" /></button>
        </div>
      </div>

      {/* Rows */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {isLoading ? (
          <div className="flex items-center justify-center gap-2 text-slate-500 py-16">
            <Loader2 className="h-5 w-5 animate-spin" /> Loading orders…
          </div>
        ) : rows.length === 0 ? (
          <div className="text-center py-16 text-slate-500">
            <ClipboardList className="h-10 w-10 mx-auto mb-2 opacity-40" />
            <p className="font-semibold">No open orders</p>
            <p className="text-xs mt-1">Start ringing items or tap “New Order”. Open orders appear here to resume.</p>
          </div>
        ) : (
          pageRows.map((row) => {
            const when = fmtWhen(row.openedAt);
            const pill = statusPill(row.status);
            const isActive = row.id === activeOrderId;
            return (
              <button
                key={row.id}
                type="button"
                onClick={() => onOpenOrder(row.id)}
                className={
                  'w-full flex items-center gap-4 px-4 py-3 border-b border-slate-100 text-left hover:bg-teal-50/60 transition-colors ' +
                  (isActive ? 'bg-teal-50' : 'bg-white')
                }
              >
                <div className="w-24 shrink-0">
                  <div className="text-sm font-bold text-slate-800">{when.day}</div>
                  <div className="text-xs text-slate-500 tabular-nums">{when.time}</div>
                </div>
                <div className="w-40 shrink-0">
                  <div className="text-sm font-mono font-semibold text-slate-700">{row.orderNumber}</div>
                  {row.guestCount ? <div className="text-xs text-slate-400">{row.guestCount} guest{row.guestCount > 1 ? 's' : ''}</div> : null}
                </div>
                <div className="flex-1 min-w-0">
                  {row.customerName ? <div className="text-sm font-semibold text-slate-800 truncate">{row.customerName}</div> : null}
                  <div className="flex items-center gap-1.5 mt-0.5">
                    {row.orderType ? (
                      <span className={'text-[11px] font-bold px-2 py-0.5 rounded ' + (TYPE_STYLE[row.orderType] ?? 'bg-slate-100 text-slate-600')}>
                        {TYPE_LABEL[row.orderType] ?? row.orderType}
                      </span>
                    ) : null}
                    {row.tableName ? (
                      <span className="text-[11px] font-bold px-2 py-0.5 rounded bg-rose-100 text-rose-700">{row.tableName}</span>
                    ) : null}
                  </div>
                </div>
                <div className="w-28 shrink-0 text-right font-mono font-bold text-slate-800">{fmt(row.totalAmount)}</div>
                <div className="w-24 shrink-0 flex justify-center">
                  <span className={'text-[11px] font-bold px-2.5 py-1 rounded ' + pill.cls}>{pill.label}</span>
                </div>
                <span
                  role="button"
                  tabIndex={-1}
                  onClick={(e) => onDelete(e, row)}
                  className="pos-icon-btn text-slate-400 hover:text-rose-600"
                  title="Delete order"
                >
                  <Trash2 className="h-4 w-4" />
                </span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
};
