import {
  ACCOUNT_CATEGORY_SEED,
  type AccountCategoryDef,
  type CashFlowClass,
  type ControlAccountType,
} from '@erp/shared';

/**
 * The single default chart of accounts.
 *
 * Previously this lived twice — `prisma/seed.ts` (39 accounts, 30 mappings) and
 * `OrganizationsService.seedChartOfAccounts` (19 accounts, 14 mappings). The two
 * had drifted, so every newly created organization threw
 * `BadRequestException: Account mapping '<key>' is not configured` from the
 * posting engine on 16 different keys. Both seeders now consume this file.
 *
 * Pure data, no imports beyond `@erp/shared`, so both the NestJS runtime and the
 * standalone prisma seed script can use it.
 */

export { ACCOUNT_CATEGORY_SEED };
export type { AccountCategoryDef };

export interface CoaAccountDef {
  code: string;
  name: string;
  /**
   * Behavior. Must be a key from ACCOUNT_CATEGORY_SEED, or `null` for a group
   * node. Invariant: `categoryKey === null` exactly when `isPostable === false`
   * — a category describes accounting behavior, which only a postable account
   * has; group nodes are folders in the reporting tree.
   */
  categoryKey: string | null;
  /** Reporting hierarchy. Resolved to `parentAccountId` in a second pass. */
  parentCode?: string;
  isPostable?: boolean;
  /** Overrides `category.cashFlowClass` when the account needs its own class. */
  cashFlowCategory?: CashFlowClass;
  isDefault?: boolean;
  controlAccountType?: ControlAccountType;
  bankName?: string | null;
  accountNumber?: string | null;
  sortOrder?: number;
}

/**
 * Union of both legacy seeders, **with `parentCode` populated** — the old
 * seeders left `parentAccountId` null everywhere, so the five group headers had
 * no children and the hierarchy was decorative.
 */
