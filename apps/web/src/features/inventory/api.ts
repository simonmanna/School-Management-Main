import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

export interface InventoryProduct {
  id: string;
  code: string;
  name: string;
  sku: string | null;
  barcode: string | null;
  description: string | null;
  productType: string;
  costingMethod: string;
  minQuantity: string | null;
  reorderQty: string | null;
  batchTracking: boolean;
  trackInventory: boolean;
  stockPolicy: string;
  uomId: string | null;
  purchaseUomId: string | null;
  salesPrice: string | null;
  costPrice: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  category: { id: string; name: string; parentId: string | null } | null;
  supplier: { id: string; name: string } | null;
  // M3 — Account overrides
  incomeAccountOverrideId: string | null;
  expenseAccountOverrideId: string | null;
  inventoryAccountOverrideId: string | null;
  cogsAccountOverrideId: string | null;
  shrinkageAccountOverrideId: string | null;
  damageAccountOverrideId: string | null;
  expiryAccountOverrideId: string | null;
  varianceGainAccountOverrideId: string | null;
}

export interface StockItemWithLocation {
  id: string;
  quantity: number;
  runningAverageCost: string;
  location: { id: string; code: string; name: string; type: string };
}

export interface BatchInfo {
  id: string;
  batchNumber: string;
  quantity: number;
  unitCost: string | null;
  expiryDate: string | null;
  receivedAt: string;
  isActive: boolean;
  location: { id: string; code: string; name: string };
}

export interface LedgerEntry {
  id: string;
  type: string;
  qtyBefore: number;
  quantityChange: number;
  balanceAfter: number;
  unitCost: number;
  totalValue: number;
  referenceType: string | null;
  referenceId: string | null;
  notes: string | null;
  performedBy: string | null;
  createdAt: string;
  location: { code: string; name: string } | null;
  batch: { batchNumber: string } | null;
}

export interface MenuProductLink {
  id: string;
  quantity: number;
  menuItem: { id: string; code: string | null; name: string };
}

export interface POLineItem {
  id: string;
  quantity: number;
  receivedQuantity: number;
  unitPrice: number;
  subtotal: number;
  version: number;
  order: {
    id: string;
    orderNumber: string;
    status: string;
    createdAt: string;
    partner: { id: string; name: string };
  };
}

export interface InventoryItemDetail {
  product: InventoryProduct;
  items: StockItemWithLocation[];
  totalOnHand: number;
  totalValue: number;
  batches: BatchInfo[];
  recentLedger: LedgerEntry[];
  menuProducts: MenuProductLink[];
  purchaseOrderLines: POLineItem[];
}

export function useInventoryItemDetail(productId: string | undefined) {
  return useQuery<InventoryItemDetail>({
    queryKey: ['inventory-item-detail', productId],
    queryFn: async () => (await api.get(`/inventory/items/${productId}`)).data,
    enabled: !!productId,
  });
}
