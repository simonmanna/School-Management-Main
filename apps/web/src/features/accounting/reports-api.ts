/**
 * Detailed accounting reports — data layer.
 *
 * One hook per report, all served by `reports/accounting/*` and gated on
 * `report:accounting`. Every amount crosses the wire as a decimal STRING (the
 * API never rounds to a JS float); format with `money()`, and do arithmetic
 * with `Number()` only for display-level things like chart scales.
 */
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

export interface Period {
  from: string;
  to: string;
}

export interface PeriodParams {
  from?: string;
  to?: string;
}

interface Variance {
  variance: string;
  variancePercent: string | null;
}

// ───────────────────────────── extended trial balance ──────────────────────

export interface ExtendedTrialBalanceRow {
  accountId: string;
  code: string;
  name: string;
  classification: string | null;
  reportSection: string | null;
  sectionLabel: string;
  normalBalance: 'debit' | 'credit';
  openingDebit: string;
  openingCredit: string;
  periodDebit: string;
  periodCredit: string;
  closingDebit: string;
  closingCredit: string;
  closingBalance: string;
}

export interface ExtendedTrialBalance {
  period: Period;
  rows: ExtendedTrialBalanceRow[];
  totals: Record<string, string>;
  balanced: boolean;
  generatedAt: string;
}

export function useExtendedTrialBalance(params: PeriodParams & { includeZero?: boolean }) {
  return useQuery({
    queryKey: ['acct-report', 'extended-trial-balance', params],
    queryFn: async () =>
      (await api.get<ExtendedTrialBalance>('/reports/accounting/extended-trial-balance', { params }))
        .data,
  });
}

// ───────────────────────────── income statement ────────────────────────────

export interface StatementRow extends Variance {
  accountId: string | null;
  code: string;
  name: string;
  amount: string;
  priorAmount: string;
  percentOfRevenue?: string;
  derived?: boolean;
}

export interface StatementSection extends Variance {
  key: string;
  label: string;
  rows: StatementRow[];
  subtotal: string;
  priorSubtotal: string;
  percentOfRevenue?: string;
  side?: 'asset' | 'liability' | 'equity' | null;
}

export interface IncomeStatement {
  period: Period;
  comparativePeriod: Period;
  sections: StatementSection[];
  subtotals: Array<Variance & {
    key: string;
    label: string;
    amount: string;
    priorAmount: string;
    percentOfRevenue: string;
  }>;
  margins: { grossMargin: string; operatingMargin: string; netMargin: string };
  generatedAt: string;
}

export function useIncomeStatement(params: PeriodParams & { compare?: boolean }) {
  return useQuery({
    queryKey: ['acct-report', 'income-statement', params],
    queryFn: async () =>
      (await api.get<IncomeStatement>('/reports/accounting/income-statement', { params })).data,
  });
}

// ───────────────────────────── comparative balance sheet ───────────────────

export interface ComparativeBalanceSheet {
  asOf: string;
  compareAsOf: string;
  sections: StatementSection[];
  totals: Record<string, string>;
  difference: string;
  balanced: boolean;
  generatedAt: string;
}

export function useComparativeBalanceSheet(params: { asOf?: string; compareAsOf?: string }) {
  return useQuery({
    queryKey: ['acct-report', 'balance-sheet-comparative', params],
    queryFn: async () =>
      (
        await api.get<ComparativeBalanceSheet>('/reports/accounting/balance-sheet/comparative', {
          params,
        })
      ).data,
  });
}

// ───────────────────────────── detailed general ledger ─────────────────────

export interface LedgerLine {
  id: string;
  date: string;
  entryId: string;
  entryNumber: string;
  entryStatus: string;
  sourceType: string | null;
  description: string;
  partner: string | null;
  debit: string;
  credit: string;
  balance: string;
}

export interface LedgerAccount {
  accountId: string;
  code: string;
  name: string;
  classification: string | null;
  normalBalance: 'debit' | 'credit';
  sectionLabel: string;
  openingBalance: string;
  periodDebit: string;
  periodCredit: string;
  closingBalance: string;
  lines: LedgerLine[];
}

