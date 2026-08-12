/**
 * Repair & Maintenance Management API hooks.
 *
 * Surfaces the full RMMS lifecycle: orders → items → diagnosis → quotations →
 * jobs (work orders) → parts → billing → delivery → close, plus technicians,
 * labour catalog, warranties + claims, service contracts + preventive
 * schedules and operational reports. Every call is org-scoped server-side;
 * permission failures surface as 403s.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

// ── Types ──────────────────────────────────────────────────────────────────

export interface RepairOrder {
  id: string;
  repairNumber: string;
  partnerId: string | null;
  status: string;
  priority: string;
  orderType: string;
  itemType: string | null;
  brand: string | null;
  model: string | null;
  serialNumber: string | null;
  imei: string | null;
  assetTag: string | null;
  problemDescription: string | null;
  dueDate: string | null;
  assignedTechnicianId: string | null;
  quotationId: string | null;
  orderId: string | null;
  invoiceId: string | null;
  labourTotal: number;
  partsTotal: number;
  taxTotal: number;
  totalAmount: number;
  receivedAt: string | null;
  deliveredAt: string | null;
  closedAt: string | null;
  createdAt: string;
  items?: RepairOrderItem[];
  quotation?: RepairQuotation;
  partner?: { id: string; name: string };
  technician?: { id: string; name: string };
}

export interface RepairOrderItem {
  id: string;
  repairOrderId: string;
  itemType: string | null;
  brand: string | null;
  model: string | null;
  serialNumber: string | null;
  imei: string | null;
  assetTag: string | null;
  plateNumber: string | null;
  vin: string | null;
  problemDescription: string | null;
}

export interface RepairQuotationLine {
  id: string;
  kind: 'labour' | 'part';
  description: string;
  quantity: number;
  unitPrice: number;
  amount: number;
  productId: string | null;
  labourTypeId: string | null;
  lineNumber: number;
}

export interface RepairQuotation {
  id: string;
  quotationNumber: string;
  status: string;
  revision: number;
  labourTotal: number;
  partsTotal: number;
  taxTotal: number;
  totalAmount: number;
  validUntil: string | null;
  lines?: RepairQuotationLine[];
}

export interface RepairJob {
  id: string;
  jobNumber: string;
  repairOrderId: string;
  technicianId: string | null;
  status: string;
  priority: string | null;
  deadline: string | null;
  estimatedHours: number | null;
  actualHours: number | null;
  instructions: string | null;
  startedAt: string | null;
  completedAt: string | null;
  order?: { id: string; repairNumber: string; itemType: string | null };
  technician?: { id: string; name: string };
}

export interface RepairPart {
  id: string;
  repairOrderId: string;
  jobId: string | null;
  productId: string;
  quantity: number;
  unitCost: number;
  totalCost: number;
  status: string;
  issuedAt: string | null;
  product?: { id: string; code: string; name: string };
}

export interface RepairStatusHistory {
  id: string;
  fromStatus: string | null;
  toStatus: string;
  action: string | null;
  note: string | null;
  changedAt: string;
}

export interface RepairAttachment {
  id: string;
  kind: string;
  caption: string | null;
  fileId: string | null;
  createdAt: string;
}

export interface RepairWarranty {
  id: string;
  warrantyType: string;
  coverageStart: string | null;
  coverageEnd: string | null;
  coveredLabour: boolean;
  status: string;
  terms: string | null;
  order?: { id: string; repairNumber: string };
}

export interface RepairServiceContract {
  id: string;
  contractNumber: string;
  partnerId: string;
  title: string;
  status: string;
  startDate: string | null;
  endDate: string | null;
  frequencyDays: number;
  slaHours: number;
  notes: string | null;
  partner?: { id: string; name: string };
}

export interface RepairSchedule {
  id: string;
  contractId: string | null;
  title: string;
  assetRef: string | null;
  status: string;
  intervalDays: number;
  lastRunAt: string | null;
  nextDueAt: string | null;
  taskTemplate: string | null;
}

export interface RepairTechnician {
  id: string;
  code: string;
  name: string;
  phone: string | null;
  email: string | null;
  skills: string[];
  hourlyRate: number;
  availability: string | null;
  isActive: boolean;
}

export interface RepairLabourType {
  id: string;
  code: string;
  name: string;
  description: string | null;
  price: number;
  durationMinutes: number;
  productId: string | null;
  isActive: boolean;
}

// ── Dashboard / reports ────────────────────────────────────────────────────

export function useRepairDashboard() {
  return useQuery({
    queryKey: ['repair', 'dashboard'],
    queryFn: async () => (await api.get('/repair/dashboard')).data,
  });
}

export function useRepairOperationalReport(from?: string, to?: string) {
  return useQuery({
    queryKey: ['repair', 'reports', 'operational', from, to],
    queryFn: async () => (await api.get('/repair/reports/operational', { params: { from, to } })).data,
  });
}

export function useRepairRevenue(from?: string, to?: string) {
  return useQuery({
    queryKey: ['repair', 'reports', 'revenue', from, to],
    queryFn: async () => (await api.get('/repair/reports/revenue', { params: { from, to } })).data,
  });
}

export function useRepairTechnicianLoad() {
  return useQuery({
    queryKey: ['repair', 'reports', 'technician-load'],
    queryFn: async () => (await api.get('/repair/reports/technician-load')).data,
  });
}

export function useRepairWarrantyHealth() {
  return useQuery({
    queryKey: ['repair', 'reports', 'warranty-health'],
    queryFn: async () => (await api.get('/repair/reports/warranty-health')).data,
  });
}

export function useRepairContractsOverview() {
  return useQuery({
    queryKey: ['repair', 'reports', 'contracts'],
    queryFn: async () => (await api.get('/repair/reports/contracts')).data,
  });
}

// ── Orders ─────────────────────────────────────────────────────────────────

export function useRepairOrders(params: { status?: string; search?: string; page?: number; pageSize?: number } = {}) {
  return useQuery({
    queryKey: ['repair', 'orders', params],
    queryFn: async () => (await api.get('/repair/orders', { params })).data,
  });
}

export function useRepairOrder(id?: string) {
  return useQuery({
    queryKey: ['repair', 'orders', id],
    queryFn: async () => (await api.get(`/repair/orders/${id}`)).data,
    enabled: !!id,
  });
}

export function useCreateRepairOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: any) => (await api.post('/repair/orders', dto)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['repair'] }),
  });
}

export function useTransitionRepairOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, dto }: { id: string; dto: any }) =>
      (await api.post(`/repair/orders/${id}/transition`, dto)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['repair'] }),
  });
}

export function useAssignTechnician() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, dto }: { id: string; dto: any }) =>
      (await api.patch(`/repair/orders/${id}/technician`, dto)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['repair'] }),
  });
}

export function useAddRepairItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, dto }: { id: string; dto: any }) =>
      (await api.post(`/repair/orders/${id}/items`, dto)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['repair'] }),
  });
}

export function useRemoveRepairItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (itemId: string) => (await api.delete(`/repair/orders/items/${itemId}`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['repair'] }),
  });
}

export function useAddRepairAttachment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, dto }: { id: string; dto: any }) =>
      (await api.post(`/repair/orders/${id}/attachments`, dto)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['repair'] }),
  });
}

export function useRemoveRepairAttachment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (attachmentId: string) => (await api.delete(`/repair/orders/attachments/${attachmentId}`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['repair'] }),
  });
}

// ── Billing ────────────────────────────────────────────────────────────────

export function useBillRepair() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, dto }: { id: string; dto?: any }) =>
      (await api.post(`/repair/orders/${id}/bill`, dto)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['repair'] }),
  });
}

export function usePayRepairInvoice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ invoiceId, dto }: { invoiceId: string; dto: any }) =>
      (await api.post(`/repair/invoices/${invoiceId}/pay`, dto)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['repair'] }),
  });
}

// ── Diagnosis ──────────────────────────────────────────────────────────────

export function useCreateDiagnosis() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, dto }: { id: string; dto: any }) =>
      (await api.post(`/repair/orders/${id}/diagnosis`, dto)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['repair'] }),
  });
}

export function useUpdateDiagnosis() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, dto }: { id: string; dto: any }) =>
      (await api.patch(`/repair/diagnosis/${id}`, dto)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['repair'] }),
  });
}

// ── Quotations ─────────────────────────────────────────────────────────────

export function useRepairQuotations(params: { status?: string; page?: number; pageSize?: number } = {}) {
  return useQuery({
    queryKey: ['repair', 'quotations', params],
    queryFn: async () => (await api.get('/repair/quotations', { params })).data,
  });
}

export function useCreateRepairQuotation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, dto }: { id: string; dto: any }) =>
      (await api.post(`/repair/orders/${id}/quotations`, dto)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['repair'] }),
  });
}

export function useSubmitQuotation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => (await api.post(`/repair/quotations/${id}/submit`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['repair'] }),
  });
}

export function useApproveQuotation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, dto }: { id: string; dto?: any }) =>
      (await api.post(`/repair/quotations/${id}/approve`, dto)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['repair'] }),
  });
}

export function useRejectQuotation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, dto }: { id: string; dto?: any }) =>
      (await api.post(`/repair/quotations/${id}/reject`, dto)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['repair'] }),
  });
}

export function useReviseQuotation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, dto }: { id: string; dto: any }) =>
      (await api.post(`/repair/quotations/${id}/revise`, dto)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['repair'] }),
  });
}

// ── Jobs ───────────────────────────────────────────────────────────────────

export function useRepairJobs(params: { status?: string; technicianId?: string; page?: number; pageSize?: number } = {}) {
  return useQuery({
    queryKey: ['repair', 'jobs', params],
    queryFn: async () => (await api.get('/repair/jobs', { params })).data,
  });
}

export function useCreateRepairJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, dto }: { id: string; dto: any }) =>
      (await api.post(`/repair/orders/${id}/jobs`, dto)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['repair'] }),
  });
}

export function useUpdateRepairJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, dto }: { id: string; dto: any }) => (await api.patch(`/repair/jobs/${id}`, dto)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['repair'] }),
  });
}

export function useStartJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => (await api.post(`/repair/jobs/${id}/start`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['repair'] }),
  });
}

export function useCompleteJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, dto }: { id: string; dto?: any }) => (await api.post(`/repair/jobs/${id}/complete`, dto)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['repair'] }),
  });
}

export function useTestJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => (await api.post(`/repair/jobs/${id}/test`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['repair'] }),
  });
}

export function useCancelJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, dto }: { id: string; dto?: any }) => (await api.post(`/repair/jobs/${id}/cancel`, dto)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['repair'] }),
  });
}

// ── Parts ──────────────────────────────────────────────────────────────────

export function useRepairParts(params: { status?: string; repairOrderId?: string; page?: number; pageSize?: number } = {}) {
  return useQuery({
    queryKey: ['repair', 'parts', params],
    queryFn: async () => (await api.get('/repair/parts', { params })).data,
  });
}

export function useReservePart() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, dto }: { id: string; dto: any }) =>
      (await api.post(`/repair/orders/${id}/parts`, dto)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['repair'] }),
  });
}

export function useIssuePart() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, dto }: { id: string; dto?: any }) => (await api.post(`/repair/parts/${id}/issue`, dto)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['repair'] }),
  });
}

export function useDeletePart() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => (await api.delete(`/repair/parts/${id}`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['repair'] }),
  });
}

// ── Labour catalog ─────────────────────────────────────────────────────────

export function useRepairLabourTypes() {
  return useQuery({
    queryKey: ['repair', 'labour-types'],
    queryFn: async () => (await api.get('/repair/labour-types')).data,
  });
}

export function useCreateLabourType() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: any) => (await api.post('/repair/labour-types', dto)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['repair', 'labour-types'] }),
  });
}

export function useUpdateLabourType() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, dto }: { id: string; dto: any }) => (await api.patch(`/repair/labour-types/${id}`, dto)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['repair', 'labour-types'] }),
  });
}

export function useDeleteLabourType() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => (await api.delete(`/repair/labour-types/${id}`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['repair', 'labour-types'] }),
  });
}

// ── Technicians ────────────────────────────────────────────────────────────

export function useRepairTechnicians() {
  return useQuery({
    queryKey: ['repair', 'technicians'],
    queryFn: async () => (await api.get('/repair/technicians')).data,
  });
}

export function useCreateTechnician() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: any) => (await api.post('/repair/technicians', dto)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['repair', 'technicians'] }),
  });
}

export function useUpdateTechnician() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, dto }: { id: string; dto: any }) => (await api.patch(`/repair/technicians/${id}`, dto)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['repair', 'technicians'] }),
  });
}

export function useDeleteTechnician() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => (await api.delete(`/repair/technicians/${id}`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['repair', 'technicians'] }),
  });
}

// ── Warranties ─────────────────────────────────────────────────────────────

export function useRepairWarranties(params: { status?: string; page?: number; pageSize?: number } = {}) {
  return useQuery({
    queryKey: ['repair', 'warranties', params],
    queryFn: async () => (await api.get('/repair/warranties', { params })).data,
  });
}

export function useCreateWarranty() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: any) => (await api.post('/repair/warranties', dto)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['repair', 'warranties'] }),
  });
}

export function useUpdateWarranty() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, dto }: { id: string; dto: any }) => (await api.patch(`/repair/warranties/${id}`, dto)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['repair', 'warranties'] }),
  });
}

export function useCreateWarrantyClaim() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, dto }: { id: string; dto: any }) => (await api.post(`/repair/warranties/${id}/claims`, dto)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['repair', 'warranties'] }),
  });
}

export function useResolveWarrantyClaim() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ claimId, dto }: { claimId: string; dto: any }) => (await api.patch(`/repair/claims/${claimId}`, dto)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['repair', 'warranties'] }),
  });
}

// ── Service contracts ──────────────────────────────────────────────────────

export function useRepairContracts() {
  return useQuery({
    queryKey: ['repair', 'contracts'],
    queryFn: async () => (await api.get('/repair/contracts')).data,
  });
}

export function useCreateContract() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: any) => (await api.post('/repair/contracts', dto)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['repair', 'contracts'] }),
  });
}

export function useUpdateContract() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, dto }: { id: string; dto: any }) => (await api.patch(`/repair/contracts/${id}`, dto)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['repair', 'contracts'] }),
  });
}

export function useActivateContract() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => (await api.post(`/repair/contracts/${id}/activate`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['repair', 'contracts'] }),
  });
}

export function useCancelContract() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, dto }: { id: string; dto?: any }) => (await api.post(`/repair/contracts/${id}/cancel`, dto)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['repair', 'contracts'] }),
  });
}

export function useDeleteContract() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => (await api.delete(`/repair/contracts/${id}`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['repair', 'contracts'] }),
  });
}

// ── Preventive schedules ───────────────────────────────────────────────────

export function useRepairSchedules() {
  return useQuery({
    queryKey: ['repair', 'schedules'],
    queryFn: async () => (await api.get('/repair/schedules')).data,
  });
}

export function useCreateSchedule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: any) => (await api.post('/repair/schedules', dto)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['repair', 'schedules'] }),
  });
}

export function useUpdateSchedule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, dto }: { id: string; dto: any }) => (await api.patch(`/repair/schedules/${id}`, dto)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['repair', 'schedules'] }),
  });
}

export function useDeleteSchedule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => (await api.delete(`/repair/schedules/${id}`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['repair', 'schedules'] }),
  });
}
