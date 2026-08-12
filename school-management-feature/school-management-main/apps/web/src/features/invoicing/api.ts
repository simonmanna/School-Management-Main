import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PaginatedResult } from '@erp/shared';
import { api } from '@/lib/api';

export interface Invoice {
  id: string;
  documentNumber: string;
  partnerId: string;
  partner?: { id: string; name: string };
  issueDate: string;
  dueDate: string | null;
  status: string;
  subtotal: string;
  taxAmount: string;
  totalAmount: string;
  amountPaid: string;
  amountResidual: string;
  paymentStatus: string;
  reference: string | null;
  notes: string | null;
  journalEntryId: string | null;
  reversedDocumentId?: string | null;
}

export interface InvoiceLine {
  id: string;
  description: string;
  quantity: string;
  unitPrice: string;
  discountPercent: string;
  subtotal: string;
  taxAmount: string;
  total: string;
}

export interface InvoiceDetail extends Invoice {
  lines: InvoiceLine[];
}

export interface InvoiceLineInput {
  productId?: string;
  description?: string;
  quantity: number;
  unitPrice?: number;
  discountPercent?: number;
}

export interface CreateInvoiceInput {
  partnerId: string;
  issueDate: string;
  dueDate?: string;
  reference?: string;
  notes?: string;
  lines: InvoiceLineInput[];
}

export function useInvoices(params: { page?: number; pageSize?: number; search?: string }) {
  return useQuery({
    queryKey: ['invoices', params],
    queryFn: async () => (await api.get<PaginatedResult<Invoice>>('/invoices', { params })).data,
  });
}

export function useInvoice(id: string | undefined) {
  return useQuery({
    queryKey: ['invoice', id],
    queryFn: async () => (await api.get<InvoiceDetail>(`/invoices/${id}`)).data,
    enabled: !!id,
  });
}

export function useCreateInvoice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateInvoiceInput) =>
      (await api.post<Invoice>('/invoices', input)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['invoices'] }),
  });
}

export function usePostInvoice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => (await api.post<Invoice>(`/invoices/${id}/post`)).data,
    onSuccess: (_d, id) => {
      qc.invalidateQueries({ queryKey: ['invoices'] });
      qc.invalidateQueries({ queryKey: ['invoice', id] });
    },
  });
}

export function useCancelInvoice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => (await api.post<Invoice>(`/invoices/${id}/cancel`)).data,
    onSuccess: (_d, id) => {
      qc.invalidateQueries({ queryKey: ['invoices'] });
      qc.invalidateQueries({ queryKey: ['invoice', id] });
    },
  });
}

export interface CreatePaymentInput {
  partnerId: string;
  paymentDate: string;
  amount: number;
  paymentMethod?: string;
  reference?: string;
  allocations?: { documentId: string; amount: number }[];
}

export function useCreatePayment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreatePaymentInput) => (await api.post('/payments', input)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['invoices'] });
      qc.invalidateQueries({ queryKey: ['invoice'] });
    },
  });
}

export interface AgingBuckets {
  current: string;
  d1_30: string;
  d31_60: string;
  d61_90: string;
  d90_plus: string;
}

export interface AgingRow {
  documentId: string;
  documentNumber: string;
  partnerName: string;
  dueDate: string;
  daysOverdue: number;
  residual: string;
  bucket: string;
}

export interface Aging {
  asOf: string;
  buckets: AgingBuckets;
  total: string;
  rows: AgingRow[];
}

export function useArAging(asOf?: string) {
  return useQuery({
    queryKey: ['ar-aging', asOf],
    queryFn: async () =>
      (await api.get<Aging>('/reports/ar/aging', { params: asOf ? { asOf } : {} })).data,
  });
}

// ---- Credit notes (Documents of type credit_note) ----

export interface CreateCreditNoteInput {
  partnerId: string;
  issueDate: string;
  reference?: string;
  notes?: string;
  reversedDocumentId?: string;
  lines: InvoiceLineInput[];
}

export function useCreditNotes(params: { page?: number; pageSize?: number; search?: string }) {
  return useQuery({
    queryKey: ['credit-notes', params],
    queryFn: async () => (await api.get<PaginatedResult<Invoice>>('/credit-notes', { params })).data,
  });
}

export function useCreditNote(id: string | undefined) {
  return useQuery({
    queryKey: ['credit-note', id],
    queryFn: async () => (await api.get<InvoiceDetail>(`/credit-notes/${id}`)).data,
    enabled: !!id,
  });
}

