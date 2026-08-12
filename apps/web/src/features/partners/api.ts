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
  website: string | null;
  taxNumber: string | null;
  membershipLevel: string | null;
  gender: string | null;
  notes: string | null;
  status: string;
  categoryId: string | null;
  category?: { id: string; name: string } | null;
  createdAt: string;
  updatedAt: string;
  loyaltyEarned?: number;
  contacts?: Array<{ id: string; firstName: string; lastName: string | null; position: string | null; email: string | null; phone: string | null; isPrimary: boolean }>;
  addresses?: Array<{ id: string; type: string; line1: string; line2: string | null; city: string | null; state: string | null; postalCode: string | null; country: string | null; isPrimary: boolean }>;
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
  phone?: string;
  membershipLevel?: string;
  gender?: string;
  isCustomer?: boolean;
  isSupplier?: boolean;
  contacts?: Array<Record<string, unknown>>;
  addresses?: Array<Record<string, unknown>>;
}

export function usePartners(params: ListParams, options?: { enabled?: boolean }) {
  return useQuery({
    ...options,
    queryKey: ['partners', params],
    queryFn: async () => (await api.get<PaginatedResult<Partner>>('/partners', { params })).data,
  });
}

export function usePartner(id: string | undefined) {
  return useQuery({
    queryKey: ['partner', id],
    queryFn: async () => (await api.get<Partner>(`/partners/${id}`)).data,
    enabled: !!id,
  });
}

export interface CustomerStatementEntry {
  date: string;
  type: 'credit_issue' | 'payment' | 'write_off';
  reference: string;
  invoiceId: string;
  invoiceNumber: string;
  amount: number;
  runningBalance: number;
}

export interface CustomerStatement {
  partner: { id: string; name: string; code: string | null };
  /** 0 = no limit configured. */
  creditLimit: number;
  outstanding: number;
  /** Headroom left, or null when there is no limit. */
  available: number | null;
  /** Manual block on new credit sales (Partner.creditHold). */
  creditHold: boolean;
  entries: CustomerStatementEntry[];
}

/** Derived house-account (credit) statement for a customer. */
export function useCustomerStatement(partnerId: string | undefined) {
  return useQuery({
    queryKey: ['customer-statement', partnerId],
    queryFn: async () => (await api.get<CustomerStatement>(`/pos/customers/${partnerId}/statement`)).data,
    enabled: !!partnerId,
  });
}

export function usePartnerStats() {
  return useQuery({
    queryKey: ['partners-stats'],
    queryFn: async () => (await api.get<{ total: number }>('/partners', { params: { page: 1, pageSize: 1 } })).data,
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

export function useUpdatePartner() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<CreatePartnerInput> }) =>
      (await api.patch<Partner>(`/partners/${id}`, data)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['partners'] }),
  });
}

export function useDeletePartner() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) =>
      (await api.delete(`/partners/${id}`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['partners'] }),
  });
}

export function useLoyaltyEarned(partnerId: string, options?: { enabled?: boolean }) {
  return useQuery({
    ...options,
    queryKey: ['loyalty-earned', partnerId],
    queryFn: async () => (await api.get<{ totalEarned: number }>(`/pos/loyalty/earned/${partnerId}`)).data,
    enabled: options?.enabled ?? !!partnerId,
  });
}
