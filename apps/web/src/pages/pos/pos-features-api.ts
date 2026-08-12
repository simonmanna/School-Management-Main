/**
 * POS P4 + P5 frontend hooks — modifiers, combos, KDS.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

export interface ModifierGroupFE {
  id: string;
  name: string;
  category: string | null;
  description: string | null;
  color: string | null;
  icon: string | null;
  groupType: 'ADD_ON' | 'MODIFIER';
  minSelect: number;
  maxSelect: number;
  sortOrder: number;
  version: number;
  modifiers: Array<{
    id: string;
    name: string;
    kitchenPrintName: string | null;
    description: string | null;
    priceDelta: number;
    isDefault: boolean;
    sortOrder: number;
  }>;
}

export interface ProductBundleFE {
  product: { id: string; name: string; unitPrice: number; sku: string | null; productType: string };
  groups: ModifierGroupFE[];
}

export interface VariantFE {
  id: string;
  name: string;
  price: number;
  sortOrder: number;
}

export interface AccompanimentOptionFE {
  id: string;
  name: string;
  priceImpact: number;
  isDefault: boolean;
  sortOrder: number;
  inventoryItemId: string | null;
}

export interface AccompanimentGroupFE {
  id: string;
  name: string;
  category: string | null;
  isRequired: boolean;
  minSelect: number;
  maxSelect: number;
  sortOrder: number;
  isActive: boolean;
  options: AccompanimentOptionFE[];
}

export interface MenuItemBundleFE {
  product: { id: string; name: string; unitPrice: number; sku: string | null; productType: string };
  variants: VariantFE[];
  accompanimentGroups: AccompanimentGroupFE[];
  groups: ModifierGroupFE[];
}

export interface ComboFE {
  id: string;
  name: string;
  price: number;
  description: string | null;
  imageUrl: string | null;
  items: Array<{ productId: string; productName: string; quantity: number }>;
}

export interface PaginatedModifierGroups {
  data: ModifierGroupFE[];
  total: number;
  page: number;
  pageSize: number;
}

export function useModifierGroups(opts?: { search?: string; isActive?: boolean; page?: number; pageSize?: number }) {
  return useQuery({
    queryKey: ['pos-modifier-groups', opts],
    queryFn: async () => {
      const params: any = {};
      if (opts?.search) params.search = opts.search;
      if (opts?.isActive !== undefined) params.isActive = String(opts.isActive);
      if (opts?.page) params.page = opts.page;
      if (opts?.pageSize) params.pageSize = opts.pageSize;
      return (await api.get<PaginatedModifierGroups>('/pos/modifiers/groups', { params })).data;
    },
    staleTime: 5 * 60_000,
  });
}

export function useProductBundle(productId: string | null) {
  return useQuery({
    queryKey: ['pos-product-bundle', productId],
    queryFn: async () => {
      if (!productId) return null;
      return (await api.get<ProductBundleFE>(`/pos/modifiers/products/${productId}/bundle`)).data;
    },
    enabled: !!productId,
    staleTime: 5 * 60_000,
  });
}

/** Menu-based POS: a sellable menu item + its modifier groups (same shape).
 *  Legacy: only returns modifiers, no variants/accompaniments. */
export function useMenuItemModifierBundle(menuItemId: string | null) {
  return useQuery({
    queryKey: ['pos-menu-item-modifier-bundle', menuItemId],
    queryFn: async () => {
      if (!menuItemId) return null;
      return (await api.get<ProductBundleFE>(`/pos/modifiers/menu-items/${menuItemId}/bundle`)).data;
    },
    enabled: !!menuItemId,
    staleTime: 5 * 60_000,
  });
}

/**
 * Full menu item bundle — variants, accompaniments, add-ons, and modifiers.
 * Single endpoint the POS terminal uses to drive the 4-step order flow.
 */
export function useMenuItemBundle(menuItemId: string | null) {
  return useQuery({
    queryKey: ['pos-menu-item-full-bundle', menuItemId],
    queryFn: async () => {
      if (!menuItemId) return null;
      return (await api.get<MenuItemBundleFE>(`/pos/menu/items/${menuItemId}/bundle`)).data;
    },
    enabled: !!menuItemId,
    staleTime: 30_000,
  });
}

