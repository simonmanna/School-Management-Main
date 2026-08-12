import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
export { usePosTablesStream } from './sse';
import { api } from '@/lib/api';
import type {
  CreateReservationInput,
  CreateTableInput,
  PosTable,
  PosTableReservationFE,
  PosTableStats,
  PosTableZoneConfig,
  ReservationReport,
  RevenueReport,
  SplitBillInput,
  UpdateReservationInput,
  UpdateTableInput,
  UtilizationReport,
} from './types';

/** Small UUID generator for Idempotency-Key on money-mutating requests. */
function uuid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return (crypto as any).randomUUID();
  }
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

// ─── Zones (configurable dining areas / table categories) ───────────────────

export interface ZoneInput {
  key?: string;
  name: string;
  sortOrder?: number;
  color?: string;
  active?: boolean;
}

export function useTableZones() {
  return useQuery({
    queryKey: ['pos-tables', 'zones'],
    queryFn: async () => {
      const res = await api.get<PosTableZoneConfig[]>('/pos/tables/zones');
      return Array.isArray(res.data) ? res.data : [];
    },
    refetchInterval: 30_000,
  });
}

/** Archived (soft-deleted) zones — restore candidates for the management dialog. */
export function useDeletedZones() {
  return useQuery({
    queryKey: ['pos-tables', 'zones', 'deleted'],
    queryFn: async () => {
      const res = await api.get<PosTableZoneConfig[]>('/pos/tables/zones/deleted');
      return Array.isArray(res.data) ? res.data : [];
    },
  });
}

function invalidateZoneQueries(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ['pos-tables', 'zones'] });
  // Table lists carry enriched zoneName/zoneColor — refresh them too.
  qc.invalidateQueries({ queryKey: ['pos-tables'] });
}

export function useCreateZone() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: ZoneInput) =>
      (await api.post<PosTableZoneConfig>('/pos/tables/zones', body)).data,
    onSuccess: () => invalidateZoneQueries(qc),
  });
}

export function useUpdateZone() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { id: string; body: Partial<ZoneInput> }) =>
      (await api.patch<PosTableZoneConfig>(`/pos/tables/zones/${args.id}`, args.body)).data,
    onSuccess: () => invalidateZoneQueries(qc),
  });
}

export function useArchiveZone() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) =>
      (await api.delete<PosTableZoneConfig>(`/pos/tables/zones/${id}`)).data,
    onSuccess: () => invalidateZoneQueries(qc),
  });
}

export function useRestoreZone() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) =>
      (await api.patch<PosTableZoneConfig>(`/pos/tables/zones/${id}/restore`, {})).data,
    onSuccess: () => invalidateZoneQueries(qc),
  });
}

// ─── Tables ──────────────────────────────────────────────────────────────────

export function useTables(filter: { status?: string; zone?: string; active?: boolean } = {}) {
  return useQuery({
    queryKey: ['pos-tables', filter],
    queryFn: async () => {
      const params: Record<string, string | boolean> = {};
      if (filter.status) params.status = filter.status;
      if (filter.zone) params.zone = filter.zone;
      if (filter.active !== undefined) params.active = filter.active;
      const res = await api.get<PosTable[]>('/pos/tables', { params });
      return Array.isArray(res.data) ? res.data : [];
    },
    refetchInterval: 20_000,
  });
}

export function useTable(id: string | null) {
  return useQuery({
    queryKey: ['pos-tables', 'detail', id],
    queryFn: async () => {
      if (!id) return null;
      const res = await api.get<PosTable>(`/pos/tables/${id}`);
      return res.data;
    },
    enabled: !!id,
    refetchInterval: 15_000,
  });
}

export function useTableStats() {
  return useQuery({
    queryKey: ['pos-tables', 'stats'],
    queryFn: async () => (await api.get<PosTableStats>('/pos/tables/stats')).data,
    refetchInterval: 15_000,
  });
}

export function useCreateTable() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: CreateTableInput) =>
      (await api.post<PosTable>('/pos/tables', body, {
        headers: { 'Idempotency-Key': uuid() },
      })).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pos-tables'] });
      qc.invalidateQueries({ queryKey: ['pos-tables', 'stats'] });
    },
  });
}

export function useUpdateTable() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { id: string; body: UpdateTableInput }) =>
      (await api.patch<PosTable>(`/pos/tables/${args.id}`, args.body)).data,
    onSuccess: (_data, args) => {
      qc.invalidateQueries({ queryKey: ['pos-tables'] });
      qc.invalidateQueries({ queryKey: ['pos-tables', 'detail', args.id] });
      qc.invalidateQueries({ queryKey: ['pos-tables', 'stats'] });
    },
  });
}

export function useArchiveTable() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) =>
      (await api.delete<PosTable>(`/pos/tables/${id}`)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pos-tables'] });
      qc.invalidateQueries({ queryKey: ['pos-tables', 'stats'] });
    },
  });
}

export function useSetTableStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { id: string; status: string; reason?: string }) =>
      (await api.put<PosTable>(`/pos/tables/${args.id}/status`, {
        status: args.status,
        reason: args.reason,
      })).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pos-tables'] });
      qc.invalidateQueries({ queryKey: ['pos-tables', 'stats'] });
    },
  });
}

export function useAssignWaiter() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { id: string; waiterId: string | null }) =>
      (await api.post<PosTable>(`/pos/tables/${args.id}/assign-waiter`, {
        waiterId: args.waiterId,
      })).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pos-tables'] }),
  });
}

