import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PaginatedResult } from '@erp/shared';
import { api } from '@/lib/api';
import { notify } from '@/lib/notify';

/** Accounting behavior of an account. Modules resolve accounts by `key`. */
export interface AccountCategory {
  id: string;
  key: string;
  name: string;
  description?: string | null;
  classification: string;
  normalBalance: 'debit' | 'credit';
  reportSection: string;
  cashFlowClass: string;
  isContra: boolean;
  isCashEquivalent: boolean;
  allowReconciliation: boolean;
  allowManualPosting: boolean;
  allowBudgeting: boolean;
  isSystem: boolean;
  isActive: boolean;
  sortOrder: number;
  /** Only present on the /account-categories/usage response. */
  accountCount?: number;
}

export interface Account {
  id: string;
  code: string;
  name: string;
  /** Source of truth for how the engine treats this account. */
  categoryId?: string | null;
  category?: Pick<
    AccountCategory,
    | 'id'
    | 'key'
    | 'name'
    | 'classification'
    | 'normalBalance'
    | 'reportSection'
    | 'cashFlowClass'
    | 'isContra'
    | 'isCashEquivalent'
    | 'allowReconciliation'
    | 'allowManualPosting'
    | 'allowBudgeting'
  >;
  normalBalance?: 'debit' | 'credit';
  /** @deprecated legacy mirror of the category — read `category.key` instead. */
  accountType: string;
  isGroup: boolean;
  isActive: boolean;
  description?: string;
  parentAccountId?: string;
  sortOrder?: number;
  currencyId?: string;
  cashFlowCategory?: string;
  bankName?: string;
  accountNumber?: string;
  isDefault?: boolean;
  isSystem?: boolean;
  isProtected?: boolean;
  isControlAccount?: boolean;
  deprecatedAt?: string | null;
  /** `null` = inherit the category default. */
  allowReconciliation?: boolean | null;
  allowManualPosting?: boolean | null;
  allowBudgeting?: boolean | null;
  parent?: { id: string; code: string; name: string };
  children?: { id: string; code: string; name: string }[];
}

export interface AccountTreeNode {
  id: string;
  code: string;
  name: string;
  isGroup: boolean;
  isActive: boolean;
  deprecatedAt?: string | null;
  sortOrder: number;
  isControlAccount: boolean;
  categoryKey: string | null;
  categoryName: string | null;
  classification: string | null;
  normalBalance: 'debit' | 'credit';
  reportSection: string | null;
  level: number;
  ownBalance?: string;
  subtotal?: string;
  children: AccountTreeNode[];
}

/** The chart of accounts as a forest, built server-side with balance roll-ups. */
export function useAccountTree(opts: { includeBalances?: boolean; includeInactive?: boolean } = {}) {
  return useQuery({
    queryKey: ['accounts', 'tree', opts],
    queryFn: async () =>
      (
        await api.get<{ nodes: AccountTreeNode[] }>('/accounts/tree', {
          params: {
            ...(opts.includeBalances ? { includeBalances: 'true' } : {}),
            ...(opts.includeInactive ? { includeInactive: 'true' } : {}),
          },
        })
      ).data,
  });
}

export function useAccountCategories() {
  return useQuery({
    queryKey: ['account-categories'],
    queryFn: async () =>
      (await api.get<AccountCategory[]>('/account-categories/usage')).data,
  });
}

export function useCreateAccountCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: Partial<AccountCategory>) =>
      (await api.post<AccountCategory>('/account-categories', input)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['account-categories'] });
      qc.invalidateQueries({ queryKey: ['accounts'] });
      notify.success('Account category created');
    },
    onError: (e: any) =>
      notify.error('Failed to create category', e?.response?.data?.message ?? e.message),
  });
}

export function useUpdateAccountCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...input }: Partial<AccountCategory> & { id: string }) =>
      (await api.patch<AccountCategory>(`/account-categories/${id}`, input)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['account-categories'] });
      qc.invalidateQueries({ queryKey: ['accounts'] });
      notify.success('Account category updated');
    },
    onError: (e: any) =>
      notify.error('Failed to update category', e?.response?.data?.message ?? e.message),
  });
}

