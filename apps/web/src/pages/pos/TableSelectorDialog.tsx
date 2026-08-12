import React, { useEffect, useMemo, useState } from 'react';
import {
  LayoutGrid,
  RefreshCw,
  Sparkles,
  Clock,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  useTableStats,
  useTables,
  useTableZones,
  usePosTablesStream,
} from '@/features/tables/api';
import type { PosTable, PosTableStatus } from '@/features/tables/types';
import { STATUS_META, zoneLabel, fmtMoney, minutesBetween } from '@/features/tables/utils';

interface Props {
  open: boolean;
  onClose: () => void;
  onPick: (table: PosTable) => void;
  selectedId: string | null;
}

const FILTERS: Array<'all' | PosTableStatus> = [
  'all',
  'available',
  'occupied',
  'out_of_service',
];

export const TableSelectorDialog: React.FC<Props> = ({
  open,
  onClose,
  onPick,
  selectedId,
}) => {
  usePosTablesStream();
  const { data: tables = [], refetch, isLoading } = useTables({ active: true });
  const { data: stats } = useTableStats();
  const { data: zones = [] } = useTableZones();

  const [filter, setFilter] = useState<'all' | PosTableStatus>('all');
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (!open) {
      setSearch('');
      setFilter('all');
    }
  }, [open]);

  const grouped = useMemo(() => {
    const filtered = tables.filter((t) => {
      if (filter !== 'all' && t.status !== filter) return false;
      const q = search.trim().toLowerCase();
      if (q) {
        const hay = `${t.number} ${t.name} ${t.zoneName ?? t.zone}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    const map = new Map<string, PosTable[]>();
    for (const t of filtered) {
      const key = t.zone;
      const arr = map.get(key) ?? [];
      arr.push(t);
      map.set(key, arr);
    }
    for (const arr of map.values()) arr.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.number - b.number);
    const zoneOrder = new Map(zones.map((z, i) => [z.key, i]));
    return Array.from(map.entries()).sort(
      (a, b) =>
        (zoneOrder.get(a[0]) ?? 999) - (zoneOrder.get(b[0]) ?? 999) || a[0].localeCompare(b[0]),
    );
  }, [tables, filter, search, zones]);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-[90vw] lg:max-w-6xl p-0 overflow-hidden bg-white rounded-2xl shadow-2xl">
        {/* Beautiful header */}
        <div className="relative bg-gradient-to-br from-indigo-50 via-white to-sky-50 px-6 py-5 rounded-t-2xl border-b border-slate-100/80">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2.5 text-slate-800 text-xl font-bold">
              <div className="p-2 bg-white rounded-lg shadow-sm">
                <LayoutGrid className="w-5 h-5 text-indigo-500" />
              </div>
              Table Selection
            </DialogTitle>
          </DialogHeader>
        </div>

        {/* Stats + filter bar – clean & functional */}
        <div className="px-2 py-1 border-b border-slate-100 bg-white flex flex-wrap items-center gap-3">
          <div className="flex flex-wrap gap-2">
            {FILTERS.map((k) => {
              const count =
                k === 'all'
                  ? stats?.total ?? 0
                  : stats?.[k as keyof typeof stats] ?? 0;
              const meta = k === 'all' ? null : STATUS_META[k as PosTableStatus];
              const active = filter === k;
              return (
                <button
                  key={k}
                  onClick={() => setFilter(k)}
                  className={`px-3 py-1.5 rounded-full text-xs font-semibold border flex items-center gap-1.5 transition ${
                    active
                      ? 'bg-slate-800 text-white border-slate-800 shadow-sm'
                      : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
                  }`}
                >
                  {meta ? (
                    <span className={`w-2 h-2 rounded-full ${meta.dot}`} />
                  ) : null}
                  {k === 'all' ? 'All' : meta?.label ?? k}
                  <span
                    className={`text-[10px] font-bold rounded-full px-1.5 ${
                      active
                        ? 'bg-white/20 text-white'
                        : 'bg-slate-100 text-slate-500'
                    }`}
                  >
                    {count}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="ml-auto flex gap-2 items-center">
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search table…"
              className="h-9 w-44 text-xs rounded-lg"
            />
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9 rounded-lg"
              onClick={() => refetch()}
            >
              <RefreshCw className="w-4 h-4 text-slate-500" />
            </Button>
          </div>
        </div>

        {/* Main grid area – wider, more columns */}
        <div className="flex-1 overflow-y-auto p-6 bg-stone-50/50 min-h-[320px] max-h-[60vh]">
          {isLoading ? (
            <div className="text-center text-slate-400 py-12">Loading tables…</div>
          ) : grouped.length === 0 ? (
            <div className="text-center text-slate-400 py-12">
              <Sparkles className="w-8 h-8 mx-auto mb-2 opacity-50" />
              <p className="font-semibold">No tables match this filter</p>
            </div>
          ) : (
            grouped.map(([zoneKey, list]) => (
              <div key={zoneKey} className="mb-8">
                <div className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-4">
                  {zoneLabel(zones, zoneKey)} · {list.length}
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                  {list.map((t) => (
                    <TableCard
                      key={t.id}
                      table={t}
                      selected={t.id === selectedId}
                      onPick={() => onPick(t)}
                    />
                  ))}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Legend + footer */}
        <div className="border-t border-slate-100 px-6 py-4 bg-white rounded-b-2xl flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap gap-4 text-xs text-slate-500">
            {Object.values(STATUS_META).map((m) => (
              <div key={m.label} className="flex items-center gap-1.5">
                <span className={`w-2.5 h-2.5 rounded-full ${m.dot} shadow-sm`} />
                {m.label}
              </div>
            ))}
          </div>
          <DialogFooter className="p-0 m-0">
            <Button variant="outline" size="sm" onClick={onClose} className="rounded-lg">
              Close
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
};

const TableCard: React.FC<{
  table: PosTable;
  selected: boolean;
  onPick: () => void;
}> = ({ table, selected, onPick }) => {
  const meta = STATUS_META[table.status];
  const openOrders = (table.orders ?? []).filter((o) => !o.closedAt);
  const total = openOrders.reduce((s, o) => s + Number(o.order?.totalAmount ?? 0), 0);

  return (
      <div
      onClick={onPick}
      className={`relative rounded-xl p-3 border cursor-pointer transition-all duration-200 
        shadow-sm hover:shadow-md hover:scale-[1.01]
        ${table.status === 'available' ? 'bg-emerald-50 border-emerald-300 border-l-4' : table.status === 'occupied' ? 'bg-orange-50/80 border-orange-300' : table.status === 'reserved' ? 'bg-blue-50/30 border-blue-200' : table.status === 'out_of_service' ? 'bg-slate-100 border-slate-300' : 'bg-white border-slate-200'}
        ${selected ? 'ring-2 ring-indigo-500 ring-offset-2 shadow-md' : ''}
      `}
    >
      {/* Occupied top indicator */}
      {table.status === 'occupied' && (
        <div className="absolute top-0 left-0 right-0 h-1.5 rounded-t-xl bg-orange-400" />
      )}

      {/* Status badge top-right */}
      <span
        className={`absolute top-2 right-2 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border 
          ${meta.pill} bg-white`}
      >
        <span className={`w-2 h-2 rounded-full ${meta.dot}`} />
        {meta.label}
      </span>

      {/* Zone pill */}
      <div className="mb-1.5">
        <span className={`text-[9px] font-bold uppercase tracking-[0.15em] px-2 py-0.5 rounded-full ${table.status === 'available' ? 'bg-emerald-100 text-emerald-700' : 'bg-white/60 text-slate-500'}`}>
          {table.zoneName ?? table.zone}
        </span>
      </div>

      {/* Table number + name */}
      <div className="text-sm font-bold uppercase tracking-wider text-slate-400 mb-0.5">
        T{table.number}
      </div>
      <div className="text-[24px] font-bold text-slate-800 leading-tight pr-14">
        {table.name}
      </div>

      {/* Zone label below name */}
      <div className="text-sm font-medium text-slate-400 capitalize mb-auto">
        {table.zoneName ?? table.zone}
      </div>

      {/* Table code (replaces seats) */}
      <div className="mt-2">
        <span className="text-sm font-bold text-slate-600 bg-white/70 px-2 py-1 rounded border border-slate-200 font-mono tracking-wider">
          {table.name}
        </span>
      </div>

      {/* Open order info — time & price on one line */}
      {table.mergedIntoId && (
        <div className="text-[11px] text-orange-600 font-semibold mt-2">
          Merged · orders on T{table.mergedInto?.number ?? '?'}
        </div>
      )}
      {openOrders.length > 0 ? (
        <div className="flex items-center justify-between mt-2 text-xs font-semibold text-slate-600">
          <span className="flex items-center gap-1">
            <Clock className="w-3 h-3" />
            {minutesBetween(openOrders[0].openedAt, null)}m
          </span>
          <span>{fmtMoney(total)}</span>
        </div>
      ) : (
        <div className="mt-2 text-xs text-slate-400 font-medium">Tap to open</div>
      )}
    </div>
  );
};

export default TableSelectorDialog;