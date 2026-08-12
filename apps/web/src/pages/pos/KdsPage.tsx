// KDS — Kitchen Display board. Layout-switchable (columns / queue / grid / tv /
// expo), tap + drag to advance, queue numbers, priority, timers, recall, batch.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useAuthStore } from '@/stores/auth.store';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { PERMISSIONS } from '@erp/shared';
import {
  ChefHat, ArrowLeft, Volume2, VolumeX, Check, RotateCcw, Truck, Flame, Star,
  LayoutGrid, Columns3, List, Tv, PackageCheck, CheckCheck, X,
} from 'lucide-react';
import {
  DndContext, PointerSensor, useSensor, useSensors, useDraggable, useDroppable,
  closestCorners, type DragEndEvent,
} from '@dnd-kit/core';
import { Button } from '@/components/ui/button';

import {
  useKdsTickets, useKdsTransition, useKdsBulkTransition, useKdsSetPriority,
  useKitchenStations, type KdsTicketFE, type KdsTicketItemFE, type KdsAction, type KdsPriorityFE,
} from './pos-features-api';
import './pos-pro.css';

type Layout = 'columns' | 'queue' | 'grid' | 'tv' | 'expo';
const LAYOUTS: Array<{ id: Layout; label: string; icon: React.ComponentType<any> }> = [
  { id: 'columns', label: 'Columns', icon: Columns3 },
  { id: 'grid', label: 'Grid', icon: LayoutGrid },
  { id: 'queue', label: 'Queue', icon: List },
  { id: 'tv', label: 'TV', icon: Tv },
  { id: 'expo', label: 'Expo', icon: PackageCheck },
];

const COLUMNS: Array<{ id: string; title: string; status: KdsTicketFE['status'] }> = [
  { id: 'new', title: 'New', status: 'new' },
  { id: 'preparing', title: 'Preparing', status: 'preparing' },
  { id: 'ready', title: 'Ready', status: 'ready' },
];

const RECALL_REASONS = ['wrong-item', 'burnt', 'customer-change', 'missing-ingredient'];

function minsSince(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
}
function timeAgo(iso: string): string {
  const m = minsSince(iso);
  if (m < 1) return 'now';
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}
/** Green 0–5m, amber 5–10m, red 10m+. */
function ageClasses(iso: string): string {
  const m = minsSince(iso);
  if (m >= 10) return 'text-rose-600';
  if (m >= 5) return 'text-amber-600';
  return 'text-emerald-600';
}
/** Expected-ready remaining string from startedAt + max item prep time. */
function etaLabel(t: KdsTicketFE): string | null {
  const maxPrep = t.items.reduce((mx, it) => Math.max(mx, it.prepTime ?? 0), 0);
  if (!maxPrep || !t.startedAt) return null;
  const remainingMs = new Date(t.startedAt).getTime() + maxPrep * 60000 - Date.now();
  const mins = Math.round(remainingMs / 60000);
  if (mins > 0) return `≈${mins}m left`;
  return 'overdue';
}

const PRIORITY_META: Record<KdsPriorityFE, { label: string; ring: string; badge: string }> = {
  normal: { label: 'Normal', ring: '', badge: '' },
  rush: { label: 'Rush', ring: 'ring-2 ring-orange-400', badge: 'bg-orange-500 text-white' },
  vip: { label: 'VIP', ring: 'ring-2 ring-fuchsia-500', badge: 'bg-fuchsia-600 text-white' },
};
const nextPriority: Record<KdsPriorityFE, KdsPriorityFE> = { normal: 'rush', rush: 'vip', vip: 'normal' };

