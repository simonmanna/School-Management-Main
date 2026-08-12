// Decimal columns arrive as strings over JSON.

export type BomStatus = 'draft' | 'active' | 'archived';
export type ProductionOrderStatus = 'draft' | 'confirmed' | 'in_progress' | 'qc_hold' | 'completed' | 'cancelled';
export type ProductionOutputKind = 'output' | 'byproduct';

export interface BomLine {
  id: string;
  bomId: string;
  componentProductId: string;
  componentVariantId: string | null;
  quantity: string;
  uomId: string | null;
  scrapPct: string;
  sequence: number;
  isOptional: boolean;
  notes: string | null;
}

export interface Bom {
  id: string;
  code: string;
  name: string;
  outputProductId: string;
  outputVariantId: string | null;
  outputQuantity: string;
  outputUomId: string | null;
  version: number;
  status: BomStatus;
  isDefault: boolean;
  expectedYieldPct: string;
  defaultLocationId: string | null;
  defaultOutputLocationId: string | null;
  shelfLifeDays: number | null;
  estimatedDurationMins: number | null;
  qcRequired: boolean;
  notes: string | null;
  createdAt: string;
  lines: BomLine[];
}

export interface ProductionMaterial {
  id: string;
  orderId: string;
  productId: string;
  variantId: string | null;
  productName: string;
  qtyPlanned: string;
  qtyConsumed: string;
  uomId: string | null;
  unitCost: string;
  totalCost: string;
  batchNumber: string | null;
  ledgerCode: string | null;
  sequence: number;
}

export interface ProductionOutput {
  id: string;
  orderId: string;
  kind: ProductionOutputKind;
  productId: string;
  productName: string;
  qtyExpected: string;
  qtyProduced: string;
  unitCost: string;
  totalCost: string;
  batchNumber: string | null;
  expiryDate: string | null;
  batchId: string | null;
}

export interface ProductionOrder {
  id: string;
  orderCode: string;
  bomId: string | null;
  bomVersion: number | null;
  outputProductId: string;
  outputVariantId: string | null;
  locationId: string;
  outputLocationId: string | null;
  status: ProductionOrderStatus;
  plannedQty: string;
  producedQty: string;
  scrapQty: string;
  scheduledFor: string | null;
  startedAt: string | null;
  completedAt: string | null;
  materialCost: string;
  totalCost: string;
  outputUnitCost: string;
  yieldVariance: string;
  batchNumber: string | null;
  expiryDate: string | null;
  notes: string | null;
  createdAt: string;
  materials: ProductionMaterial[];
  outputs: ProductionOutput[];
}

export interface BomLineInput {
  componentProductId: string;
  quantity: number;
  uomId?: string;
  scrapPct?: number;
}

export interface CreateBomInput {
  name: string;
  outputProductId: string;
  outputQuantity: number;
  outputUomId?: string;
  expectedYieldPct?: number;
  defaultLocationId?: string;
  defaultOutputLocationId?: string;
  shelfLifeDays?: number;
  qcRequired?: boolean;
  isDefault?: boolean;
  notes?: string;
  lines: BomLineInput[];
}

export interface CreateProductionOrderInput {
  bomId?: string;
  outputProductId?: string;
  locationId?: string;
  outputLocationId?: string;
  runs?: number;
  plannedQty?: number;
  scheduledFor?: string;
  notes?: string;
}
