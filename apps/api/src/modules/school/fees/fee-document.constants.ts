import type { Prisma } from '@prisma/client';

/**
 * Canonical school financial-document classification.
 *
 * The rule (FINANCIAL_INVARIANTS §Document):
 *
 *   Document.status        — LIFECYCLE. Decides whether the row participates
 *                            in balances at all.
 *   Document.paymentStatus — SETTLEMENT. Describes how far it has been paid.
 *                            NEVER a substitute for lifecycle filtering.
 *
 * Which `sourceType`s are student receivables is declared once, per source, in
 * FINANCIAL_DOCUMENT_PROFILES. Every balance, aging, clearance, portal, statement
 * and collection query derives its filter from these profiles, so adding a new
 * billable source means adding one profile — not hunting for magic arrays.
 */

export type BalanceClass = 'receivable' | 'stored_value' | 'deposit';

export interface FinancialDocumentProfile {
  sourceType: string;
  label: string;
  balanceClass: BalanceClass;
  /** Included in student / family outstanding balance, statements, clearance, portal. */
  countsTowardStudentBalance: boolean;
  countsTowardAging: boolean;
  /** A fee payment may be allocated against it (explicitly or oldest-first). */
  collectable: boolean;
  /** Overpayment against it may be refunded. */
  refundable: boolean;
  revenueBearing: boolean;
  taxable: boolean;
}

const receivable = (sourceType: string, label: string, taxable = false): FinancialDocumentProfile => ({
  sourceType,
  label,
  balanceClass: 'receivable',
  countsTowardStudentBalance: true,
  countsTowardAging: true,
  collectable: true,
  refundable: true,
  revenueBearing: true,
  taxable,
});

export const FINANCIAL_DOCUMENT_PROFILES: readonly FinancialDocumentProfile[] = [
  receivable('school_fee', 'Tuition & term fees', true),
  receivable('school_penalty', 'Late-payment penalty'),
  receivable('library_fine', 'Library fine'),
  receivable('school_meal', 'Meal plan', true),
  receivable('school_transport', 'Transport', true),
  receivable('school_admission_fee', 'Admission / application fee'),
  {
    // Re-audit #3 P0-2: cash refunded out of a receipt that was later reversed
    // (bounced cheque). Owed by the family, but it is not income.
    ...receivable('school_payment_recovery', 'Refund recovered after reversed receipt'),
    revenueBearing: false,
  },
  {
    // Cafeteria wallet: prepaid stored value, never an invoice. Listed so the
    // classification is explicit rather than an omission.
    sourceType: 'meal_wallet',
    label: 'Cafeteria wallet',
    balanceClass: 'stored_value',
    countsTowardStudentBalance: false,
    countsTowardAging: false,
    collectable: false,
    refundable: true,
    revenueBearing: false,
    taxable: false,
  },
];

const PROFILE_BY_SOURCE = new Map(FINANCIAL_DOCUMENT_PROFILES.map((p) => [p.sourceType, p]));

export function financialProfile(sourceType: string | null | undefined): FinancialDocumentProfile | undefined {
  return sourceType ? PROFILE_BY_SOURCE.get(sourceType) : undefined;
}

/** Every `sourceType` that represents money a student (or their payer) owes the school. */
export const SCHOOL_FEE_SOURCE_TYPES: readonly string[] = FINANCIAL_DOCUMENT_PROFILES.filter(
  (p) => p.countsTowardStudentBalance,
).map((p) => p.sourceType);

export const COLLECTABLE_FEE_SOURCE_TYPES: readonly string[] = FINANCIAL_DOCUMENT_PROFILES.filter(
  (p) => p.collectable,
).map((p) => p.sourceType);

export const AGING_FEE_SOURCE_TYPES: readonly string[] = FINANCIAL_DOCUMENT_PROFILES.filter(
  (p) => p.countsTowardAging,
).map((p) => p.sourceType);

/**
 * Lifecycle states in which a document is financially real. `paid` belongs here:
 * PaymentService promotes a document to `status = 'paid'` once its residual
 * reaches zero, and a billed total must not shrink as the family pays.
 * Excluded: `draft` (not issued) and `cancelled` (voided).
 */
export const ACTIVE_FEE_STATUSES = ['posted', 'paid'] as const;

/** Settlement states that still owe money. */
export const OPEN_PAYMENT_STATUSES = ['not_paid', 'partial'] as const;

/** Financially active school-fee documents — the basis for *billed* totals. */
export const POSTED_FEE_WHERE: Prisma.DocumentWhereInput = {
  documentType: 'sales_invoice',
  sourceType: { in: [...SCHOOL_FEE_SOURCE_TYPES] },
  status: { in: [...ACTIVE_FEE_STATUSES] },
};

/** Open school-fee documents — outstanding balances, aging, defaulters, allocation. */
export const OPEN_FEE_WHERE: Prisma.DocumentWhereInput = {
  ...POSTED_FEE_WHERE,
  paymentStatus: { in: [...OPEN_PAYMENT_STATUSES] },
  amountResidual: { gt: 0 },
};

/** Documents a fee payment may settle. */
export const COLLECTABLE_FEE_WHERE: Prisma.DocumentWhereInput = {
  documentType: 'sales_invoice',
  sourceType: { in: [...COLLECTABLE_FEE_SOURCE_TYPES] },
  status: { in: [...ACTIVE_FEE_STATUSES] },
};

export const OPEN_COLLECTABLE_FEE_WHERE: Prisma.DocumentWhereInput = {
  ...COLLECTABLE_FEE_WHERE,
  paymentStatus: { in: [...OPEN_PAYMENT_STATUSES] },
  amountResidual: { gt: 0 },
};

/**
 * StudentProfile statuses a term invoice is raised for. Suspension is
 * disciplinary, not departure: the pupil keeps their seat and is billed
 * (owner decision D3, re-audit #3, 2026-09-25).
 */
export const BILLABLE_STUDENT_STATUSES = ['active', 'suspended'] as const;
