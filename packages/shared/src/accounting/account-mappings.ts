/**
 * Well-known account-determination mapping keys (org-level GL defaults).
 *
 * This registry is the single source of truth. It replaces the hand-maintained
 * `ACCOUNT_MAPPING_KEYS` list, which had drifted: 14 keys were in live use by
 * posting code but missing from the catalog, so the UI could not surface them
 * and nothing validated that they were seeded.
 *
 * `expectedCategories` lets the API reject (and the UI filter out) an account of
 * the wrong kind — e.g. mapping `cogs` to a revenue account.
 */

export const ACCOUNT_MAPPING_GROUPS = [
  'ar_ap',
  'sales',
  'tax',
  'treasury',
  'inventory',
  'fixed_assets',
  'fx',
  'hr',
  'system',
] as const;
export type AccountMappingGroup = (typeof ACCOUNT_MAPPING_GROUPS)[number];

export const ACCOUNT_MAPPING_GROUP_LABELS: Record<AccountMappingGroup, string> = {
  ar_ap: 'Receivables & Payables',
  sales: 'Sales & Revenue',
  tax: 'Tax',
  treasury: 'Cash & Treasury',
  inventory: 'Inventory',
  fixed_assets: 'Fixed Assets',
  fx: 'Foreign Exchange',
  hr: 'Human Resources',
  system: 'System',
};

export interface AccountMappingDef {
  key: string;
  label: string;
  group: AccountMappingGroup;
  /** Categories an account must belong to for this mapping. Empty = any postable. */
  expectedCategories: readonly string[];
  /** Posting throws at runtime if unset — the COA seeder must produce it for every org. */
  required: boolean;
  description?: string;
}

