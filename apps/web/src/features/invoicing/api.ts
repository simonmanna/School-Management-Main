import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PaginatedResult } from '@erp/shared';
import { api } from '@/lib/api';

export type InvoiceDiscountType = 'percentage' | 'fixed_amount';
export type InvoiceDiscountSource = 'manual' | 'promotion' | 'loyalty' | 'coupon';

export interface Invoice {
  id: string;
  documentNumber: string;
  partnerId: string;
  partner?: { id: string; name: string };
  issueDate: string;
  dueDate: string | null;
  /** Payment term master id (loose ref) + name snapshot from sale time. */
  paymentTermId: string | null;
  paymentTermName: string | null;
  status: string;
  subtotal: string;
  discountTotal: string;
  discountType: InvoiceDiscountType;
  discountValue: string;
  discountSource: InvoiceDiscountSource;
  discountReason: string | null;
  discountAppliedBy: string | null;
  discountApprovedBy: string | null;
  discountApprovedAt: string | null;
  taxAmount: string;
  totalAmount: string;
  amountPaid: string;
  amountResidual: string;
  paymentStatus: string;
  paymentMode: string | null;
  fiscalPositionId: string | null;
  fiscalPositionName: string | null;
  invoicingJournalId: string | null;
  invoicingJournalName: string | null;
  salespersonId: string | null;
  salespersonName: string | null;
  deliveryDate: string | null;
  deliveryAddress: string | null;
  incoterm: string | null;
  incotermLocation: string | null;
  sourceDocument: string | null;
  settlementStatus: string;
  branchId: string | null;
  reference: string | null;
  notes: string | null;
  journalEntryId: string | null;
  reversedDocumentId?: string | null;
}

export interface InvoiceLine {
  id: string;
  /** Odoo line type: 'product' | 'section' | 'note'. */
  lineType: string;
  /** GL account the line posts to (Odoo Account column). */
  account?: { id: string; code: string; name: string } | null;
  /** Tax row joined by loose ref at read time. */
  tax?: { id: string; name: string; rate: string } | null;
  description: string;
  quantity: string;
  unitPrice: string;
  discountPercent: string;
  discountType: InvoiceDiscountType;
  discountAmount: string;
  discountReason: string | null;
  discountSource: InvoiceDiscountSource;
  discountAppliedBy: string | null;
  discountApprovedBy: string | null;
  discountApprovedAt: string | null;
  subtotal: string;
  taxAmount: string;
  total: string;
}

export interface InvoiceAllocation {
  paymentId: string;
  amount: string;
  payment?: {
    direction: string;
    paymentDate: string;
    paymentMethod: string;
    reference?: string | null;
    paymentNumber?: string | null;
  };
}

export interface InvoiceDetail extends Invoice {
  lines: InvoiceLine[];
  allocations?: InvoiceAllocation[];
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
  paymentTermId?: string;
  /** Payment method intent — how the sale will be settled. */
  paymentMode?: string;
  /** Fiscal position (loose ref to core FiscalPosition master). */
  fiscalPositionId?: string;
  /** Invoicing journal (loose ref to Journal master). */
  invoicingJournalId?: string;
  /** Salesperson (loose ref to HrEmployee). */
  salespersonId?: string;
  /** Delivery intent (Odoo Other Info). */
  deliveryDate?: string;
  deliveryAddress?: string;
  incoterm?: string;
  incotermLocation?: string;
  sourceDocument?: string;
  reference?: string;
  notes?: string;
  lines: InvoiceLineInput[];
}

export function useInvoices(params: {
  page?: number;
  pageSize?: number;
  search?: string;
  status?: string;
  paymentStatus?: string;
  settlementStatus?: string;
  dateFrom?: string;
  dateTo?: string;
}) {
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

// ---- Journal-entry preview (invoices/new "Journal Entry" tab) ----

export interface JournalPreviewAccount {
  id: string;
  code: string;
  name: string;
}

export interface JournalPreviewLine {
  lineNumber: number;
  account: JournalPreviewAccount | null;
  partnerName: string | null;
  description: string | null;
  debit: string | null;
  credit: string | null;
}

export interface InvoiceJournalPreview {
  journal: {
    id: string;
    code: string;
    name: string;
    journalType: string;
  };
  postingDate: string;
  description: string | null;
  lines: JournalPreviewLine[];
  debitTotal: string;
  creditTotal: string;
  balanced: boolean;
}

/** Server-side dry-run of the entry the invoice will post (read-only, writes nothing). */
export function useInvoiceJournalPreview() {
  return useMutation({
    mutationFn: async (input: CreateInvoiceInput) =>
      (await api.post<InvoiceJournalPreview>('/invoices/journal-preview', input)).data,
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
  accountId?: string;
  cashSessionId?: string;
  allowOverpayment?: boolean;
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

/** Post a credit note. `disposition` decides what happens to returned goods:
 *  'restock' (default) puts them back on the shelf and reverses COGS; 'scrap'
 *  writes them off (revenue reversed only). */
export function usePostCreditNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (arg: string | { id: string; disposition?: 'restock' | 'scrap' }) => {
      const id = typeof arg === 'string' ? arg : arg.id;
      const disposition = typeof arg === 'string' ? undefined : arg.disposition;
      const qs = disposition ? `?disposition=${disposition}` : '';
      return (await api.post<Invoice>(`/credit-notes/${id}/post${qs}`)).data;
    },
    onSuccess: (_d, arg) => {
      const id = typeof arg === 'string' ? arg : arg.id;
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
    queryFn: async () => (await api.get<PaginatedResult<Invoice>>('/vendor-bills', { params })).data,
  });
}

export function useExpense(id: string | undefined) {
  return useQuery({
    queryKey: ['expense', id],
    queryFn: async () => (await api.get<InvoiceDetail>(`/vendor-bills/${id}`)).data,
    enabled: !!id,
  });
}

export function useCreateExpense() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateExpenseInput) => (await api.post<Invoice>('/vendor-bills', input)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['expenses'] }),
  });
}

export function usePostExpense() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => (await api.post<Invoice>(`/vendor-bills/${id}/post`)).data,
    onSuccess: (_d, id) => {
      qc.invalidateQueries({ queryKey: ['expenses'] });
      qc.invalidateQueries({ queryKey: ['expense', id] });
    },
  });
}

export function useVoidExpense() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => (await api.post<Invoice>(`/vendor-bills/${id}/cancel`)).data,
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

export interface SupplierLedger {
  openingBalance: number;
  closingBalance: number;
  transactions: Array<{
    id: string;
    date: string;
    type: string;
    reference: string;
    description: string;
    debit: number;
    credit: number;
    balance: number;
    status: string;
  }>;
}

export function useSupplierLedger(partnerId: string | undefined) {
  return useQuery({
    queryKey: ['supplier-ledger', partnerId],
    queryFn: async () => (await api.get<SupplierLedger>(`/vendor-bills/suppliers/${partnerId}/ledger`)).data,
    enabled: !!partnerId,
  });
}
