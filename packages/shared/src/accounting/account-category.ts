/**
 * Account **behavior** contracts.
 *
 * The chart of accounts has two orthogonal dimensions:
 *   - `Account.parentAccountId` — hierarchy. Reporting and navigation ONLY.
 *   - `Account.categoryId`      — behavior. How the accounting engine treats the
 *                                 account: normal balance, which statement it
 *                                 lands on, whether a module may auto-find it.
 *
 * Modules must resolve accounts by category `key` (or by an AccountMapping key),
 * never by account name, code range, or position in the tree.
 */

export const ACCOUNT_CLASSIFICATIONS = [
  'asset',
  'liability',
  'equity',
  'revenue',
  'expense',
  'off_balance',
] as const;
export type AccountClassification = (typeof ACCOUNT_CLASSIFICATIONS)[number];

export const NORMAL_BALANCES = ['debit', 'credit'] as const;
export type NormalBalance = (typeof NORMAL_BALANCES)[number];

export const CASH_FLOW_CLASSES = ['operating', 'investing', 'financing', 'none'] as const;
export type CashFlowClass = (typeof CASH_FLOW_CLASSES)[number];

/** Subledger control account type — replaces the bare `isControlAccount` boolean. */
export const CONTROL_ACCOUNT_TYPES = [
  'ar',
  'ap',
  'inventory',
  'fixed_assets',
  'payroll',
  'tax',
] as const;
export type ControlAccountType = (typeof CONTROL_ACCOUNT_TYPES)[number];

/** Statement line-group. Single source of truth for every financial report. */
export const REPORT_SECTIONS = [
  'current_assets',
  'non_current_assets',
  'current_liabilities',
  'long_term_liabilities',
  'equity',
  'revenue',
  'contra_revenue',
  'cogs',
  'operating_expense',
  'other_income',
  'other_expense',
  'off_balance',
] as const;
export type ReportSection = (typeof REPORT_SECTIONS)[number];

/** Classifications that belong to the profit & loss statement. */
export const PNL_CLASSIFICATIONS: readonly AccountClassification[] = ['revenue', 'expense'];

/** Classifications that belong to the balance sheet. */
export const BALANCE_SHEET_CLASSIFICATIONS: readonly AccountClassification[] = [
  'asset',
  'liability',
  'equity',
];

export interface AccountCategoryDef {
  key: string;
  name: string;
  description?: string;
  classification: AccountClassification;
  normalBalance: NormalBalance;
  reportSection: ReportSection;
  cashFlowClass: CashFlowClass;
  /** Contra accounts carry the opposite normal balance of their classification. */
  isContra: boolean;
  /** Counts toward cash & cash equivalents (cash-flow statement, treasury). */
  isCashEquivalent: boolean;
  allowReconciliation: boolean;
  allowManualPosting: boolean;
  allowBudgeting: boolean;
  sortOrder: number;
  /**
   * Version of this category's accounting contract. Defaults to
   * {@link DEFAULT_CATEGORY_SYSTEM_VERSION}.
   *
   * The boot seeder only rewrites a stored row when the template's version is
   * higher, so upgrades are deterministic and idempotent: changing a category's
   * behavior means editing it here **and bumping its version**. Without the bump
   * the change will not reach an already-seeded database.
   */
  systemVersion?: number;
}

/** Version assumed for any category entry that does not declare one. */
export const DEFAULT_CATEGORY_SYSTEM_VERSION = 1;

export function categorySystemVersion(def: AccountCategoryDef): number {
  return def.systemVersion ?? DEFAULT_CATEGORY_SYSTEM_VERSION;
}

/**
 * Canonical categories seeded (as `isSystem`) for every organization.
 *
 * Losslessly covers all 15 legacy `AccountType` values and adds the two the old
 * enum was missing: a real `contra_revenue` (previously branched on in reports
 * but absent from the enum, so it could never match) and `off_balance`.
 *
 * Tenants may add their own categories; system rows cannot be deleted and their
 * key / classification / normalBalance / isContra are immutable.
 */