export function useCreateCreditNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateCreditNoteInput) =>
      (await api.post<Invoice>('/credit-notes', input)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['credit-notes'] }),
  });
}

export function usePostCreditNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => (await api.post<Invoice>(`/credit-notes/${id}/post`)).data,
    onSuccess: (_d, id) => {
      qc.invalidateQueries({ queryKey: ['credit-notes'] });
      qc.invalidateQueries({ queryKey: ['credit-note', id] });
      qc.invalidateQueries({ queryKey: ['invoices'] });
      qc.invalidateQueries({ queryKey: ['invoice'] });
    },
  });
}

// ---- Payments / Receipts ----

export interface Payment {
  id: string;
  paymentNumber: string;
  partnerId: string;
  partner?: { id: string; name: string };
  direction: string;
  paymentDate: string;
  paymentMethod: string;
  amount: string;
  allocatedAmount: string;
  unallocatedAmount: string;
  reference: string | null;
  status: string;
}

export interface PaymentAllocation {
  id: string;
  amount: string;
  document: { id: string; documentNumber: string; documentType: string };
}

export interface PaymentDetail extends Payment {
  allocations: PaymentAllocation[];
}

export function usePayments(params: { page?: number; pageSize?: number; search?: string }) {
  return useQuery({
    queryKey: ['payments', params],
    queryFn: async () => (await api.get<PaginatedResult<Payment>>('/payments', { params })).data,
  });
}

export function usePayment(id: string | undefined) {
  return useQuery({
    queryKey: ['payment', id],
    queryFn: async () => (await api.get<PaymentDetail>(`/payments/${id}`)).data,
    enabled: !!id,
  });
}

export function useVoidPayment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => (await api.post(`/payments/${id}/void`)).data,
    onSuccess: (_d, id) => {
      qc.invalidateQueries({ queryKey: ['payments'] });
      qc.invalidateQueries({ queryKey: ['supplier-payments'] });
      qc.invalidateQueries({ queryKey: ['payment', id] });
      qc.invalidateQueries({ queryKey: ['invoices'] });
      qc.invalidateQueries({ queryKey: ['invoice'] });
      qc.invalidateQueries({ queryKey: ['expenses'] });
      qc.invalidateQueries({ queryKey: ['expense'] });
    },
  });
}

// ---- Vendor bills / Expenses (Accounts Payable) ----

export interface CreateExpenseInput {
  partnerId: string;
  issueDate: string;
  dueDate?: string;
  reference?: string;
  notes?: string;
  lines: InvoiceLineInput[];
}

export function useExpenses(params: { page?: number; pageSize?: number; search?: string }) {
  return useQuery({
    queryKey: ['expenses', params],
    queryFn: async () => (await api.get<PaginatedResult<Invoice>>('/expenses', { params })).data,
  });
}

export function useExpense(id: string | undefined) {
  return useQuery({
    queryKey: ['expense', id],
    queryFn: async () => (await api.get<InvoiceDetail>(`/expenses/${id}`)).data,
    enabled: !!id,
  });
}

export function useCreateExpense() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateExpenseInput) => (await api.post<Invoice>('/expenses', input)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['expenses'] }),
  });
}

export function usePostExpense() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => (await api.post<Invoice>(`/expenses/${id}/post`)).data,
    onSuccess: (_d, id) => {
      qc.invalidateQueries({ queryKey: ['expenses'] });
      qc.invalidateQueries({ queryKey: ['expense', id] });
    },
  });
}

export function useVoidExpense() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => (await api.post<Invoice>(`/expenses/${id}/cancel`)).data,
    onSuccess: (_d, id) => {
      qc.invalidateQueries({ queryKey: ['expenses'] });
      qc.invalidateQueries({ queryKey: ['expense', id] });
    },
  });
}

// ---- Supplier payments (outbound) ----

export function useSupplierPayments(params: { page?: number; pageSize?: number; search?: string }) {
  return useQuery({
    queryKey: ['supplier-payments', params],
    queryFn: async () => (await api.get<PaginatedResult<Payment>>('/supplier-payments', { params })).data,
  });
}

export function useCreateSupplierPayment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreatePaymentInput) => (await api.post('/supplier-payments', input)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['supplier-payments'] });
      qc.invalidateQueries({ queryKey: ['expenses'] });
      qc.invalidateQueries({ queryKey: ['expense'] });
    },
  });
}
