import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { PaginatedResult } from '@erp/shared';

export interface PurchaseOrderRow {
  id: string;
  orderNumber: string;
  orderDate: string;
  partner: { id: string; name: string } | null;
  status: string;
  paymentType: string | null;
  paymentStatus: string | null;
  subtotal: string;
  taxAmount: string;
  totalAmount: string;
}

export function usePurchasesReport(fromDate: string, toDate: string) {
  return useQuery({
    queryKey: ['reports', 'purchases', fromDate, toDate],
    queryFn: async () =>
      (await api.get<PaginatedResult<PurchaseOrderRow>>('/procurement/purchase-orders', {
        params: { page: 1, pageSize: 200, dateFrom: fromDate || undefined, dateTo: toDate || undefined },
      })).data,
    enabled: !!fromDate && !!toDate,
  });
}

export function useExpensesReport(fromDate: string, toDate: string, categoryId?: string) {
  return useQuery({
    queryKey: ['reports', 'expenses', fromDate, toDate, categoryId ?? 'all'],
    queryFn: async () =>
      (await api.get<PaginatedResult<any>>('/expenses', {
        params: { page: 1, pageSize: 200, dateFrom: fromDate || undefined, dateTo: toDate || undefined, categoryId: categoryId || undefined },
      })).data,
    enabled: !!fromDate && !!toDate,
  });
}

export function useExpenseStats(fromDate: string, toDate: string) {
  return useQuery({
    queryKey: ['reports', 'expense-stats', fromDate, toDate],
    queryFn: async () =>
      (await api.get<any>('/expenses/stats', { params: { dateFrom: fromDate || undefined, dateTo: toDate || undefined } })).data,
    enabled: !!fromDate && !!toDate,
  });
}

export interface CashFlowSummary {
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

export function useCashFlowSummary(fromDate: string, toDate: string) {
  return useQuery({
    queryKey: ['reports', 'cash-flow-summary', fromDate, toDate],
    queryFn: async () =>
      (await api.get<CashFlowSummary>('/reports/accounting/cash-flow', {
        params: { from: fromDate || undefined, to: toDate || undefined },
      })).data,
    enabled: !!fromDate && !!toDate,
  });
}

export function usePaymentsInbound(fromDate: string, toDate: string) {
  return useQuery({
    queryKey: ['reports', 'payments-inbound', fromDate, toDate],
    queryFn: async () =>
      (await api.get<PaginatedResult<any>>('/payments', {
        params: { page: 1, pageSize: 200, dateFrom: fromDate || undefined, dateTo: toDate || undefined },
      })).data,
    enabled: !!fromDate && !!toDate,
  });
}

export function usePaymentsOutbound(fromDate: string, toDate: string) {
  return useQuery({
    queryKey: ['reports', 'payments-outbound', fromDate, toDate],
    queryFn: async () =>
      (await api.get<PaginatedResult<any>>('/supplier-payments', {
        params: { page: 1, pageSize: 200, dateFrom: fromDate || undefined, dateTo: toDate || undefined },
      })).data,
    enabled: !!fromDate && !!toDate,
  });
}
