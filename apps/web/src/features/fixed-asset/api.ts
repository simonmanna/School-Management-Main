import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PaginatedResult } from '@erp/shared';
import { api } from '@/lib/api';
import type { Asset, AssetCategory, AssetAcquisition, AssetAssignment, AssetTransfer, AssetDepreciation, AssetMaintenance, AssetWarranty, AssetDisposal } from './types';

// ---- Categories ----
export function useAssetCategories(params?: { page?: number; pageSize?: number }) {
  return useQuery({
    queryKey: ['asset-categories', params],
    queryFn: async () => (await api.get<PaginatedResult<AssetCategory>>('/asset-categories', { params })).data,
  });
}

export function useAllAssetCategories() {
  return useQuery({
    queryKey: ['asset-categories', 'all'],
    queryFn: async () => (await api.get<AssetCategory[]>('/asset-categories/all')).data,
  });
}

export function useCreateAssetCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: Partial<AssetCategory>) => (await api.post<AssetCategory>('/asset-categories', input)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['asset-categories'] }),
  });
}

export function useUpdateAssetCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<AssetCategory> }) =>
      (await api.patch<AssetCategory>(`/asset-categories/${id}`, data)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['asset-categories'] }),
  });
}

export function useDeleteAssetCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => api.delete(`/asset-categories/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['asset-categories'] }),
  });
}

// ---- Assets ----
export function useAssets(params: Record<string, any>) {
  return useQuery({
    queryKey: ['fixed-assets', params],
    queryFn: async () => (await api.get<PaginatedResult<Asset>>('/fixed-assets', { params })).data,
  });
}

export function useAsset(id: string) {
  return useQuery({
    queryKey: ['fixed-asset', id],
    queryFn: async () => (await api.get<Asset & { category: AssetCategory | null; acquisition: AssetAcquisition | null; assignments: AssetAssignment[]; transfers: AssetTransfer[]; depreciations: AssetDepreciation[]; maintenanceLogs: AssetMaintenance[]; warranties: AssetWarranty[]; disposals: AssetDisposal[] }>(`/fixed-assets/${id}`)).data,
    enabled: !!id,
  });
}

export function useCreateAsset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: Record<string, any>) => (await api.post<Asset>('/fixed-assets', input)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['fixed-assets'] }),
  });
}

export function useUpdateAsset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Record<string, any> }) =>
      (await api.patch<Asset>(`/fixed-assets/${id}`, data)).data,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['fixed-assets'] }); qc.invalidateQueries({ queryKey: ['fixed-asset'] }); },
  });
}

export function useDeleteAsset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => api.delete(`/fixed-assets/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['fixed-assets'] }),
  });
}

export function useSearchAssets(q: string) {
  return useQuery({
    queryKey: ['fixed-assets', 'search', q],
    queryFn: async () => (await api.get<Asset[]>('/fixed-assets/search', { params: { q } })).data,
    enabled: q.length > 1,
  });
}

export function useAssetDashboard() {
  return useQuery({
    queryKey: ['fixed-assets', 'dashboard'],
    queryFn: async () => (await api.get<any>('/fixed-assets/dashboard')).data,
  });
}

// ---- Dashboard ----
export function useAssetDashboardSummary() {
  return useQuery({
    queryKey: ['fixed-assets-dashboard', 'summary'],
    queryFn: async () => (await api.get<any>('/fixed-assets-dashboard/summary')).data,
  });
}

export function useAssetDashboardUpcoming() {
  return useQuery({
    queryKey: ['fixed-assets-dashboard', 'upcoming'],
    queryFn: async () => (await api.get<any>('/fixed-assets-dashboard/upcoming')).data,
  });
}

export function useAssetReports(type: string) {
  return useQuery({
    queryKey: ['fixed-assets-dashboard', 'reports', type],
    queryFn: async () => (await api.get<any>(`/fixed-assets-dashboard/reports/${type}`)).data,
  });
}

// ---- Acquisition ----
export function useAssetAcquisition(assetId: string) {
  return useQuery({
    queryKey: ['fixed-asset', assetId, 'acquisition'],
    queryFn: async () => (await api.get<AssetAcquisition>(`/fixed-assets/${assetId}/acquisition`)).data,
    enabled: !!assetId,
  });
}

