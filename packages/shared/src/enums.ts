/**
 * Generic, industry-agnostic enums shared by API and Web.
 * NOTE: industry party types (Student, Patient, Donor...) deliberately do NOT
 * live here — see ADR-008. Partners use role flags + categories instead.
 */

export const PRODUCT_TYPES = [
  'stockable',
  'consumable',
  'service',
  'fee',
  'subscription',
  'asset',
] as const;
export type ProductType = (typeof PRODUCT_TYPES)[number];

export const TAX_TYPES = ['vat', 'gst', 'sales_tax', 'withholding'] as const;
export type TaxType = (typeof TAX_TYPES)[number];

export const FISCAL_PERIOD_STATUS = ['open', 'closed', 'locked'] as const;
export type FiscalPeriodStatus = (typeof FISCAL_PERIOD_STATUS)[number];

export const ORGANIZATION_STATUS = ['active', 'suspended', 'archived'] as const;
export type OrganizationStatus = (typeof ORGANIZATION_STATUS)[number];

export const PARTNER_STATUS = ['active', 'inactive', 'archived'] as const;
export type PartnerStatus = (typeof PARTNER_STATUS)[number];

export const ADDRESS_TYPES = ['billing', 'shipping', 'office', 'branch', 'home'] as const;
export type AddressType = (typeof ADDRESS_TYPES)[number];

// ---------------------------- Accounting (Phase 2) --------------------------

/**
 * @deprecated Legacy account type. Replaced by `AccountCategory` — see
 * `./accounting/account-category`. This list is retained only for the
 * Android POS client compatibility; it will be removed after the next
 * mobile release.
 *
 * Mapped from AccountCategory via `legacyAccountTypeFor()`.
 */
export const ACCOUNT_TYPES = [
  'asset',
  'liability',
  'equity',
  'revenue',
  'expense',
  'cost_of_goods_sold',
  'bank',
  'cash',
  'mobile_money',
  'petty_cash',
  'receivable',
  'payable',
  'tax',
  'contra_asset',
  'contra_liability',
] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

export const JOURNAL_TYPES = [
  'general',
  'sales',
  'purchase',
  'cash',
  'bank',
  'adjustment',
  'opening',
  'closing',
] as const;
export type JournalType = (typeof JOURNAL_TYPES)[number];

export const JOURNAL_ENTRY_STATUS = ['draft', 'posted', 'reversed'] as const;
export type JournalEntryStatus = (typeof JOURNAL_ENTRY_STATUS)[number];

// ---------------------------- Documents / AR (Phase 3) ----------------------

export const DOCUMENT_TYPES = [
  'sales_invoice',
  'credit_note',
  'vendor_bill',
  'debit_note',
  'proforma_invoice',
] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export const DOCUMENT_STATUS = [
  'draft',
  'submitted',
  'approved',
  'posted',
  'paid',
  'cancelled',
] as const;
export type DocumentStatus = (typeof DOCUMENT_STATUS)[number];

/** Residual/settlement status, derived from amountResidual. */
export const PAYMENT_STATUS = ['not_paid', 'partial', 'paid', 'overpaid'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUS)[number];

export const PAYMENT_DIRECTION = ['inbound', 'outbound'] as const;
export type PaymentDirection = (typeof PAYMENT_DIRECTION)[number];