export function useCombos() {
  return useQuery({
    queryKey: ['pos-combos'],
    queryFn: async () => (await api.get<ComboFE[]>('/pos/modifiers/combos')).data ?? [],
    staleTime: 5 * 60_000,
  });
}

export function useCreateModifierGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: { name: string; category?: string; description?: string; color?: string; icon?: string; groupType?: 'ADD_ON' | 'MODIFIER'; minSelect?: number; maxSelect?: number }) =>
      (await api.post('/pos/modifiers/groups', body)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pos-modifier-groups'] }),
  });
}

export function useCreateModifier() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: { groupId: string; name: string; kitchenPrintName?: string; description?: string; priceDelta?: number; isDefault?: boolean }) =>
      (await api.post('/pos/modifiers/modifiers', body)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pos-modifier-groups'] }),
  });
}

export function useCreateCombo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: { name: string; price: number; description?: string; imageUrl?: string; items: Array<{ productId: string; quantity: number }> }) =>
      (await api.post('/pos/modifiers/combos', body)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pos-combos'] }),
  });
}

export function useUpdateCombo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: { id: string; name?: string; price?: number; description?: string | null; imageUrl?: string | null; items?: Array<{ productId: string; quantity: number }> }) => {
      const { id, ...payload } = body;
      return (await api.patch(`/pos/modifiers/combos/${id}`, payload)).data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pos-combos'] }),
  });
}

/** Soft-delete (deactivates) a combo — it disappears from the active list. */
export function useDeleteCombo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => (await api.delete(`/pos/modifiers/combos/${id}`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pos-combos'] }),
  });
}

export function useAssignModifierGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: { productId: string; modifierGroupId: string; sortOrder?: number }) =>
      (await api.post(`/pos/modifiers/products/${body.productId}/groups`, body)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pos-product-bundle'] }),
  });
}

/** Menu-based POS: assign modifier group to a menu item. */
export function useAssignModifierGroupToMenuItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: { menuItemId: string; modifierGroupId: string; sortOrder?: number }) => {
      const { menuItemId, ...payload } = body;
      return (await api.post(`/pos/modifiers/menu-items/${menuItemId}/groups`, payload)).data;
    },
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ['pos-group-menu-items', variables.modifierGroupId] });
      qc.invalidateQueries({ queryKey: ['pos-menu-item-bundle'] });
      qc.invalidateQueries({ queryKey: ['pos-modifier-groups'] });
    },
  });
}

export function useUnassignModifierGroupFromMenuItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: { menuItemId: string; modifierGroupId: string }) =>
      (await api.delete(`/pos/modifiers/menu-items/${body.menuItemId}/groups/${body.modifierGroupId}`)).data,
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ['pos-group-menu-items', variables.modifierGroupId] });
      qc.invalidateQueries({ queryKey: ['pos-menu-item-bundle'] });
      qc.invalidateQueries({ queryKey: ['pos-modifier-groups'] });
    },
  });
}

/* ============== Variant hooks ============== */

export function useVariants(menuItemId: string | null) {
  return useQuery({
    queryKey: ['pos-variants', menuItemId],
    queryFn: async () => {
      if (!menuItemId) return [];
      return (await api.get<VariantFE[]>(`/pos/menu/items/${menuItemId}/variants`)).data ?? [];
    },
    enabled: !!menuItemId,
    staleTime: 5 * 60_000,
  });
}

export function useCreateVariant() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: { menuItemId: string; name: string; price: number; sortOrder?: number }) =>
      (await api.post(`/pos/menu/items/${body.menuItemId}/variants`, body)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pos-variants'] }),
  });
}

export function useUpdateVariant() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: { menuItemId: string; variantId: string; name?: string; price?: number; sortOrder?: number; isActive?: boolean }) => {
      const { menuItemId, variantId, ...payload } = body;
      return (await api.patch(`/pos/menu/items/${menuItemId}/variants/${variantId}`, payload)).data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pos-variants'] }),
  });
}

