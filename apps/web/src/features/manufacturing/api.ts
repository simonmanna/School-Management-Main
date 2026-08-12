import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { Bom, CreateBomInput, CreateProductionOrderInput, ProductionOrder } from './types';

// ---- BOMs ----
export function useBoms(params: { outputProductId?: string; status?: string } = {}) {
  return useQuery({
    queryKey: ['boms', params],
    queryFn: async () => (await api.get<Bom[]>('/manufacturing/boms', { params })).data,
  });
}

export function useBom(id: string) {
  return useQuery({
    queryKey: ['bom', id],
    queryFn: async () => (await api.get<Bom>(`/manufacturing/boms/${id}`)).data,
    enabled: !!id,
  });
}

export function useCreateBom() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateBomInput) => (await api.post<Bom>('/manufacturing/boms', input)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['boms'] }),
  });
}

export function useUpdateBom() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<CreateBomInput> }) =>
      (await api.patch<Bom>(`/manufacturing/boms/${id}`, data)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['boms'] });
      qc.invalidateQueries({ queryKey: ['bom'] });
    },
  });
}

export function useActivateBom() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => (await api.post<Bom>(`/manufacturing/boms/${id}/activate`, {})).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['boms'] }),
  });
}

export function useDeleteBom() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => api.delete(`/manufacturing/boms/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['boms'] }),
  });
}

// ---- Production orders ----
export function useProductionOrders(params: { status?: string; outputProductId?: string } = {}) {
  return useQuery({
    queryKey: ['production-orders', params],
    queryFn: async () => (await api.get<ProductionOrder[]>('/manufacturing/production-orders', { params })).data,
  });
}

export function useProductionOrder(id: string) {
  return useQuery({
    queryKey: ['production-order', id],
    queryFn: async () => (await api.get<ProductionOrder>(`/manufacturing/production-orders/${id}`)).data,
    enabled: !!id,
  });
}

export function useCreateProductionOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateProductionOrderInput) =>
      (await api.post<ProductionOrder>('/manufacturing/production-orders', input)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['production-orders'] }),
  });
}

/** confirm / start / complete / cancel / qc / reverse share one shape. */
export function useProductionAction(action: 'confirm' | 'start' | 'complete' | 'cancel' | 'qc' | 'reverse') {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, body }: { id: string; body?: Record<string, unknown> }) =>
      (await api.post<ProductionOrder>(`/manufacturing/production-orders/${id}/${action}`, body ?? {})).data,
    onSuccess: (_, { id }) => {
      qc.invalidateQueries({ queryKey: ['production-orders'] });
      qc.invalidateQueries({ queryKey: ['production-order', id] });
      qc.invalidateQueries({ queryKey: ['work-orders', id] });
    },
  });
}

// ---- Requests ----
export function useProductionRequests(status?: string) {
  return useQuery({
    queryKey: ['production-requests', status],
    queryFn: async () => (await api.get<any[]>('/manufacturing/requests', { params: { status } })).data,
  });
}
export function useCreateProductionRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: any) => (await api.post('/manufacturing/requests', input)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['production-requests'] }),
  });
}
export function useRequestAction(action: 'submit' | 'approve' | 'reject' | 'cancel') {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, body }: { id: string; body?: any }) =>
      (await api.post(`/manufacturing/requests/${id}/${action}`, body ?? {})).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['production-requests'] }),
  });
}

// ---- Plans ----
export function useProductionPlans(status?: string) {
  return useQuery({
    queryKey: ['production-plans', status],
    queryFn: async () => (await api.get<any[]>('/manufacturing/plans', { params: { status } })).data,
  });
}
export function useCreateProductionPlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: any) => (await api.post('/manufacturing/plans', input)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['production-plans'] }),
  });
}
export function usePlanAction(action: 'confirm' | 'cancel') {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => (await api.post(`/manufacturing/plans/${id}/${action}`, {})).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['production-plans'] });
      qc.invalidateQueries({ queryKey: ['production-orders'] });
    },
  });
}

// ---- MRP ----
export function useMrpAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ path, id }: { path: 'scan-min-stock' | 'run' | 'from-document'; id?: string }) =>
      (await api.post(`/manufacturing/mrp/${path === 'from-document' ? `from-document/${id}` : path}`, {})).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['production-requests'] });
    },
  });
}

// ---- Reports / analytics ----
export function useReport(name: string, params: Record<string, string | undefined> = {}, enabled = true) {
  return useQuery({
    queryKey: ['mfg-report', name, params],
    queryFn: async () => (await api.get<any>(`/manufacturing/reports/${name}`, { params })).data,
    enabled,
  });
}

// ---- Work centres / resources / routings ----
export function useWorkCenters() {
  return useQuery({ queryKey: ['work-centers'], queryFn: async () => (await api.get<any[]>('/manufacturing/work-centers')).data });
}
export function useResources(kind?: string) {
  return useQuery({ queryKey: ['resources', kind], queryFn: async () => (await api.get<any[]>('/manufacturing/resources', { params: { kind } })).data });
}
export function useRoutings() {
  return useQuery({ queryKey: ['routings'], queryFn: async () => (await api.get<any[]>('/manufacturing/routings')).data });
}
export function useCreateMaster(kind: 'work-centers' | 'resources' | 'routings') {
  const qc = useQueryClient();
  const key = kind === 'work-centers' ? 'work-centers' : kind;
  return useMutation({
    mutationFn: async (input: any) => (await api.post(`/manufacturing/${kind}`, input)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: [key] }),
  });
}

// ---- Work orders ----
export function useWorkOrders(orderId: string) {
  return useQuery({
    queryKey: ['work-orders', orderId],
    queryFn: async () => (await api.get<any[]>(`/manufacturing/production-orders/${orderId}/work-orders`)).data,
    enabled: !!orderId,
  });
}
export function useGenerateWorkOrders() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (orderId: string) => (await api.post(`/manufacturing/production-orders/${orderId}/work-orders/generate`, {})).data,
    onSuccess: (_, orderId) => qc.invalidateQueries({ queryKey: ['work-orders', orderId] }),
  });
}
export function useWorkOrderAction(action: 'start' | 'pause' | 'complete') {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, body }: { id: string; orderId: string; body?: any }) =>
      (await api.post(`/manufacturing/work-orders/${id}/${action}`, body ?? {})).data,
    onSuccess: (_, { orderId }) => {
      qc.invalidateQueries({ queryKey: ['work-orders', orderId] });
      qc.invalidateQueries({ queryKey: ['production-order', orderId] });
    },
  });
}