export function useDeleteAccountCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => (await api.delete(`/account-categories/${id}`)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['account-categories'] });
      notify.success('Account category deleted');
    },
    onError: (e: any) =>
      notify.error('Failed to delete category', e?.response?.data?.message ?? e.message),
  });
}

export function useAccounts() {
  return useQuery({
    queryKey: ['accounts'],
    queryFn: async () =>
      (await api.get<PaginatedResult<Account>>('/accounts', { params: { pageSize: 200 } })).data,
  });
}

export function useAccount(id: string | undefined) {
  return useQuery({
    queryKey: ['accounts', id],
    queryFn: async () => (await api.get<Account>(`/accounts/${id}`)).data,
    enabled: !!id,
  });
}

export function useCreateAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      code: string;
      name: string;
      categoryId: string;
      isGroup?: boolean;
      parentAccountId?: string | null;
      description?: string;
      cashFlowCategory?: string;
      sortOrder?: number;
      isControlAccount?: boolean;
      allowReconciliation?: boolean | null;
      allowManualPosting?: boolean | null;
      allowBudgeting?: boolean | null;
    }) => (await api.post<Account>('/accounts', input)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['accounts'] });
      notify.success('Account created');
    },
    onError: (e: any) =>
      notify.error('Failed to create account', e?.response?.data?.message ?? e.message),
  });
}

export function useUpdateAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...input }: {
      id: string;
      code?: string;
      name?: string;
      categoryId?: string;
      isGroup?: boolean;
      isActive?: boolean;
      parentAccountId?: string | null;
      description?: string | null;
      cashFlowCategory?: string | null;
      bankName?: string | null;
      accountNumber?: string | null;
      sortOrder?: number;
      isControlAccount?: boolean;
      allowReconciliation?: boolean | null;
      allowManualPosting?: boolean | null;
      allowBudgeting?: boolean | null;
    }) => (await api.patch<Account>(`/accounts/${id}`, input)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['accounts'] });
      notify.success('Account updated');
    },
    onError: (e: any) =>
      notify.error('Failed to update account', e?.response?.data?.message ?? e.message),
  });
}

export interface AccountMappingRow {
  id: string;
  key: string;
  accountId: string;
}

export function useAccountMappings() {
  return useQuery({
    queryKey: ['account-mappings'],
    queryFn: async () =>
      (await api.get<AccountMappingRow[]>('/account-mappings')).data,
  });
}

/** Catalog of mapping keys and the account categories each one expects. */
export interface AccountMappingDef {
  key: string;
  label: string;
  group: string;
  expectedCategories: string[];
  required: boolean;
  description?: string;
}

export function useAccountMappingRegistry() {
  return useQuery({
    queryKey: ['account-mappings', 'registry'],
    queryFn: async () =>
      (await api.get<AccountMappingDef[]>('/account-mappings/registry')).data,
    staleTime: 5 * 60 * 1000,
  });
}

/** Required mapping keys with no account assigned — these throw at posting time. */
export function useMissingAccountMappings() {
  return useQuery({
    queryKey: ['account-mappings', 'missing'],
    queryFn: async () => (await api.get<string[]>('/account-mappings/missing')).data,
  });
}

export interface BalanceSheetRow {
  accountId: string;
  code: string;
  name: string;
  balance: string;
}

export interface BalanceSheetSection {
  key: string;
  label: string;
  type: 'asset' | 'liability' | 'equity';
  rows: BalanceSheetRow[];
  subtotal: string;
}

export interface BalanceSheetDetailedResult {
  asOf: string;
  balanced: boolean;
  source: 'snapshot' | 'live';
  sections: BalanceSheetSection[];
  totals: {
    assets: string;
    liabilities: string;
    equity: string;
    liabilitiesAndEquity: string;
  };
}

export function useBalanceSheet(asOf: string) {
  return useQuery({
    queryKey: ['balance-sheet', asOf],
    queryFn: async () =>
      (await api.get<BalanceSheetResult>('/reports/accounting/balance-sheet', { params: { asOf } })).data,
    enabled: !!asOf,
  });
}

