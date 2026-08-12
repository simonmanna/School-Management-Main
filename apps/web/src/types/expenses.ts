export interface Expense {
  id: string;
  organizationId: string;
  expenseCode: string;
  title: string;
  description?: string | null;
  amount: number;
  status: string;
  expenseDate: string;
  paidAt?: string | null;
  approvalNotes?: string | null;
  notes?: string | null;
  categoryId?: string | null;
  categoryName?: string | null;
  category?: { id: string; name: string; icon?: string | null } | null;
  createdBy?: { staff?: { firstName: string; lastName: string } | null } | null;
  approvedBy?: { staff?: { firstName: string; lastName: string } | null } | null;
}

export interface ExpenseStats {
  count: number;
  grandTotal: number;
  totalUnpaid: number;
  totalUnpaidCount: number;
  totalPartiallyPaid: number;
  totalPartiallyPaidCount: number;
  totalPaid: number;
  totalPaidCount: number;
}

export interface Account {
  id: string;
  name: string;
  currency: string;
  currentBalance: number;
}

export interface User {
  id: string;
  email: string;
  staff?: { firstName: string; lastName: string } | null;
}

export interface AuditLogRow {
  id: string;
  action: string;
  entityType: string;
  userId?: string | null;
  userName?: string | null;
  reason?: string | null;
  createdAt: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
}