export const ACCOUNT_CATEGORY_SEED: readonly AccountCategoryDef[] = [
  {
    key: 'cash',
    name: 'Cash',
    classification: 'asset',
    normalBalance: 'debit',
    reportSection: 'current_assets',
    cashFlowClass: 'operating',
    isContra: false,
    isCashEquivalent: true,
    allowReconciliation: true,
    allowManualPosting: true,
    allowBudgeting: false,
    sortOrder: 10,
  },
  {
    key: 'bank',
    name: 'Bank',
    classification: 'asset',
    normalBalance: 'debit',
    reportSection: 'current_assets',
    cashFlowClass: 'operating',
    isContra: false,
    isCashEquivalent: true,
    allowReconciliation: true,
    allowManualPosting: true,
    allowBudgeting: false,
    sortOrder: 11,
  },
  {
    key: 'mobile_money',
    name: 'Mobile Money',
    classification: 'asset',
    normalBalance: 'debit',
    reportSection: 'current_assets',
    cashFlowClass: 'operating',
    isContra: false,
    isCashEquivalent: true,
    allowReconciliation: true,
    allowManualPosting: true,
    allowBudgeting: false,
    sortOrder: 12,
  },
  {
    key: 'petty_cash',
    name: 'Petty Cash',
    classification: 'asset',
    normalBalance: 'debit',
    reportSection: 'current_assets',
    cashFlowClass: 'operating',
    isContra: false,
    isCashEquivalent: true,
    allowReconciliation: true,
    allowManualPosting: true,
    allowBudgeting: false,
    sortOrder: 13,
  },
  {
    key: 'receivable',
    name: 'Accounts Receivable',
    description: 'Customer subledger control. Aging and reconciliation.',
    classification: 'asset',
    normalBalance: 'debit',
    reportSection: 'current_assets',
    cashFlowClass: 'operating',
    isContra: false,
    isCashEquivalent: false,
    allowReconciliation: true,
    allowManualPosting: true,
    allowBudgeting: false,
    sortOrder: 20,
  },
  {
    key: 'inventory',
    name: 'Inventory',
    description: 'Stock valuation. Target of the inventory posting engine.',
    classification: 'asset',
    normalBalance: 'debit',
    reportSection: 'current_assets',
    cashFlowClass: 'operating',
    isContra: false,
    isCashEquivalent: false,
    allowReconciliation: false,
    allowManualPosting: true,
    allowBudgeting: false,
    sortOrder: 25,
  },
  {
    key: 'current_asset',
    name: 'Current Asset',
    classification: 'asset',
    normalBalance: 'debit',
    reportSection: 'current_assets',
    cashFlowClass: 'operating',
    isContra: false,
    isCashEquivalent: false,
    allowReconciliation: false,
    allowManualPosting: true,
    allowBudgeting: true,
    sortOrder: 30,
  },
  {
    key: 'non_current_asset',
    name: 'Non-current Asset',
    description: 'Fixed assets and other long-term assets. Asset register integration.',
    classification: 'asset',
    normalBalance: 'debit',
    reportSection: 'non_current_assets',
    cashFlowClass: 'investing',
    isContra: false,
    isCashEquivalent: false,
    allowReconciliation: false,
    allowManualPosting: true,
    allowBudgeting: true,
    sortOrder: 40,
  },
  {
    key: 'contra_asset',
    name: 'Contra Asset',
    description: 'Accumulated depreciation and similar asset offsets. Credit-normal.',
    classification: 'asset',
    normalBalance: 'credit',
    reportSection: 'non_current_assets',
    cashFlowClass: 'investing',
    isContra: true,
    isCashEquivalent: false,
    allowReconciliation: false,
    allowManualPosting: true,
    allowBudgeting: false,
    sortOrder: 45,
  },
  {
    key: 'payable',
    name: 'Accounts Payable',
    description: 'Supplier subledger control. Aging and reconciliation.',
    classification: 'liability',
    normalBalance: 'credit',
    reportSection: 'current_liabilities',
    cashFlowClass: 'operating',
    isContra: false,
    isCashEquivalent: false,
    allowReconciliation: true,
    allowManualPosting: true,
    allowBudgeting: false,
    sortOrder: 50,
  },
  {
    key: 'tax',
    name: 'Tax',
    description: 'Tax engine target (output VAT, WHT payable).',
    classification: 'liability',
    normalBalance: 'credit',
    reportSection: 'current_liabilities',
    cashFlowClass: 'operating',
    isContra: false,
    isCashEquivalent: false,
    allowReconciliation: true,
    allowManualPosting: true,
    allowBudgeting: false,
    sortOrder: 55,
  },
  {
    key: 'current_liability',
    name: 'Current Liability',
    classification: 'liability',
    normalBalance: 'credit',
    reportSection: 'current_liabilities',
    cashFlowClass: 'operating',
    isContra: false,
    isCashEquivalent: false,
    allowReconciliation: false,
    allowManualPosting: true,
    allowBudgeting: false,
    sortOrder: 60,
  },
  {
    key: 'non_current_liability',
    name: 'Non-current Liability',
    classification: 'liability',
    normalBalance: 'credit',
    reportSection: 'long_term_liabilities',
    cashFlowClass: 'financing',
    isContra: false,
    isCashEquivalent: false,
    allowReconciliation: false,
    allowManualPosting: true,
    allowBudgeting: false,
    sortOrder: 70,
  },
  {
    key: 'contra_liability',
    name: 'Contra Liability',
    classification: 'liability',
    normalBalance: 'debit',
    reportSection: 'long_term_liabilities',
    cashFlowClass: 'financing',
    isContra: true,
    isCashEquivalent: false,
    allowReconciliation: false,
    allowManualPosting: true,
    allowBudgeting: false,
    sortOrder: 75,
  },
  {
    key: 'equity',
    name: 'Equity',
    classification: 'equity',
    normalBalance: 'credit',
    reportSection: 'equity',
    cashFlowClass: 'financing',
    isContra: false,
    isCashEquivalent: false,
    allowReconciliation: false,
    allowManualPosting: true,
    allowBudgeting: false,
    sortOrder: 80,
  },
  {
    key: 'revenue',
    name: 'Revenue',
    classification: 'revenue',
    normalBalance: 'credit',
    reportSection: 'revenue',
    cashFlowClass: 'operating',
    isContra: false,
    isCashEquivalent: false,
    allowReconciliation: false,
    allowManualPosting: true,
    allowBudgeting: true,
    sortOrder: 90,
  },
  {
    key: 'contra_revenue',
    name: 'Contra Revenue',
    description: 'Sales discounts, returns and allowances. Debit-normal, nets against revenue.',
    classification: 'revenue',
    normalBalance: 'debit',
    reportSection: 'contra_revenue',
    cashFlowClass: 'operating',
    isContra: true,
    isCashEquivalent: false,
    allowReconciliation: false,
    allowManualPosting: true,
    allowBudgeting: true,
    sortOrder: 95,
  },
  {
    key: 'other_income',
    name: 'Other Income',
    description: 'Non-operating income (FX gains, purchase discounts).',
    classification: 'revenue',
    normalBalance: 'credit',
    reportSection: 'other_income',
    cashFlowClass: 'operating',
    isContra: false,
    isCashEquivalent: false,
    allowReconciliation: false,
    allowManualPosting: true,
    allowBudgeting: true,
    sortOrder: 100,
  },
  {
    key: 'cost_of_goods_sold',
    name: 'Cost of Goods Sold',
    classification: 'expense',
    normalBalance: 'debit',
    reportSection: 'cogs',
    cashFlowClass: 'operating',
    isContra: false,
    isCashEquivalent: false,
    allowReconciliation: false,
    allowManualPosting: true,
    allowBudgeting: true,
    sortOrder: 110,
  },
  {
    key: 'operating_expense',
    name: 'Operating Expense',
    classification: 'expense',
    normalBalance: 'debit',
    reportSection: 'operating_expense',
    cashFlowClass: 'operating',
    isContra: false,
    isCashEquivalent: false,
    allowReconciliation: false,
    allowManualPosting: true,
    allowBudgeting: true,
    sortOrder: 120,
  },
  {
    key: 'other_expense',
    name: 'Other Expense',
    description: 'Non-operating expense (FX losses, cash short & over, rounding).',
    classification: 'expense',
    normalBalance: 'debit',
    reportSection: 'other_expense',
    cashFlowClass: 'operating',
    isContra: false,
    isCashEquivalent: false,
    allowReconciliation: false,
    allowManualPosting: true,
    allowBudgeting: true,
    sortOrder: 130,
  },
  {
    key: 'off_balance',
    name: 'Off Balance Sheet',
    description: 'Memo accounts. Excluded from the balance sheet and the P&L.',
    classification: 'off_balance',
    normalBalance: 'debit',
    reportSection: 'off_balance',
    cashFlowClass: 'none',
    isContra: false,
    isCashEquivalent: false,
    allowReconciliation: false,
    allowManualPosting: true,
    allowBudgeting: false,
    sortOrder: 200,
  },
  // --- New categories (Fix #6) ------------------------------------------------
  {
    key: 'accumulated_depreciation',
    name: 'Accumulated Depreciation',
    description: 'Cumulative depreciation of fixed assets. Contra-asset, credit-normal.',
    classification: 'asset',
    normalBalance: 'credit',
    reportSection: 'non_current_assets',
    cashFlowClass: 'operating',
    isContra: true,
    isCashEquivalent: false,
    allowReconciliation: false,
    allowManualPosting: true,
    allowBudgeting: false,
    sortOrder: 46,
  },
  {
    key: 'accumulated_amortization',
    name: 'Accumulated Amortization',
    description: 'Cumulative amortization of intangible assets. Contra-asset, credit-normal.',
    classification: 'asset',
    normalBalance: 'credit',
    reportSection: 'non_current_assets',
    cashFlowClass: 'operating',
    isContra: true,
    isCashEquivalent: false,
    allowReconciliation: false,
    allowManualPosting: true,
    allowBudgeting: false,
    sortOrder: 47,
  },
  {
    key: 'work_in_progress',
    name: 'Work In Progress',
    description: 'Goods partially through production. Inventory subcategory for manufacturing.',
    classification: 'asset',
    normalBalance: 'debit',
    reportSection: 'current_assets',
    cashFlowClass: 'operating',
    isContra: false,
    isCashEquivalent: false,
    allowReconciliation: false,
    allowManualPosting: true,
    allowBudgeting: false,
    sortOrder: 26,
  },
  {
    key: 'construction_in_progress',
    name: 'Construction In Progress',
    description: 'Assets under construction / development. Non-current until completed.',
    classification: 'asset',
    normalBalance: 'debit',
    reportSection: 'non_current_assets',
    cashFlowClass: 'investing',
    isContra: false,
    isCashEquivalent: false,
    allowReconciliation: false,
    allowManualPosting: true,
    allowBudgeting: true,
    sortOrder: 41,
  },
  {
    key: 'deferred_revenue',
    name: 'Deferred Revenue',
    description: 'Customer prepayments and subscriptions. Liability until earned.',
    classification: 'liability',
    normalBalance: 'credit',
    reportSection: 'current_liabilities',
    cashFlowClass: 'operating',
    isContra: false,
    isCashEquivalent: false,
    allowReconciliation: false,
    allowManualPosting: true,
    allowBudgeting: false,
    sortOrder: 61,
  },
  {
    key: 'prepaid_expense',
    name: 'Prepaid Expense',
    description: 'Expenses paid in advance (insurance, rent). Current asset, amortized over time.',
    classification: 'asset',
    normalBalance: 'debit',
    reportSection: 'current_assets',
    cashFlowClass: 'operating',
    isContra: false,
    isCashEquivalent: false,
    allowReconciliation: true,
    allowManualPosting: true,
    allowBudgeting: true,
    sortOrder: 31,
  },
  {
    key: 'other_comprehensive_income',
    name: 'Other Comprehensive Income',
    description: 'Unrealised gains/losses bypassing the P&L (revaluation, FX translation). Equity classification.',
    classification: 'equity',
    normalBalance: 'credit',
    reportSection: 'equity',
    cashFlowClass: 'financing',
    isContra: false,
    isCashEquivalent: false,
    allowReconciliation: false,
    allowManualPosting: true,
    allowBudgeting: false,
    sortOrder: 81,
  },
];