// ─── Ticket card ─────────────────────────────────────────────────────────────
const TicketCard: React.FC<{
  ticket: KdsTicketFE;
  onAction: (action: KdsAction) => void;
  onCyclePriority: () => void;
  onToggleSelect?: () => void;
  selected?: boolean;
  pending: boolean;
  tv?: boolean;
  draggableId?: string;
}> = ({ ticket, onAction, onCyclePriority, onToggleSelect, selected, pending, tv, draggableId }) => {
  const drag = useDraggable({ id: draggableId ?? ticket.id, disabled: !draggableId });
  const status = ticket.status;
  const statusColors: Record<string, string> = {
    new: 'border-blue-400 bg-blue-50',
    preparing: 'border-amber-400 bg-amber-50',
    ready: 'border-emerald-400 bg-emerald-50',
    served: 'border-slate-300 bg-slate-50 opacity-60',
    cancelled: 'border-rose-300 bg-rose-50 opacity-60',
  };
  const pmeta = PRIORITY_META[ticket.priority];
  const eta = etaLabel(ticket);
  const style = draggableId && drag.transform
    ? { transform: `translate(${drag.transform.x}px, ${drag.transform.y}px)`, zIndex: 50 }
    : undefined;

  return (
    <div
      ref={draggableId ? drag.setNodeRef : undefined}
      style={style}
      className={`rounded-2xl border-2 ${statusColors[status]} ${pmeta.ring} ${selected ? 'ring-2 ring-sky-500' : ''} ${tv ? 'p-5' : 'p-4'} shadow-sm transition`}
    >
      <div className="flex items-center justify-between mb-2 gap-2">
        <div className="flex items-center gap-2 min-w-0">
          {onToggleSelect && (
            <input type="checkbox" checked={!!selected} onChange={onToggleSelect}
              className="h-4 w-4 shrink-0" onClick={(e) => e.stopPropagation()} />
          )}
          {ticket.ticketNo && (
            <span className={`font-mono font-extrabold ${tv ? 'text-2xl' : 'text-base'} text-slate-900`}>{ticket.ticketNo}</span>
          )}
          <span
            // The drag handle is the label area; buttons/checkbox stop propagation.
            {...(draggableId ? { ...drag.listeners, ...drag.attributes } : {})}
            className={`font-extrabold truncate cursor-grab ${tv ? 'text-2xl' : 'text-lg'}`}
          >{ticket.label}</span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {ticket.priority !== 'normal' && (
            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${pmeta.badge}`}>{pmeta.label}</span>
          )}
          {ticket.orderType && ticket.orderType !== 'dine_in' && (
            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-slate-700 text-white capitalize">
              {ticket.orderType.replace('_', '')}
            </span>
          )}
          <span className={`text-xs font-mono ${ageClasses(ticket.createdAt)}`}>{timeAgo(ticket.createdAt)}</span>
        </div>
      </div>

      {eta && <div className="text-[11px] font-semibold text-slate-500 mb-1.5">{eta}</div>}
      {ticket.recallCount > 0 && (
        <div className="text-[11px] font-semibold text-rose-600 mb-1.5">↺ recalled ×{ticket.recallCount}{ticket.recallReason ? ` — ${ticket.recallReason}` : ''}</div>
      )}

      <div className="space-y-2 mb-3">
        {ticket.items.map((it: KdsTicketItemFE, idx) => (
          <div key={idx} className="bg-white rounded-lg p-2 shadow-sm">
            <div className={`font-bold ${tv ? 'text-lg' : 'text-sm'} flex items-center gap-1.5`}>
              {it.quantity > 1 ? <span className="text-amber-700">{it.quantity}×</span> : null}
              <span>{it.productName}</span>
              {it.course ? <span className="text-[10px] font-bold px-1 rounded bg-violet-600 text-white">C{it.course}</span> : null}
            </div>
            {it.variantName && <div className="text-[11px] font-semibold text-slate-700 mt-0.5">{it.variantName}</div>}
            {it.accompanimentNames && it.accompanimentNames.length > 0 && (
              <div className="text-[11px] text-slate-600 mt-0.5">+ {it.accompanimentNames.join(', ')}</div>
            )}
            {it.modifiers.length > 0 && (
              <div className="text-[11px] text-slate-600 mt-0.5">
                {it.modifiers.map((m) => (m as any).kitchenPrintName ?? m.name).join(', ')}
              </div>
            )}
            {it.notes && <div className="text-[11px] font-bold text-rose-700 mt-0.5 uppercase">! {it.notes}</div>}
          </div>
        ))}
      </div>

      <div className="flex gap-1.5 items-center">
        {status === 'new' && (
          <Button onClick={() => onAction('start')} disabled={pending} className="flex-1" style={{ background: '#f59e0b' }}>
            <ChefHat className="h-3.5 w-3.5 mr-1" /> Start
          </Button>
        )}
        {status === 'preparing' && (
          <Button onClick={() => onAction('ready')} disabled={pending} className="flex-1" style={{ background: '#16a34a' }}>
            <Check className="h-3.5 w-3.5 mr-1" /> Ready
          </Button>
        )}
        {status === 'ready' && (
          <>
            <Button onClick={() => onAction('serve')} disabled={pending} className="flex-1" style={{ background: '#0f172a' }}>
              <Truck className="h-3.5 w-3.5 mr-1" /> Served
            </Button>
            <Button onClick={() => onAction('recall')} disabled={pending} variant="outline" className="border-amber-300 text-amber-700 px-2" title="Recall">
              <RotateCcw className="h-3.5 w-3.5" />
            </Button>
          </>
        )}
        {/* Priority cycle + cancel for live tickets. */}
        <Button onClick={onCyclePriority} disabled={pending} variant="outline" className="px-2" title={`Priority: ${pmeta.label}`}>
          {ticket.priority === 'vip' ? <Star className="h-3.5 w-3.5 text-fuchsia-600" /> : <Flame className={`h-3.5 w-3.5 ${ticket.priority === 'rush' ? 'text-orange-500' : 'text-slate-400'}`} />}
        </Button>
        {(status === 'new' || status === 'preparing') && (
          <Button onClick={() => onAction('cancel')} disabled={pending} variant="outline" className="border-rose-300 text-rose-600 px-2" title="Cancel">
            <X className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
    </div>
  );
};

// ─── Droppable column ────────────────────────────────────────────────────────
const DroppableColumn: React.FC<{ id: string; title: string; count: number; children: React.ReactNode }> = ({ id, title, count, children }) => {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div className="flex-1 min-w-[260px]">
      <div className="flex items-center justify-between mb-2 px-1">
        <h2 className="font-extrabold text-slate-700">{title}</h2>
        <span className="text-xs font-mono text-slate-500">{count}</span>
      </div>
      <div ref={setNodeRef} className={`space-y-3 min-h-[120px] rounded-xl p-2 transition ${isOver ? 'bg-sky-100/60 outline-dashed outline-2 outline-sky-300' : ''}`}>
        {children}
      </div>
    </div>
  );
};

// ─── Page ────────────────────────────────────────────────────────────────────
const KdsPage: React.FC = () => {
  const navigate = useNavigate();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canKds = hasPermission(PERMISSIONS.pos.kds);

  const [params, setParams] = useSearchParams();
  const stationParam = params.get('station') || localStorage.getItem('kds.station') || 'all';
  const [station, setStation] = useState<string>(stationParam);
  const [layout, setLayout] = useState<Layout>((localStorage.getItem('kds.layout') as Layout) || 'columns');
  const [muted, setMuted] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const lastActiveRef = useRef(0);
  const lastUrgentRef = useRef(0);
  const audioCtxRef = useRef<AudioContext | null>(null);

  const { data: stations = [] } = useKitchenStations();
  const stationFilter = station === 'all' ? undefined : station;
  const { data: tickets = [] } = useKdsTickets(stationFilter, 2_000);
  const transition = useKdsTransition();
  const bulk = useKdsBulkTransition();
  const setPriority = useKdsSetPriority();

  useEffect(() => {
    localStorage.setItem('kds.station', station);
    const next = new URLSearchParams(params);
    if (station === 'all') next.delete('station'); else next.set('station', station);
    setParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [station]);
  useEffect(() => { localStorage.setItem('kds.layout', layout); }, [layout]);

  const beep = (freq: number, times = 1) => {
    if (muted) return;
    try {
      if (!audioCtxRef.current) audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      const ctx = audioCtxRef.current!;
      for (let i = 0; i < times; i++) {
        const o = ctx.createOscillator(); const g = ctx.createGain();
        o.connect(g); g.connect(ctx.destination);
        const t0 = ctx.currentTime + i * 0.18;
        o.frequency.value = freq;
        g.gain.setValueAtTime(0, t0);
        g.gain.linearRampToValueAtTime(0.2, t0 + 0.04);
        g.gain.linearRampToValueAtTime(0, t0 + 0.15);
        o.start(t0); o.stop(t0 + 0.16);
      }
    } catch { /* noop */ }
  };

  // Chime on new tickets; urgent double-beep when a rush/vip is waiting.
  useEffect(() => {
    const active = tickets.filter((t) => t.status === 'new' || t.status === 'ready').length;
    const urgent = tickets.filter((t) => (t.priority === 'rush' || t.priority === 'vip') && (t.status === 'new' || t.status === 'preparing')).length;
    if (active > lastActiveRef.current) beep(880, 1);
    if (urgent > lastUrgentRef.current) beep(1200, 2);
    lastActiveRef.current = active; lastUrgentRef.current = urgent;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tickets, muted]);

  const doAction = (ticketId: string, action: KdsAction) => {
    let reason: string | undefined;
    if (action === 'recall') {
      const r = window.prompt(`Recall reason?\nOptions: ${RECALL_REASONS.join(', ')}`, RECALL_REASONS[0]);
      if (r === null) return;
      reason = r || undefined;
    }
    transition.mutate({ ticketId, action, reason });
  };
  const cyclePriority = (t: KdsTicketFE) => setPriority.mutate({ ticketId: t.id, priority: nextPriority[t.priority] });
  const toggleSelect = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const runBulk = (action: KdsAction) => {
    if (selected.size === 0) return;
    let reason: string | undefined;
    if (action === 'recall') { const r = window.prompt(`Recall reason?\nOptions: ${RECALL_REASONS.join(', ')}`, RECALL_REASONS[0]); if (r === null) return; reason = r || undefined; }
    bulk.mutate({ ids: [...selected], action, reason }, { onSuccess: () => setSelected(new Set()) });
  };

  // Priority-first, then oldest-first ordering.
  const prioRank: Record<KdsPriorityFE, number> = { vip: 0, rush: 1, normal: 2 };
  const sortTickets = (arr: KdsTicketFE[]) =>
    [...arr].sort((a, b) => prioRank[a.priority] - prioRank[b.priority] || new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

  const live = tickets.filter((t) => t.status !== 'cancelled' && t.status !== 'served');
  const activeCount = tickets.filter((t) => t.status === 'new' || t.status === 'preparing').length;

  // Per-station capacity badges (from the unfiltered "all" view only).
  const stationLoad = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of tickets) if (t.status === 'new' || t.status === 'preparing') m.set(t.station, (m.get(t.station) ?? 0) + 1);
    return m;
  }, [tickets]);
  const loadColor = (n: number) => (n >= 8 ? 'bg-rose-500' : n >= 4 ? 'bg-amber-500' : 'bg-emerald-500');

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));
  const handleDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over) return;
    const t = tickets.find((x) => x.id === active.id);
    if (!t) return;
    const target = String(over.id);
    let action: KdsAction | null = null;
    if (target === 'preparing') action = t.status === 'new' ? 'start' : t.status === 'ready' ? 'recall' : null;
    else if (target === 'ready') action = t.status === 'preparing' ? 'ready' : null;
    if (action) doAction(t.id, action);
  };

  if (!canKds) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center text-center">
        <div>
          <ChefHat className="h-12 w-12 mx-auto mb-3 text-slate-300" />
          <p className="text-lg font-semibold">Access denied</p>
          <p className="text-sm text-muted-foreground">You need the Kitchen Display permission (pos:kds).</p>
        </div>
      </div>
    );
  }

  const renderCard = (t: KdsTicketFE, opts?: { tv?: boolean; select?: boolean; drag?: boolean }) => (
    <TicketCard
      key={t.id}
      ticket={t}
      pending={transition.isPending}
      tv={opts?.tv}
      draggableId={opts?.drag ? t.id : undefined}
      selected={selected.has(t.id)}
      onToggleSelect={opts?.select ? () => toggleSelect(t.id) : undefined}
      onAction={(a) => doAction(t.id, a)}
      onCyclePriority={() => cyclePriority(t)}
    />
  );

  return (
    <div className="pos-reports-shell" style={{ minHeight: '100vh' }}>
      {/* Header */}
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" onClick={() => navigate('/pos/terminal')}>
            <ArrowLeft className="h-4 w-4 mr-1" /> Back
          </Button>
          <h1 className="text-2xl font-extrabold flex items-center gap-2"><ChefHat className="h-6 w-6" /> KDS</h1>
          <span className="text-sm text-slate-500">{activeCount} active</span>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Station tabs */}
          <div className="flex gap-1 flex-wrap">
            <Button variant={station === 'all' ? 'default' : 'outline'} size="sm" onClick={() => setStation('all')}>All</Button>
            {stations.filter((s) => s.isActive).map((s) => {
              const load = stationLoad.get(s.code) ?? 0;
              return (
                <Button key={s.id} variant={station === s.code ? 'default' : 'outline'} size="sm" onClick={() => setStation(s.code)}
                  style={station === s.code ? { background: s.color ?? '#334155', color: 'white' } : {}}>
                  {s.name}
                  {load > 0 && <span className={`ml-1.5 text-[10px] text-white rounded-full px-1.5 ${loadColor(load)}`}>{load}</span>}
                </Button>
              );
            })}
          </div>
          {/* Layout switcher */}
          <div className="flex gap-1">
            {LAYOUTS.map((l) => (
              <Button key={l.id} variant={layout === l.id ? 'default' : 'outline'} size="sm" onClick={() => setLayout(l.id)} title={l.label}>
                <l.icon className="h-4 w-4" />
              </Button>
            ))}
          </div>
          <Button variant="outline" size="sm" onClick={() => setMuted((m) => !m)}>
            {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
          </Button>
        </div>
      </div>

      {/* Batch action bar */}
      {selected.size > 0 && (
        <div className="flex items-center gap-2 mb-3 p-2 rounded-lg bg-sky-50 border border-sky-200">
          <span className="text-sm font-semibold text-sky-800">{selected.size} selected</span>
          <Button size="sm" onClick={() => runBulk('start')} style={{ background: '#f59e0b' }}>Start</Button>
          <Button size="sm" onClick={() => runBulk('ready')} style={{ background: '#16a34a' }}><CheckCheck className="h-3.5 w-3.5 mr-1" /> Ready</Button>
          <Button size="sm" onClick={() => runBulk('serve')} style={{ background: '#0f172a' }}>Served</Button>
          <Button size="sm" variant="outline" onClick={() => setSelected(new Set())}>Clear</Button>
        </div>
      )}

      {/* Body */}
      {live.length === 0 && layout !== 'expo' ? (
        <EmptyState />
      ) : layout === 'columns' ? (
        <DndContext sensors={sensors} collisionDetection={closestCorners} onDragEnd={handleDragEnd}>
          <div className="flex gap-3 overflow-x-auto pb-4">
            {COLUMNS.map((col) => {
              const colTickets = sortTickets(live.filter((t) => t.status === col.status));
              return (
                <DroppableColumn key={col.id} id={col.id} title={col.title} count={colTickets.length}>
                  {colTickets.map((t) => renderCard(t, { drag: true, select: true }))}
                </DroppableColumn>
              );
            })}
          </div>
        </DndContext>
      ) : layout === 'expo' ? (
        (() => {
          const ready = sortTickets(tickets.filter((t) => t.status === 'ready'));
          return ready.length === 0 ? <EmptyState label="Nothing waiting for pickup." /> : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
              {ready.map((t) => renderCard(t, { tv: true }))}
            </div>
          );
        })()
      ) : layout === 'queue' ? (
        <div className="max-w-2xl mx-auto space-y-3">
          {sortTickets(live).map((t) => renderCard(t, { select: true }))}
        </div>
      ) : layout === 'tv' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 text-lg">
          {sortTickets(live).map((t) => renderCard(t, { tv: true }))}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {sortTickets(live).map((t) => renderCard(t, { select: true }))}
        </div>
      )}
    </div>
  );
};

const EmptyState: React.FC<{ label?: string }> = ({ label = 'No active tickets.' }) => (
  <div className="flex-1 flex items-center justify-center text-slate-400 py-20">
    <div className="text-center">
      <ChefHat className="h-12 w-12 mx-auto mb-3 opacity-50" />
      <p className="text-lg font-semibold">All caught up!</p>
      <p className="text-sm">{label}</p>
    </div>
  </div>
);

export default KdsPage;