export interface DetailedGeneralLedger {
  period: Period;
  accounts: LedgerAccount[];
  meta: { page: number; pageSize: number; total: number; totalPages: number };
  generatedAt: string;
}

export function useDetailedGeneralLedger(
  params: PeriodParams & { accountIds?: string; page?: number; pageSize?: number },
) {
  return useQuery({
    queryKey: ['acct-report', 'general-ledger-detailed', params],
    queryFn: async () =>
      (await api.get<DetailedGeneralLedger>('/reports/accounting/general-ledger/detailed', { params }))
        .data,
  });
}

// ───────────────────────────── journal report ──────────────────────────────

export interface JournalReportEntry {
  id: string;
  entryNumber: string;
  postingDate: string;
  description: string;
  status: string;
  sourceType: string | null;
  journal: { id: string; code: string; name: string; journalType: string } | null;
  lines: Array<{
    id: string;
    accountId: string;
    accountCode: string;
    accountName: string;
    description: string;
    debit: string;
    credit: string;
  }>;
  debit: string;
  credit: string;
  balanced: boolean;
}

export interface JournalReport {
  period: Period;
  data: JournalReportEntry[];
  totals: { debit: string; credit: string };
  meta: { page: number; pageSize: number; total: number; totalPages: number };
  generatedAt: string;
}

export function useJournalReport(
  params: PeriodParams & { journalId?: string; status?: string; page?: number; pageSize?: number },
) {
  return useQuery({
    queryKey: ['acct-report', 'journal-report', params],
    queryFn: async () =>
      (await api.get<JournalReport>('/reports/accounting/journal-report', { params })).data,
  });
}

// ───────────────────────────── partner ledger ──────────────────────────────

export interface PartnerLedgerRow {
  partnerId: string;
  name: string;
  email: string | null;
  phone: string | null;
  opening: string;
  debit: string;
  credit: string;
  closing: string;
  outstanding: string;
  lines: Array<{
    date: string;
    entryNumber: string;
    description: string;
    sourceType: string | null;
    debit: string;
    credit: string;
    balance: string;
  }>;
}

export interface PartnerLedger {
  period: Period;
  type: 'receivable' | 'payable';
  partners: PartnerLedgerRow[];
  totals: Record<string, string>;
  /**
   * Which accounts the statement was drawn from: the flagged control account,
   * or — when the chart never set one — every account in the matching category.
   */
  basis?: 'control_account' | 'category';
  note?: string;
  generatedAt: string;
}

export function usePartnerLedger(
  params: PeriodParams & {
    type?: 'receivable' | 'payable';
    partnerId?: string;
    detail?: boolean;
  },
) {
  return useQuery({
    queryKey: ['acct-report', 'partner-ledger', params],
    queryFn: async () =>
      (await api.get<PartnerLedger>('/reports/accounting/partner-ledger', { params })).data,
  });
}

// ───────────────────────────── cash book ───────────────────────────────────

export interface CashBook {
  period: Period;
  accounts: Array<{
    accountId: string;
    code: string;
    name: string;
    categoryName: string | null;
    openingBalance: string;
    receipts: string;
    payments: string;
    netMovement: string;
    closingBalance: string;
  }>;
  daily: Array<{
    date: string;
    receipts: string;
    payments: string;
    net: string;
    balance: string;
  }>;
  totals: Record<string, string>;
  note?: string;
  generatedAt: string;
}

export function useCashBook(params: PeriodParams) {
  return useQuery({
    queryKey: ['acct-report', 'cash-book', params],
    queryFn: async () => (await api.get<CashBook>('/reports/accounting/cash-book', { params })).data,
  });
}

// ───────────────────────────── tax summary ─────────────────────────────────