export const ACCOUNT_CATEGORY_KEYS = ACCOUNT_CATEGORY_SEED.map((c) => c.key);

export const ACCOUNT_CATEGORY_BY_KEY: Record<string, AccountCategoryDef> = Object.fromEntries(
  ACCOUNT_CATEGORY_SEED.map((c) => [c.key, c]),
);

/** Categories that count as cash & cash equivalents. */
export const CASH_EQUIVALENT_CATEGORY_KEYS = ACCOUNT_CATEGORY_SEED.filter(
  (c) => c.isCashEquivalent,
).map((c) => c.key);

export interface ReportSectionDef {
  key: ReportSection;
  label: string;
  /** Balance-sheet side, or `null` for P&L / off-balance sections. */
  side: 'asset' | 'liability' | 'equity' | null;
  order: number;
}

export const REPORT_SECTION_DEFS: readonly ReportSectionDef[] = [
  { key: 'current_assets', label: 'Current Assets', side: 'asset', order: 10 },
  { key: 'non_current_assets', label: 'Non-current Assets', side: 'asset', order: 20 },
  { key: 'current_liabilities', label: 'Current Liabilities', side: 'liability', order: 30 },
  { key: 'long_term_liabilities', label: 'Long-term Liabilities', side: 'liability', order: 40 },
  { key: 'equity', label: "Stockholders' Equity", side: 'equity', order: 50 },
  { key: 'revenue', label: 'Revenue', side: null, order: 60 },
  { key: 'contra_revenue', label: 'Sales Discounts & Returns', side: null, order: 65 },
  { key: 'cogs', label: 'Cost of Sales', side: null, order: 70 },
  { key: 'operating_expense', label: 'Operating Expenses', side: null, order: 80 },
  { key: 'other_income', label: 'Other Income', side: null, order: 90 },
  { key: 'other_expense', label: 'Other Expenses', side: null, order: 100 },
  { key: 'off_balance', label: 'Off Balance Sheet', side: null, order: 200 },
];

export const REPORT_SECTION_BY_KEY: Record<string, ReportSectionDef> = Object.fromEntries(
  REPORT_SECTION_DEFS.map((s) => [s.key, s]),
);
