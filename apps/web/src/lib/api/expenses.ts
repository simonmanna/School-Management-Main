import { api } from '@/lib/api';
import type { Expense, ExpenseStats, AuditLogRow, PaginatedResponse } from '@/types/expenses';

interface GetAllParams {
  page?: number;
  limit?: number;
  categoryId?: string;
  status?: string;
  dateFrom?: string;
  dateTo?: string;
  search?: string;
  paymentType?: string;
}

export const expensesApi = {
  getAll(params: GetAllParams): Promise<PaginatedResponse<Expense>> {
    return api.get('/expenses', { params }).then((r) => r.data);
  },
  getStats(dateFrom?: string, dateTo?: string): Promise<ExpenseStats> {
    return api.get('/expenses/stats', { params: { dateFrom, dateTo } }).then((r) => r.data);
  },
  create(body: any): Promise<Expense> {
    return api.post('/expenses', body).then((r) => r.data);
  },
  update(id: string, body: any): Promise<Expense> {
    return api.patch(`/expenses/${id}`, body).then((r) => r.data);
  },
  delete(id: string): Promise<void> {
    return api.delete(`/expenses/${id}`).then((r) => r.data);
  },
  approve(id: string, body: { approvedBy: string; approvalNotes?: string }): Promise<Expense> {
    return api.post(`/expenses/${id}/approve`, body).then((r) => r.data);
  },
  reject(id: string, reason?: string): Promise<Expense> {
    return api.post(`/expenses/${id}/reject`, { reason }).then((r) => r.data);
  },
  pay(id: string, body: { paidBy: string; paymentMethod: string; reference?: string; paymentNotes?: string; accountId: string }): Promise<Expense> {
    return api.post(`/expenses/${id}/pay`, body).then((r) => r.data);
  },
  void(id: string, body: { voidReason: string }): Promise<Expense> {
    return api.post(`/expenses/${id}/void`, body).then((r) => r.data);
  },
  getAudit(id: string): Promise<AuditLogRow[]> {
    return api.get(`/expenses/${id}/audit`).then((r) => r.data);
  },
};

export const accountsApi = {
  // Postable cash/bank accounts (with GL-derived balances) the expense module
  // can debit. Served by the expenses module so the shape matches the form.
  // Return type is loose so the page's `{accounts}`/array fallback compiles.
  getAll(): Promise<any> {
    return api.get('/expenses/meta/accounts').then((r) => r.data);
  },
};

export const usersApi = {
  // The staff dropdowns expect `{ id, email, staff: { firstName, lastName } }`.
  // The core /users endpoint returns flat firstName/lastName, so reshape here.
  getAll(): Promise<any> {
    return api.get('/users').then((r) => {
      const rows = Array.isArray(r.data) ? r.data : (r.data?.data ?? []);
      return rows.map((u: any) => ({
        id: u.id,
        email: u.email,
        staff:
          u.firstName || u.lastName
            ? { firstName: u.firstName ?? '', lastName: u.lastName ?? '' }
            : null,
      }));
    });
  },
};

export const suppliersApi = {
  getAll(): Promise<any> {
    return api.get('/expenses/meta/suppliers').then((r) => r.data);
  },
};
