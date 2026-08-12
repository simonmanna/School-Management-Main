import { useQuery } from '@tanstack/react-query';
import type { PaginatedResult } from '@erp/shared';
import { api } from '@/lib/api';

export interface Product {
  id: string;
  code: string;
  sku: string | null;
  name: string;
  productType: string;
  salesPrice: string | null;
  isActive: boolean;
  createdAt: string;
}

export interface ListParams {
  page: number;
  pageSize: number;
  search?: string;
}

export function useProducts(params: ListParams) {
  return useQuery({
    queryKey: ['products', params],
    queryFn: async () => (await api.get<PaginatedResult<Product>>('/products', { params })).data,
  });
}