export function useBalanceSheetDetailed(asOf: string) {
  return useQuery({
    queryKey: ['balance-sheet-detailed', asOf],
    queryFn: async () =>
      (await api.get<BalanceSheetDetailedResult>('/reports/accounting/balance-sheet/detailed', { params: { asOf } })).data,
    enabled: !!asOf,
  });
}

export interface BalanceSheetResult {
  asOf: string;
  totalAssets: string;
  totalLiabilities: string;
  totalEquity: string;
  currentYearEarnings: string;
  totalLiabilitiesAndEquity: string;
  balanced: boolean;
  source: 'snapshot' | 'live';
}

export function useRebuildSnapshots() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () =>
      (await api.post('/reports/accounting/rebuild-snapshots')).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['balance-sheet'] });
      qc.invalidateQueries({ queryKey: ['trial-balance'] });
    },
  });
}

export function useUpdateAccountMapping() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ key, accountId }: { key: string; accountId: string }) =>
      (await api.put(`/account-mappings/${key}`, { accountId })).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['account-mappings'] });
    },
  });
}

export interface TrialBalanceRow {
  accountId: string;
  code: string;
  name: string;
  accountType: string;
  debit: string;
  credit: string;
  balance: string;
}

export interface TrialBalance {
  rows: TrialBalanceRow[];
  totals: { debit: string; credit: string };
  balanced: boolean;
}

export function useTrialBalance(params: { from?: string; to?: string }) {
  return useQuery({
    queryKey: ['trial-balance', params],
    queryFn: async () =>
      (await api.get<TrialBalance>('/reports/accounting/trial-balance', { params })).data,
  });
}

export interface GeneralLedgerRow {
  id: string;
  date: string;
  entryNumber: string;
  accountCode: string;
  accountName: string;
  description: string | null;
  debit: string;
  credit: string;
}

export interface GeneralLedgerResult {
  data: GeneralLedgerRow[];
  meta: { page: number; pageSize: number; total: number; totalPages: number };
}

export function useGeneralLedger(params: {
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
}) {
  return useQuery({
    queryKey: ['general-ledger', params],
    queryFn: async () =>
      (await api.get<GeneralLedgerResult>('/reports/accounting/general-ledger', { params })).data,
  });
}

/* ── Profit & Loss ─────────────────────────────────────────────── */

export interface PnLResult {
  revenue: string;
  contraRevenue: string;
  netRevenue: string;
  cogs: string;
  grossProfit: string;
  expense: string;
  otherIncome: string;
  operatingProfit: string;
  source: string;
  asOf?: string;
}

export function usePnL(params: { from?: string; to?: string }) {
  return useQuery({
    queryKey: ['pnl', params],
    queryFn: async () =>
      (await api.get<PnLResult>('/reports/accounting/profit-and-loss', { params })).data,
  });
}

/* ── Cash Flow ─────────────────────────────────────────────────── */

export interface CashFlowResult {
  from: string | null;
  to: string | null;
  openingCash: string;
  operating: string;
  investing: string;
  financing: string;
  netCashFlow: string;
  closingCash: string;
  actualClosingCash: string;
  reconciled: boolean;
}

export function useCashFlow(params: { from?: string; to?: string }) {
  return useQuery({
    queryKey: ['cash-flow', params],
    queryFn: async () =>
      (await api.get<CashFlowResult>('/reports/accounting/cash-flow', { params })).data,
  });
}

/* ── Account Ledger ────────────────────────────────────────────── */

export interface AccountLedgerLine {
  id: string;
  date: string;
  entryNumber: string;
  description: string | null;
  debit: string;
  credit: string;
  balance: string;
}

export interface AccountLedgerResult {
  account: { id: string; code: string; name: string };
  lines: AccountLedgerLine[];
  closingBalance: string;
}

export function useAccountLedger(accountId: string | undefined, params: { from?: string; to?: string }) {
  return useQuery({
    queryKey: ['account-ledger', accountId, params],
    queryFn: async () =>
      (await api.get<AccountLedgerResult>(`/reports/accounting/account-ledger/${accountId}`, { params })).data,
    enabled: !!accountId,
  });
}

