import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type {
  BillOrderInput, CreateOrderInput, ListResponse, Order, OrderDetail,
  OrderLineInput, OrderSettings, UpdateOrderHeaderInput,
} from './types';

const ORDER_PREFIX = ['orders'] as const;

/** Tiny UUID generator for the Idempotency-Key header (mirrors features/pos). */
function uuid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return (crypto as any).randomUUID();
  }
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

// ─── Settings ───────────────────────────────────────────────────────────────

export function useOrderSettings() {
  return useQuery({
    queryKey: [...ORDER_PREFIX, 'settings'],
    queryFn: async () => (await api.get<OrderSettings>('/orders/settings')).data,
  });
}

export function useUpdateOrderSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { lineSource: string }) =>
      (await api.patch<OrderSettings>('/orders/settings', input)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: [...ORDER_PREFIX, 'settings'] }),
  });
}

// ─── Queries ────────────────────────────────────────────────────────────────

export function useOrders(params: {
  page?: number;
  pageSize?: number;
  search?: string;
  status?: string;
  orderType?: string;
  transactionKind?: string;
  dateFrom?: string;
  dateTo?: string;
}) {
  return useQuery({
    queryKey: [...ORDER_PREFIX, params],
    queryFn: async () => (await api.get<ListResponse<Order>>('/orders', { params })).data,
  });
}

export function useOrder(id: string | undefined) {
  return useQuery({
    queryKey: [...ORDER_PREFIX, id],
    queryFn: async () => (await api.get<OrderDetail>(`/orders/${id}`)).data,
    enabled: !!id,
  });
}

// ─── Mutations ──────────────────────────────────────────────────────────────

export function useCreateOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateOrderInput) =>
      (await api.post<OrderDetail>('/orders', input, { headers: { 'Idempotency-Key': uuid() } })).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ORDER_PREFIX }),
  });
}

export function useUpdateOrderHeader() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, input }: { id: string; input: UpdateOrderHeaderInput }) =>
      (await api.patch<OrderDetail>(`/orders/${id}`, input)).data,
    onSuccess: (_d, { id }) => {
      qc.invalidateQueries({ queryKey: ORDER_PREFIX });
      qc.invalidateQueries({ queryKey: [...ORDER_PREFIX, id] });
    },
  });
}

export function useSaveOrderItems() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, input }: { id: string; input: { lines: OrderLineInput[]; expectedVersion?: number } }) =>
      (await api.put<OrderDetail>(`/orders/${id}/items`, input)).data,
    onSuccess: (_d, { id }) => {
      qc.invalidateQueries({ queryKey: ORDER_PREFIX });
      qc.invalidateQueries({ queryKey: [...ORDER_PREFIX, id] });
    },
  });
}

export function useAddOrderItems() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, input }: { id: string; input: { lines: OrderLineInput[] } }) =>
      (await api.post<OrderDetail>(`/orders/${id}/items`, input)).data,
    onSuccess: (_d, { id }) => {
      qc.invalidateQueries({ queryKey: ORDER_PREFIX });
      qc.invalidateQueries({ queryKey: [...ORDER_PREFIX, id] });
    },
  });
}

export function useCancelOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason?: string }) =>
      (await api.post<OrderDetail>(`/orders/${id}/cancel`, { reason })).data,
    onSuccess: (_d, { id }) => {
      qc.invalidateQueries({ queryKey: ORDER_PREFIX });
      qc.invalidateQueries({ queryKey: [...ORDER_PREFIX, id] });
    },
  });
}

export function useReopenOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) =>
      (await api.post<OrderDetail>(`/orders/${id}/reopen`)).data,
    onSuccess: (_d, id) => {
      qc.invalidateQueries({ queryKey: ORDER_PREFIX });
      qc.invalidateQueries({ queryKey: [...ORDER_PREFIX, id] });
    },
  });
}

export function useBillOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, input }: { id: string; input?: BillOrderInput }) =>
      (await api.post<OrderDetail>(`/orders/${id}/invoice`, input ?? {}, { headers: { 'Idempotency-Key': uuid() } })).data,
    onSuccess: (_d, { id }) => {
      qc.invalidateQueries({ queryKey: ORDER_PREFIX });
      qc.invalidateQueries({ queryKey: [...ORDER_PREFIX, id] });
    },
  });
}