/**
 * School-finance GL accounts that are created on first use. One definition per
 * account so every caller agrees on code, category and mapping key; the mapping
 * key lets an accountant repoint any of them in Account Mappings.
 */
export interface SchoolAccountDef {
  code: string;
  name: string;
  categoryKey: string;
  mappingKey: string;
}

export const SCHOOL_ACCOUNTS = {
  feeCredit: { code: 'FEE-CR', name: 'Fee Credit Liability', categoryKey: 'current_liability', mappingKey: 'fee_credit' },
  feeWaiver: { code: 'FEE-WAIVER', name: 'Fee Waiver Expense', categoryKey: 'operating_expense', mappingKey: 'fee_waiver' },
  feeAdjustmentIncome: {
    code: 'FEE-ADJ-INC',
    name: 'Fee Adjustment Income',
    categoryKey: 'revenue',
    mappingKey: 'fee_adjustment_income',
  },
  feeAdjustmentExpense: {
    code: 'FEE-ADJ-EXP',
    name: 'Fee Adjustment Expense',
    categoryKey: 'operating_expense',
    mappingKey: 'fee_adjustment_expense',
  },
  admissionFeeRevenue: {
    code: 'ADM-FEE',
    name: 'Admission Fee Revenue',
    categoryKey: 'revenue',
    mappingKey: 'admission_fee_revenue',
  },
  mealStoredValue: { code: 'MEAL-SVL', name: 'Cafeteria Stored Value', categoryKey: 'current_liability', mappingKey: 'meal_stored_value' },
  mealRevenue: { code: 'MEAL-REV', name: 'Cafeteria Revenue', categoryKey: 'revenue', mappingKey: 'meal_revenue' },
} as const satisfies Record<string, SchoolAccountDef>;