export const COA_TEMPLATE: readonly CoaAccountDef[] = [
  // --- Assets --------------------------------------------------------------
  { code: '1000', name: 'Assets', categoryKey: null, isPostable: false, sortOrder: 1000 },
  { code: '1100', name: 'Cash', categoryKey: 'cash', parentCode: '1000', sortOrder: 1100 },
  { code: '1200', name: 'Bank', categoryKey: 'bank', parentCode: '1000', sortOrder: 1200 },
  { code: '1300', name: 'Accounts Receivable', categoryKey: 'receivable', parentCode: '1000', controlAccountType: 'ar', sortOrder: 1300 },
  { code: '1400', name: 'Inventory / Stock Valuation', categoryKey: 'inventory', parentCode: '1000', controlAccountType: 'inventory', sortOrder: 1400 },
  { code: '1450', name: 'Input VAT Receivable', categoryKey: 'current_asset', parentCode: '1000', sortOrder: 1450 },
  { code: '1490', name: 'Accumulated Depreciation', categoryKey: 'contra_asset', parentCode: '1000', sortOrder: 1490 },
  // Gross carrying amount of capitalised assets. `fixed_asset_valuation` used to
  // map to '1000' — the non-postable "Assets" header — so every fixed-asset
  // capitalisation resolved to a summary node with no accounting category.
  { code: '1600', name: 'Fixed Assets', categoryKey: 'non_current_asset', parentCode: '1000', sortOrder: 1600 },
  { code: '1500', name: 'Stock In Transit', categoryKey: 'inventory', parentCode: '1000', sortOrder: 1500 },
  // Manufacturing work-in-progress. Raw materials debit here on production
  // consume and clear on production output; the balance is Σ open orders' cost.
  { code: '1420', name: 'Work In Progress', categoryKey: 'work_in_progress', parentCode: '1000', sortOrder: 1420 },
  // Cash drawer pay-in / pay-out suspense — back-office reclassifies to the
  // real counter-account later (petty cash, safe transfer, misc income…).
  { code: '1900', name: 'Cash Clearing (Suspense)', categoryKey: 'current_asset', parentCode: '1000', sortOrder: 1900 },
  { code: '1950', name: 'Suspense', categoryKey: 'current_asset', parentCode: '1000', sortOrder: 1950 },
  // Payment accounts used on receipts & payments (visible in POS tender selection).
  { code: 'CASH-DEFAULT', name: 'Cash Drawer', categoryKey: 'cash', parentCode: '1000', isDefault: true, sortOrder: 1110 },
  { code: 'BANK-DEFAULT', name: 'Bank Account 1', categoryKey: 'bank', parentCode: '1000', isDefault: true, sortOrder: 1210 },
  { code: 'MOMO-MTN', name: 'MTN Mobile Money', categoryKey: 'mobile_money', parentCode: '1000', isDefault: true, sortOrder: 1220 },
  { code: 'MOMO-AIRTEL', name: 'Airtel Money', categoryKey: 'mobile_money', parentCode: '1000', sortOrder: 1221 },
  { code: 'PETTY', name: 'Petty Cash', categoryKey: 'petty_cash', parentCode: '1000', sortOrder: 1120 },

  // --- Liabilities ---------------------------------------------------------
  { code: '2000', name: 'Liabilities', categoryKey: null, isPostable: false, sortOrder: 2000 },
  { code: '2100', name: 'Accounts Payable', categoryKey: 'payable', parentCode: '2000', controlAccountType: 'ap', sortOrder: 2100 },
  { code: '2150', name: 'Goods Received Not Invoiced (GRNI)', categoryKey: 'current_liability', parentCode: '2000', sortOrder: 2150 },
  { code: '2160', name: 'Withholding Tax Payable', categoryKey: 'current_liability', parentCode: '2000', sortOrder: 2160 },
  { code: '2170', name: 'Gift Card Liability', categoryKey: 'current_liability', parentCode: '2000', sortOrder: 2170 },
  { code: '2200', name: 'Tax Payable', categoryKey: 'tax', parentCode: '2000', sortOrder: 2200 },
  { code: '2300', name: 'Store Credit Liability', categoryKey: 'current_liability', parentCode: '2000', sortOrder: 2300 },
  { code: '2400', name: 'Unearned Revenue', categoryKey: 'current_liability', parentCode: '2000', sortOrder: 2400 },

  // --- Equity --------------------------------------------------------------
  { code: '3000', name: 'Equity', categoryKey: null, isPostable: false, sortOrder: 3000 },
  { code: '3100', name: 'Retained Earnings', categoryKey: 'equity', parentCode: '3000', sortOrder: 3100 },

  // --- Revenue -------------------------------------------------------------
  { code: '4000', name: 'Revenue', categoryKey: null, isPostable: false, sortOrder: 4000 },
  { code: '4100', name: 'Sales Revenue', categoryKey: 'revenue', parentCode: '4000', sortOrder: 4100 },
  { code: '4200', name: 'Stock Adjustment Income', categoryKey: 'other_income', parentCode: '4000', sortOrder: 4200 },
  // Contra-revenue: order/line discounts post here (debit) instead of reducing
  // Sales Revenue, so gross sales and total discounts are both visible on the P&L.
  { code: '4900', name: 'Sales Discounts', categoryKey: 'contra_revenue', parentCode: '4000', sortOrder: 4900 },
  { code: '4910', name: 'Purchase Discounts Received', categoryKey: 'other_income', parentCode: '4000', sortOrder: 4910 },
  { code: '7100', name: 'Foreign Exchange Gain', categoryKey: 'other_income', parentCode: '4000', sortOrder: 7100 },

  // --- Expenses ------------------------------------------------------------
  { code: '5000', name: 'Expenses', categoryKey: null, isPostable: false, sortOrder: 5000 },
  { code: '5100', name: 'Cost of Goods Sold', categoryKey: 'cost_of_goods_sold', parentCode: '5000', sortOrder: 5100 },
  { code: '5200', name: 'Operating Expenses', categoryKey: 'operating_expense', parentCode: '5000', sortOrder: 5200 },
  { code: '5300', name: 'Stock Adjustment Expense', categoryKey: 'operating_expense', parentCode: '5000', sortOrder: 5300 },
  // Contra to actual overhead expenses — credited as overhead is absorbed into
  // WIP on a production order. Net of this and the real overhead accounts is the
  // period's over/under-absorption.
  { code: '5350', name: 'Manufacturing Overhead Absorbed', categoryKey: 'operating_expense', parentCode: '5000', sortOrder: 5350 },
  // Cash drawer over/short at shift close (also used for manual adjustments).
  { code: '5400', name: 'Cash Short & Over', categoryKey: 'operating_expense', parentCode: '5000', sortOrder: 5400 },
  // Invoice write-offs (Dr bad debt / Cr AR) — required by POS write-off.
  { code: '5500', name: 'Bad Debt Expense', categoryKey: 'operating_expense', parentCode: '5000', sortOrder: 5500 },
  { code: '5600', name: 'Depreciation Expense', categoryKey: 'operating_expense', parentCode: '5000', sortOrder: 5600 },
  // Rental Management — deposit liability (customer money held, not revenue).
  { code: '2175', name: 'Customer Deposits', categoryKey: 'current_liability', parentCode: '2000', sortOrder: 2175 },
  // Rental Management — revenue accounts for fee lines. Fee products
  // (RENT-LATE / RENT-DAMAGE / RENT-MISSING / RENT-EXTEND) override to these.
  { code: '4250', name: 'Rental Income', categoryKey: 'revenue', parentCode: '4000', sortOrder: 4250 },
  { code: '4260', name: 'Late Fee Income', categoryKey: 'revenue', parentCode: '4000', sortOrder: 4260 },
  { code: '4270', name: 'Damage Recovery Income', categoryKey: 'revenue', parentCode: '4000', sortOrder: 4270 },
  { code: '7200', name: 'Foreign Exchange Loss', categoryKey: 'operating_expense', parentCode: '5000', sortOrder: 7200 },
  // Gain or loss on fixed-asset disposal. Non-operating, so it sits outside the
  // operating-expense line.
  { code: '7300', name: 'Asset Disposal Gain/Loss', categoryKey: 'other_expense', parentCode: '5000', sortOrder: 7300 },
  // Auto-provisioned by the posting engine when a rounding difference occurs;
  // seeding it up front avoids a mid-transaction account create.
  { code: 'ROUNDING', name: 'Rounding Difference', categoryKey: 'other_expense', parentCode: '5000', sortOrder: 5900 },
  // Workforce Management (HR) — payroll posting accounts. Salaries are expensed
  // gross; net pay, PAYE, pension and social security are liabilities until paid.
  { code: '1350', name: 'Employee Advances', categoryKey: 'current_asset', parentCode: '1000', sortOrder: 1350 },
  { code: '1355', name: 'Employee Loans', categoryKey: 'current_asset', parentCode: '1000', sortOrder: 1355 },
  { code: '2180', name: 'Net Pay Payable', categoryKey: 'current_liability', parentCode: '2000', sortOrder: 2180 },
  { code: '2210', name: 'PAYE Tax Payable', categoryKey: 'current_liability', parentCode: '2000', sortOrder: 2210 },
  { code: '2220', name: 'Pension Payable', categoryKey: 'current_liability', parentCode: '2000', sortOrder: 2220 },
  { code: '2230', name: 'Social Security Payable', categoryKey: 'current_liability', parentCode: '2000', sortOrder: 2230 },
  { code: '2240', name: 'Insurance Payable', categoryKey: 'current_liability', parentCode: '2000', sortOrder: 2240 },
  { code: '5710', name: 'Salaries & Wages Expense', categoryKey: 'operating_expense', parentCode: '5000', sortOrder: 5710 },
];