export function useDeleteVariant() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: { menuItemId: string; variantId: string }) =>
      (await api.delete(`/pos/menu/items/${body.menuItemId}/variants/${body.variantId}`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pos-variants'] }),
  });
}

/* ============== Accompaniment hooks ============== */

/** All accompaniment groups (standalone, admin page). */
export function useAllAccompanimentGroups() {
  return useQuery({
    queryKey: ['pos-accompaniment-groups'],
    queryFn: async () => (await api.get<{ data: AccompanimentGroupFE[] }>('/pos/menu/accompaniments/groups')).data.data ?? [],
    staleTime: 5 * 60_000,
  });
}

/** Accompaniment groups assigned to a specific menu item. */
export function useMenuItemAccompaniments(menuItemId: string | null) {
  return useQuery({
    queryKey: ['pos-menu-item-accompaniments', menuItemId],
    queryFn: async () => {
      if (!menuItemId) return [];
      return (await api.get<AccompanimentGroupFE[]>(`/pos/menu/items/${menuItemId}/accompaniments`)).data ?? [];
    },
    enabled: !!menuItemId,
    staleTime: 5 * 60_000,
  });
}

export function useCreateAccompanimentGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: { name: string; isRequired?: boolean; minSelect?: number; maxSelect?: number }) =>
      (await api.post('/pos/menu/accompaniments/groups', body)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pos-accompaniment-groups'] }),
  });
}

export function useUpdateAccompanimentGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: { groupId: string; name?: string; isRequired?: boolean; minSelect?: number; maxSelect?: number; isActive?: boolean }) => {
      const { groupId, ...payload } = body;
      return (await api.patch(`/pos/menu/accompaniments/groups/${groupId}`, payload)).data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pos-accompaniment-groups'] });
      qc.invalidateQueries({ queryKey: ['pos-menu-item-full-bundle'] });
    },
  });
}

export function useDeleteAccompanimentGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (groupId: string) => (await api.delete(`/pos/menu/accompaniments/groups/${groupId}`)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pos-accompaniment-groups'] });
      qc.invalidateQueries({ queryKey: ['pos-menu-item-full-bundle'] });
    },
  });
}

export function useCreateAccompanimentOption() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: { groupId: string; name: string; priceImpact?: number; isDefault?: boolean }) => {
      const { groupId, ...payload } = body;
      return (await api.post(`/pos/menu/accompaniments/groups/${groupId}/options`, payload)).data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pos-accompaniment-groups'] }),
  });
}

export function useUpdateAccompanimentOption() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: { optionId: string; name?: string; priceImpact?: number; isDefault?: boolean; isActive?: boolean }) => {
      const { optionId, ...payload } = body;
      return (await api.patch(`/pos/menu/accompaniments/options/${optionId}`, payload)).data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pos-accompaniment-groups'] });
      qc.invalidateQueries({ queryKey: ['pos-menu-item-full-bundle'] });
    },
  });
}

export function useDeleteAccompanimentOption() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (optionId: string) => (await api.delete(`/pos/menu/accompaniments/options/${optionId}`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pos-accompaniment-groups'] }),
  });
}

/** Assign a standalone accompaniment group to a menu item. */
export function useAssignAccompanimentGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: { menuItemId: string; accompanimentGroupId: string; sortOrder?: number }) => {
      const { menuItemId, ...payload } = body;
      return (await api.post(`/pos/menu/items/${menuItemId}/accompaniments`, payload)).data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pos-menu-item-accompaniments'] });
      qc.invalidateQueries({ queryKey: ['pos-menu-item-full-bundle'] });
    },
  });
}

/** Unassign an accompaniment group from a menu item. */
export function useUnassignAccompanimentGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: { menuItemId: string; groupId: string }) => {
      const { menuItemId, groupId } = body;
      return (await api.delete(`/pos/menu/items/${menuItemId}/accompaniments/${groupId}`)).data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pos-menu-item-accompaniments'] });
      qc.invalidateQueries({ queryKey: ['pos-menu-item-full-bundle'] });
    },
  });
}

