import { api } from '@/lib/api';
import type {
  Income,
  IncomeHead,
  Account,
  AuditLogRow,
  PaginatedResponse,
} from '@/types/income';

interface GetAllParams {
  page?: number;
  limit?: number;
  incomeHeadId?: string;
  paymentMethod?: string;
  dateFrom?: string;
  dateTo?: string;
  search?: string;
}

export const incomeApi = {
  getAll(params: GetAllParams): Promise<PaginatedResponse<Income>> {
    return api.get('/income', { params }).then((r) => r.data);
  },
  getStats(dateFrom?: string, dateTo?: string) {
    return api.get('/income/stats', { params: { dateFrom, dateTo } }).then((r) => r.data);
  },
  create(body: any): Promise<Income> {
    return api.post('/income', body).then((r) => r.data);
  },
  update(id: string, body: any): Promise<Income> {
    return api.patch(`/income/${id}`, body).then((r) => r.data);
  },
  cancel(id: string, body: { cancelReason: string }): Promise<Income> {
    return api.post(`/income/${id}/cancel`, body).then((r) => r.data);
  },
  delete(id: string): Promise<void> {
    return api.delete(`/income/${id}`).then((r) => r.data);
  },
  getAudit(id: string): Promise<AuditLogRow[]> {
    return api.get(`/income/${id}/audit`).then((r) => r.data);
  },
  receiptAccounts(): Promise<Account[]> {
    return api.get('/income/meta/accounts').then((r) => r.data);
  },
};

export const incomeHeadsApi = {
  getAll(): Promise<IncomeHead[]> {
    return api.get('/income-heads').then((r) => r.data);
  },
  create(body: any): Promise<IncomeHead> {
    return api.post('/income-heads', body).then((r) => r.data);
  },
  update(id: string, body: any): Promise<IncomeHead> {
    return api.patch(`/income-heads/${id}`, body).then((r) => r.data);
  },
  delete(id: string): Promise<void> {
    return api.delete(`/income-heads/${id}`).then((r) => r.data);
  },
};
