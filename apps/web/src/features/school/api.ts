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
