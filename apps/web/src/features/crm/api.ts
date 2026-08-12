import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PaginatedResult } from '@erp/shared';
import { api } from '@/lib/api';

/* ───────────────────────── Types (mirror backend contract) ───────────────────────── */

export type DealStage = 'lead' | 'qualified' | 'proposal' | 'negotiation' | 'won' | 'lost';
export type ActivityType = 'call' | 'email' | 'meeting' | 'note' | 'task' | 'deal_stage_change';
export type ActivityStatus = 'todo' | 'in_progress' | 'done' | 'cancelled';

export const DEAL_STAGES: DealStage[] = ['lead', 'qualified', 'proposal', 'negotiation', 'won', 'lost'];
export const ACTIVITY_TYPES: ActivityType[] = ['call', 'email', 'meeting', 'note', 'task'];

export const STAGE_META: Record<DealStage, { label: string; dot: string; chip: string }> = {
  lead: { label: 'Lead', dot: 'bg-slate-400', chip: 'bg-slate-100 text-slate-700' },
  qualified: { label: 'Qualified', dot: 'bg-sky-500', chip: 'bg-sky-100 text-sky-700' },
  proposal: { label: 'Proposal', dot: 'bg-violet-500', chip: 'bg-violet-100 text-violet-700' },
  negotiation: { label: 'Negotiation', dot: 'bg-amber-500', chip: 'bg-amber-100 text-amber-700' },
  won: { label: 'Won', dot: 'bg-emerald-500', chip: 'bg-emerald-100 text-emerald-700' },
  lost: { label: 'Lost', dot: 'bg-rose-500', chip: 'bg-rose-100 text-rose-700' },
};

/** Deal amounts default to the org currency (IDR) on the frontend; fall back to
 *  the deal's stored currencyCode when present. */
export function dealCurrency(deal: Pick<CrmDeal, 'currencyCode'>): string {
  return deal.currencyCode || 'IDR';
}

export interface CrmUser {
  id: string;
  email: string;
  name: string;
}

export interface CrmPartnerLite {
  name: string;
  code: string | null;
  contacts?: Array<{ id: string; firstName: string; lastName: string | null; email: string | null; phone: string | null }>;
}

export interface CrmDeal {
  id: string;
  name: string;
  partnerId: string;
  partner?: CrmPartnerLite | null;
  ownerId: string | null;
  owner?: CrmUser | null;
  createdById: string | null;
  createdBy?: CrmUser | null;
  stage: DealStage;
  amount: number;
  currencyCode: string;
  expectedClose: string | null;
  notes: string | null;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
  activities?: CrmActivity[];
}

