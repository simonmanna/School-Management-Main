import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { locationsApi } from '@/lib/api/locations';

export interface ProductOption {
  id: string;
  code: string;
  name: string;
  uomId: string | null;
}

/** Lightweight product list for the BOM/order pickers. */
export function useProductOptions() {
  return useQuery({
    queryKey: ['manufacturing', 'product-options'],
    queryFn: async () => {
      const res = await api.get<{ data: ProductOption[] }>('/products', { params: { pageSize: 500 } });
      return res.data.data;
    },
  });
}

export function useLocationOptions() {
  return useQuery({
    queryKey: ['manufacturing', 'location-options'],
    queryFn: async () => (await locationsApi.list({ pageSize: 200 })).data,
  });
}
