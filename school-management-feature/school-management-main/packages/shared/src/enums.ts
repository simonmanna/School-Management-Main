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

export const ACCOUNT_TYPES = [
  'asset',
  'liability',
  'equity',
  'revenue',
  'expense',
  'cost_of_goods_sold',
  'bank',
  'cash',
  'receivable',
  'payable',
  'tax',
  'contra_asset',
  'contra_liability',
] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

/** Account types whose normal balance is a debit (assets, expenses...). */
export const DEBIT_NORMAL_ACCOUNT_TYPES: AccountType[] = [
  'asset',
  'expense',
  'cost_of_goods_sold',
  'bank',
  'cash',
  'receivable',
  'contra_liability',
];

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

/** Well-known account-determination mapping keys (org-level defaults). */
export const ACCOUNT_MAPPING_KEYS = [
  'accounts_receivable',
  'accounts_payable',
  'sales_revenue',
  'default_expense',
  'sales_discount',
  'tax_payable',
  'tax_receivable',
  'default_cash',
  'default_bank',
  'rounding',
  'retained_earnings',
  'suspense',
  // M3 — inventory→GL
  'stock_valuation',
  'cogs',
  'grni_accrued',
  'stock_adjustment_income',
  'stock_adjustment_expense',
] as const;
export type AccountMappingKey = (typeof ACCOUNT_MAPPING_KEYS)[number];

/** Per-product inventory costing method (M3). */
export const COSTING_METHODS = ['AVCO', 'FIFO', 'STANDARD'] as const;
export type CostingMethod = (typeof COSTING_METHODS)[number];

// ---------------------------- Inventory (Phase 4) ---------------------------

export const LOCATION_TYPES = ['warehouse', 'store', 'virtual'] as const;
export type LocationType = (typeof LOCATION_TYPES)[number];

export const STOCK_MOVE_TYPES = [
  'receipt',
  'issue',
  'adjustment_in',
  'adjustment_out',
  'transfer_in',
  'transfer_out',
  'opening_balance',
] as const;
export type StockMoveType = (typeof STOCK_MOVE_TYPES)[number];
