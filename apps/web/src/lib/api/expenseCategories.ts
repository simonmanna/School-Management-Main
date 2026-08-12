import { api } from '@/lib/api';

export interface ExpenseCategory {
  id: string;
  name: string;
  icon?: string | null;
  isActive?: boolean;
  ledgerAccountId?: string | null;
  ledgerAccount?: { id: string; name: string; code: string } | null;
}

export const expenseCategoriesApi = {
  list(): Promise<ExpenseCategory[]> {
    return api.get('/expense-categories').then((r) => r.data);
  },
  get(id: string): Promise<ExpenseCategory> {
    return api.get(`/expense-categories/${id}`).then((r) => r.data);
  },
  create(body: {
    name: string;
    icon?: string;
    description?: string;
    ledgerAccountId?: string;
  }): Promise<ExpenseCategory> {
    return api.post('/expense-categories', body).then((r) => r.data);
  },
  update(id: string, body: Partial<ExpenseCategory>): Promise<ExpenseCategory> {
    return api.patch(`/expense-categories/${id}`, body).then((r) => r.data);
  },
  delete(id: string): Promise<void> {
    return api.delete(`/expense-categories/${id}`).then((r) => r.data);
  },
};