export interface CrmActivity {
  id: string;
  type: ActivityType;
  title: string;
  body: string | null;
  subjectType: string | null;
  subjectId: string | null;
  dealId: string | null;
  partnerId: string | null;
  dueAt: string | null;
  duration: number | null;
  status: ActivityStatus;
  completed: boolean;
  completedAt: string | null;
  occurredAt: string;
  createdById: string | null;
  createdBy?: CrmUser | null;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DealListParams {
  page?: number;
  pageSize?: number;
  stage?: DealStage | '';
  partnerId?: string;
  ownerId?: string;
  q?: string;
}

export interface ActivityListParams {
  page?: number;
  pageSize?: number;
  type?: string;
  dealId?: string;
  partnerId?: string;
  status?: string;
}

export interface CreateDealInput {
  name: string;
  partnerId: string;
  ownerId?: string;
  stage?: DealStage;
  amount?: number;
  currencyCode?: string;
  expectedClose?: string;
  notes?: string;
}

export interface CreateActivityInput {
  type: 'call' | 'email' | 'meeting' | 'note' | 'task';
  title: string;
  body?: string;
  dealId?: string;
  partnerId?: string;
  dueAt?: string;
  duration?: number;
}

/* ───────────────────────── Analytics types ───────────────────────── */

export interface PipelineStageRow {
  stage: DealStage;
  count: number;
  totalAmount: number;
  weight: number;
}

export interface PipelineSummary {
  stages: PipelineStageRow[];
  openPipelineValue: number;
  weightedValue: number;
}

export interface WinRateSummary {
  won: number;
  lost: number;
  total: number;
  rate: number;
}

export interface ForecastMonth {
  month: string;
  expectedAmount: number;
}

export interface TopCustomer {
  partnerId: string;
  name: string;
  code: string | null;
  dealCount: number;
  dealValue: number;
}

/* ───────────────────────── Deals ───────────────────────── */

export function useCrmDeals(params: DealListParams, options?: { enabled?: boolean }) {
  return useQuery({
    ...options,
    queryKey: ['crm-deals', params],
    queryFn: async () => (await api.get<PaginatedResult<CrmDeal>>('/crm/deals', { params })).data,
  });
}

export function useCrmDeal(id: string | undefined) {
  return useQuery({
    queryKey: ['crm-deal', id],
    queryFn: async () => (await api.get<CrmDeal>(`/crm/deals/${id}`)).data,
    enabled: !!id,
  });
}

export function useCrmDeletedDeals() {
  return useQuery({
    queryKey: ['crm-deals-deleted'],
    queryFn: async () => (await api.get<CrmDeal[]>('/crm/deals/deleted')).data,
  });
}

export function useCreateDeal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateDealInput) => (await api.post<CrmDeal>('/crm/deals', input)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['crm-deals'] });
      qc.invalidateQueries({ queryKey: ['crm-analytics'] });
    },
  });
}

export function useUpdateDeal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<CreateDealInput> }) =>
      (await api.patch<CrmDeal>(`/crm/deals/${id}`, data)).data,
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ['crm-deals'] });
      qc.invalidateQueries({ queryKey: ['crm-deal', vars.id] });
      qc.invalidateQueries({ queryKey: ['crm-analytics'] });
    },
  });
}

export function useChangeStage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, stage }: { id: string; stage: DealStage }) =>
      (await api.patch<CrmDeal>(`/crm/deals/${id}/stage`, { stage })).data,
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ['crm-deals'] });
      qc.invalidateQueries({ queryKey: ['crm-deal', vars.id] });
      qc.invalidateQueries({ queryKey: ['crm-activities'] });
      qc.invalidateQueries({ queryKey: ['crm-analytics'] });
    },
  });
}

export function useDeleteDeal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => (await api.delete(`/crm/deals/${id}`)).data,
    onSuccess: (_data, id) => {
      qc.invalidateQueries({ queryKey: ['crm-deals'] });
      qc.invalidateQueries({ queryKey: ['crm-deals-deleted'] });
      qc.invalidateQueries({ queryKey: ['crm-deal', id] });
      qc.invalidateQueries({ queryKey: ['crm-analytics'] });
    },
  });
}

export function useRestoreDeal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => (await api.patch(`/crm/deals/${id}/restore`)).data,
    onSuccess: (_data, id) => {
      qc.invalidateQueries({ queryKey: ['crm-deals'] });
      qc.invalidateQueries({ queryKey: ['crm-deals-deleted'] });
      qc.invalidateQueries({ queryKey: ['crm-deal', id] });
      qc.invalidateQueries({ queryKey: ['crm-analytics'] });
    },
  });
}

/* ───────────────────────── Activities ───────────────────────── */

export function useCrmActivities(params: ActivityListParams, options?: { enabled?: boolean }) {
  return useQuery({
    ...options,
    queryKey: ['crm-activities', params],
    queryFn: async () => (await api.get<PaginatedResult<CrmActivity>>('/crm/activities', { params })).data,
  });
}

export function useCrmUpcomingTasks(limit = 20) {
  return useQuery({
    queryKey: ['crm-upcoming', limit],
    queryFn: async () => (await api.get<CrmActivity[]>('/crm/activities/upcoming', { params: { limit } })).data,
  });
}

