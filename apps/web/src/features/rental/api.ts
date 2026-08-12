/**
 * Rental Management API hooks.
 *
 * Surfaces the full lifecycle: catalog/rates/packages, units, availability,
 * reservations (holds), scores, agreements, deposits, extensions, swaps,
 * returns (inspect/settle), service orders and reports. Every call is
 * org-scoped server-side; permission failures surface as 403s.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

// ── Types ──────────────────────────────────────────────────────────────────

export interface RentalRate {
  id: string;
  productId: string;
  period: string;
  minUnits: number;
  maxUnits: number | null;
  price: number;
  priority: number;
  isActive: boolean;
}

export interface RentalPackageItem {
  id: string;
  productId: string;
  quantity: number;
  role: string;
  product?: { id: string; code: string; name: string };
}

export interface RentalPackage {
  id: string;
  code: string;
  name: string;
  description: string | null;
  productId: string;
  isActive: boolean;
  items: RentalPackageItem[];
}

export interface RentalUnit {
  id: string;
  unitCode: string;
  barcode: string | null;
  productId: string;
  status: string;
  rentalCount: number;
  lifetimeRevenue: number;
  lastInspectedAt: string | null;
  product?: { id: string; code: string; name: string };
}

export interface RentalReservation {
  id: string;
  reservationNumber: string;
  partnerId: string;
  status: string;
  startAt: string;
  endAt: string;
  expiresAt: string | null;
  notes: string | null;
  lines: Array<{ id: string; productId: string; quantity: number; product?: { id: string; code: string; name: string } }>;
}

export interface RentalAgreement {
  id: string;
  agreementNumber: string;
  partnerId: string;
  status: string;
  startAt: string;
  dueAt: string;
  termsSnapshot: Record<string, unknown>;
  orderId: string | null;
  invoiceId: string | null;
  settlementTotal: number;
  lateFeeTotal: number;
  damageTotal: number;
  depositApplied: number;
  lines: Array<{
    id: string;
    productId: string;
    quantity: number;
    ratePeriod: string;
    unitRate: number;
    lineTotal: number;
    dueAt: string;
    unitId: string | null;
    product?: { id: string; code: string; name: string };
  }>;
}

export interface RentalReturnLine {
  id: string;
  agreementLineId: string;
  unitId: string | null;
  quantity: number;
  quantityMissing: number;
  conditionGrade: string | null;
  isMissing: boolean;
  lateDays: number;
  lateFeeAmount: number;
  damages: Array<{ id: string; damageType: string; description: string | null; chargeAmount: number; waivedById: string | null }>;
}

export interface RentalReturn {
  id: string;
  returnNumber: string;
  agreementId: string;
  receivedAt: string;
  notes: string | null;
  lines: RentalReturnLine[];
  agreement?: { id: string; agreementNumber: string; partnerId: string };
}

export interface RentalDeposit {
  id: string;
  agreementId: string;
  totalCollected: number;
  totalApplied: number;
  totalRefunded: number;
  totalForfeited: number;
  movements: Array<{ id: string; type: string; amount: number; method: string | null; note: string | null; createdAt: string }>;
}

// ── Catalog ────────────────────────────────────────────────────────────────

export function useRentalCatalog(params: { productId?: string; includeInactive?: boolean } = {}) {
  return useQuery({
    queryKey: ['rental', 'catalog', params],
    queryFn: async () =>
      (
        await api.get<{ rates: RentalRate[]; packages: RentalPackage[] }>('/rental/catalog', {
          params: { productId: params.productId, includeInactive: params.includeInactive },
        })
      ).data,
  });
}

export function useRentalRates(productId?: string) {
  return useQuery({
    queryKey: ['rental', 'rates', productId],
    queryFn: async () => (await api.get<RentalRate[]>('/rental/rates', { params: { productId } })).data,
  });
}

export function useUpsertRate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: Partial<RentalRate> & { productId: string; period: string; minUnits: number; price: number }) =>
      (await api.post<RentalRate>('/rental/rates', dto)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['rental', 'rates'] }),
  });
}

export function useCreatePackage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: any) => (await api.post<RentalPackage>('/rental/packages', dto)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['rental', 'catalog'] }),
  });
}

// ── Units ──────────────────────────────────────────────────────────────────

export function useRentalUnits(params: { productId?: string; status?: string; search?: string; page?: number; pageSize?: number } = {}) {
  return useQuery({
    queryKey: ['rental', 'units', params],
    queryFn: async () =>
      (await api.get<{ total: number; page: number; pageSize: number; items: RentalUnit[] }>('/rental/units', { params })).data,
  });
}

export function useGenerateUnits() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: { productId: string; count: number; template: string }) =>
      (await api.post<{ created: number }>('/rental/units/generate', { codeTemplate: dto.template, ...dto })).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['rental', 'units'] }),
  });
}

export function useRetireUnit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, notes }: { id: string; notes?: string }) =>
      (await api.post(`/rental/units/${id}/retire`, { notes })).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['rental', 'units'] }),
  });
}

// ── Availability ───────────────────────────────────────────────────────────

export function useAvailability(productId?: string, startAt?: string, endAt?: string, excludeSourceId?: string) {
  return useQuery({
    queryKey: ['rental', 'availability', productId, startAt, endAt],
    enabled: Boolean(productId && startAt && endAt),
    queryFn: async () =>
      (
        await api.get<number>('/rental/availability', {
          params: { productId, startAt, endAt, excludeSourceId },
        })
      ).data,
  });
}

export function useAvailabilityUnits(productId?: string, startAt?: string, endAt?: string) {
  return useQuery({
    queryKey: ['rental', 'availability-units', productId, startAt, endAt],
    enabled: Boolean(productId && startAt && endAt),
    queryFn: async () =>
      (
        await api.get<string[]>('/rental/availability/units', {
          params: { productId, startAt, endAt },
        })
      ).data,
  });
}

// ── Reservations ───────────────────────────────────────────────────────────

export function useRentalReservations(params: { status?: string; partnerId?: string; page?: number; pageSize?: number } = {}) {
  return useQuery({
    queryKey: ['rental', 'reservations', params],
    queryFn: async () =>
      (
        await api.get<{ total: number; page: number; pageSize: number; items: RentalReservation[] }>('/rental/reservations', {
          params,
        })
      ).data,
  });
}

export function useCreateReservation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: {
      partnerId: string;
      startAt: string;
      endAt: string;
      holdMinutes?: number;
      notes?: string;
      branchId?: string;
      lines: Array<{ productId: string; quantity?: number }>;
    }) => (await api.post<RentalReservation>('/rental/reservations', dto)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['rental', 'reservations'] });
      qc.invalidateQueries({ queryKey: ['rental', 'availability'] });
    },
  });
}

export function useCancelReservation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => (await api.post(`/rental/reservations/${id}/cancel`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['rental', 'reservations'] }),
  });
}

// ── Agreements ─────────────────────────────────────────────────────────────

export function useRentalAgreements(params: { status?: string; partnerId?: string; search?: string; page?: number; pageSize?: number } = {}) {
  return useQuery({
    queryKey: ['rental', 'agreements', params],
    queryFn: async () =>
      (
        await api.get<{ total: number; page: number; pageSize: number; items: RentalAgreement[] }>('/rental/agreements', {
          params,
        })
      ).data,
  });
}

export function useRentalAgreement(id?: string) {
  return useQuery({
    queryKey: ['rental', 'agreement', id],
    enabled: Boolean(id),
    queryFn: async () => (await api.get<RentalAgreement>(`/rental/agreements/${id}`)).data,
  });
}

export function useCreateAgreement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: any) => (await api.post<RentalAgreement>('/rental/agreements', dto)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['rental', 'agreements'] });
      qc.invalidateQueries({ queryKey: ['rental', 'reservations'] });
    },
  });
}

export function useConfirmAgreement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => (await api.post(`/rental/agreements/${id}/confirm`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['rental', 'agreements'] }),
  });
}

export function useCheckoutAgreement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, dto }: { id: string; dto?: any }) => (await api.post(`/rental/agreements/${id}/checkout`, dto)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['rental', 'agreements'] });
      qc.invalidateQueries({ queryKey: ['rental', 'units'] });
    },
  });
}

export function useCancelAgreement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => (await api.post(`/rental/agreements/${id}/cancel`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['rental', 'agreements'] }),
  });
}

// ── Deposits ───────────────────────────────────────────────────────────────

export function useRentalDeposit(agreementId?: string) {
  return useQuery({
    queryKey: ['rental', 'deposit', agreementId],
    enabled: Boolean(agreementId),
    queryFn: async () => (await api.get<RentalDeposit>(`/rental/agreements/${agreementId}/deposit`)).data,
  });
}

export function useCollectDeposit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ agreementId, method, amount, note }: { agreementId: string; method: string; amount: number; note?: string }) =>
      (await api.post(`/rental/agreements/${agreementId}/deposit/collect`, { method, amount, note })).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['rental', 'deposit'] }),
  });
}

export function useRefundDeposit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ agreementId, method, amount, note }: { agreementId: string; method: string; amount: number; note?: string }) =>
      (await api.post(`/rental/agreements/${agreementId}/deposit/refund`, { method, amount, note })).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['rental', 'deposit'] }),
  });
}

// ── Extensions & swaps ─────────────────────────────────────────────────────

export function useExtendLine() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: { agreementId: string; lineId: string; newDueAt: string; note?: string; paymentMode?: string }) =>
      (await api.post('/rental/extensions', dto)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['rental', 'agreements'] }),
  });
}

export function useSwapUnit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: { agreementId: string; lineId: string; toUnitId: string; reason?: string; priceDelta?: number }) =>
      (await api.post('/rental/swaps', dto)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['rental', 'agreements'] });
      qc.invalidateQueries({ queryKey: ['rental', 'units'] });
    },
  });
}

// ── Returns / inspect / settle ─────────────────────────────────────────────

export function useRentalReturns(params: { agreementId?: string; page?: number; pageSize?: number } = {}) {
  return useQuery({
    queryKey: ['rental', 'returns', params],
    queryFn: async () =>
      (await api.get<{ total: number; page: number; pageSize: number; items: RentalReturn[] }>('/rental/returns', { params })).data,
  });
}

export function useCreateReturn() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: { agreementId: string; notes?: string; items: Array<{ agreementLineId: string; quantity?: number; quantityMissing?: number; conditionGrade?: string }> }) =>
      (await api.post<RentalReturn>('/rental/returns', dto)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['rental', 'returns'] });
      qc.invalidateQueries({ queryKey: ['rental', 'agreements'] });
    },
  });
}

export function useInspectReturn() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: { returnId: string; items: Array<{ returnLineId: string; conditionGrade?: string; damages?: Array<{ damageType: string; description?: string; chargeAmount?: number }> }> }) =>
      (await api.post(`/rental/returns/${dto.returnId}/inspect`, dto)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['rental', 'returns'] });
      qc.invalidateQueries({ queryKey: ['rental', 'units'] });
    },
  });
}

export function useSettleReturn() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: { returnId: string; depositApplied?: number; paymentMode?: string; waiveDamageIds?: string[] }) =>
      (await api.post(`/rental/returns/${dto.returnId}/settle`, dto)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['rental', 'returns'] });
      qc.invalidateQueries({ queryKey: ['rental', 'agreements'] });
      qc.invalidateQueries({ queryKey: ['rental', 'deposit'] });
    },
  });
}

// ── Service orders ─────────────────────────────────────────────────────────

export function useServiceOrders(params: { unitId?: string; status?: string; page?: number; pageSize?: number } = {}) {
  return useQuery({
    queryKey: ['rental', 'service-orders', params],
    queryFn: async () =>
      (await api.get<{ total: number; page: number; pageSize: number; items: any[] }>('/rental/service-orders', { params })).data,
  });
}

export function useCreateServiceOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: { unitId: string; type: string; vendor?: string; cost?: number; notes?: string }) =>
      (await api.post('/rental/service-orders', dto)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['rental', 'service-orders'] }),
  });
}

export function useCompleteServiceOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, dto }: { id: string; dto?: any }) => (await api.post(`/rental/service-orders/${id}/complete`, dto)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['rental', 'service-orders'] });
      qc.invalidateQueries({ queryKey: ['rental', 'units'] });
    },
  });
}

// ── Reports ────────────────────────────────────────────────────────────────

export function useRentalUtilization(from?: string, to?: string) {
  return useQuery({
    queryKey: ['rental', 'reports', 'utilization', from, to],
    queryFn: async () => (await api.get('/rental/reports/utilization', { params: { from, to } })).data,
  });
}

export function useRentalRevenue(from?: string, to?: string) {
  return useQuery({
    queryKey: ['rental', 'reports', 'revenue', from, to],
    queryFn: async () => (await api.get('/rental/reports/revenue', { params: { from, to } })).data,
  });
}

export function useRentalFleet(params: { status?: string } = {}) {
  return useQuery({
    queryKey: ['rental', 'reports', 'fleet', params],
    queryFn: async () => (await api.get('/rental/reports/fleet', { params })).data,
  });
}
