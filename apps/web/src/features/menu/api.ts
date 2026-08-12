/**
 * Menu management API hooks (categories + items + ingredient picker).
 *
 * Mirrors the conventions in features/products/api.ts: React Query hooks,
 * queryKey tuples for caching, mutation invalidation that re-fetches the
 * matching query keys.
 *
 * Endpoints (all under /api/v1/pos/menu):
 *   GET    /categories               list active categories
 *   POST   /categories               create category
 *   GET    /items                    list all items (admin)
 *   GET    /items/available          list categories + items grouped (POS/digital-menu payload)
 *   GET    /items/:id                detail with ingredients + product info
 *   POST   /items                    create item + ingredient links in one tx
 *   PATCH  /items/:id                update metadata (price, image, etc.)
 *   PATCH  /items/:id/availability   quick 86 toggle
 *   DELETE /items/:id                disable (isAvailable=false)
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

// ─── Types ────────────────────────────────────────────────────────────────

export interface MenuCategory {
  id: string;
  organizationId: string;
  name: string;
  parentId: string | null;
  image: string | null;
  icon: string | null;
  displayOrder: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface MenuIngredientProduct {
  id: string;
  code: string;
  name: string;
  station: string;
}

export interface MenuIngredient {
  id: string;
  organizationId: string;
  menuItemId: string;
  productId: string;
  quantity: string;
  product?: MenuIngredientProduct;
}

export interface MenuItem {
  id: string;
  organizationId: string;
  code: string | null;
  name: string;
  description: string | null;
  categoryId: string | null;
  /** Minor units (e.g. cents). String per Prisma Decimal serialization. */
  basePrice: string | null;
  image: string | null;
  preparationTime: number | null;
  isAvailable: boolean;
  isInventoryTracked: boolean;
  displayOrder: number;
  createdAt: string;
  updatedAt: string;
  ingredients?: MenuIngredient[];
  category?: MenuCategory | null;
}

export interface MenuPayload {
  categories: MenuCategory[];
  items: MenuItem[];
}

/** Minimal product shape returned by /products; enough for the ingredient picker. */
export interface ProductMini {
  id: string;
  code: string;
  name: string;
  salesPrice: string | null;
  productType: string;
  station?: string;
}

// ─── Input shapes ─────────────────────────────────────────────────────────

export interface CreateCategoryInput {
  name: string;
  parentId?: string;
  image?: string;
  icon?: string;
  displayOrder?: number;
}

export interface IngredientInput {
  productId: string;
  quantity?: number;
}

export interface CreateMenuItemInput {
  code?: string;
  name: string;
  description?: string;
  categoryId?: string;
  /** Whole currency units (UGX). E.g. 5000 = UGX 5,000 */
  basePrice?: number;
  image?: string;
  preparationTime?: number;
  isAvailable?: boolean;
  isInventoryTracked?: boolean;
  displayOrder?: number;
  ingredients?: IngredientInput[];
}

export interface UpdateMenuItemInput {
  code?: string;
  name?: string;
  description?: string;
  categoryId?: string | null;
  basePrice?: number | null;
  image?: string | null;
  preparationTime?: number | null;
  isAvailable?: boolean;
  isInventoryTracked?: boolean;
  displayOrder?: number;
  ingredients?: IngredientInput[];
}

// ─── Categories ───────────────────────────────────────────────────────────

export function useMenuCategories() {
  return useQuery({
    queryKey: ['menu-categories'],
    queryFn: async () => (await api.get<MenuCategory[]>('/pos/menu/categories')).data,
  });
}

export function useCreateCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateCategoryInput) =>
      (await api.post<MenuCategory>('/pos/menu/categories', input)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['menu-categories'] });
      qc.invalidateQueries({ queryKey: ['menu-items-available'] });
    },
  });
}

export function useUpdateCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<CreateCategoryInput> }) =>
      (await api.patch<MenuCategory>(`/pos/menu/categories/${id}`, data)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['menu-categories'] });
      qc.invalidateQueries({ queryKey: ['menu-items-available'] });
    },
  });
}

export function useDeleteCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) =>
      (await api.delete(`/pos/menu/categories/${id}`)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['menu-categories'] });
      qc.invalidateQueries({ queryKey: ['menu-items-available'] });
    },
  });
}

export function useRestoreCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) =>
      (await api.patch(`/pos/menu/categories/${id}/restore`, {})).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['menu-categories'] });
      qc.invalidateQueries({ queryKey: ['menu-items-available'] });
    },
  });
}

// ─── Items ────────────────────────────────────────────────────────────────

export function useMenuItemsAvailable() {
  return useQuery({
    queryKey: ['menu-items-available'],
    queryFn: async () => (await api.get<MenuPayload>('/pos/menu/items/available')).data,
    staleTime: 240_000,
    refetchInterval: 300_000,
  });
}

export function useMenuItems(params: { page: number; pageSize: number; search?: string }) {
  return useQuery({
    queryKey: ['menu-items-all', params],
    queryFn: async () => (await api.get<{ data: MenuItem[]; meta: { page: number; pageSize: number; total: number; totalPages: number } }>('/pos/menu/items', { params })).data,
  });
}

export function useMenuItem(id: string | undefined) {
  return useQuery({
    enabled: Boolean(id),
    queryKey: ['menu-item', id],
    queryFn: async () => (await api.get<MenuItem>(`/pos/menu/items/${id}`)).data,
  });
}

export function useCreateMenuItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateMenuItemInput) =>
      (await api.post<MenuItem>('/pos/menu/items', {
        ...input,
        basePrice: input.basePrice,
      })).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['menu-items-all'] });
      qc.invalidateQueries({ queryKey: ['menu-items-available'] });
    },
  });
}

export function useUpdateMenuItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: UpdateMenuItemInput }) =>
      (await api.patch<MenuItem>(`/pos/menu/items/${id}`, {
        ...patch,
        basePrice: patch.basePrice === undefined ? undefined : patch.basePrice,
      })).data,
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['menu-items-all'] });
      qc.invalidateQueries({ queryKey: ['menu-items-available'] });
      qc.invalidateQueries({ queryKey: ['menu-item', vars.id] });
    },
  });
}

export function useToggleAvailability() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, isAvailable }: { id: string; isAvailable: boolean }) =>
      (await api.patch<MenuItem>(`/pos/menu/items/${id}/availability`, { isAvailable })).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['menu-items-all'] });
      qc.invalidateQueries({ queryKey: ['menu-items-available'] });
    },
  });
}

export function useDisableMenuItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) =>
      (await api.delete<MenuItem>(`/pos/menu/items/${id}`)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['menu-items-all'] });
      qc.invalidateQueries({ queryKey: ['menu-items-available'] });
    },
  });
}

// ─── Ingredient picker ────────────────────────────────────────────────────

/** Dedicated search endpoint — avoids fetching 200 rows on every keystroke. */
export function useProductPicker(search?: string) {
  return useQuery({
    queryKey: ['product-picker', search],
    queryFn: async () => {
      if (!search || search.length < 2) return [];
      const res = await api.get<{ data: ProductMini[] }>('/products/search', {
        params: { q: search, pageSize: 20 },
      });
      return (res.data.data ?? []).filter((p) => p.productType !== 'service');
    },
    enabled: !!search && search.length >= 2,
  });
}