/**
 * Every `required: true` mapping key -> a template code. A CI test asserts this
 * covers `REQUIRED_ACCOUNT_MAPPING_KEYS`, which is what would have caught the
 * original drift.
 */
export const COA_MAPPINGS: Record<string, string> = {
  accounts_receivable: '1300',
  accounts_payable: '2100',
  bad_debt: '5500',

  sales_revenue: '4100',
  sales_discount: '4900',
  purchase_discount: '4910',
  default_expense: '5200',
  store_credit: '2300',
  gift_card_liability: '2170',
  unearned_revenue: '2400',

  tax_payable: '2200',
  tax_receivable: '1450',
  withholding_payable: '2160',

  default_cash: '1100',
  default_bank: '1200',
  petty_cash: 'PETTY',
  cash_clearing: '1900',
  cash_short_over: '5400',
  cash_suspense: '1900',

  suspense: '1950',
  rounding: 'ROUNDING',
  retained_earnings: '3100',

  stock_valuation: '1400',
  inventory: '1400',
  stock_in_transit: '1500',
  cogs: '5100',
  grni_accrued: '2150',
  stock_adjustment_income: '4200',
  stock_adjustment_expense: '5300',
  wip: '1420',
  overhead_absorbed: '5350',

  fixed_asset_valuation: '1600',
  accumulated_depreciation: '1490',
  depreciation_expense: '5600',
  asset_gain_loss: '7300',
  asset_revaluation_surplus: '3100',

  customer_deposit: '2175',
  rental_income: '4250',
  late_fee_income: '4260',
  damage_recovery_income: '4270',

  fx_gain: '7100',
  fx_loss: '7200',

  // Workforce Management (HR) — payroll posting accounts.
  salary_expense: '5710',
  net_pay_payable: '2180',
  paye_payable: '2210',
  pension_payable: '2220',
  social_security_payable: '2230',
  insurance_payable: '2240',
  employee_advance_receivable: '1350',
  employee_loan_receivable: '1355',
};

export interface CoaJournalDef {
  code: string;
  name: string;
  journalType: string;
  /** Template code resolved to an account id by the seeder. */
  defaultDebitCode?: string;
}

export const COA_JOURNALS: readonly CoaJournalDef[] = [
  { code: 'GEN', name: 'General Journal', journalType: 'general' },
  { code: 'SALES', name: 'Sales Journal', journalType: 'sales' },
  { code: 'PURCH', name: 'Purchase Journal', journalType: 'purchase' },
  { code: 'CASH', name: 'Cash Journal', journalType: 'cash', defaultDebitCode: '1100' },
  { code: 'BANK', name: 'Bank Journal', journalType: 'bank', defaultDebitCode: '1200' },
  { code: 'INV', name: 'Inventory Journal', journalType: 'general' },
  { code: 'ADJ', name: 'Adjustment Journal', journalType: 'adjustment' },
];
