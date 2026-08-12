import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PaginatedResult } from '@erp/shared';
import { api } from '@/lib/api';

export interface Uom {
  id: string;
  code: string;
  name: string;
  symbol: string | null;
  categoryId: string | null;
  category: string;
  factor: string;
  roundingPrecision: string;
  uomType: string;
  isBase: boolean;
  isActive: boolean;
}

export interface UomCategory {
  id: string;
  name: string;
  referenceUomId: string | null;
  isActive: boolean;
}

export interface UomInput {
  code: string;
  name: string;
  symbol?: string;
  categoryId?: string;
  factor?: number;
  roundingPrecision?: number;
  uomType?: string;
  isBase?: boolean;
  isActive?: boolean;
}

export interface UomCategoryInput {
  name: string;
  referenceUomId?: string;
  isActive?: boolean;
}

export function useUoms() {
  return useQuery({
    queryKey: ['uoms'],
    queryFn: async () => (await api.get<PaginatedResult<Uom>>('/uoms', { params: { pageSize: 500 } })).data?.data ?? [],
  });
}

export function useUomCategories() {
  return useQuery({
    queryKey: ['uom-categories'],
    queryFn: async () =>
      (await api.get<PaginatedResult<UomCategory>>('/uom-categories', { params: { pageSize: 200 } })).data?.data ?? [],
  });
}

export function useSaveUom() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id?: string; data: UomInput | Partial<UomInput> }) =>
      id ? (await api.patch<Uom>(`/uoms/${id}`, data)).data : (await api.post<Uom>('/uoms', data)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['uoms'] }),
  });
}

export function useSaveUomCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id?: string; data: UomCategoryInput | Partial<UomCategoryInput> }) =>
      id
        ? (await api.patch<UomCategory>(`/uom-categories/${id}`, data)).data
        : (await api.post<UomCategory>('/uom-categories', data)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['uom-categories'] }),
  });
}

export function useDeleteUom() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => (await api.delete(`/uoms/${id}`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['uoms'] }),
  });
}

export function useDeleteUomCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => (await api.delete(`/uom-categories/${id}`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['uom-categories'] }),
  });
}