export const PAYMENT_METHODS = ['cash', 'bank', 'mobile_money', 'card', 'cheque'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/**
 * Account-determination mapping keys now live in `./accounting/account-mappings`
 * as `ACCOUNT_MAPPING_REGISTRY` (key + label + group + expectedCategories +
 * required). `ACCOUNT_MAPPING_KEYS` and `ACCOUNT_MAPPING_LABELS` are still
 * exported from there as derived aliases.
 */

/**
 * Per-product inventory costing method (M3).
 * - AVCO / FIFO / STANDARD: see CostResolverService.
 * - SPECIFIC: specific-identification — each unit/layer is costed at its own
 *   actual receipt cost (requires serial or batch tracking to identify the layer).
 */
export const COSTING_METHODS = ['AVCO', 'FIFO', 'STANDARD', 'SPECIFIC'] as const;
export type CostingMethod = (typeof COSTING_METHODS)[number];

// ---------------------------- Inventory (Phase 4) ---------------------------

export const LOCATION_TYPES = [
  'warehouse',
  'store',
  'virtual',
  // F.8 — restaurant-specific
  'main_kitchen',
  'bar',
  'storage_room',
  'walkin_fridge',
  'freezer',
  'dry_storage',
  'front_counter',
  'branch',
  // Manufacturing (additive) — the production floor.
  'production',
] as const;
export type LocationType = (typeof LOCATION_TYPES)[number];

export const STOCK_MOVE_TYPES = [
  'receipt',
  'issue',
  'adjustment_in',
  'adjustment_out',
  'transfer_in',
  'transfer_out',
  'opening_balance',
  // F.8 — restaurant inventory engine
  'waste',
  'return_in',
  'return_to_supplier',
  'expiry_write_off',
  'internal_use',
  'promo_sample',
  // Manufacturing (additive) — consume relieves raw materials into WIP, output
  // receives finished goods. MUST match the StockMoveType enum in schema.prisma.
  'production_consume',
  'production_output',
] as const;
export type StockMoveType = (typeof STOCK_MOVE_TYPES)[number];

// ---- M3 — Configurable Inventory Movement Types (posting rules) ----
export const INVENTORY_MOVEMENT_TYPES = [
  'STOCK_IN',
  'STOCK_OUT',
  'STOCK_TRANSFER_OUT',
  'STOCK_TRANSFER_IN',
  'ADJUSTMENT_GAIN',
  'ADJUSTMENT_LOSS',
  'WASTE',
  'EXPIRY_WRITE_OFF',
  'RETURN_RESTOCK',
  'RETURN_TO_SUPPLIER',
  'INTERNAL_CONSUMPTION',
  'PROMO_SAMPLE',
  'PRODUCTION_CONSUME',
  'PRODUCTION_OUTPUT',
  'REVALUATION',
  /** Squares up COGS/valuation after a receipt lands on negative on-hand
   *  (goods sold before they were received). See
   *  StockPostingService.postNegativeStockCostCorrection. */
  'COGS_CORRECTION',
] as const;
export type InventoryMovementType = (typeof INVENTORY_MOVEMENT_TYPES)[number];

// ---- F.8 — Stock document wrappers ----
export const STOCK_DOC_STATUS = [
  'draft',
  'pending',
  'approved',
  'rejected',
  'completed',
  'cancelled',
] as const;
export type StockDocStatus = (typeof STOCK_DOC_STATUS)[number];

export const STOCK_OUT_CATEGORIES = [
  'general_use',
  'kitchen_testing',
  'training',
  'damaged',
  'sample',
  'expired',
  'complimentary',
  'other',
] as const;
export type StockOutCategory = (typeof STOCK_OUT_CATEGORIES)[number];

export const WASTE_CATEGORIES = [
  'expired',
  'spoiled',
  'burnt',
  'contaminated',
  'breakage',
  'other',
  // Manufacturing scrap reasons (Phase 2)
  'overmixed',
  'packaging_defect',
  'qc_rejection',
] as const;
export type WasteCategory = (typeof WASTE_CATEGORIES)[number];

export const STOCK_ADJUSTMENT_REASONS = [
  'cycle_count',
  'damaged',
  'expired',
  'theft',
  'found',
  'initial_count',
  'other',
] as const;
export type StockAdjustmentReason = (typeof STOCK_ADJUSTMENT_REASONS)[number];

/**
 * How stock is picked when issuing a batch/serial-tracked product. Doubles as the
 * per-product default `pickingStrategy` and the per-transaction `distStrategy`.
 * - FEFO: nearest expiry first (default). FIFO: oldest receipt first.
 * - MANUAL: consume only a named batch. SERIAL: consume specifically-selected serials.
 */
export const STOCK_DISTRIBUTION_STRATEGIES = ['FEFO', 'FIFO', 'MANUAL', 'SERIAL'] as const;
export type StockDistributionStrategy = (typeof STOCK_DISTRIBUTION_STRATEGIES)[number];

/** Lifecycle status of a single serialized stock unit (InventorySerial). */
export const SERIAL_STATUSES = ['in_stock', 'issued', 'returned', 'scrapped'] as const;
export type SerialStatus = (typeof SERIAL_STATUSES)[number];

// ---- Beverage Control — digital-weight alcohol measurement ----
/** How a product's remaining stock is measured. */
export const MEASUREMENT_METHODS = ['count', 'manual_volume', 'digital_weight'] as const;
export type MeasurementMethod = (typeof MEASUREMENT_METHODS)[number];

/** Where a bottle weight reading came from (extensible: Bluetooth/USB later). */
export const MEASUREMENT_SOURCES = ['MANUAL', 'SCALE', 'BLUETOOTH', 'USB', 'IMPORT', 'API'] as const;
export type MeasurementSource = (typeof MEASUREMENT_SOURCES)[number];

/** Confidence of a single weight reading, derived from the tolerance/guards. */
export const BOTTLE_CONFIDENCE = ['GOOD', 'SUSPICIOUS', 'OUT_OF_RANGE'] as const;
export type BottleConfidence = (typeof BOTTLE_CONFIDENCE)[number];

export const BOTTLE_COUNT_TYPES = ['opening', 'closing'] as const;
export type BottleCountType = (typeof BOTTLE_COUNT_TYPES)[number];

// ---------------------------- Procurement (Phase F.6) -----------------------

export const PURCHASE_REQUEST_STATUS = [
  'draft',
  'submitted',
  'approved',
  'rejected',
  'cancelled',
  'converted',
] as const;
export type PurchaseRequestStatus = (typeof PURCHASE_REQUEST_STATUS)[number];

export const PURCHASE_ORDER_STATUS = [
  'draft',
  'submitted',
  'approved',
  'sent',
  'acknowledged',
  'partially_received',
  'received',
  'billed',
  'closed',
  'cancelled',
] as const;
export type PurchaseOrderStatus = (typeof PURCHASE_ORDER_STATUS)[number];

export const GOODS_RECEIPT_STATUS = ['draft', 'posted', 'cancelled'] as const;
export type GoodsReceiptStatus = (typeof GOODS_RECEIPT_STATUS)[number];

export const MATCH_STATUS = [
  'pending',
  'matched',
  'partial',
  'mismatch',
  'blocked',
] as const;
export type MatchStatus = (typeof MATCH_STATUS)[number];

export const DEBIT_NOTE_REASONS = [
  'price_adjustment',
  'returned_goods',
  'overcharge',
  'correction',
  'other',
] as const;
export type DebitNoteReason = (typeof DEBIT_NOTE_REASONS)[number];

export const SUPPORTED_LOCALES = ['en', 'es', 'fr'] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

// ---------------------------- Fixed Assets ----------------------------------

export const ASSET_STATUSES = [
  'active',
  'under_maintenance',
  'disposed',
  'lost_stolen',
  'in_repair',
  'reserved',
] as const;
export type AssetStatus = (typeof ASSET_STATUSES)[number];

export const ACQUISITION_METHODS = [
  'purchased',
  'donated',
  'leased',
  'constructed',
  'transferred_in',
  'gifted',
] as const;
export type AcquisitionMethod = (typeof ACQUISITION_METHODS)[number];

export const DEPRECIATION_METHODS = [
  'straight_line',
  'declining_balance',
  'double_declining',
  'units_of_production',
  'manual',
] as const;
export type DepreciationMethod = (typeof DEPRECIATION_METHODS)[number];

export const DISPOSAL_METHODS = [
  'sold',
  'scrapped',
  'donated',
  'lost',
  'stolen',
  'destroyed',
] as const;
export type DisposalMethod = (typeof DISPOSAL_METHODS)[number];

export const MAINTENANCE_TYPES = [
  'preventive',
  'corrective',
  'emergency',
  'scheduled',
  'calibration',
] as const;
export type MaintenanceType = (typeof MAINTENANCE_TYPES)[number];

export const ASSIGNMENT_ENTITY_TYPES = [
  'employee',
  'teacher',
  'student',
  'department',
  'branch',
  'room',
  'vehicle',
  'clinic',
  'store',
] as const;
export type AssignmentEntityType = (typeof ASSIGNMENT_ENTITY_TYPES)[number];