/* ── Tie-Out / Reconciliation ──────────────────────────────────── */

export interface TieOutResult {
  asOf: string;
  arBalanced: boolean;
  arVariance: string;
  apBalanced: boolean;
  apVariance: string;
  arDetails: { glBalance: string; subLedgerBalance: string } | null;
  apDetails: { glBalance: string; subLedgerBalance: string } | null;
}

export function useTieOut(asOf?: string) {
  return useQuery({
    queryKey: ['tieout', asOf],
    queryFn: async () =>
      (await api.get<TieOutResult>('/reports/accounting/tieout', { params: asOf ? { asOf } : {} })).data,
  });
}

/* ── Audit Log ─────────────────────────────────────────────────── */

export interface AuditLogEntry {
  id: string;
  entity: string;
  entityId: string;
  action: string;
  oldValues: unknown | null;
  newValues: unknown | null;
  actorId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
}

export function useAuditLogs(params: { page?: number; pageSize?: number; entity?: string }) {
  return useQuery({
    queryKey: ['audit-logs', params],
    queryFn: async () =>
      (await api.get<PaginatedResult<AuditLogEntry>>('/audit-logs', { params })).data,
  });
}

/* ── Fiscal Periods ───────────────────────────────────────────── */

export interface FiscalPeriod {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  status: 'open' | 'closed' | 'locked';
  closedAt: string | null;
  lockedAt: string | null;
  createdAt: string;
}

export function useFiscalPeriods(params?: { page?: number }) {
  return useQuery({
    queryKey: ['fiscal-periods', params],
    queryFn: async () =>
      (await api.get<PaginatedResult<FiscalPeriod>>('/fiscal-periods', { params })).data,
  });
}

export function useCreateFiscalPeriod() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { name: string; startDate: string; endDate: string }) =>
      (await api.post<FiscalPeriod>('/fiscal-periods', input)).data,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['fiscal-periods'] }); notify.success('Period created'); },
    onError: (e: any) => notify.error('Failed', e?.response?.data?.message ?? e.message),
  });
}

export function useClosePeriod() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => (await api.post(`/fiscal-periods/${id}/close`)).data,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['fiscal-periods'] }); notify.success('Period closed'); },
    onError: (e: any) => notify.error('Failed', e?.response?.data?.message ?? e.message),
  });
}

export function useReopenPeriod() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => (await api.post(`/fiscal-periods/${id}/reopen`)).data,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['fiscal-periods'] }); notify.success('Period reopened'); },
    onError: (e: any) => notify.error('Failed', e?.response?.data?.message ?? e.message),
  });
}

export function useLockPeriod() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => (await api.post(`/fiscal-periods/${id}/lock`)).data,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['fiscal-periods'] }); notify.success('Period locked'); },
    onError: (e: any) => notify.error('Failed', e?.response?.data?.message ?? e.message),
  });
}

/* ── Taxes ────────────────────────────────────────────────────── */

export interface Tax {
  id: string;
  name: string;
  code: string | null;
  type: string;
  rate: number;
  isInclusive: boolean;
  isCompound: boolean;
  vatCategory: string;
  accountId: string | null;
  isActive: boolean;
}

export function useTaxes(params?: { page?: number; pageSize?: number }) {
  return useQuery({
    queryKey: ['taxes', params],
    queryFn: async () =>
      (await api.get<PaginatedResult<Tax>>('/taxes', { params })).data,
  });
}

export function useCreateTax() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: Partial<Tax>) =>
      (await api.post<Tax>('/taxes', input)).data,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['taxes'] }); notify.success('Tax created'); },
    onError: (e: any) => notify.error('Failed', e?.response?.data?.message ?? e.message),
  });
}

export function useUpdateTax() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...input }: { id: string } & Partial<Tax>) =>
      (await api.patch(`/taxes/${id}`, input)).data,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['taxes'] }); notify.success('Tax updated'); },
    onError: (e: any) => notify.error('Failed', e?.response?.data?.message ?? e.message),
  });
}

