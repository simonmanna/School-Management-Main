import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { notify } from '@/lib/notify';

export interface StockTransferItem {
  id: string;
  productId: string;
  productName: string;
  unit: string | null;
  qtyRequested: number;
  qtyTransferred: number;
  batchNumber: string | null;
  distStrategy: string | null;
}

export interface StockTransfer {
  id: string;
  transferCode: string;
  fromLocId: string;
  toLocId: string;
  status: string;
  notes: string | null;
  createdAt: string;
  items: StockTransferItem[];
}

export function useTransfers(status?: string) {
  return useQuery<StockTransfer[]>({
    queryKey: ['inventory-transfers', status],
    queryFn: async () => {
      const params = status ? { status } : {};
      const res = await api.get<StockTransfer[]>('/inventory/transfers', { params });
      return res.data;
    },
  });
}

export function useCreateTransfer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: {
      fromLocationId: string;
      toLocationId: string;
      notes?: string;
      items: { productId: string; qtyRequested: number; distStrategy?: string }[];
    }) => {
      const res = await api.post('/inventory/transfers', data);
      return res.data;
    },
    onSuccess: () => {
      notify.success('Transfer created');
      qc.invalidateQueries({ queryKey: ['inventory-transfers'] });
    },
    onError: (e: any) => notify.error(e?.response?.data?.message ?? 'Failed to create transfer'),
  });
}

export function useApproveTransfer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await api.post(`/inventory/transfers/${id}/approve`);
      return res.data;
    },
    onSuccess: () => {
      notify.success('Transfer approved');
      qc.invalidateQueries({ queryKey: ['inventory-transfers'] });
      qc.invalidateQueries({ queryKey: ['inventory-product-stock-levels'] });
      qc.invalidateQueries({ queryKey: ['inventory-stats'] });
      qc.invalidateQueries({ queryKey: ['inventory-ledger'] });
    },
    onError: (e: any) => notify.error(e?.response?.data?.message ?? 'Failed to approve transfer'),
  });
}
