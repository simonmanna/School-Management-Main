import { api } from '@/lib/api';

export interface InventoryLocation {
  id: string;
  code: string;
  name: string;
  type: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export const locationsApi = {
  list(params?: {
    page?: number;
    pageSize?: number;
    search?: string;
    type?: string;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
  }): Promise<{ data: InventoryLocation[]; meta: { page: number; pageSize: number; total: number; totalPages: number } }> {
    return api.get('/inventory/locations', { params }).then((r) => r.data);
  },
  get(id: string): Promise<InventoryLocation> {
    return api.get(`/inventory/locations/${id}`).then((r) => r.data);
  },
  create(body: { code: string; name: string; type?: string; isActive?: boolean }): Promise<InventoryLocation> {
    return api.post('/inventory/locations', body).then((r) => r.data);
  },
  update(id: string, body: Partial<InventoryLocation>): Promise<InventoryLocation> {
    return api.patch(`/inventory/locations/${id}`, body).then((r) => r.data);
  },
  delete(id: string): Promise<void> {
    return api.delete(`/inventory/locations/${id}`).then((r) => r.data);
  },
};