export function useDeleteTax() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => api.delete(`/taxes/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['taxes'] }); notify.success('Tax deleted'); },
    onError: (e: any) => notify.error('Failed', e?.response?.data?.message ?? e.message),
  });
}

/* ── Cost Centers ─────────────────────────────────────────────── */

export interface CostCenter {
  id: string;
  code: string;
  name: string;
  type: string;
  isActive: boolean;
}

export function useCostCenters(params?: { page?: number; type?: string }) {
  return useQuery({
    queryKey: ['cost-centers', params],
    queryFn: async () =>
      (await api.get<PaginatedResult<CostCenter>>('/cost-centers', { params })).data,
  });
}

export function useCreateCostCenter() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { code: string; name: string; type?: string }) =>
      (await api.post<CostCenter>('/cost-centers', input)).data,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['cost-centers'] }); notify.success('Cost center created'); },
    onError: (e: any) => notify.error('Failed', e?.response?.data?.message ?? e.message),
  });
}

export function useUpdateCostCenter() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...input }: { id: string; code?: string; name?: string; type?: string; isActive?: boolean }) =>
      (await api.patch(`/cost-centers/${id}`, input)).data,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['cost-centers'] }); notify.success('Updated'); },
    onError: (e: any) => notify.error('Failed', e?.response?.data?.message ?? e.message),
  });
}

export function useDeleteCostCenter() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => api.delete(`/cost-centers/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['cost-centers'] }); notify.success('Deleted'); },
    onError: (e: any) => notify.error('Failed', e?.response?.data?.message ?? e.message),
  });
}

/* ── Currency / Rates ─────────────────────────────────────────── */

export interface Currency {
  code: string;
  symbol: string;
  name: string;
  decimalPlaces: number;
}

export interface CurrencyRate {
  id: string;
  fromCode: string;
  toCode: string;
  asOf: string;
  rate: number;
  source: string;
}

export function useCurrencies() {
  return useQuery({
    queryKey: ['currencies'],
    queryFn: async () => (await api.get<Currency[]>('/currencies')).data,
  });
}

export function useCurrencyRates(params?: { fromCode?: string; toCode?: string }) {
  return useQuery({
    queryKey: ['currency-rates', params],
    queryFn: async () =>
      (await api.get<CurrencyRate[]>('/currencies/rates', { params })).data,
  });
}

export function useCreateCurrencyRate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { fromCode: string; toCode: string; rate: number; asOf?: string }) =>
      (await api.post<CurrencyRate>('/currencies/rates', input)).data,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['currency-rates'] }); notify.success('Rate added'); },
    onError: (e: any) => notify.error('Failed', e?.response?.data?.message ?? e.message),
  });
}

/* ── Inventory Valuation Report ───────────────────────────────── */

export interface InventoryValuationItem {
  productId: string;
  productName: string;
  sku: string;
  unitCost: string;
  onHandQty: number;
  totalValue: string;
  accountCode: string;
  accountName: string;
  categoryName: string;
}

export interface InventoryValuationResult {
  asOf: string;
  items: InventoryValuationItem[];
  summary: { totalItems: number; totalValue: string; totalQty: number };
  groupedBy: string;
}

export function useInventoryValuation(asOf?: string) {
  return useQuery({
    queryKey: ['inventory-valuation', asOf],
    queryFn: async () =>
      (await api.get<InventoryValuationResult>('/reports/inventory/valuation', { params: asOf ? { asOf } : {} })).data,
  });
}

export interface JournalEntryRow {
  id: string;
  entryNumber: string;
  postingDate: string;
  description: string | null;
  status: string;
  journal: { code: string; name: string };
  journalId?: string;
  sourceType?: string | null;
  sourceId?: string | null;
  reversalOfId?: string | null;
  reversedEntryId?: string | null;
  postedAt?: string | null;
  postedBy?: string | null;
  createdBy?: string | null;
  _count?: { lines: number };
}

export interface JournalLine {
  id: string;
  description: string | null;
  debit: string;
  credit: string;
  account: { code: string; name: string };
}

export interface JournalEntryDetail extends JournalEntryRow {
  lines: JournalLine[];
}

