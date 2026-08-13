import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

/* ───────────────────────── Types (mirror the backend contract) ───────────────────────── */

export interface Paginated<T> {
  data: T[];
  meta: { page: number; pageSize: number; total: number; totalPages: number };
}

export interface SchoolOverview {
  students: number;
  staff: number;
  campuses: number;
  classes: number;
  terms: number;
  sections: number;
  organizationId: string;
}

export type StudentStatus = 'active' | 'suspended' | 'transferred' | 'withdrawn' | 'alumni';

export interface Student {
  id: string;
  partnerId: string;
  admissionNo: string;
  status: StudentStatus;
  gender?: string | null;
  dateOfBirth?: string | null;
  currentClassId?: string | null;
  currentSectionId?: string | null;
  residenceType?: string | null;
  house?: string | null;
  enrollmentDate?: string | null;
  partner?: { id: string; name: string; code: string | null; email: string | null; phone: string | null } | null;
  currentClass?: { id: string; name: string } | null;
}

export interface AcademicYear { id: string; name: string; startDate: string; endDate: string; isCurrent: boolean }
export interface Term { id: string; academicYearId: string; name: string; isCurrent: boolean }
export interface SchoolClass { id: string; name: string; gradeLevelId: string; campusId?: string | null }
export interface Section { id: string; classId: string; name: string }

export interface Guardian {
  id: string;
  studentProfileId: string;
  guardianContactId: string;
  relationship: string;
  isPrimary: boolean;
  canPickup: boolean;
  receivesStatements: boolean;
  contact?: { firstName: string; lastName: string | null; email: string | null; phone: string | null } | null;
}

export interface FeeStatement {
  studentId: string;
  totalBilled: number;
  totalPaid: number;
  balance: number;
  invoices: Array<{ id: string; documentNumber: string; totalAmount: string; amountResidual: string; paymentStatus: string; issueDate: string }>;
  payments: Array<{ id: string; paymentNumber: string; amount: string; paymentDate: string; paymentMethod: string }>;
}

const S = '/school';

/* ───────────────────────── Overview ───────────────────────── */

export function useSchoolOverview() {
  return useQuery({
    queryKey: ['school', 'overview'],
    queryFn: async () => (await api.get<SchoolOverview>(`${S}/overview`)).data,
  });
}

/* ───────────────────────── Foundation dropdowns ───────────────────────── */

export function useAcademicYears() {
  return useQuery({
    queryKey: ['school', 'academic-years'],
    queryFn: async () => (await api.get<Paginated<AcademicYear>>(`${S}/academic-years`, { params: { pageSize: 100 } })).data,
  });
}

export function useTerms() {
  return useQuery({
    queryKey: ['school', 'terms'],
    queryFn: async () => (await api.get<Paginated<Term>>(`${S}/terms`, { params: { pageSize: 100 } })).data,
  });
}

export function useClasses() {
  return useQuery({
    queryKey: ['school', 'classes'],
    queryFn: async () => (await api.get<Paginated<SchoolClass>>(`${S}/classes`, { params: { pageSize: 200 } })).data,
  });
}

export function useSections() {
  return useQuery({
    queryKey: ['school', 'sections'],
    queryFn: async () => (await api.get<Paginated<Section>>(`${S}/sections`, { params: { pageSize: 300 } })).data,
  });
}

/* ───────────────────────── Students ───────────────────────── */

export interface StudentListParams {
  search?: string;
  page?: number;
  pageSize?: number;
}

export function useStudents(params: StudentListParams = {}) {
  return useQuery({
    queryKey: ['school', 'students', params],
    queryFn: async () => (await api.get<Paginated<Student>>(`${S}/students`, { params })).data,
  });
}

export function useStudent(id: string | undefined) {
  return useQuery({
    queryKey: ['school', 'student', id],
    enabled: !!id,
    queryFn: async () => (await api.get<Student>(`${S}/students/${id}`)).data,
  });
}

export interface CreateStudentInput {
  name: string;
  admissionNo: string;
  enrollmentDate: string;
  email?: string;
  phone?: string;
  gender?: 'male' | 'female' | 'other';
  dateOfBirth?: string;
  currentClassId?: string;
  currentSectionId?: string;
  residenceType?: 'day' | 'boarder';
  house?: string;
  nationality?: string;
  religion?: string;
}

export function useCreateStudent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: CreateStudentInput) => (await api.post<Student>(`${S}/students`, dto)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['school', 'students'] }),
  });
}

export function useUpdateStudent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, dto }: { id: string; dto: Partial<CreateStudentInput> & { status?: StudentStatus; reason?: string } }) =>
      (await api.patch<Student>(`${S}/students/${id}`, dto)).data,
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ['school', 'students'] });
      qc.invalidateQueries({ queryKey: ['school', 'student', v.id] });
    },
  });
}

