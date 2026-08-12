/**
 * Tables — Reservations page. List + create + seat + cancel + no-show.
 * Filters by date + status. Optimistic invalidation via TanStack mutations.
 */
import React, { useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  CalendarPlus, RefreshCw, Check, X, Pencil, Eye,
  CalendarClock,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  useCancelReservation,
  useCreateReservation,
  useNoShowReservation,
  useReservations,
  useSeatReservation,
  useTables,
  useTableZones,
  useUpdateReservation,
} from '@/features/tables/api';
import type {
  CreateReservationInput,
  PosTableReservationFE,
} from '@/features/tables/types';
import {
  RESERVATION_STATUS_COLOR,
  RESERVATION_STATUS_LABEL,
  zoneLabel,
} from '@/features/tables/utils';

interface FormState {
  tableId: string;
  customerName: string;
  phone: string;
  email: string;
  partySize: number;
  startAt: string; // datetime-local string
  endAt: string;
  notes: string;
}

const EMPTY_FORM: FormState = {
  tableId: '',
  customerName: '',
  phone: '',
  email: '',
  partySize: 2,
  startAt: '',
  endAt: '',
  notes: '',
};

function toIso(local: string): string {
  if (!local) return '';
  return new Date(local).toISOString();
}

export const ReservationsPage: React.FC = () => {
  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState<string>(today);
  const [status, setStatus] = useState<string>('all');
  const { data: reservations = [], isLoading, refetch } = useReservations({ date, status });
  const { data: tables = [] } = useTables({ active: true });
  const { data: zones = [] } = useTableZones();
  const create = useCreateReservation();
  const update = useUpdateReservation();
  const seat = useSeatReservation();
  const cancel = useCancelReservation();
  const noShow = useNoShowReservation();

  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<PosTableReservationFE | null>(null);
  const [cancelTarget, setCancelTarget] = useState<PosTableReservationFE | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);

  const tableMap = useMemo(() => {
    const m = new Map<string, typeof tables[number]>();
    for (const t of tables) m.set(t.id, t);
    return m;
  }, [tables]);

  function openCreate() {
    const start = new Date();
    start.setMinutes(0, 0, 0);
    const end = new Date(start.getTime() + 90 * 60_000);
    setForm({
      ...EMPTY_FORM,
      startAt: toLocal(start),
      endAt: toLocal(end),
      tableId: tables[0]?.id ?? '',
    });
    setCreateOpen(true);
  }

  function openEdit(r: PosTableReservationFE) {
    setEditTarget(r);
    setForm({
      tableId: r.tableId,
      customerName: r.customerName,
      phone: r.phone ?? '',
      email: r.email ?? '',
      partySize: r.partySize,
      startAt: toLocal(new Date(r.startAt)),
      endAt: toLocal(new Date(r.endAt)),
      notes: r.notes ?? '',
    });
  }

  async function submitCreate() {
    if (!form.tableId || !form.customerName.trim()) {
      toast.error('Table and customer name are required');
      return;
    }
    const body: CreateReservationInput = {
      tableId: form.tableId,
      customerName: form.customerName.trim(),
      phone: form.phone.trim() || undefined,
      email: form.email.trim() || undefined,
      partySize: Math.max(1, Number(form.partySize ?? 2)),
      startAt: toIso(form.startAt),
      endAt: toIso(form.endAt),
      notes: form.notes.trim() || undefined,
    };
    try {
      await create.mutateAsync(body);
      toast.success('Reservation created');
      setCreateOpen(false);
    } catch (e: any) {
      toast.error(e?.response?.data?.message ?? 'Failed to create reservation');
    }
  }

  async function submitEdit() {
    if (!editTarget) return;
    try {
      await update.mutateAsync({
        id: editTarget.id,
        body: {
          customerName: form.customerName.trim(),
          phone: form.phone.trim() || undefined,
          email: form.email.trim() || undefined,
          partySize: Math.max(1, Number(form.partySize ?? 2)),
          startAt: toIso(form.startAt),
          endAt: toIso(form.endAt),
          notes: form.notes.trim() || undefined,
        },
      });
      toast.success('Reservation updated');
      setEditTarget(null);
    } catch (e: any) {
      toast.error(e?.response?.data?.message ?? 'Failed to update reservation');
    }
  }

  async function doSeat(r: PosTableReservationFE) {
    try {
      await seat.mutateAsync({ id: r.id });
      toast.success(`${r.customerName} seated`);
    } catch (e: any) {
      toast.error(e?.response?.data?.message ?? 'Seat failed');
    }
  }

  async function doCancel() {
    if (!cancelTarget) return;
    try {
      await cancel.mutateAsync(cancelTarget.id);
      toast.success('Reservation cancelled');
      setCancelTarget(null);
    } catch (e: any) {
      toast.error(e?.response?.data?.message ?? 'Cancel failed');
    }
  }

  async function doNoShow(r: PosTableReservationFE) {
    try {
      await noShow.mutateAsync(r.id);
      toast.success('Marked no-show');
    } catch (e: any) {
      toast.error(e?.response?.data?.message ?? 'No-show failed');
    }
  }

  return (
    <div className="page-wrap space-y-6">
      {/* ── Hero ── */}
      <div className="page-hero hero-strip">
        <div className="page-hero-inner">
          <div className="flex items-center gap-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white/20 backdrop-blur-md border border-white/30 text-2xl">
              <CalendarClock className="h-7 w-7" />
            </div>
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.16em] text-white/70">
                Restaurant
              </div>
              <div className="text-2xl md:text-3xl font-extrabold tracking-tight">
                Reservations
              </div>
              <div className="text-sm text-white/80 mt-0.5">
                Bookings, parties and no-shows — at a glance.
              </div>
            </div>
          </div>
          <Button
            onClick={openCreate}
            className="bg-white text-blue-700 hover:bg-white/90 btn-shine shadow-lg"
          >
            <CalendarPlus className="w-4 h-4 mr-1.5" /> New reservation
          </Button>
        </div>
      </div>

      {/* ── Filters ── */}
      <div className="glass-card p-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <label className="section-title flex items-center gap-1.5">
            <CalendarClock className="w-3 h-3" /> Date
          </label>
          <Input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="h-9 w-44"
          />
          <select
            className="h-9 px-3 rounded-lg border border-input bg-white text-sm focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="all">All statuses</option>
            {Object.entries(RESERVATION_STATUS_LABEL).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          <RefreshCw className="w-3 h-3 mr-1" /> Refresh
        </Button>
      </div>

      {/* ── List ── */}
      {isLoading ? (
        <div className="text-slate-400 py-10 text-center">Loading reservations…</div>
      ) : reservations.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-slate-400">
            No reservations for this filter.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {reservations.map((r) => {
            const t = r.table ?? tableMap.get(r.tableId);
            const color = RESERVATION_STATUS_COLOR[r.status] ?? 'bg-slate-100 text-slate-600';
            return (
              <Card key={r.id}>
                <CardContent className="p-4 flex flex-wrap items-center justify-between gap-3">
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-2">
                      <span className="font-extrabold text-slate-800">{r.customerName}</span>
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border ${color}`}
                      >
                        {RESERVATION_STATUS_LABEL[r.status] ?? r.status}
                      </span>
                    </div>
                    <div className="text-xs text-slate-500">
                      {new Date(r.startAt).toLocaleString([], {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      })}{' '}
                      – {new Date(r.endAt).toLocaleTimeString([], { timeStyle: 'short' })}{' '}
                      · {r.partySize} pax
                      {r.phone ? ` · ${r.phone}` : ''}
                    </div>
                    {t ? (
                      <div className="text-[11px] text-slate-500">
                        T{t.number} {t.name}
                        {(t as any).zone ? ` · ${zoneLabel(zones, (t as any).zone as string)}` : ''}
                      </div>
                    ) : null}
                    {r.notes ? (
                      <div className="text-[11px] italic text-slate-500 mt-1">"{r.notes}"</div>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {r.status === 'pending' ? (
                      <>
                        <Button
                          size="sm"
                          className="h-7 text-[11px] bg-emerald-600 hover:bg-emerald-700"
                          onClick={() => doSeat(r)}
                          disabled={seat.isPending}
                        >
                          <Check className="w-3 h-3 mr-1" /> Seat
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 text-[11px]"
                          onClick={() => doNoShow(r)}
                          disabled={noShow.isPending}
                        >
                          <Eye className="w-3 h-3 mr-1" /> No-show
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 text-[11px]"
                          onClick={() => openEdit(r)}
                        >
                          <Pencil className="w-3 h-3 mr-1" /> Edit
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 text-[11px] text-rose-600"
                          onClick={() => setCancelTarget(r)}
                        >
                          <X className="w-3 h-3 mr-1" /> Cancel
                        </Button>
                      </>
                    ) : null}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* ── Create / edit dialog ── */}
      <Dialog
        open={createOpen || !!editTarget}
        onOpenChange={(o) => {
          if (!o) {
            setCreateOpen(false);
            setEditTarget(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>
              {editTarget ? `Edit reservation` : 'New reservation'}
            </DialogTitle>
            <DialogDescription>
              Tables automatically flip to RESERVED 60 minutes before the
              booking and free up on cancel / no-show.
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Table" className="col-span-2">
              <select
                className="h-10 px-3 rounded-md border border-slate-200 bg-white text-sm"
                value={form.tableId}
                onChange={(e) => setForm((f) => ({ ...f, tableId: e.target.value }))}
                disabled={!!editTarget}
              >
                <option value="">Select table…</option>
                {tables.map((t) => (
                  <option key={t.id} value={t.id}>
                    T{t.number} {t.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Customer name" className="col-span-2">
              <Input
                value={form.customerName}
                onChange={(e) => setForm((f) => ({ ...f, customerName: e.target.value }))}
              />
            </Field>
            <Field label="Phone">
              <Input
                value={form.phone}
                onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
              />
            </Field>
            <Field label="Email">
              <Input
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              />
            </Field>
            <Field label="Party size">
              <Input
                type="number"
                min={1}
                value={form.partySize}
                onChange={(e) => setForm((f) => ({ ...f, partySize: Number(e.target.value) }))}
              />
            </Field>
            <Field label="Start">
              <Input
                type="datetime-local"
                value={form.startAt}
                onChange={(e) => setForm((f) => ({ ...f, startAt: e.target.value }))}
              />
            </Field>
            <Field label="End" className="col-span-2">
              <Input
                type="datetime-local"
                value={form.endAt}
                onChange={(e) => setForm((f) => ({ ...f, endAt: e.target.value }))}
              />
            </Field>
            <Field label="Notes" className="col-span-2">
              <Input
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              />
            </Field>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => { setCreateOpen(false); setEditTarget(null); }}>
              Cancel
            </Button>
            <Button
              onClick={editTarget ? submitEdit : submitCreate}
              disabled={create.isPending || update.isPending}
            >
              {editTarget ? 'Save changes' : 'Create reservation'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Cancel confirm ── */}
      <AlertDialog open={!!cancelTarget} onOpenChange={(o) => !o && setCancelTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel reservation?</AlertDialogTitle>
            <AlertDialogDescription>
              {cancelTarget?.customerName}'s booking will be marked cancelled and the table freed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep</AlertDialogCancel>
            <AlertDialogAction className="bg-rose-600 hover:bg-rose-700" onClick={doCancel}>
              Cancel reservation
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

const Field: React.FC<{ label: string; className?: string; children: React.ReactNode }> = ({
  label,
  className,
  children,
}) => (
  <div className={className}>
    <label className="block text-[11px] font-bold text-slate-600 uppercase tracking-wider mb-1">
      {label}
    </label>
    {children}
  </div>
);

function toLocal(d: Date): string {
  const tz = d.getTimezoneOffset() * 60_000;
  return new Date(d.getTime() - tz).toISOString().slice(0, 16);
}

export default ReservationsPage;