import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

// ── types ────────────────────────────────────────────────────────────────────

export interface BottleReading {
  id?: string;
  bottleNumber?: string | null;
  measuredWeightG: string | number;
  remainingMl?: string | number;
  confidence?: string;
}

export interface BottleCountLine {
  id: string;
  productId: string;
  productName: string;
  unit?: string | null;
  systemMl: string;
  sealedFullCount: string;
  countedMl: string | null;
  varianceMl: string;
  varianceG: string;
  expectedShots: string | null;
  reason?: string | null;
  confidence: 'GOOD' | 'SUSPICIOUS' | 'OUT_OF_RANGE';
  readings: BottleReading[];
}

export interface BottleCountSession {
  id: string;
  countCode: string;
  name?: string | null;
  locationId: string;
  countType: 'opening' | 'closing';
  status: 'draft' | 'submitted' | 'cancelled';
  startedAt: string;
  submittedAt?: string | null;
  approvedById?: string | null;
  adjustmentId?: string | null;
  notes?: string | null;
  lines: BottleCountLine[];
  _count?: { lines: number };
}

export interface SaveBottleLineInput {
  lineId: string;
  sealedFullCount?: number;
  readings?: { measuredWeightG: number; bottleNumber?: string; measurementSource?: string }[];
  reason?: string;
}

export interface VarianceRow {
  productId: string;
  product: string;
  systemMl: number;
  countedMl: number | null;
  varianceMl: number;
  varianceG: number;
  variancePct: number;
  lossValue: number;
  confidence: string | null;
  countedAt: string | null;
}

export interface YieldRow {
  productId: string;
  product: string;
  shotsPerBottle: number;
  soldMl: number;
  soldShots: number;
  bottlesSold: number;
}

export interface BartenderRow {
  waiterId: string;
  bartender: string;
  soldMl: number;
  salesValue: number;
}

export interface BeverageDashboard {
  openBottles: number;
  todaysAlcoholSales: number;
  todaysVariancePct: number;
  openVariances: number;
  countsPending: number;
  shrinkage: { thisWeek: number; thisMonth: number; lastMonth: number };
  totalLossValue: number;
}

// ── count hooks ──────────────────────────────────────────────────────────────

export function useBottleCounts(enabled = true) {
  return useQuery<BottleCountSession[]>({
    queryKey: ['beverage-counts'],
    queryFn: async () => (await api.get<BottleCountSession[]>('/beverage/counts')).data ?? [],
    enabled,
  });
}

export function useStartBottleCount() {
  return useMutation({
    mutationFn: async (body: { locationId?: string; countType: 'opening' | 'closing' }) =>
      (await api.post<BottleCountSession>('/beverage/counts/start', body)).data,
  });
}

export function useSaveBottleDraft() {
  return useMutation({
    mutationFn: async ({ id, body }: { id: string; body: { name?: string; notes?: string; lines: SaveBottleLineInput[] } }) =>
      (await api.patch<BottleCountSession>(`/beverage/counts/${id}/draft`, body)).data,
  });
}

export function useSubmitBottleCount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, body }: { id: string; body?: { approverId?: string; approverEmail?: string; managerPin?: string } }) =>
      (await api.post<BottleCountSession>(`/beverage/counts/${id}/submit`, body ?? {})).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['beverage-counts'] });
      qc.invalidateQueries({ queryKey: ['beverage-reports'] });
    },
  });
}

export function useCancelBottleCount() {
  return useMutation({
    mutationFn: async (id: string) => (await api.post(`/beverage/counts/${id}/cancel`)).data,
  });
}

// ── report hooks ─────────────────────────────────────────────────────────────

export function useBeverageVariance(locationId?: string) {
  return useQuery<VarianceRow[]>({
    queryKey: ['beverage-reports', 'variance', locationId ?? ''],
    queryFn: async () =>
      (await api.get<VarianceRow[]>('/beverage/reports/variance', { params: { locationId } })).data ?? [],
  });
}

export function useBeverageYield(from?: string, to?: string) {
  return useQuery<YieldRow[]>({
    queryKey: ['beverage-reports', 'yield', from ?? '', to ?? ''],
    queryFn: async () =>
      (await api.get<YieldRow[]>('/beverage/reports/yield', { params: { from, to } })).data ?? [],
  });
}

export function useBeverageBartender(from?: string, to?: string) {
  return useQuery<BartenderRow[]>({
    queryKey: ['beverage-reports', 'bartender', from ?? '', to ?? ''],
    queryFn: async () =>
      (await api.get<BartenderRow[]>('/beverage/reports/bartender', { params: { from, to } })).data ?? [],
  });
}

export function useBeverageDashboard(locationId?: string) {
  return useQuery<BeverageDashboard>({
    queryKey: ['beverage-reports', 'dashboard', locationId ?? ''],
    queryFn: async () =>
      (await api.get<BeverageDashboard>('/beverage/reports/dashboard', { params: { locationId } })).data,
  });
}