export function useMergeTables() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { sourceId: string; targetId: string }) =>
      (await api.post<unknown>(`/pos/tables/${args.sourceId}/merge/${args.targetId}`, {}, {
        headers: { 'Idempotency-Key': uuid() },
      })).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pos-tables'] });
      qc.invalidateQueries({ queryKey: ['pos-tables', 'stats'] });
    },
  });
}

export function useUnmergeTable() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) =>
      (await api.post<unknown>(`/pos/tables/${id}/unmerge`, {}, {
        headers: { 'Idempotency-Key': uuid() },
      })).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pos-tables'] });
      qc.invalidateQueries({ queryKey: ['pos-tables', 'stats'] });
    },
  });
}

export function useTransferTable() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { sourceId: string; targetId: string; orderIds?: string[] }) =>
      (await api.post<unknown>(`/pos/tables/${args.sourceId}/transfer/${args.targetId}`, {
        orderIds: args.orderIds,
      }, {
        headers: { 'Idempotency-Key': uuid() },
      })).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pos-tables'] });
      qc.invalidateQueries({ queryKey: ['pos-tables', 'stats'] });
    },
  });
}

/**
 * Item-level transfer: move selected lines (with optional partial quantities)
 * from one table's draft order into another's. Works into an occupied table.
 */
export function useTransferItems() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { sourceId: string; targetId: string; items: Array<{ lineId: string; quantity: number }> }) =>
      (await api.post<unknown>(`/pos/tables/${args.sourceId}/transfer-items/${args.targetId}`, { items: args.items }, {
        headers: { 'Idempotency-Key': uuid() },
      })).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pos-tables'] });
      qc.invalidateQueries({ queryKey: ['pos-tables', 'stats'] });
      qc.invalidateQueries({ queryKey: ['pos-tab'] });
    },
  });
}

export function useSplitBill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { tableId: string; body: SplitBillInput }) =>
      (await api.post<unknown>(`/pos/tables/${args.tableId}/split-bill`, args.body, {
        headers: { 'Idempotency-Key': uuid() },
      })).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pos-tables'] }),
  });
}

// ─── Reservations ────────────────────────────────────────────────────────────

export function useReservations(filter: { date?: string; status?: string; tableId?: string } = {}) {
  return useQuery({
    queryKey: ['pos-reservations', filter],
    queryFn: async () => {
      const params: Record<string, string> = {};
      if (filter.date) params.date = filter.date;
      if (filter.status) params.status = filter.status;
      if (filter.tableId) params.tableId = filter.tableId;
      const res = await api.get<PosTableReservationFE[]>('/pos/reservations', { params });
      return res.data;
    },
    refetchInterval: 15_000,
  });
}

export function useReservation(id: string | null) {
  return useQuery({
    queryKey: ['pos-reservations', 'detail', id],
    queryFn: async () => {
      if (!id) return null;
      const res = await api.get<PosTableReservationFE>(`/pos/reservations/${id}`);
      return res.data;
    },
    enabled: !!id,
  });
}

export function useCreateReservation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: CreateReservationInput) =>
      (await api.post<PosTableReservationFE>('/pos/reservations', body)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pos-reservations'] });
      qc.invalidateQueries({ queryKey: ['pos-tables'] });
      qc.invalidateQueries({ queryKey: ['pos-tables', 'stats'] });
    },
  });
}

export function useUpdateReservation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { id: string; body: UpdateReservationInput }) =>
      (await api.patch<PosTableReservationFE>(`/pos/reservations/${args.id}`, args.body)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pos-reservations'] }),
  });
}

export function useSeatReservation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { id: string; orderId?: string }) =>
      (await api.post<PosTableReservationFE>(`/pos/reservations/${args.id}/seat`, {
        orderId: args.orderId,
      })).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pos-reservations'] });
      qc.invalidateQueries({ queryKey: ['pos-tables'] });
      qc.invalidateQueries({ queryKey: ['pos-tables', 'stats'] });
    },
  });
}

export function useCancelReservation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) =>
      (await api.post<PosTableReservationFE>(`/pos/reservations/${id}/cancel`, {})).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pos-reservations'] });
      qc.invalidateQueries({ queryKey: ['pos-tables'] });
      qc.invalidateQueries({ queryKey: ['pos-tables', 'stats'] });
    },
  });
}

export function useNoShowReservation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) =>
      (await api.post<PosTableReservationFE>(`/pos/reservations/${id}/no-show`, {})).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pos-reservations'] });
      qc.invalidateQueries({ queryKey: ['pos-tables'] });
    },
  });
}

export function useCompleteReservation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) =>
      (await api.post<PosTableReservationFE>(`/pos/reservations/${id}/complete`, {})).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pos-reservations'] }),
  });
}

// ─── Reports ─────────────────────────────────────────────────────────────────

export function useUtilizationReport(date: string) {
  return useQuery({
    queryKey: ['pos-tables-reports', 'utilization', date],
    queryFn: async () =>
      (await api.get<UtilizationReport>('/pos/reports/tables/utilization', { params: { date } })).data,
    enabled: !!date,
  });
}

export function useRevenueReport(fromDate: string, toDate: string) {
  return useQuery({
    queryKey: ['pos-tables-reports', 'revenue', fromDate, toDate],
    queryFn: async () =>
      (await api.get<RevenueReport>('/pos/reports/tables/revenue', { params: { fromDate, toDate } })).data,
    enabled: !!fromDate && !!toDate,
  });
}

export function useReservationReport(fromDate: string, toDate: string) {
  return useQuery({
    queryKey: ['pos-tables-reports', 'reservations', fromDate, toDate],
    queryFn: async () =>
      (await api.get<ReservationReport>('/pos/reports/reservations', { params: { fromDate, toDate } })).data,
    enabled: !!fromDate && !!toDate,
  });
}