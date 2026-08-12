export interface AssetCategory {
  id: string;
  name: string;
  description: string | null;
  parentId: string | null;
  depreciationMethod: string;
  defaultUsefulLife: number;
  defaultResidualValue: string;
  isActive: boolean;
  parent?: AssetCategory | null;
  children?: AssetCategory[];
  _count?: { assets: number };
}

export interface Asset {
  id: string;
  assetCode: string;
  barcode: string | null;
  name: string;
  description: string | null;
  serialNumber: string | null;
  brand: string | null;
  model: string | null;
  manufacturer: string | null;
  categoryId: string | null;
  category?: AssetCategory | null;
  department: string | null;
  branchId: string | null;
  location: string | null;
  assignedToId: string | null;
  assignedToType: string | null;
  purchaseDate: string | null;
  supplierId: string | null;
  invoiceNumber: string | null;
  purchaseCost: string | null;
  currentValue: string | null;
  salvageValue: string;
  usefulLife: number;
  acquisitionMethod: string;
  capitalizedCost: string | null;
  image: string | null;
  status: string;
  notes: string | null;
  createdAt: string;
}

export interface AssetAcquisition {
  id: string;
  assetId: string;
  vendor: string | null;
  vendorId: string | null;
  purchaseOrderId: string | null;
  invoiceId: string | null;
  taxes: string | null;
  freight: string | null;
  installationCost: string | null;
  otherCosts: string | null;
  capitalizedCost: string | null;
  acquisitionDate: string | null;
  notes: string | null;
}

export interface AssetAssignment {
  id: string;
  assetId: string;
  assignedToId: string | null;
  assignedToType: string | null;
  assignedToName: string | null;
  assignedDate: string;
  returnedDate: string | null;
  conditionBefore: string | null;
  conditionAfter: string | null;
  responsiblePerson: string | null;
  notes: string | null;
}

export interface AssetTransfer {
  id: string;
  assetId: string;
  fromLocation: string | null;
  toLocation: string | null;
  fromBranchId: string | null;
  toBranchId: string | null;
  reason: string | null;
  approvedBy: string | null;
  transferDate: string;
  notes: string | null;
}

export interface AssetDepreciation {
  id: string;
  assetId: string;
  period: string;
  method: string;
  assetCost: string;
  salvageValue: string;
  usefulLife: number;
  depreciationAmount: string;
  accumulatedDepr: string;
  bookValue: string;
  isPosted: boolean;
  journalEntryId: string | null;
  postedAt: string | null;
}

export interface AssetMaintenance {
  id: string;
  assetId: string;
  maintenanceType: string;
  title: string;
  description: string | null;
  technician: string | null;
  vendor: string | null;
  scheduledDate: string | null;
  completedDate: string | null;
  cost: string | null;
  nextMaintenanceDate: string | null;
  status: string;
  notes: string | null;
}

export interface AssetWarranty {
  id: string;
  assetId: string;
  warrantyStart: string;
  warrantyEnd: string;
  vendor: string | null;
  contactPerson: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  coverage: string | null;
  notes: string | null;
  asset?: { name: string; assetCode: string };
}

export interface AssetDisposal {
  id: string;
  assetId: string;
  disposalMethod: string;
  disposalDate: string;
  disposalValue: string | null;
  bookValueAtDisposal: string | null;
  gainLoss: string | null;
  approvedBy: string | null;
  reason: string | null;
}