export const ACCOUNT_MAPPING_REGISTRY: readonly AccountMappingDef[] = [
  // ---------------------------------------------------------------- ar_ap ---
  {
    key: 'accounts_receivable',
    label: 'Accounts Receivable',
    group: 'ar_ap',
    expectedCategories: ['receivable'],
    required: true,
    description: 'Default customer control account when the partner has no override.',
  },
  {
    key: 'accounts_payable',
    label: 'Accounts Payable',
    group: 'ar_ap',
    expectedCategories: ['payable'],
    required: true,
    description: 'Default supplier control account when the partner has no override.',
  },
  {
    key: 'bad_debt',
    label: 'Bad Debt Expense',
    group: 'ar_ap',
    expectedCategories: ['operating_expense', 'other_expense'],
    required: true,
    description: 'Written-off receivables.',
  },

  // ---------------------------------------------------------------- sales ---
  {
    key: 'sales_revenue',
    label: 'Sales Revenue',
    group: 'sales',
    expectedCategories: ['revenue'],
    required: true,
    description: 'Fallback revenue account when neither the line nor the product category sets one.',
  },
  {
    key: 'sales_discount',
    label: 'Sales Discount',
    group: 'sales',
    expectedCategories: ['contra_revenue', 'revenue'],
    required: true,
    description: 'Discounts granted at the point of sale. Debit-normal contra revenue.',
  },
  {
    key: 'purchase_discount',
    label: 'Purchase Discount Received',
    group: 'sales',
    expectedCategories: ['other_income', 'revenue'],
    required: true,
  },
  {
    key: 'default_expense',
    label: 'Default Expense',
    group: 'sales',
    expectedCategories: ['operating_expense', 'other_expense'],
    required: true,
    description: 'Fallback expense account for purchases with no category mapping.',
  },
  {
    key: 'store_credit',
    label: 'Store Credit Liability',
    group: 'sales',
    expectedCategories: ['current_liability'],
    required: true,
  },
  {
    key: 'gift_card_liability',
    label: 'Gift Card Liability',
    group: 'sales',
    expectedCategories: ['current_liability'],
    required: true,
  },
  {
    key: 'unearned_revenue',
    label: 'Unearned Revenue',
    group: 'sales',
    expectedCategories: ['current_liability'],
    required: true,
    description: 'Deferred revenue for goods or services not yet delivered.',
  },
  {
    key: 'customer_deposit',
    label: 'Customer Deposits',
    group: 'sales',
    expectedCategories: ['current_liability'],
    required: true,
    description: 'Refundable deposits held against rental agreements (a liability, never revenue).',
  },
  {
    key: 'rental_income',
    label: 'Rental Income',
    group: 'sales',
    expectedCategories: ['revenue'],
    required: true,
    description: 'Rental fee revenue from agreements (checked-out fee lines).',
  },
  {
    key: 'late_fee_income',
    label: 'Late Fee Income',
    group: 'sales',
    expectedCategories: ['revenue', 'other_income'],
    required: true,
    description: 'Late-return and extension fees charged at settlement.',
  },
  {
    key: 'damage_recovery_income',
    label: 'Damage Recovery Income',
    group: 'sales',
    expectedCategories: ['revenue', 'other_income'],
    required: true,
    description: 'Damage / replacement / missing-item recovery and forfeited deposits.',
  },

  // ------------------------------------------------------------------ tax ---
  {
    key: 'tax_payable',
    label: 'Tax Payable (Output)',
    group: 'tax',
    expectedCategories: ['tax', 'current_liability'],
    required: true,
  },
  {
    key: 'tax_receivable',
    label: 'Tax Receivable (Input)',
    group: 'tax',
    expectedCategories: ['current_asset', 'receivable'],
    required: true,
    description: 'Recoverable input VAT — an asset, not a negative liability.',
  },
  {
    key: 'withholding_payable',
    label: 'Withholding Tax Payable',
    group: 'tax',
    expectedCategories: ['tax', 'current_liability'],
    required: true,
  },

  // ------------------------------------------------------------- treasury ---
  {
    key: 'default_cash',
    label: 'Default Cash',
    group: 'treasury',
    expectedCategories: ['cash'],
    required: true,
  },
  {
    key: 'default_bank',
    label: 'Default Bank',
    group: 'treasury',
    expectedCategories: ['bank'],
    required: true,
  },
  {
    key: 'petty_cash',
    label: 'Petty Cash',
    group: 'treasury',
    expectedCategories: ['petty_cash', 'cash'],
    required: true,
  },
  {
    key: 'cash_clearing',
    label: 'Cash Clearing',
    group: 'treasury',
    expectedCategories: ['current_asset'],
    required: true,
    description: 'Holds drawer takings between session close and bank deposit.',
  },
  {
    key: 'cash_short_over',
    label: 'Cash Short & Over',
    group: 'treasury',
    expectedCategories: ['other_expense', 'operating_expense'],
    required: true,
    description: 'Cash session close variance.',
  },
  {
    key: 'cash_suspense',
    label: 'Cash Suspense',
    group: 'treasury',
    expectedCategories: ['current_asset'],
    required: true,
  },

  // --------------------------------------------------------------- system ---
  {
    key: 'suspense',
    label: 'Suspense',
    group: 'system',
    expectedCategories: ['current_asset'],
    required: true,
  },
  {
    key: 'rounding',
    label: 'Rounding Difference',
    group: 'system',
    expectedCategories: ['other_expense', 'operating_expense'],
    required: true,
  },
  {
    key: 'retained_earnings',
    label: 'Retained Earnings',
    group: 'system',
    expectedCategories: ['equity'],
    required: true,
    description: 'Period-close target for the P&L roll-up.',
  },

  // ------------------------------------------------------------ inventory ---
  {
    key: 'stock_valuation',
    label: 'Stock Valuation',
    group: 'inventory',
    expectedCategories: ['inventory', 'current_asset'],
    required: true,
  },
  {
    key: 'inventory',
    label: 'Inventory (alias of Stock Valuation)',
    group: 'inventory',
    expectedCategories: ['inventory', 'current_asset'],
    required: false,
    description: 'Legacy alias read as a fallback by the inventory valuation report.',
  },
  {
    key: 'stock_in_transit',
    label: 'Stock In Transit',
    group: 'inventory',
    expectedCategories: ['inventory', 'current_asset'],
    required: true,
  },
  {
    key: 'cogs',
    label: 'Cost of Goods Sold',
    group: 'inventory',
    expectedCategories: ['cost_of_goods_sold'],
    required: true,
  },
  {
    key: 'grni_accrued',
    label: 'Goods Received Not Invoiced',
    group: 'inventory',
    expectedCategories: ['current_liability'],
    required: true,
  },
  {
    key: 'stock_adjustment_income',
    label: 'Stock Adjustment Income',
    group: 'inventory',
    expectedCategories: ['other_income', 'revenue'],
    required: true,
  },
  {
    key: 'stock_adjustment_expense',
    label: 'Stock Adjustment Expense',
    group: 'inventory',
    expectedCategories: ['operating_expense', 'other_expense'],
    required: true,
  },
  {
    key: 'wip',
    label: 'Work In Progress',
    group: 'inventory',
    // `work_in_progress` MUST be first/listed — AccountResolverService enforces
    // expectedCategories at mapping-set time, and the WIP account created by the
    // COA seeder carries categoryKey `work_in_progress`. Without it here the `wip`
    // mapping is unsettable and every production posting silently degrades.
    expectedCategories: ['work_in_progress', 'inventory', 'current_asset'],
    required: false,
    description: 'Manufacturing WIP. Only required when production orders are in use.',
  },
  {
    key: 'overhead_absorbed',
    label: 'Manufacturing Overhead Absorbed',
    group: 'inventory',
    // Credited when overhead (labour/machine/utility) is absorbed into WIP; a
    // contra to the actual overhead expenses booked elsewhere. Net = over/under
    // absorption. Only needed once Phase 4 absorption costing is in use.
    expectedCategories: ['operating_expense', 'other_income'],
    required: false,
    description: 'Overhead absorbed into WIP (Phase 4 absorption costing).',
  },

  // --------------------------------------------------------- fixed_assets ---
  {
    key: 'fixed_asset_valuation',
    label: 'Fixed Asset Valuation',
    group: 'fixed_assets',
    expectedCategories: ['non_current_asset'],
    required: true,
  },
  {
    key: 'accumulated_depreciation',
    label: 'Accumulated Depreciation',
    group: 'fixed_assets',
    expectedCategories: ['contra_asset'],
    required: true,
  },
  {
    key: 'depreciation_expense',
    label: 'Depreciation Expense',
    group: 'fixed_assets',
    expectedCategories: ['operating_expense'],
    required: true,
  },
  {
    key: 'asset_gain_loss',
    label: 'Asset Disposal Gain/Loss',
    group: 'fixed_assets',
    expectedCategories: ['other_income', 'other_expense'],
    required: true,
  },
  {
    key: 'asset_revaluation_surplus',
    label: 'Asset Revaluation Surplus',
    group: 'fixed_assets',
    expectedCategories: ['equity'],
    required: true,
  },

  // ------------------------------------------------------------------- fx ---
  {
    key: 'fx_gain',
    label: 'Foreign Exchange Gain',
    group: 'fx',
    expectedCategories: ['other_income', 'revenue'],
    required: true,
  },
  {
      key: 'fx_loss',
      label: 'Foreign Exchange Loss',
      group: 'fx',
      expectedCategories: ['other_expense', 'operating_expense'],
      required: true,
    },

    // ------------------------------------------------------------------- hr ---
    // Workforce Management (HR) — payroll posting accounts. Salaries are expensed
    // gross; net pay, PAYE, pension and social security are liabilities until paid.
    {
      key: 'salary_expense',
      label: 'Salaries & Wages Expense',
      group: 'hr',
      expectedCategories: ['operating_expense'],
      required: true,
      description: 'Gross payroll expense for the posting period.',
    },
    {
      key: 'net_pay_payable',
      label: 'Net Pay Payable',
      group: 'hr',
      expectedCategories: ['current_liability'],
      required: true,
      description: 'Net wages owed to employees until the pay run is disbursed.',
    },
    {
      key: 'paye_payable',
      label: 'PAYE Tax Payable',
      group: 'hr',
      expectedCategories: ['current_liability'],
      required: true,
      description: 'Withheld income tax remitted to the tax authority.',
    },
    {
      key: 'pension_payable',
      label: 'Pension Payable',
      group: 'hr',
      expectedCategories: ['current_liability'],
      required: true,
      description: 'Employer + employee pension contributions owed to the fund.',
    },
    {
      key: 'social_security_payable',
      label: 'Social Security Payable',
      group: 'hr',
      expectedCategories: ['current_liability'],
      required: true,
    },
    {
      key: 'insurance_payable',
      label: 'Insurance Payable',
      group: 'hr',
      expectedCategories: ['current_liability'],
      required: true,
    },
    {
      key: 'employee_advance_receivable',
      label: 'Employee Advances',
      group: 'hr',
      expectedCategories: ['current_asset'],
      required: true,
      description: 'Advances paid to employees, recoverable from future pay.',
    },
    {
      key: 'employee_loan_receivable',
      label: 'Employee Loans',
      group: 'hr',
      expectedCategories: ['current_asset'],
      required: true,
      description: 'Loans extended to employees, recoverable from future pay.',
    },
  ];

export const ACCOUNT_MAPPING_KEYS: string[] = ACCOUNT_MAPPING_REGISTRY.map((m) => m.key);
export type AccountMappingKey = string;

export const ACCOUNT_MAPPING_BY_KEY: Record<string, AccountMappingDef> = Object.fromEntries(
  ACCOUNT_MAPPING_REGISTRY.map((m) => [m.key, m]),
);

export const ACCOUNT_MAPPING_LABELS: Record<string, string> = Object.fromEntries(
  ACCOUNT_MAPPING_REGISTRY.map((m) => [m.key, m.label]),
);

/** Keys the posting engine will throw on if unmapped. Seeders must cover all of these. */
export const REQUIRED_ACCOUNT_MAPPING_KEYS: string[] = ACCOUNT_MAPPING_REGISTRY.filter(
  (m) => m.required,
).map((m) => m.key);

/** True when `categoryKey` is an acceptable category for `mappingKey`. */
export function isCategoryValidForMapping(mappingKey: string, categoryKey: string): boolean {
  const def = ACCOUNT_MAPPING_BY_KEY[mappingKey];
  if (!def || def.expectedCategories.length === 0) return true;
  return def.expectedCategories.includes(categoryKey);
}