export interface TaxSummary {
  period: Period;
  rows: Array<{
    taxId: string | null;
    name: string;
    code: string | null;
    rate: string;
    vatCategory: string;
    netSales: string;
    outputTax: string;
    netPurchases: string;
    inputTax: string;
    netTax: string;
    documents: number;
  }>;
  totals: Record<string, string>;
  position: 'payable' | 'refundable';
  generatedAt: string;
}

export function useTaxSummary(params: PeriodParams) {
  return useQuery({
    queryKey: ['acct-report', 'tax-summary', params],
    queryFn: async () =>
      (await api.get<TaxSummary>('/reports/accounting/tax-summary', { params })).data,
  });
}

// ───────────────────────────── revenue / expense analysis ──────────────────

export interface SectionAnalysis {
  label: string;
  period: Period;
  comparativePeriod: Period;
  rows: Array<Variance & {
    accountId: string;
    code: string;
    name: string;
    categoryName: string | null;
    section: string;
    sectionLabel: string;
    amount: string;
    priorAmount: string;
    percentOfTotal: string;
  }>;
  categories: Array<Variance & {
    name: string;
    amount: string;
    priorAmount: string;
    percentOfTotal: string;
  }>;
  totals: Variance & { amount: string; priorAmount: string };
  generatedAt: string;
}

export function useRevenueAnalysis(params: PeriodParams) {
  return useQuery({
    queryKey: ['acct-report', 'revenue-analysis', params],
    queryFn: async () =>
      (await api.get<SectionAnalysis>('/reports/accounting/revenue-analysis', { params })).data,
  });
}

export function useExpenseAnalysis(params: PeriodParams) {
  return useQuery({
    queryKey: ['acct-report', 'expense-analysis', params],
    queryFn: async () =>
      (await api.get<SectionAnalysis>('/reports/accounting/expense-analysis', { params })).data,
  });
}

// ───────────────────────────── equity statement ────────────────────────────

export interface EquityStatement {
  period: Period;
  rows: Array<{
    accountId: string;
    code: string;
    name: string;
    opening: string;
    movement: string;
    closing: string;
  }>;
  profitForPeriod: string;
  totals: Record<string, string>;
  generatedAt: string;
}

export function useEquityStatement(params: PeriodParams) {
  return useQuery({
    queryKey: ['acct-report', 'equity-statement', params],
    queryFn: async () =>
      (await api.get<EquityStatement>('/reports/accounting/equity-statement', { params })).data,
  });
}

// ───────────────────────────── financial ratios ────────────────────────────

export interface FinancialRatios {
  period: Period & { days: number };
  inputs: Record<string, string>;
  ratios: Array<{
    key: string;
    label: string;
    group: string;
    format: 'ratio' | 'percent' | 'amount' | 'days';
    value: string | null;
    numerator: string;
    denominator: string;
    basis: string;
  }>;
  generatedAt: string;
}

export function useFinancialRatios(params: PeriodParams) {
  return useQuery({
    queryKey: ['acct-report', 'financial-ratios', params],
    queryFn: async () =>
      (await api.get<FinancialRatios>('/reports/accounting/financial-ratios', { params })).data,
  });
}

// ───────────────────────────── account balances ────────────────────────────

export interface AccountBalances {
  asOf: string;
  rows: Array<{
    accountId: string;
    code: string;
    name: string;
    classification: string | null;
    categoryKey: string | null;
    categoryName: string | null;
    reportSection: string | null;
    sectionLabel: string;
    normalBalance: 'debit' | 'credit';
    controlAccountType: string | null;
    isPostable: boolean;
    isActive: boolean;
    debit: string;
    credit: string;
    balance: string;
  }>;
  totalsByClassification: Record<string, string>;
  generatedAt: string;
}

export function useAccountBalances(params: { asOf?: string; includeZero?: boolean }) {
  return useQuery({
    queryKey: ['acct-report', 'account-balances', params],
    queryFn: async () =>
      (await api.get<AccountBalances>('/reports/accounting/account-balances', { params })).data,
  });
}
