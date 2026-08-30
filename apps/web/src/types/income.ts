export interface IncomeHead {
  id: string;
  organizationId: string;
  name: string;
  icon?: string | null;
  description?: string | null;
  ledgerAccountId?: string | null;
  isActive: boolean;
  ledgerAccount?: { id: string; name: string; code: string } | null;
}

export interface Income {
  id: string;
  organizationId: string;
  incomeCode: string;
  name: string;
  description?: string | null;
  invoiceNumber?: string | null;
  amount: number;
  incomeDate: string;
  incomeHeadId?: string | null;
  incomeHeadName?: string | null;
  paymentMethod: string;
  accountId?: string | null;
  attachmentId?: string | null;
  journalEntryId?: string | null;
  status: string;
  receivedById?: string | null;
  incomeHead?: { id: string; name: string; icon?: string | null } | null;
  receivedBy?: { staff?: { firstName: string; lastName: string } | null } | null;
  createdAt: string;
  updatedAt: string;
}

export interface Account {
  id: string;
  name: string;
  currency: string;
  currentBalance: number;
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