export function useJournalEntries(params: { page?: number; pageSize?: number; search?: string }) {
  return useQuery({
    queryKey: ['journal-entries', params],
    queryFn: async () =>
      (await api.get<PaginatedResult<JournalEntryRow>>('/journal-entries', { params })).data,
  });
}

export function useJournalEntry(id: string | undefined) {
  return useQuery({
    queryKey: ['journal-entry', id],
    queryFn: async () => (await api.get<JournalEntryDetail>(`/journal-entries/${id}`)).data,
    enabled: !!id,
  });
}

export interface Journal {
  id: string;
  code: string;
  name: string;
  journalType: string;
  isActive: boolean;
  defaultDebitAccountId?: string | null;
  defaultCreditAccountId?: string | null;
  sequencePrefix?: string | null;
  _count?: { entries: number };
}

export function useJournals() {
  return useQuery({
    queryKey: ['journals'],
    queryFn: async () =>
      (await api.get<PaginatedResult<Journal>>('/journals', { params: { pageSize: 100 } })).data,
  });
}

/** Company (accounting) settings + reference data for select dropdowns. */
export interface CompanySettingsData {
  defaultSalesJournalId?: string | null;
  exchangeDifferenceJournalId?: string | null;
  _references?: {
    journals?: { id: string; code: string; name: string }[];
  };
}

export function useCompanySettings() {
  return useQuery({
    // Shares the cache with CompanySettingsPage (same endpoint / invalidations).
    queryKey: ['settings-company'],
    queryFn: async () => (await api.get<CompanySettingsData>('/settings/company')).data,
  });
}

export function useJournal(id: string | undefined) {
  return useQuery({
    queryKey: ['journal', id],
    queryFn: async () => (await api.get<Journal>(`/journals/${id}`)).data,
    enabled: !!id,
  });
}

export function useCreateJournal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      code: string;
      name: string;
      journalType: string;
      defaultDebitAccountId?: string;
      defaultCreditAccountId?: string;
      sequencePrefix?: string;
      isActive?: boolean;
    }) => (await api.post<Journal>('/journals', input)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['journals'] });
      notify.success('Journal created');
    },
    onError: (e: any) => notify.error('Failed to create journal', e?.response?.data?.message ?? e.message),
  });
}

export function useUpdateJournal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...input }: {
      id: string;
      code?: string;
      name?: string;
      journalType?: string;
      defaultDebitAccountId?: string | null;
      defaultCreditAccountId?: string | null;
      sequencePrefix?: string | null;
      isActive?: boolean;
    }) => (await api.patch<Journal>(`/journals/${id}`, input)).data,
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['journals'] });
      qc.invalidateQueries({ queryKey: ['journal', vars.id] });
      notify.success('Journal updated');
    },
    onError: (e: any) => notify.error('Failed to update journal', e?.response?.data?.message ?? e.message),
  });
}

export function useDeleteJournal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => (await api.delete(`/journals/${id}`)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['journals'] });
      notify.success('Journal deleted');
    },
    onError: (e: any) => notify.error('Failed to delete journal', e?.response?.data?.message ?? e.message),
  });
}

export interface ManualJournalLineInput {
  accountId: string;
  debit?: number;
  credit?: number;
  partnerId?: string;
  description?: string;
}

export interface CreateJournalEntryInput {
  journalCode: string;
  date: string;
  description?: string;
  lines: ManualJournalLineInput[];
}

export function useCreateJournalEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateJournalEntryInput) =>
      (await api.post<JournalEntryDetail>('/journal-entries', input)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['journal-entries'] });
      qc.invalidateQueries({ queryKey: ['trial-balance'] });
    },
  });
}

export function useReverseJournalEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) =>
      (await api.post<JournalEntryDetail>(`/journal-entries/${id}/reverse`, {})).data,
    onSuccess: (_data, id) => {
      qc.invalidateQueries({ queryKey: ['journal-entries'] });
      qc.invalidateQueries({ queryKey: ['journal-entry', id] });
      qc.invalidateQueries({ queryKey: ['trial-balance'] });
    },
  });
}

// ── Cash Accounts / Cash Flow ──

