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

/* ───────────────────────── Subjects (foundation) ───────────────────────── */

export interface Subject { id: string; code: string; name: string; isCore: boolean }

export function useSubjects() {
  return useQuery({
    queryKey: ['school', 'subjects'],
    queryFn: async () => (await api.get<Paginated<Subject>>(`${S}/subjects`, { params: { pageSize: 200 } })).data,
  });
}

/* ───────────────────────── Attendance ───────────────────────── */

export type AttendanceStatus = 'present' | 'absent' | 'late' | 'excused';

export interface RosterStudent {
  id: string;
  admissionNo: string;
  partner?: { name: string } | null;
}

export function useClassRoster(classId: string | undefined) {
  return useQuery({
    queryKey: ['school', 'roster', classId],
    enabled: !!classId,
    queryFn: async () => (await api.get<RosterStudent[]>(`${S}/students/by-class/${classId}`)).data,
  });
}

export interface AttendanceRow {
  id: string;
  studentProfileId: string;
  status: AttendanceStatus;
  minutesLate: number;
  reason?: string | null;
}

export function useAttendanceRegister(classId: string | undefined, date: string | undefined) {
  return useQuery({
    queryKey: ['school', 'register', classId, date],
    enabled: !!classId && !!date,
    queryFn: async () => (await api.get<AttendanceRow[]>(`${S}/attendance/register`, { params: { classId, date } })).data,
  });
}

export function useMarkAttendance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: {
      date: string;
      classId: string;
      sectionId?: string;
      entries: Array<{ studentProfileId: string; status: AttendanceStatus; minutesLate?: number; reason?: string }>;
    }) => (await api.post(`${S}/attendance/mark`, dto)).data,
    onSuccess: (_d, v) => qc.invalidateQueries({ queryKey: ['school', 'register', v.classId, v.date] }),
  });
}

/* ───────────────────────── Timetable ───────────────────────── */

export interface TimetableSlot {
  id: string;
  classId: string;
  dayOfWeek: number;
  periodId: string;
  subjectId: string;
  teacherPartnerId?: string | null;
  room?: string | null;
  subject?: { name: string; code: string } | null;
  period?: { name: string; startTime: string; endTime: string } | null;
}

export function useClassTimetable(classId: string | undefined) {
  return useQuery({
    queryKey: ['school', 'timetable', classId],
    enabled: !!classId,
    queryFn: async () => (await api.get<TimetableSlot[]>(`${S}/timetable/class/${classId}`)).data,
  });
}

export interface Period { id: string; name: string; startTime: string; endTime: string; order: number }

export function usePeriods() {
  return useQuery({
    queryKey: ['school', 'periods'],
    queryFn: async () => (await api.get<Paginated<Period>>(`${S}/periods`, { params: { pageSize: 100 } })).data,
  });
}

export function useCreateSlot() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: { classId: string; dayOfWeek: number; periodId: string; subjectId: string; room?: string; teacherPartnerId?: string }) =>
      (await api.post<TimetableSlot>(`${S}/timetable/slots`, dto)).data,
    onSuccess: (_d, v) => qc.invalidateQueries({ queryKey: ['school', 'timetable', v.classId] }),
  });
}

/* ───────────────────────── Examinations ───────────────────────── */

export interface ExamType { id: string; name: string; weight: string; isFinal: boolean }
export interface Exam { id: string; termId: string; examTypeId: string; name: string; status: string; startDate: string; endDate: string }
export interface ExamSchedule { id: string; examId: string; classId: string; subjectId: string; date: string; startTime: string; maxMarks?: number | null; subject?: { name: string } | null; schoolClass?: { name: string } | null }
export interface GradeEntry {
  id: string;
  examScheduleId: string;
  studentProfileId: string;
  marksObtained: string;
  maxMarks: string;
  grade?: string | null;
  status: string;
  studentProfile?: { admissionNo: string; partner?: { name: string } | null } | null;
}

export function useExamTypes() {
  return useQuery({ queryKey: ['school', 'exam-types'], queryFn: async () => (await api.get<Paginated<ExamType>>(`${S}/exam-types`, { params: { pageSize: 100 } })).data });
}
export function useCreateExamType() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: { name: string; weight: number; isFinal?: boolean }) => (await api.post(`${S}/exam-types`, dto)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['school', 'exam-types'] }),
  });
}

export function useExams() {
  return useQuery({ queryKey: ['school', 'exams'], queryFn: async () => (await api.get<Paginated<Exam>>(`${S}/exams`, { params: { pageSize: 100 } })).data });
}
export function useCreateExam() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: { termId: string; examTypeId: string; name: string; startDate: string; endDate: string; classes: string[] }) =>
      (await api.post(`${S}/exams`, dto)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['school', 'exams'] }),
  });
}
export function useExamAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, action }: { id: string; action: 'publish' | 'close' }) => (await api.post(`${S}/exams/${id}/${action}`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['school', 'exams'] }),
  });
}

export function useExamSchedules() {
  return useQuery({ queryKey: ['school', 'exam-schedules'], queryFn: async () => (await api.get<Paginated<ExamSchedule>>(`${S}/exam-schedules`, { params: { pageSize: 200 } })).data });
}
export function useCreateExamSchedule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: { examId: string; classId: string; subjectId: string; date: string; startTime: string; maxMarks?: number }) =>
      (await api.post(`${S}/exam-schedules`, dto)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['school', 'exam-schedules'] }),
  });
}

export function useGradesByClass(examScheduleId: string | undefined) {
  return useQuery({
    queryKey: ['school', 'grades', examScheduleId],
    enabled: !!examScheduleId,
    queryFn: async () => (await api.get<GradeEntry[]>(`${S}/grades/by-class/${examScheduleId}`)).data,
  });
}
export function useBulkGrades() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: { examScheduleId: string; entries: Array<{ studentProfileId: string; marksObtained: number; maxMarks?: number; remarks?: string }> }) =>
      (await api.post(`${S}/grades/bulk-upsert`, dto)).data,
    onSuccess: (_d, v) => qc.invalidateQueries({ queryKey: ['school', 'grades', v.examScheduleId] }),
  });
}
export function useGradeAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ examScheduleId, action }: { examScheduleId: string; action: 'submit' | 'approve' }) =>
      (await api.post(`${S}/grades/${action}/${examScheduleId}`)).data,
    onSuccess: (_d, v) => qc.invalidateQueries({ queryKey: ['school', 'grades', v.examScheduleId] }),
  });
}

export interface ReportCard { id: string; studentProfileId: string; termId: string; pdfUrl?: string | null; publishedAt?: string | null }

export function useReportCards(studentProfileId: string | undefined) {
  return useQuery({
    queryKey: ['school', 'report-cards', studentProfileId],
    enabled: !!studentProfileId,
    queryFn: async () => (await api.get<ReportCard[]>(`${S}/report-cards/by-student/${studentProfileId}`)).data,
  });
}
export function useGenerateReportCard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: { studentProfileId: string; termId: string }) => (await api.post<ReportCard>(`${S}/report-cards/generate`, dto)).data,
    onSuccess: (_d, v) => qc.invalidateQueries({ queryKey: ['school', 'report-cards', v.studentProfileId] }),
  });
}
