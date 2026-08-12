import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PaginatedResult } from '@erp/shared';
import { api } from '@/lib/api';

export interface Product {
  id: string;
  code: string;
  sku: string | null;
  name: string;
  productType: string;
  costingMethod: string;
  categoryId: string | null;
  category: { id: string; name: string } | null;
  // UOM roles.
  uomId?: string | null;
  purchaseUomId?: string | null;
  salesUomId?: string | null;
  recipeUomId?: string | null;
  productionUomId?: string | null;
  uomConversion?: string | null;
  reorderQty?: string | null;
  /** KDS routing: KitchenStation.code. */
  station?: string | null;
  allowFractionalSale?: boolean;
  minSaleQty?: string | null;
  maxSaleQty?: string | null;
  packagings?: { id: string; name: string; quantity: string; barcode: string | null; isActive: boolean }[];
  salesPrice: string | null;
  costPrice: string | null;
  image?: string | null;
  isActive: boolean;
  trackInventory: boolean;
  // Inventory tracking configuration.
  batchTracking?: boolean;
  expiryTracking?: boolean;
  serialTracking?: boolean;
  pickingStrategy?: string;
  createdAt: string;
  // Beverage Control (bar alcohol) — digital-weight measurement.
  measurementMethod?: string;
  containerVolumeMl?: string | null;
  emptyBottleWeightG?: string | null;
  actualEmptyWeightG?: string | null;
  fullBottleWeightG?: string | null;
  liquidWeightG?: string | null;
  conversionFactorMlPerG?: string | null;
  standardPourMl?: string | null;
  allowPartialBottle?: boolean;
  varianceToleranceG?: string | null;
  // M3 — Inventory account overrides (optional; null = inherit).
  incomeAccountOverrideId?: string | null;
  expenseAccountOverrideId?: string | null;
  inventoryAccountOverrideId?: string | null;
  cogsAccountOverrideId?: string | null;
  shrinkageAccountOverrideId?: string | null;
  damageAccountOverrideId?: string | null;
  expiryAccountOverrideId?: string | null;
  varianceGainAccountOverrideId?: string | null;
}

export interface ProductCategory {
  id: string;
  name: string;
  parentId: string | null;
  incomeAccountId?: string | null;
  expenseAccountId?: string | null;
  inventoryAccountId?: string | null;
  cogsAccountId?: string | null;
  shrinkageAccountId?: string | null;
  damageAccountId?: string | null;
  expiryAccountId?: string | null;
  varianceGainAccountId?: string | null;
}

export interface ListParams {
  page: number;
  pageSize: number;
  search?: string;
  categoryId?: string;
  productType?: string;
}

export interface CreateProductInput {
  code: string;
  sku?: string;
  name: string;
  productType: string;
  costingMethod?: string;
  categoryId?: string;
  // UOM roles + purchasing/sale rules.
  uomId?: string;
  purchaseUomId?: string;
  salesUomId?: string;
  recipeUomId?: string;
  productionUomId?: string;
  uomConversion?: number;
  reorderQty?: number;
  /** KDS routing: KitchenStation.code. */
  station?: string;
  allowFractionalSale?: boolean;
  minSaleQty?: number;
  maxSaleQty?: number;
  packagings?: { name: string; quantity: number; barcode?: string; isActive?: boolean }[];
  salesPrice?: number;
  costPrice?: number;
  image?: string;
  trackInventory?: boolean;
  // Inventory tracking configuration.
  batchTracking?: boolean;
  expiryTracking?: boolean;
  serialTracking?: boolean;
  pickingStrategy?: string;
  // Beverage Control (bar alcohol) — digital-weight measurement.
  measurementMethod?: string;
  containerVolumeMl?: number;
  emptyBottleWeightG?: number;
  actualEmptyWeightG?: number;
  fullBottleWeightG?: number;
  standardPourMl?: number;
  allowPartialBottle?: boolean;
  varianceToleranceG?: number;
}

export function useProducts(params: ListParams) {
  return useQuery({
    queryKey: ['products', params],
    queryFn: async () => (await api.get<PaginatedResult<Product>>('/products', { params })).data,
  });
}

export function useCreateProduct() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateProductInput) =>
      (await api.post<Product>('/products', input)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['products'] }),
  });
}

export function useUpdateProduct() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<CreateProductInput> }) =>
      (await api.patch<Product>(`/products/${id}`, data)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['products'] }),
  });
}

export function useProductCategories() {
  return useQuery({
    queryKey: ['product-categories'],
    queryFn: async () =>
      (await api.get<PaginatedResult<ProductCategory>>('/product-categories', { params: { pageSize: 200 } })).data?.data ?? [],
    staleTime: 5 * 60 * 1000,
  });
}

export interface CreateProductCategoryInput {
  name: string;
  parentId?: string;
  incomeAccountId?: string;
  expenseAccountId?: string;
}

export function useCreateProductCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateProductCategoryInput) =>
      (await api.post<ProductCategory>('/product-categories', input)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['product-categories'] }),
  });
}

export function useUpdateProductCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<CreateProductCategoryInput> }) =>
      (await api.patch<ProductCategory>(`/product-categories/${id}`, data)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['product-categories'] }),
  });
}

export function useDeleteProductCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) =>
      (await api.delete(`/product-categories/${id}`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['product-categories'] }),
  });
}

export function useDeleteProduct() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) =>
      (await api.delete(`/products/${id}`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['products'] }),
  });
}

export function useRestoreProduct() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) =>
      (await api.patch(`/products/${id}/restore`, {})).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['products'] }),
  });
}