export interface CashAccount {
  id: string;
  code: string;
  name: string;
  accountType: string;
  balance: string;
  bankName: string | null;
  accountNumber: string | null;
  isDefault: boolean;
  currencyId: string | null;
  cashRegister: { id: string; name: string; code: string } | null;
}

export function useCashAccounts() {
  return useQuery({
    queryKey: ['cash-accounts'],
    queryFn: async () => (await api.get<CashAccount[]>('/accounts/cash-flow')).data,
  });
}

export interface CashTransaction {
  id: string;
  journalEntryId: string;
  entryNumber: string;
  postingDate: string;
  description: string | null;
  sourceType: string | null;
  debit: string;
  credit: string;
  baseDebit: string;
  baseCredit: string;
}

export interface TransactionsResult {
  data: CashTransaction[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  account: { id: string; code: string; name: string; accountType: string; bankName: string | null; accountNumber: string | null; currencyId: string | null };
}

export function useCashAccountTransactions(id: string | undefined, params: { page?: number; pageSize?: number }) {
  return useQuery({
    queryKey: ['cash-account-transactions', id, params],
    queryFn: async () =>
      (await api.get<TransactionsResult>(`/accounts/cash-flow/${id}/transactions`, { params })).data,
    enabled: !!id,
  });
}

export function useCashFlowDeposit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { accountId: string; amount: number; description?: string }) =>
      (await api.post('/accounts/cash-flow/deposit', input)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cash-accounts'] });
      qc.invalidateQueries({ queryKey: ['cash-account-transactions'] });
      qc.invalidateQueries({ queryKey: ['trial-balance'] });
    },
  });
}

export function useCashFlowWithdraw() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { accountId: string; amount: number; description?: string }) =>
      (await api.post('/accounts/cash-flow/withdraw', input)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cash-accounts'] });
      qc.invalidateQueries({ queryKey: ['cash-account-transactions'] });
      qc.invalidateQueries({ queryKey: ['trial-balance'] });
    },
  });
}

export function useTreasuryTransfer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { fromAccountId: string; toAccountId: string; amount: number; date: string; reference?: string }) =>
      (await api.post('/treasury/transfer', input)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cash-accounts'] });
      qc.invalidateQueries({ queryKey: ['cash-account-transactions'] });
      qc.invalidateQueries({ queryKey: ['trial-balance'] });
    },
  });
}

export function useCreateCashAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      code: string;
      name: string;
      accountType: string;
      currencyId?: string;
      bankName?: string;
      accountNumber?: string;
      isDefault?: boolean;
    }) => (await api.post('/accounts/cash-flow', input)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cash-accounts'] });
      qc.invalidateQueries({ queryKey: ['accounts'] });
    },
  });
}

export function useUpdateCashAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...data }: { id: string; name?: string; bankName?: string; accountNumber?: string; isDefault?: boolean }) =>
      (await api.patch(`/accounts/cash-flow/${id}`, data)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cash-accounts'] });
      qc.invalidateQueries({ queryKey: ['accounts'] });
    },
  });
}

export function useDeleteCashAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => (await api.delete(`/accounts/cash-flow/${id}`)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cash-accounts'] });
      qc.invalidateQueries({ queryKey: ['accounts'] });
    },
  });
}



/* ── Payment Terms (core master, Odoo-style due-date methods) ──── */

export type PaymentTermMethod = 'immediate' | 'net_days' | 'end_of_following_month';