export function useStudentStatement(id: string | undefined) {
  return useQuery({
    queryKey: ['school', 'statement', id],
    enabled: !!id,
    queryFn: async () => (await api.get<FeeStatement>(`${S}/students/${id}/statement`)).data,
  });
}

/* ───────────────────────── Guardians ───────────────────────── */

export function useGuardians(studentProfileId: string | undefined) {
  return useQuery({
    queryKey: ['school', 'guardians', studentProfileId],
    enabled: !!studentProfileId,
    queryFn: async () => (await api.get<Guardian[]>(`${S}/guardians/by-student/${studentProfileId}`)).data,
  });
}

export interface CreateGuardianInput {
  studentProfileId: string;
  guardian: { firstName: string; lastName?: string; email?: string; phone?: string };
  relationship: string;
  isPrimary?: boolean;
  canPickup?: boolean;
  receivesStatements?: boolean;
}

export function useCreateGuardian() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: CreateGuardianInput) => (await api.post<Guardian>(`${S}/guardians`, dto)).data,
    onSuccess: (_d, v) => qc.invalidateQueries({ queryKey: ['school', 'guardians', v.studentProfileId] }),
  });
}

/* ───────────────────────── Fees — structures & schedules ───────────────────────── */

export interface FeeComponent {
  code: string;
  productId: string;
  amount: number;
  isOptional?: boolean;
}

export interface FeeStructure {
  id: string;
  name: string;
  academicYearId: string;
  components: FeeComponent[];
  applicableTo?: { classIds?: string[]; gradeLevelIds?: string[] } | null;
}

export interface FeeSchedule {
  id: string;
  feeStructureId: string;
  termId: string;
  dueDate: string;
  feeStructure?: { name: string } | null;
}

export interface ServiceProduct {
  id: string;
  code: string;
  name: string;
  productType: string;
  salesPrice: string | null;
}

export function useFeeStructures() {
  return useQuery({
    queryKey: ['school', 'fee-structures'],
    queryFn: async () => (await api.get<Paginated<FeeStructure>>(`${S}/fee-structures`, { params: { pageSize: 100 } })).data,
  });
}

export function useCreateFeeStructure() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: { name: string; academicYearId: string; components: FeeComponent[]; applicableTo?: { classIds?: string[] } }) =>
      (await api.post<FeeStructure>(`${S}/fee-structures`, dto)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['school', 'fee-structures'] }),
  });
}

export function useFeeSchedules() {
  return useQuery({
    queryKey: ['school', 'fee-schedules'],
    queryFn: async () => (await api.get<Paginated<FeeSchedule>>(`${S}/fee-schedules`, { params: { pageSize: 100 } })).data,
  });
}

export function useCreateFeeSchedule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: { feeStructureId: string; termId: string; dueDate: string }) =>
      (await api.post<FeeSchedule>(`${S}/fee-schedules`, dto)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['school', 'fee-schedules'] }),
  });
}

/** Service products usable as fee components. */
export function useServiceProducts() {
  return useQuery({
    queryKey: ['school', 'service-products'],
    queryFn: async () =>
      (await api.get<Paginated<ServiceProduct>>('/products', { params: { pageSize: 200, productType: 'service' } })).data,
  });
}

/* ───────────────────────── Billing run + collection ───────────────────────── */

export interface BillingResult {
  count: number;
  skipped: Array<{ studentProfileId: string; reason: string }>;
}

export function useGenerateBilling() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: { termId: string; classId?: string }) =>
      (await api.post<BillingResult>(`${S}/billing/generate`, dto)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['school', 'statement'] });
      qc.invalidateQueries({ queryKey: ['school', 'reports'] });
    },
  });
}

export interface CollectResult {
  payment: { id: string; paymentNumber?: string; amount: string } | null;
  allocations: Array<{ documentId: string; amount: number }>;
  unallocated: number;
  replayed: boolean;
}

export function useCollectPayment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: {
      studentProfileId: string;
      amount: number;
      paymentMethod: 'cash' | 'bank' | 'mobile_money' | 'card';
      cashSessionId?: string;
      reference?: string;
    }) => (await api.post<CollectResult>(`${S}/payments/collect`, dto)).data,
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ['school', 'statement', v.studentProfileId] });
      qc.invalidateQueries({ queryKey: ['school', 'reports'] });
    },
  });
}

/* ───────────────────────── Reports ───────────────────────── */

export interface ClassArrears {
  classId: string;
  className: string;
  outstanding: number;
  studentCount: number;
}

export function useArrearsByClass() {
  return useQuery({
    queryKey: ['school', 'reports', 'arrears'],
    queryFn: async () => (await api.get<ClassArrears[]>(`${S}/reports/outstanding-by-class`)).data,
  });
}

export function useDailyCollections() {
  return useQuery({
    queryKey: ['school', 'reports', 'collections'],
    queryFn: async () => (await api.get<Array<{ date: string; total: number }>>(`${S}/reports/daily-collections`)).data,
  });
}