/* ============== M-E edit / delete ============== */

function invalidateGroups(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ['pos-modifier-groups'] });
  qc.invalidateQueries({ queryKey: ['pos-product-bundle'] });
}

export function useUpdateModifierGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: { id: string; name?: string; category?: string; description?: string; color?: string; icon?: string; groupType?: 'ADD_ON' | 'MODIFIER'; minSelect?: number; maxSelect?: number; sortOrder?: number; isActive?: boolean; expectedVersion?: number }) => {
      const { id, ...payload } = body;
      return (await api.patch(`/pos/modifiers/groups/${id}`, payload)).data;
    },
    onSuccess: () => invalidateGroups(qc),
  });
}

export function useDeleteModifierGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => (await api.delete(`/pos/modifiers/groups/${id}`)).data,
    onSuccess: () => invalidateGroups(qc),
  });
}

export function useUpdateModifier() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: { id: string; name?: string; kitchenPrintName?: string; description?: string; priceDelta?: number; isDefault?: boolean; sortOrder?: number; isActive?: boolean }) => {
      const { id, ...payload } = body;
      return (await api.patch(`/pos/modifiers/modifiers/${id}`, payload)).data;
    },
    onSuccess: () => invalidateGroups(qc),
  });
}

export function useDeleteModifier() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => (await api.delete(`/pos/modifiers/modifiers/${id}`)).data,
    onSuccess: () => invalidateGroups(qc),
  });
}

export function useUnassignModifierGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: { productId: string; modifierGroupId: string }) =>
      (await api.delete(`/pos/modifiers/products/${body.productId}/groups/${body.modifierGroupId}`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pos-product-bundle'] }),
  });
}

/** All menu items with isAssigned flag for a given modifier group — admin checkbox UI. */
export function useGroupMenuItems(groupId: string | null) {
  return useQuery({
    queryKey: ['pos-group-menu-items', groupId],
    queryFn: async () => {
      if (!groupId) return [];
      return (await api.get<Array<{ id: string; name: string; isAssigned: boolean }>>(`/pos/modifiers/groups/${groupId}/menu-items`)).data;
    },
    enabled: !!groupId,
    staleTime: 30_000,
  });
}

/* ============== M-F sales report ============== */

export interface ModifierSalesRow { name: string; count: number; revenue: number }

export function useModifierSalesReport(from?: string, to?: string) {
  return useQuery({
    queryKey: ['pos-modifier-sales', from ?? '', to ?? ''],
    queryFn: async () =>
      (await api.get<ModifierSalesRow[]>('/pos/modifiers/report/sales', { params: { from, to } })).data ?? [],
  });
}

/* ============== P5 KDS ============== */

export type KdsAction = 'start' | 'ready' | 'serve' | 'cancel' | 'recall';
export type KdsPriorityFE = 'normal' | 'rush' | 'vip';

export interface KdsTicketItemFE {
  productId: string;
  productName: string;
  quantity: number;
  modifiers: Array<{ name: string; kitchenPrintName?: string | null; priceDelta: number }>;
  notes: string | null;
  /** Configurable KitchenStation.code. */
  station: string;
  variantName?: string;
  accompanimentNames?: string[];
  /** Prep-time hint (minutes) for expected-ready display. */
  prepTime?: number | null;
  /** Course grouping (1=starter, 2=main, …). */
  course?: number | null;
}

export interface KdsTicketFE {
  id: string;
  invoiceId: string;
  label: string;
  ticketNo: string | null;
  station: string;
  status: 'new' | 'preparing' | 'ready' | 'served' | 'cancelled';
  priority: KdsPriorityFE;
  orderType: string | null;
  items: KdsTicketItemFE[];
  startedAt: string | null;
  readyAt: string | null;
  servedAt: string | null;
  startedBy: string | null;
  readyBy: string | null;
  assignedTo: string | null;
  recallCount: number;
  recallReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export function useKdsTickets(station?: string, refetchInterval = 2_000) {
  return useQuery({
    queryKey: ['pos-kds-tickets', station ?? 'all'],
    queryFn: async () =>
      (await api.get<KdsTicketFE[]>('/pos/kds/tickets', { params: { station } })).data ?? [],
    refetchInterval,
  });
}

export function useKdsTransition() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: { ticketId: string; action: KdsAction; reason?: string }) =>
      (await api.post(`/pos/kds/tickets/${body.ticketId}/transition`, { action: body.action, reason: body.reason })).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pos-kds-tickets'] }),
  });
}