export function useUpsertAcquisition() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ assetId, data }: { assetId: string; data: Record<string, any> }) =>
      (await api.post(`/fixed-assets/${assetId}/acquisition`, data)).data,
    onSuccess: (_, { assetId }) => qc.invalidateQueries({ queryKey: ['fixed-asset', assetId] }),
  });
}

// ---- Assignments ----
export function useAssetAssignments(assetId: string) {
  return useQuery({
    queryKey: ['fixed-asset', assetId, 'assignments'],
    queryFn: async () => (await api.get<AssetAssignment[]>(`/fixed-assets/${assetId}/assignments`)).data,
    enabled: !!assetId,
  });
}

export function useCreateAssignment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ assetId, data }: { assetId: string; data: Record<string, any> }) =>
      (await api.post(`/fixed-assets/${assetId}/assignments`, data)).data,
    onSuccess: (_, { assetId }) => qc.invalidateQueries({ queryKey: ['fixed-asset', assetId] }),
  });
}

// ---- Transfers ----
export function useAssetTransfers(assetId: string) {
  return useQuery({
    queryKey: ['fixed-asset', assetId, 'transfers'],
    queryFn: async () => (await api.get<AssetTransfer[]>(`/fixed-assets/${assetId}/transfers`)).data,
    enabled: !!assetId,
  });
}

export function useCreateTransfer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ assetId, data }: { assetId: string; data: Record<string, any> }) =>
      (await api.post(`/fixed-assets/${assetId}/transfers`, data)).data,
    onSuccess: (_, { assetId }) => qc.invalidateQueries({ queryKey: ['fixed-asset', assetId] }),
  });
}

// ---- Depreciation ----
export function useAssetDepreciation(assetId: string) {
  return useQuery({
    queryKey: ['fixed-asset', assetId, 'depreciation'],
    queryFn: async () => (await api.get<AssetDepreciation[]>(`/fixed-assets/${assetId}/depreciation`)).data,
    enabled: !!assetId,
  });
}

export function useRunDepreciation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: { period: string; postEntries?: boolean; assetId?: string }) =>
      (await api.post('/fixed-assets/depreciation/run', data)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['fixed-asset'] }),
  });
}

// ---- Maintenance ----
export function useAssetMaintenance(assetId: string) {
  return useQuery({
    queryKey: ['fixed-asset', assetId, 'maintenance'],
    queryFn: async () => (await api.get<AssetMaintenance[]>(`/fixed-assets/${assetId}/maintenance`)).data,
    enabled: !!assetId,
  });
}

export function useCreateMaintenance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ assetId, data }: { assetId: string; data: Record<string, any> }) =>
      (await api.post(`/fixed-assets/${assetId}/maintenance`, data)).data,
    onSuccess: (_, { assetId }) => qc.invalidateQueries({ queryKey: ['fixed-asset', assetId] }),
  });
}

// ---- Warranty ----
export function useAssetWarranties(assetId: string) {
  return useQuery({
    queryKey: ['fixed-asset', assetId, 'warranties'],
    queryFn: async () => (await api.get<AssetWarranty[]>(`/fixed-assets/${assetId}/warranties`)).data,
    enabled: !!assetId,
  });
}

export function useCreateWarranty() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ assetId, data }: { assetId: string; data: Record<string, any> }) =>
      (await api.post(`/fixed-assets/${assetId}/warranties`, data)).data,
    onSuccess: (_, { assetId }) => qc.invalidateQueries({ queryKey: ['fixed-asset', assetId] }),
  });
}

// ---- Disposal ----
export function useAssetDisposal(assetId: string) {
  return useQuery({
    queryKey: ['fixed-asset', assetId, 'disposal'],
    queryFn: async () => (await api.get<AssetDisposal>(`/fixed-assets/${assetId}/disposal`)).data,
    enabled: !!assetId,
  });
}

export function useCreateDisposal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ assetId, data }: { assetId: string; data: Record<string, any> }) =>
      (await api.post(`/fixed-assets/${assetId}/disposal`, data)).data,
    onSuccess: (_, { assetId }) => qc.invalidateQueries({ queryKey: ['fixed-asset', assetId] }),
  });
}