export interface PaymentTerm {
  id: string;
  organizationId: string;
  code: string;
  name: string;
  method: PaymentTermMethod;
  netDays: number;
  discountDays: number | null;
  /** Decimal serializes as string. */
  discountPercent: string | null;
  isActive: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface PaymentTermInput {
  code: string;
  name: string;
  method: PaymentTermMethod;
  netDays?: number;
  discountDays?: number | null;
  discountPercent?: number | null;
  isActive?: boolean;
  sortOrder?: number;
}

/** Method display labels + due-date hints shared by the page and pickers. */
export const PAYMENT_METHOD_LABELS: Record<PaymentTermMethod, string> = {
  immediate: 'Immediate Payment',
  net_days: 'Days after invoice date',
  end_of_following_month: 'End of following month',
};

export function usePaymentTerms() {
  return useQuery({
    queryKey: ['payment-terms'],
    queryFn: async () => (await api.get<PaymentTerm[]>('/payment-terms')).data,
  });
}

/** Archived (soft-deleted) terms — the restore list. */
export function useDeletedPaymentTerms() {
  return useQuery({
    queryKey: ['payment-terms', 'deleted'],
    queryFn: async () => (await api.get<PaymentTerm[]>('/payment-terms/deleted')).data,
  });
}

export function useCreatePaymentTerm() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: PaymentTermInput) => (await api.post<PaymentTerm>('/payment-terms', input)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['payment-terms'] });
      notify.success('Payment term created');
    },
    onError: (e: any) => notify.error('Failed', e?.response?.data?.message ?? e.message),
  });
}

export function useUpdatePaymentTerm() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...input }: { id: string } & Partial<PaymentTermInput>) =>
      (await api.patch<PaymentTerm>(`/payment-terms/${id}`, input)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['payment-terms'] });
      notify.success('Payment term updated');
    },
    onError: (e: any) => notify.error('Failed', e?.response?.data?.message ?? e.message),
  });
}

/** Archive (soft delete). Referencing invoices keep their term-name snapshot. */
export function useArchivePaymentTerm() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => (await api.delete(`/payment-terms/${id}`)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['payment-terms'] });
      notify.success('Payment term archived');
    },
    onError: (e: any) => notify.error('Failed', e?.response?.data?.message ?? e.message),
  });
}

export function useRestorePaymentTerm() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => (await api.patch(`/payment-terms/${id}/restore`)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['payment-terms'] });
      notify.success('Payment term restored');
    },
    onError: (e: any) => notify.error('Failed', e?.response?.data?.message ?? e.message),
  });
}

/* ── Fiscal Positions (core master, Odoo-style tax-treatment labels) ── */

export interface FiscalPosition {
  id: string;
  organizationId: string;
  code: string;
  name: string;
  isActive: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface FiscalPositionInput {
  code: string;
  name: string;
  isActive?: boolean;
  sortOrder?: number;
}

export function useFiscalPositions() {
  return useQuery({
    queryKey: ['fiscal-positions'],
    queryFn: async () => (await api.get<FiscalPosition[]>('/fiscal-positions')).data,
  });
}

/** Archived (soft-deleted) fiscal positions — the restore list. */
export function useDeletedFiscalPositions() {
  return useQuery({
    queryKey: ['fiscal-positions', 'deleted'],
    queryFn: async () => (await api.get<FiscalPosition[]>('/fiscal-positions/deleted')).data,
  });
}

export function useCreateFiscalPosition() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: FiscalPositionInput) =>
      (await api.post<FiscalPosition>('/fiscal-positions', input)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['fiscal-positions'] });
      notify.success('Fiscal position created');
    },
    onError: (e: any) => notify.error('Failed', e?.response?.data?.message ?? e.message),
  });
}

export function useUpdateFiscalPosition() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...input }: { id: string } & Partial<FiscalPositionInput>) =>
      (await api.patch<FiscalPosition>(`/fiscal-positions/${id}`, input)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['fiscal-positions'] });
      notify.success('Fiscal position updated');
    },
    onError: (e: any) => notify.error('Failed', e?.response?.data?.message ?? e.message),
  });
}

/** Archive (soft delete). Referencing invoices keep their name snapshot. */
export function useArchiveFiscalPosition() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => (await api.delete(`/fiscal-positions/${id}`)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['fiscal-positions'] });
      notify.success('Fiscal position archived');
    },
    onError: (e: any) => notify.error('Failed', e?.response?.data?.message ?? e.message),
  });
}

export function useRestoreFiscalPosition() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => (await api.patch(`/fiscal-positions/${id}/restore`)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['fiscal-positions'] });
      notify.success('Fiscal position restored');
    },
    onError: (e: any) => notify.error('Failed', e?.response?.data?.message ?? e.message),
  });
}

