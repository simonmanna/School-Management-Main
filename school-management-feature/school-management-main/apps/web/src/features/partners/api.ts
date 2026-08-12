import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PaginatedResult } from '@erp/shared';
import { api } from '@/lib/api';

export interface Partner {
  id: string;
  code: string;
  name: string;
  isCompany: boolean;
  isCustomer: boolean;
  isSupplier: boolean;
  isEmployee: boolean;
  email: string | null;
  phone: string | null;
  status: string;
  createdAt: string;
}

export interface ListParams {
  page: number;
  pageSize: number;
  search?: string;
}

export interface CreatePartnerInput {
  code: string;
  name: string;
  email?: string;
  isCustomer?: boolean;
  isSupplier?: boolean;
}

export function usePartners(params: ListParams) {
  return useQuery({
    queryKey: ['partners', params],
    queryFn: async () => (await api.get<PaginatedResult<Partner>>('/partners', { params })).data,
  });
}

export function useCreatePartner() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreatePartnerInput) =>
      (await api.post<Partner>('/partners', input)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['partners'] }),
  });
}