export function useCreateActivity() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateActivityInput) => (await api.post<CrmActivity>('/crm/activities', input)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['crm-activities'] });
      qc.invalidateQueries({ queryKey: ['crm-upcoming'] });
      qc.invalidateQueries({ queryKey: ['crm-deal'] });
    },
  });
}

export function useCompleteActivity() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => (await api.post(`/crm/activities/${id}/complete`)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['crm-activities'] });
      qc.invalidateQueries({ queryKey: ['crm-upcoming'] });
      qc.invalidateQueries({ queryKey: ['crm-deal'] });
    },
  });
}

export function useUpdateActivity() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: { title?: string; body?: string; dueAt?: string; status?: ActivityStatus; completed?: boolean } }) =>
      (await api.patch(`/crm/activities/${id}`, data)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['crm-activities'] });
      qc.invalidateQueries({ queryKey: ['crm-upcoming'] });
      qc.invalidateQueries({ queryKey: ['crm-deal'] });
    },
  });
}

export function useDeleteActivity() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => (await api.delete(`/crm/activities/${id}`)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['crm-activities'] });
      qc.invalidateQueries({ queryKey: ['crm-upcoming'] });
      qc.invalidateQueries({ queryKey: ['crm-deal'] });
    },
  });
}

/* ───────────────────────── Analytics ───────────────────────── */

export function useCrmPipeline() {
  return useQuery({
    queryKey: ['crm-analytics', 'pipeline'],
    queryFn: async () => (await api.get<PipelineSummary>('/crm/analytics/pipeline')).data,
  });
}

export function useCrmWinRate(from?: string, to?: string) {
  return useQuery({
    queryKey: ['crm-analytics', 'win-rate', from, to],
    queryFn: async () => (await api.get<WinRateSummary>('/crm/analytics/win-rate', { params: { from, to } })).data,
  });
}

export function useCrmForecast(months = 3) {
  return useQuery({
    queryKey: ['crm-analytics', 'forecast', months],
    queryFn: async () => (await api.get<ForecastMonth[]>('/crm/analytics/forecast', { params: { months } })).data,
  });
}

export function useCrmTopCustomers(limit = 10) {
  return useQuery({
    queryKey: ['crm-analytics', 'top-customers', limit],
    queryFn: async () => (await api.get<TopCustomer[]>('/crm/analytics/top-customers', { params: { limit } })).data,
  });
}

/* ───────────────────────── Meta (owners / partners) ───────────────────────── */

/** C1 — Partner 360 spend stats from POS documents (totalSpent, orderCount, lastOrderAt, openReceivable). */
export interface Partner360 {
  totalSpent: number;
  orderCount: number;
  lastOrderAt: string | null;
  openReceivable: number;
}

export function useCrmPartner360(partnerId: string | undefined) {
  return useQuery<Partner360>({
    queryKey: ['crm-partner-360', partnerId],
    queryFn: async () => (await api.get(`/crm/analytics/partner/${partnerId}`)).data,
    enabled: !!partnerId,
  });
}

/** Staff users for the owner dropdown. The core /users endpoint returns flat
 *  firstName/lastName; reshape to { id, email, name } like the expenses client. */
export function useCrmUsers() {
  return useQuery<CrmUser[]>({
    queryKey: ['crm-users'],
    queryFn: async () => {
      const res = await api.get('/users');
      const rows: Array<Record<string, unknown>> = Array.isArray(res.data) ? res.data : (res.data?.data ?? []);
      return rows.map((u) => ({
        id: String(u.id),
        email: String(u.email ?? ''),
        name: [u.firstName, u.lastName].filter(Boolean).join(' ') || String(u.email ?? ''),
      }));
    },
  });
}

/** Partner autocomplete for the deal form (search-as-you-type). */
export function useCrmPartners(search: string, options?: { enabled?: boolean }) {
  return useQuery({
    ...options,
    queryKey: ['crm-partners', search],
    queryFn: async () =>
      (await api.get<PaginatedResult<{ id: string; name: string; code: string | null; isCustomer: boolean }>>('/partners', {
        params: { page: 1, pageSize: 8, search: search || undefined },
      })).data,
  });
}