export function useKdsBulkTransition() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: { ids: string[]; action: KdsAction; reason?: string }) =>
      (await api.post('/pos/kds/tickets/bulk-transition', body)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pos-kds-tickets'] }),
  });
}

export function useKdsSetPriority() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: { ticketId: string; priority: KdsPriorityFE }) =>
      (await api.post(`/pos/kds/tickets/${body.ticketId}/priority`, { priority: body.priority })).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pos-kds-tickets'] }),
  });
}

export function useKdsAssign() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: { ticketId: string; chefUserId: string | null }) =>
      (await api.post(`/pos/kds/tickets/${body.ticketId}/assign`, { chefUserId: body.chefUserId })).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pos-kds-tickets'] }),
  });
}

/* ============== KDS — configurable kitchen stations ============== */

export interface KitchenStationFE {
  id: string;
  name: string;
  code: string;
  color: string | null;
  icon: string | null;
  displayOrder: number;
  isActive: boolean;
  isDefault: boolean;
  printerId: string | null;
}

export function useKitchenStations() {
  return useQuery({
    queryKey: ['pos-kitchen-stations'],
    queryFn: async () => (await api.get<KitchenStationFE[]>('/pos/kitchen-stations')).data ?? [],
    staleTime: 60_000,
  });
}

export function useCreateStation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: Partial<KitchenStationFE> & { name: string; code: string }) =>
      (await api.post('/pos/kitchen-stations', body)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pos-kitchen-stations'] }),
  });
}

export function useUpdateStation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...body }: { id: string } & Partial<KitchenStationFE>) =>
      (await api.patch(`/pos/kitchen-stations/${id}`, body)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pos-kitchen-stations'] }),
  });
}

export function useDeleteStation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => (await api.delete(`/pos/kitchen-stations/${id}`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pos-kitchen-stations'] }),
  });
}

export function useReorderStations() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (ids: string[]) => (await api.patch('/pos/kitchen-stations/reorder', { ids })).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pos-kitchen-stations'] }),
  });
}

/* ============== KDS reporting + live ops ============== */

export interface KdsSummaryFE {
  range: { from: string; to: string };
  totals: { tickets: number; cancelled: number; recalls: number; delayed: number };
  prepTime: { avg: number; p50: number; p90: number; samples: number };
  waitTime: { avg: number; p50: number; p90: number; samples: number };
  perStation: Array<{ station: string; tickets: number; avgPrep: number }>;
  perChef: Array<{ chefUserId: string; tickets: number; avgPrep: number }>;
  recallCauses: Array<{ reason: string; count: number }>;
  peakHours: Array<{ hour: number; count: number }>;
  topDishes: Array<{ name: string; qty: number }>;
}

export interface KdsLiveFE {
  counts: { new: number; preparing: number; ready: number };
  totalActive: number;
  avgAgeMin: number;
  longestWaitMin: number;
  perStation: Array<{ station: string; count: number }>;
}

export function useKdsReportSummary(from?: string, to?: string) {
  return useQuery({
    queryKey: ['pos-kds-report-summary', from ?? '', to ?? ''],
    queryFn: async () => (await api.get<KdsSummaryFE>('/pos/kds/reports/summary', { params: { from, to } })).data,
  });
}

export function useKdsLive(refetchInterval = 5_000) {
  return useQuery({
    queryKey: ['pos-kds-live'],
    queryFn: async () => (await api.get<KdsLiveFE>('/pos/kds/reports/live')).data,
    refetchInterval,
  });
}