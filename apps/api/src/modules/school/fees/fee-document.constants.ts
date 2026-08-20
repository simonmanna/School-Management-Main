import type { Prisma } from '@prisma/client';

/**
 * Canonical school-fee document filters.
 *
 * Phase 0 (P0-1 / P0-7) of the Fees & Finance production-hardening plan. Before
 * this file the `sourceType` list was duplicated as a magic array in six places
 * and the lifecycle filter was applied inconsistently — `ReportingService`
 * filtered `status`, `AdvancedFinanceService` filtered a different set, and
 * `StudentService.statement` / `PortalsService.feeBalance` filtered nothing at
 * all. That let draft and cancelled documents into student balances, and let
 * `SchoolPaymentService.collect` settle a cancelled invoice.
 *
 * The rule these constants encode (FINANCIAL_INVARIANTS §Document):
 *
 *   Document.status        — LIFECYCLE. Decides whether the row participates
 *                            in balances at all.
 *   Document.paymentStatus — SETTLEMENT. Describes how far it has been paid.
 *                            NEVER a substitute for lifecycle filtering.
 */

/**
 * Every `sourceType` that represents money a student owes the school. A fee
 * balance that omits any of these understates what the family owes — the
 * original parent-portal defect (P0-1) omitted three of the four.
 */
export const SCHOOL_FEE_SOURCE_TYPES = [
  'school_fee',
  'school_penalty',
  'library_fine',
  'school_meal',
] as const;

/**
 * Lifecycle states in which a document is financially real.
 *
 * `paid` belongs here alongside `posted`: PaymentService promotes a document to
 * `status = 'paid'` once its residual reaches zero
 * (`payment.service.ts` — `status: newResidual.lessThanOrEqualTo(0) ? 'paid' : doc.status`).
 * Filtering on `posted` alone would therefore make a student's billed total
 * *shrink as they pay*, which is the same class of bug as P0-1.
 *
 * Excluded: `draft` (not yet issued) and `cancelled` (withdrawn). Neither is a
 * receivable, so neither may appear in a balance or be settled by a payment.
 */
export const ACTIVE_FEE_STATUSES = ['posted', 'paid'] as const;

/**
 * Financially active school-fee documents — the basis for *billed* totals.
 * Includes fully-settled invoices, which still count as billed.
 */
export const POSTED_FEE_WHERE: Prisma.DocumentWhereInput = {
  documentType: 'sales_invoice',
  sourceType: { in: [...SCHOOL_FEE_SOURCE_TYPES] },
  status: { in: [...ACTIVE_FEE_STATUSES] },
};

/**
 * Open school-fee documents — the basis for *outstanding* balances, aging,
 * defaulters, and payment allocation. Financially active AND still owing.
 */
export const OPEN_FEE_WHERE: Prisma.DocumentWhereInput = {
  ...POSTED_FEE_WHERE,
  paymentStatus: { in: ['not_paid', 'partial'] },
  amountResidual: { gt: 0 },
};
