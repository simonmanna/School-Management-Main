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

/* ───────────────────────── Admissions ───────────────────────── */

export type AdmissionStatus =
  | 'submitted'
  | 'under_review'
  | 'exam_scheduled'
  | 'accepted'
  | 'enrolled'
  | 'rejected'
  | 'withdrawn';

export interface AdmissionApplication {
  id: string;
  applicationNumber: string;
  applicantFirstName: string;
  applicantLastName: string;
  applicantGender?: string | null;
  applyingForClassId?: string | null;
  academicYearId: string;
  status: AdmissionStatus;
  createdAt: string;
  academicYear?: { id: string; name: string } | null;
}

export interface CreateAdmissionInput {
  academicYearId: string;
  applicantFirstName: string;
  applicantLastName: string;
  applicantDob?: string;
  applicantGender?: 'male' | 'female' | 'other';
  applyingForClassId?: string;
  parentContactId?: string;
}

export function useAdmissions(params: { page?: number; pageSize?: number } = {}) {
  return useQuery({
    queryKey: ['school', 'admissions', params],
    queryFn: async () => (await api.get<Paginated<AdmissionApplication>>(`${S}/admissions`, { params })).data,
  });
}

export function useCreateAdmission() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: CreateAdmissionInput) => (await api.post<AdmissionApplication>(`${S}/admissions`, dto)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['school', 'admissions'] }),
  });
}

export function useAdmissionAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      action,
      notes,
    }: {
      id: string;
      action: 'review' | 'accept' | 'reject' | 'schedule_exam' | 'withdraw';
      notes?: string;
    }) => (await api.post(`${S}/admissions/${id}/review`, { action, notes })).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['school', 'admissions'] }),
  });
}

export interface EnrollAdmissionInput {
  applicationId: string;
  classId: string;
  termId: string;
  rollNumber: string;
  student: { name: string; email?: string; phone?: string; gender?: 'male' | 'female' | 'other'; dateOfBirth?: string };
}

export function useEnrollAdmission() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: EnrollAdmissionInput) => (await api.post(`${S}/admissions/enroll`, dto)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['school', 'admissions'] });
      qc.invalidateQueries({ queryKey: ['school', 'students'] });
    },
  });
}

/* ───────────────────────── Promotion / rollover (P5) ───────────────────────── */

export type PromotionOutcome = 'promoted' | 'repeated' | 'graduated';

export interface RolloverPlanRow {
  studentProfileId: string;
  admissionNo: string;
  outcome: PromotionOutcome | 'skipped';
  toClassId: string | null;
  reason?: string;
}

export interface RolloverPlan {
  fromTermId: string;
  toTermId: string;
  dryRun: boolean;
  counts: { promoted: number; graduated: number; skipped: number; total: number };
  promote: RolloverPlanRow[];
  graduate: RolloverPlanRow[];
  skip: RolloverPlanRow[];
  executed?: Array<{ studentProfileId: string; outcome: string; enrollmentId: string | null; error?: string }>;
}

/** Rollover is a POST that computes (dryRun) or commits the whole-cohort plan. */
export function useRollover() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: { fromTermId: string; toTermId: string; dryRun: boolean }) =>
      (await api.post<RolloverPlan>(`${S}/promotion/rollover`, dto)).data,
    onSuccess: (res) => {
      // Only a committed run mutates data worth refetching.
      if (!res.dryRun) {
        qc.invalidateQueries({ queryKey: ['school', 'students'] });
        qc.invalidateQueries({ queryKey: ['school', 'overview'] });
      }
    },
  });
}

export function usePromoteStudent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: {
      studentProfileId: string;
      toTermId: string;
      toClassId?: string;
      toSectionId?: string;
      rollNumber?: string;
      outcome?: PromotionOutcome;
      reason?: string;
    }) => (await api.post(`${S}/promotion/promote`, dto)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['school', 'students'] }),
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

/* ───────────────────────── Student 360 (per-student reads) ───────────────────────── */

export interface AttendanceRecord {
  date: string;
  status: string;
  minutesLate?: number;
  reason?: string;
}
export function useStudentAttendance(studentProfileId: string | undefined, from?: string, to?: string) {
  return useQuery({
    queryKey: ['school', 'attendance', 'by-student', studentProfileId, from, to],
    enabled: !!studentProfileId,
    queryFn: async () =>
      (await api.get<AttendanceRecord[]>(`${S}/attendance/by-student/${studentProfileId}`, { params: { from, to } })).data,
  });
}
export interface StudentDocumentMeta {
  id: string;
  name?: string;
  type?: string;
  url?: string;
  verified?: boolean;
  uploadedAt?: string;
}
export function useStudentDocuments(studentProfileId: string | undefined) {
  return useQuery({
    queryKey: ['school', 'student-docs', studentProfileId],
    enabled: !!studentProfileId,
    queryFn: async () => (await api.get<StudentDocumentMeta[]>(`${S}/students/${studentProfileId}/documents`)).data,
  });
}
export interface MedicalInfo {
  bloodGroup?: string;
  allergies?: string[];
  conditions?: string[];
  notes?: string;
}
export function useStudentMedical(studentProfileId: string | undefined) {
  return useQuery({
    queryKey: ['school', 'medical', studentProfileId],
    enabled: !!studentProfileId,
    queryFn: async () => (await api.get<MedicalInfo>(`${S}/students/${studentProfileId}/medical-record`)).data,
  });
}

/* Student 360 — modules without a dedicated list page (library, meals, transport,
   behavior/communication/activities). Each reads the new per-student GET endpoint. */

export interface BorrowingRow {
  id: string;
  bookMetadata?: { title?: string; author?: string; isbn?: string } | null;
  borrowedAt: string;
  dueAt: string;
  returnedAt?: string | null;
  status: string;
  fineAmount?: number | string;
}
export function useStudentLibrary(studentProfileId: string | undefined) {
  return useQuery({
    queryKey: ['school', 'library', 'by-student', studentProfileId],
    enabled: !!studentProfileId,
    queryFn: async () => (await api.get<BorrowingRow[]>(`${S}/library/borrowings/by-student/${studentProfileId}`)).data,
  });
}

export interface MealWalletSummary {
  exists: boolean;
  balance?: number | string;
  mealPlan?: { name?: string; type?: string } | null;
  transactions?: Array<{ id: string; type: string; amount: number | string; balanceAfter?: number | string; notes?: string; createdAt: string }>;
}
export function useStudentMeals(studentProfileId: string | undefined) {
  return useQuery({
    queryKey: ['school', 'meals', 'by-student', studentProfileId],
    enabled: !!studentProfileId,
    queryFn: async () => (await api.get<MealWalletSummary>(`${S}/meals/wallet/by-student/${studentProfileId}`)).data,
  });
}

export interface TransportRow {
  id: string;
  route?: { name?: string; monthlyFee?: number | string } | null;
  stop?: { name?: string; pickupTime?: string; dropoffTime?: string } | null;
  startDate: string;
  isActive?: boolean;
  monthlyFee?: number | string;
}
export function useStudentTransport(studentProfileId: string | undefined) {
  return useQuery({
    queryKey: ['school', 'transport', 'by-student', studentProfileId],
    enabled: !!studentProfileId,
    queryFn: async () => (await api.get<TransportRow[]>(`${S}/transport/assignments/by-student/${studentProfileId}`)).data,
  });
}

export interface StudentActivity {
  id: string;
  type: string;
  title: string;
  body?: string | null;
  occurredAt: string;
  duration?: number | null;
  completed?: boolean;
}
export function useStudentActivities(studentProfileId: string | undefined) {
  return useQuery({
    queryKey: ['school', 'activities', 'by-student', studentProfileId],
    enabled: !!studentProfileId,
    queryFn: async () => (await api.get<StudentActivity[]>(`${S}/students/${studentProfileId}/activities`)).data,
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

/**
 * `GET school/timetable/class/:classId` returns `{ slots, grid }`, where `grid`
 * is keyed `[dayOfWeek][periodId]`. This was previously typed as a bare array,
 * so the page called `.find()` on an object and crashed the whole app.
 */
export interface TimetableGrid {
  slots: TimetableSlot[];
  grid: Record<number, Record<string, TimetableSlot | undefined>>;
}

/** Tolerate any of the shapes this endpoint has returned, rather than throwing. */
function normalizeTimetable(payload: unknown): TimetableGrid {
  if (Array.isArray(payload)) {
    const grid: TimetableGrid['grid'] = {};
    for (const s of payload as TimetableSlot[]) {
      (grid[s.dayOfWeek] ??= {})[s.periodId] = s;
    }
    return { slots: payload as TimetableSlot[], grid };
  }
  const obj = (payload ?? {}) as Partial<TimetableGrid>;
  return { slots: obj.slots ?? [], grid: obj.grid ?? {} };
}

export function useClassTimetable(classId: string | undefined) {
  return useQuery({
    queryKey: ['school', 'timetable', classId],
    enabled: !!classId,
    queryFn: async () =>
      normalizeTimetable((await api.get<unknown>(`${S}/timetable/class/${classId}`)).data),
  });
}

export interface Period { id: string; name: string; startTime: string; endTime: string; order: number }

export function usePeriods() {
  return useQuery({
    queryKey: ['school', 'periods'],
    queryFn: async () => (await api.get<Paginated<Period>>(`${S}/periods`, { params: { pageSize: 100 } })).data,
  });
}

/* ───────────────────────── Staff / Campuses (foundation) ───────────────────────── */

export interface StaffMember {
  id: string;
  employeeNo: string;
  staffCategory: string;
  firstName?: string | null;
  lastName?: string | null;
  gender?: string | null;
  designation?: string | null;
  department?: { id: string; name: string } | null;
  position?: { id: string; name: string } | null;
  dateOfJoining?: string | null;
  qualification?: string | null;
  status?: string;
  partner?: { name?: string; email?: string; phone?: string } | null;
}

export function useStaff(params: { page?: number; pageSize?: number } = {}) {
  return useQuery({
    queryKey: ['school', 'staff', params],
    queryFn: async () => (await api.get<Paginated<StaffMember>>(`${S}/staff`, { params: { pageSize: 200, ...params } })).data,
  });
}

export interface Campus { id: string; code: string; name: string; phone?: string | null; email?: string | null; isActive?: boolean }

export function useCampuses() {
  return useQuery({
    queryKey: ['school', 'campuses'],
    queryFn: async () => (await api.get<Paginated<Campus>>(`${S}/campuses`, { params: { pageSize: 100 } })).data,
  });
}

export function useDepartments() {
  return useQuery({
    queryKey: ['school', 'departments'],
    queryFn: async () => (await api.get<Paginated<{ id: string; name: string; code?: string }>>(`${S}/departments`, { params: { pageSize: 100 } })).data,
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
/** Publish / unpublish a report card to the parent+student portals. */
export function usePublishReportCard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { id: string; studentProfileId: string; publish: boolean }) =>
      (await api.post<ReportCard>(`${S}/report-cards/${v.id}/${v.publish ? 'publish' : 'unpublish'}`)).data,
    onSuccess: (_d, v) => qc.invalidateQueries({ queryKey: ['school', 'report-cards', v.studentProfileId] }),
  });
}

/* ───────────────────────── Meals (V1) ───────────────────────── */

export interface MealProgram { id: string; name: string; kind: string; description?: string | null; isActive: boolean }
export interface MealType { id: string; name: string; order: number; startTime?: string | null; endTime?: string | null; isActive: boolean }
export interface MealPlan { id: string; name: string; type: string; pricePerTerm: string; billingModel: string; fundingModel: string; mealProgramId?: string | null; feeProductId?: string | null; isActive: boolean }
export interface MealEntitlement { id: string; mealTypeId: string; mealType?: MealType }
export type MealAttendanceStatus = 'served' | 'absent' | 'excused' | 'not_eligible';
export interface MealPlanAssignment {
  id: string; studentProfileId: string; mealPlanId: string; termId: string;
  startDate: string; endDate?: string | null; status: string;
  mealPlan?: MealPlan; studentProfile?: { admissionNo: string; partner?: { name: string } | null } | null;
}
export interface MealSession { id: string; mealTypeId: string; date: string; classId?: string | null; expectedCount: number; servedCount: number; status: string; mealType?: MealType }
export interface MealRosterRow { studentProfileId: string; admissionNo?: string; name?: string | null; status: MealAttendanceStatus | null }
export interface TodaysMeal { mealTypeId: string; mealType: string; expected: number; served: number; sessions: number; status: string; sessionIds: string[] }
export interface TodaysMeals { date: string; meals: TodaysMeal[] }
export interface MealMenu { id: string; mealTypeId: string; date?: string | null; dayOfWeek?: number | null; title?: string | null; items?: Array<{ id: string; name: string; notes?: string | null; sortOrder: number; posMenuItemId?: string | null }>; mealType?: MealType }

const MEALS = `${S}/meals`;
const CAFE = `${S}/cafeteria`;

// Programs
export function useMealPrograms() {
  return useQuery({ queryKey: ['school', 'meal-programs'], queryFn: async () => (await api.get<Paginated<MealProgram>>(`${MEALS}/programs`, { params: { pageSize: 100 } })).data });
}
export function useCreateMealProgram() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: { name: string; kind?: string; description?: string }) => (await api.post<MealProgram>(`${MEALS}/programs`, dto)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['school', 'meal-programs'] }),
  });
}

// Meal types
export function useMealTypes() {
  return useQuery({ queryKey: ['school', 'meal-types'], queryFn: async () => (await api.get<Paginated<MealType>>(`${MEALS}/types`, { params: { pageSize: 100 } })).data });
}
export function useCreateMealType() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: { name: string; order?: number; startTime?: string; endTime?: string }) => (await api.post<MealType>(`${MEALS}/types`, dto)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['school', 'meal-types'] }),
  });
}

// Plans (reuse existing cafeteria plan endpoint; carries meal fields now)
export function useMealPlans() {
  return useQuery({ queryKey: ['school', 'meal-plans'], queryFn: async () => (await api.get<Paginated<MealPlan>>(`${CAFE}/plans`, { params: { pageSize: 100 } })).data });
}
export function useCreateMealPlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: { name: string; pricePerTerm: number; type?: string; billingModel?: string; fundingModel?: string; mealProgramId?: string; feeProductId?: string }) =>
      (await api.post<MealPlan>(`${CAFE}/plans`, dto)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['school', 'meal-plans'] }),
  });
}

// Entitlements
export function useMealEntitlements(mealPlanId: string | undefined) {
  return useQuery({
    queryKey: ['school', 'meal-entitlements', mealPlanId],
    enabled: !!mealPlanId,
    queryFn: async () => (await api.get<MealEntitlement[]>(`${MEALS}/entitlements/by-plan/${mealPlanId}`)).data,
  });
}
export function useSetEntitlements() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: { mealPlanId: string; mealTypeIds: string[] }) => (await api.put(`${MEALS}/entitlements`, dto)).data,
    onSuccess: (_d, v) => qc.invalidateQueries({ queryKey: ['school', 'meal-entitlements', v.mealPlanId] }),
  });
}

// Assignments
export function useAssignmentsByTerm(termId: string | undefined, status?: string) {
  return useQuery({
    queryKey: ['school', 'meal-assignments', termId, status],
    enabled: !!termId,
    queryFn: async () => (await api.get<MealPlanAssignment[]>(`${MEALS}/assignments/by-term/${termId}`, { params: status ? { status } : {} })).data,
  });
}
export function useAssignMealPlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: { studentProfileId: string; mealPlanId: string; termId: string; startDate: string; endDate?: string; reason?: string }) =>
      (await api.post<MealPlanAssignment>(`${MEALS}/assignments`, dto)).data,
    onSuccess: (_d, v) => qc.invalidateQueries({ queryKey: ['school', 'meal-assignments', v.termId] }),
  });
}
export function useChangeAssignment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: { id: string; status: string; reason?: string; endDate?: string }) =>
      (await api.post(`${MEALS}/assignments/${dto.id}/change`, dto)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['school', 'meal-assignments'] }),
  });
}

// Sessions + attendance
export function useTodaysMeals(date?: string) {
  return useQuery({ queryKey: ['school', 'meals-today', date], queryFn: async () => (await api.get<TodaysMeals>(`${MEALS}/sessions/today`, { params: date ? { date } : {} })).data });
}
export function useMealSessions(from?: string, to?: string) {
  return useQuery({ queryKey: ['school', 'meal-sessions', from, to], queryFn: async () => (await api.get<MealSession[]>(`${MEALS}/sessions`, { params: { from, to } })).data });
}
export function useMealRoster(sessionId: string | undefined) {
  return useQuery({
    queryKey: ['school', 'meal-roster', sessionId],
    enabled: !!sessionId,
    queryFn: async () => (await api.get<{ session: MealSession; roster: MealRosterRow[] }>(`${MEALS}/sessions/${sessionId}/roster`)).data,
  });
}
export function useOpenMealSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: { mealTypeId: string; date: string; classId?: string; sectionId?: string }) => (await api.post<MealSession>(`${MEALS}/sessions/open`, dto)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['school', 'meals-today'] }),
  });
}
export function useMarkMealAttendance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: { sessionId: string; entries: Array<{ studentProfileId: string; status: MealAttendanceStatus; reason?: string }> }) =>
      (await api.post(`${MEALS}/sessions/${dto.sessionId}/mark`, { entries: dto.entries })).data,
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ['school', 'meal-roster', v.sessionId] });
      qc.invalidateQueries({ queryKey: ['school', 'meals-today'] });
    },
  });
}

// Menus
export function useMealMenus(mealTypeId?: string) {
  return useQuery({ queryKey: ['school', 'meal-menus', mealTypeId], queryFn: async () => (await api.get<MealMenu[]>(`${MEALS}/menus`, { params: mealTypeId ? { mealTypeId } : {} })).data });
}
export function useCreateMealMenu() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: { mealTypeId: string; date?: string; title?: string; items?: Array<{ name: string; notes?: string; sortOrder?: number; posMenuItemId?: string }>; posMenuItemIds?: string[] }) =>
      (await api.post<MealMenu>(`${MEALS}/menus`, dto)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['school', 'meal-menus'] }),
  });
}

/** School-food catalog (Ugandan local dishes + fruits), grouped by category. */
export function useSchoolMenuCatalog() {
  return useQuery({ queryKey: ['school', 'school-menu-catalog'], queryFn: async () => (await api.get<PosMenuCategory[]>(`${MEALS}/menus/school-catalog`)).data });
}
export function useBuildMenuFromPos() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: { mealTypeId: string; date?: string; title?: string; posMenuItemIds: string[] }) =>
      (await api.post<MealMenu>(`${MEALS}/menus/from-pos`, dto)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['school', 'meal-menus'] }),
  });
}

export interface PosMenuCategory {
  categoryId: string | null;
  categoryName: string;
  items: Array<{ id: string; name: string; description?: string | null; basePrice?: number | string | null; categoryId?: string | null }>;
}

/* ───────────────────────── Meals V2 finance ───────────────────────── */

export interface MealChargeResult { count: number; documents: unknown[]; skipped: unknown[] }
export interface MealAccount { id: string; studentProfileId: string; balance: string }
export interface MealWalletTxn { id: string; type: string; amount: string; balanceAfter: string; reference?: string | null; createdAt: string }

export function useRunMealBilling() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: { termId: string; classId?: string }) => (await api.post<MealChargeResult>(`${MEALS}/billing/run`, dto)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['school'] }),
  });
}
export function useWalletTopUp() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: { studentProfileId: string; mealPlanId: string; amount: number; reference?: string }) =>
      (await api.post<MealAccount>(`${MEALS}/wallet/top-up`, dto)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['school', 'meal-wallet'] }),
  });
}
export function useWalletHistory(accountId: string | undefined) {
  return useQuery({
    queryKey: ['school', 'meal-wallet', accountId],
    enabled: !!accountId,
    queryFn: async () => (await api.get<MealWalletTxn[]>(`${MEALS}/wallet/${accountId}/history`)).data,
  });
}

/* ───────────────────────── Meals V3 kitchen ───────────────────────── */

export interface MealRecipe { id: string; name: string; portionYield: number; ingredients?: Array<{ id: string; productId: string; quantityPerPortion: string }> }
export interface MealProductionItem { id: string; productId: string; plannedQuantity: string; issuedQuantity: string; consumedQuantity: string; wastedQuantity: string; unitCost: string }
export interface MealProductionPlan {
  id: string; mealTypeId: string; date: string; expectedPortions: number; status: string;
  items?: MealProductionItem[]; cost?: { foodCost: number; wasteCost: number; costPerPortion: number }; mealType?: MealType;
}

export function useMealRecipes() {
  return useQuery({ queryKey: ['school', 'meal-recipes'], queryFn: async () => (await api.get<MealRecipe[]>(`${MEALS}/recipes`)).data });
}
export function useCreateMealRecipe() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: { name: string; description?: string; portionYield?: number; ingredients?: Array<{ productId: string; quantityPerPortion: number; uomId?: string }> }) =>
      (await api.post<MealRecipe>(`${MEALS}/recipes`, dto)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['school', 'meal-recipes'] }),
  });
}
export function useProductionPlans(from?: string, to?: string) {
  return useQuery({ queryKey: ['school', 'meal-production', from, to], queryFn: async () => (await api.get<MealProductionPlan[]>(`${MEALS}/production`, { params: { from, to } })).data });
}
export function usePlanProduction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: { mealTypeId: string; date: string; expectedPortions?: number; mealSessionId?: string; mealRecipeIds: string[] }) =>
      (await api.post<MealProductionPlan>(`${MEALS}/production/plan`, dto)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['school', 'meal-production'] }),
  });
}
export function useIssueProduction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: { id: string; stockLocationId?: string }) => (await api.post<MealProductionPlan>(`${MEALS}/production/${dto.id}/issue`, { stockLocationId: dto.stockLocationId })).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['school', 'meal-production'] }),
  });
}
export function useRecordWaste() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: { id: string; productId?: string; quantity: number; reason: string; notes?: string }) =>
      (await api.post(`${MEALS}/production/${dto.id}/waste`, dto)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['school', 'meal-production'] }),
  });
}

/* ═══════════════════════════════════════════════════════════════════════════
 * A0–A8: Assessment / Exam operations / CBT / Certification / Analytics
 * Wired to the school vertical's assessment, CBT, certification & analytics
 * controllers. Every hook mirrors the existing P0–P4 convention.
 * ═══════════════════════════════════════════════════════════════════════════ */

const AS = `${S}/assessment-policies`;
const AC = `${S}/assessment-components`;
const A = `${S}/assessments`;
const MK = `${S}/marking`;
const RO = `${S}/rosters`;
const RB = `${S}/rubrics`;
const ASG = `${S}/assignments`;
const RES = `${S}/results`;
const EV = `${S}/exam-venues`;
const ER = `${S}/exam-registrations`;
const QB = `${S}/question-banks`;
const Q = `${S}/questions`;
const PP = `${S}/papers`;
const CBT = `${S}/cbt`;
const TR = `${S}/transcripts`;
const EXT = `${S}/external-results`;
const CERT = `${S}/certificates`;
const AN = `${S}/analytics`;

/* ── A1 Assessment policy + components + instances ────────────────────────── */

export interface AssessmentPolicy { id: string; name: string; gradeLevelId?: string | null; classId?: string | null; subjectId?: string | null; termId?: string | null; passMark?: number | null; caCap?: number | null; roundingMode?: string; decimalPlaces?: number | null; isActive: boolean; version: number }
export interface AssessmentComponent { id: string; policyId: string; name: string; kind: string; weight: number; aggregation?: string | null; bestN?: number | null; countsAbsentAsZero?: boolean; examTypeId?: string | null; order?: number | null }
export interface Assessment { id: string; subjectId: string; classId: string; termId: string; componentId?: string | null; title: string; maxScore?: number | null; weightInComponent?: number | null; sourceType?: string; status: string; component?: { name: string; kind: string } | null }

export function useAssessmentPolicies() {
  return useQuery({ queryKey: ['school', 'assessment-policies'], queryFn: async () => (await api.get<Paginated<AssessmentPolicy>>(AS, { params: { pageSize: 200 } })).data });
}
export function useCreateAssessmentPolicy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: { name: string; gradeLevelId?: string; classId?: string; subjectId?: string; termId?: string; passMark?: number; caCap?: number; roundingMode?: string; decimalPlaces?: number }) =>
      (await api.post<AssessmentPolicy>(AS, dto)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['school', 'assessment-policies'] }),
  });
}
export function useResolvePolicy(subjectId?: string, classId?: string, gradeLevelId?: string, termId?: string) {
  return useQuery({
    queryKey: ['school', 'assessment-policy-resolve', subjectId, classId, gradeLevelId, termId],
    enabled: !!(subjectId || classId || gradeLevelId || termId),
    queryFn: async () => (await api.get<AssessmentPolicy | null>(`${AS}/resolve`, { params: { subjectId, classId, gradeLevelId, termId } })).data,
  });
}

export function useAssessmentComponents(policyId?: string) {
  return useQuery({
    queryKey: ['school', 'assessment-components', policyId],
    enabled: !!policyId,
    queryFn: async () => (await api.get<AssessmentComponent[]>(`${AC}/by-policy/${policyId}`)).data,
  });
}
export function useValidateComponents(policyId: string | undefined) {
  return useQuery({
    queryKey: ['school', 'assessment-components-validate', policyId],
    enabled: !!policyId,
    queryFn: async () => (await api.get<{ valid: boolean; totalWeight: number; message?: string }>(`${AC}/validate/${policyId}`)).data,
  });
}
export function useCreateAssessmentComponent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: { policyId: string; name: string; kind: string; weight: number; aggregation?: string; bestN?: number; countsAbsentAsZero?: boolean; examTypeId?: string; order?: number }) =>
      (await api.post<AssessmentComponent>(AC, dto)).data,
    onSuccess: (_d, v) => qc.invalidateQueries({ queryKey: ['school', 'assessment-components', v.policyId] }),
  });
}

export function useAssessments(classId?: string, termId?: string) {
  return useQuery({
    queryKey: ['school', 'assessments', classId, termId],
    enabled: !!(classId && termId),
    queryFn: async () => (await api.get<Assessment[]>(`${A}/by-class/${classId}/term/${termId}`)).data,
  });
}
export function useCreateAssessment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: { subjectId: string; classId: string; termId: string; title: string; componentId?: string; maxScore?: number; weightInComponent?: number; sourceType?: string; dueAt?: string }) =>
      (await api.post<Assessment>(A, dto)).data,
    onSuccess: (_d, v) => qc.invalidateQueries({ queryKey: ['school', 'assessments', v.classId, v.termId] }),
  });
}
export function useAssessmentTransition() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { id: string; action: 'schedule' | 'publish' | 'open' | 'close' | 'grade' | 'archive' }) =>
      (await api.post(`${A}/${v.id}/transition`, { action: v.action })).data,
    onSuccess: (_d, v) => { qc.invalidateQueries({ queryKey: ['school', 'assessments'] }); qc.invalidateQueries({ queryKey: ['school', 'marking', v.id] }); },
  });
}

/* ── A1 Marking (SoD: enter vs approve) ────────────────────────────────────── */

export interface MarkRow {
  studentAssessmentId: string; studentProfileId: string; studentName: string; admissionNo?: string | null;
  participation: string; score?: number | null; firstMark?: number | null; secondMark?: number | null;
  adjustedScore?: number | null; status: string; round?: string; comment?: string | null;
}
export function useMarksByAssessment(assessmentId: string | undefined) {
  return useQuery({
    queryKey: ['school', 'marking', assessmentId],
    enabled: !!assessmentId,
    queryFn: async () => (await api.get<MarkRow[]>(`${MK}/by-assessment/${assessmentId}`)).data,
  });
}
export function useRecordMark() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: { studentAssessmentId: string; score: number; round?: string; comment?: string }) =>
      (await api.post(`${MK}/mark`, dto)).data,
    onSuccess: (_d, v) => qc.invalidateQueries({ queryKey: ['school', 'marking', v.studentAssessmentId] }),
  });
}
export function useSetParticipation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: { assessmentId: string; studentProfileId: string; participation: string; classId?: string; sectionId?: string; gradeLevelId?: string; termId?: string }) =>
      (await api.post(`${MK}/participation`, dto)).data,
    onSuccess: (_d, v) => qc.invalidateQueries({ queryKey: ['school', 'marking', v.assessmentId] }),
  });
}
export function useAppendAdjustment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: { studentAssessmentId: string; kind: string; delta?: number; replacementScore?: number; reason: string }) =>
      (await api.post(`${MK}/adjustment`, dto)).data,
    onSuccess: (_d, v) => qc.invalidateQueries({ queryKey: ['school', 'marking', v.studentAssessmentId] }),
  });
}
export function useSubmitMarks() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (assessmentId: string) => (await api.post(`${MK}/submit`, { assessmentId })).data,
    onSuccess: (_d, v) => qc.invalidateQueries({ queryKey: ['school', 'marking', v] }),
  });
}
export function useMarkingApproval() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: { assessmentId: string; action: 'submit' | 'approve' | 'reject'; reason?: string }) =>
      (await api.post(`${MK}/approval`, dto)).data,
    onSuccess: (_d, v) => qc.invalidateQueries({ queryKey: ['school', 'marking', v.assessmentId] }),
  });
}

/* ── A2 Rosters ───────────────────────────────────────────────────────────── */

export interface Roster { id: string; termId: string; name?: string | null; scopeType: string; classId?: string | null; sectionId?: string | null; subjectId?: string | null; status: string; memberCount?: number | null }
export interface RosterMember { studentProfileId: string; name: string; admissionNo?: string | null; status: string; classId?: string | null; sectionId?: string | null }

export function useRosters() {
  return useQuery({ queryKey: ['school', 'rosters'], queryFn: async () => (await api.get<Paginated<Roster>>(RO, { params: { pageSize: 200 } })).data });
}
export function useRosterMembers(rosterId: string | undefined) {
  return useQuery({
    queryKey: ['school', 'roster-members', rosterId],
    enabled: !!rosterId,
    queryFn: async () => (await api.get<RosterMember[]>(`${RO}/${rosterId}/members`)).data,
  });
}
export function useCaptureRoster() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: { termId: string; scopeType?: string; classId?: string; sectionId?: string; subjectId?: string; name?: string; source?: string }) =>
      (await api.post<Roster>(`${RO}/capture`, dto)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['school', 'rosters'] }),
  });
}
export function useFreezeRoster() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => (await api.post(`${RO}/${id}/freeze`)).data,
    onSuccess: (_d, v) => { qc.invalidateQueries({ queryKey: ['school', 'rosters'] }); qc.invalidateQueries({ queryKey: ['school', 'roster-members', v] }); },
  });
}
export function useAddRosterMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { rosterId: string; studentProfileId: string; classId?: string; sectionId?: string; gradeLevelId?: string; joinReason?: string }) =>
      (await api.post(`${RO}/${v.rosterId}/members`, { studentProfileId: v.studentProfileId, classId: v.classId, sectionId: v.sectionId, gradeLevelId: v.gradeLevelId, joinReason: v.joinReason })).data,
    onSuccess: (_d, v) => qc.invalidateQueries({ queryKey: ['school', 'roster-members', v.rosterId] }),
  });
}
export function useRemoveRosterMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { rosterId: string; studentProfileId: string }) => (await api.post(`${RO}/${v.rosterId}/members/${v.studentProfileId}`, {}).then(() => null)),
    onSuccess: (_d, v) => qc.invalidateQueries({ queryKey: ['school', 'roster-members', v.rosterId] }),
  });
}

/* ── A2 Rubrics ───────────────────────────────────────────────────────────── */

export interface Rubric { id: string; name: string; description?: string | null; criteria?: RubricCriterion[] }
export interface RubricCriterion { id: string; name: string; description?: string | null; weight?: number | null; maxScore: number; levels?: RubricLevel[] }
export interface RubricLevel { id?: string; label: string; score: number; descriptor?: string | null; order?: number }

export function useRubrics() {
  return useQuery({ queryKey: ['school', 'rubrics'], queryFn: async () => (await api.get<Paginated<Rubric>>(RB, { params: { pageSize: 200 } })).data });
}
export function useRubric(id: string | undefined) {
  return useQuery({ queryKey: ['school', 'rubric', id], enabled: !!id, queryFn: async () => (await api.get<Rubric>(`${RB}/${id}`)).data });
}
export function useCreateRubric() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: { name: string; description?: string; criteria?: Array<{ name: string; description?: string; weight?: number; maxScore: number; order?: number; levels?: Array<{ label: string; score: number; descriptor?: string; order?: number }> }> }) =>
      (await api.post<Rubric>(RB, dto)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['school', 'rubrics'] }),
  });
}
export function useForkRubric() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => (await api.post(`${RB}/${id}/fork`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['school', 'rubrics'] }),
  });
}
export function useDeleteRubric() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => (await api.delete(`${RB}/${id}`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['school', 'rubrics'] }),
  });
}

/* ── A2 Assignments ───────────────────────────────────────────────────────── */

export interface Assignment { id: string; subjectId: string; classId: string; termId: string; title: string; maxScore?: number | null; dueAt?: string | null; rosterId?: string | null; gradingMode?: string; rubricId?: string | null; status: string; publishedAt?: string | null }
export interface AssignmentSubmission { id: string; assignmentId: string; studentProfileId: string; studentName?: string; status: string; submittedAt?: string | null; rawScore?: number | null }

export function useAssignments(classId?: string, termId?: string) {
  return useQuery({
    queryKey: ['school', 'assignments', classId, termId],
    enabled: !!(classId && termId),
    queryFn: async () => (await api.get<Assignment[]>(`${ASG}/by-class/${classId}/term/${termId}`)).data,
  });
}
export function useCreateAssignment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: { subjectId: string; classId: string; termId: string; title: string; maxScore?: number; dueAt?: string; rosterId?: string; instructions?: string; allowLate?: boolean; latePenaltyPercent?: number; lateCutoffAt?: string; maxAttempts?: number; gradingMode?: string; rubricId?: string }) =>
      (await api.post<Assignment>(ASG, dto)).data,
    onSuccess: (_d, v) => qc.invalidateQueries({ queryKey: ['school', 'assignments', v.classId, v.termId] }),
  });
}
export function usePublishAssignment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => (await api.post(`${ASG}/${id}/publish`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['school', 'assignments'] }),
  });
}
export function useSubmitAssignment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: { assignmentId: string; studentProfileId: string; content?: string }) =>
      (await api.post(`${ASG}/submit`, dto)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['school', 'assignments'] }),
  });
}
export function useGradeAssignment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: { assignmentId: string; studentProfileId: string; rawScore?: number; complete?: boolean; rubricScores?: Array<{ criterionId: string; levelId?: string; score: number; comment?: string }> }) =>
      (await api.post(`${ASG}/grade`, dto)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['school', 'assignments'] }),
  });
}

/* ── A3 Result spine ──────────────────────────────────────────────────────── */

export interface ResultSet {
  id: string; termId: string; rosterId?: string | null; scopeType: string; scopeId?: string | null;
  status: string; revision: number; computedAt?: string | null; publishedAt?: string | null;
  coveragePct?: number | null; allApproved?: boolean | null; weightsSum100?: boolean | null;
  studentCount?: number | null; checksum?: string | null;
}
export interface StudentSubjectResult { subjectId: string; subjectName?: string | null; caScore?: number | null; examScore?: number | null; finalPercent?: number | null; grade?: string | null; position?: number | null }
export interface StudentTermResult { studentProfileId: string; studentName?: string | null; admissionNo?: string | null; meanPercent?: number | null; gpa?: number | null; classRank?: number | null; eligible?: boolean; promotionRecommendation?: string | null }
export interface ResultSetDetail { resultSet: ResultSet; subjects: StudentSubjectResult[]; students: StudentTermResult[] }

export function useComputeResults() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: { termId: string; rosterId: string; scopeType?: string; scopeId?: string; calculationVersion?: string; idempotencyKey?: string }) =>
      (await api.post<ResultSet>(`${RES}/compute`, dto)).data,
    onSuccess: (_d, v) => { qc.invalidateQueries({ queryKey: ['school', 'result-sets', v.termId] }); },
  });
}
export function useResultSets(termId?: string) {
  return useQuery({
    queryKey: ['school', 'result-sets', termId],
    enabled: !!termId,
    queryFn: async () => (await api.get<ResultSet[]>(`${RES}/by-term/${termId}`)).data,
  });
}
/** The most recent published result set for a student-term (portal-facing). */
export function useStudentResultSet(studentProfileId: string | undefined, termId: string | undefined) {
  return useQuery({
    queryKey: ['school', 'student-result-set', studentProfileId, termId],
    enabled: !!(studentProfileId && termId),
    queryFn: async () => (await api.get<ResultSetDetail>(`${RES}/by-student/${studentProfileId}/term/${termId}`)).data,
  });
}
export function useResultSet(id: string | undefined) {
  return useQuery({
    queryKey: ['school', 'result-set', id],
    enabled: !!id,
    queryFn: async () => (await api.get<ResultSetDetail>(`${RES}/${id}`)).data,
  });
}
export function usePublishResultSet() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => (await api.post(`${RES}/${id}/publish`)).data,
    onSuccess: (_d, v) => qc.invalidateQueries({ queryKey: ['school', 'result-set', v] }),
  });
}
export function useRequestAmendment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: { resultSetId: string; reason: string }) => (await api.post(`${RES}/amendments`, dto)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['school', 'amendments'] }),
  });
}
export function useAmendments(resultSetId?: string) {
  return useQuery({
    queryKey: ['school', 'amendments', resultSetId],
    enabled: !!resultSetId,
    queryFn: async () => (await api.get<Array<{ id: string; resultSetId: string; reason: string; status: string; createdAt: string }>>(`${RES}/amendments/by-result-set/${resultSetId}`)).data,
  });
}
export function useApproveAmendment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => (await api.post(`${RES}/amendments/${id}/approve`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['school', 'amendments'] }),
  });
}

/* ── A4 Exam operations ───────────────────────────────────────────────────── */

export interface ExamVenue { id: string; name: string; code?: string | null; campusId?: string | null; capacity?: number | null; isActive: boolean }
export interface ExamRegistration { id: string; examId: string; studentProfileId: string; classId?: string | null; status: string; venueId?: string | null; seatNumber?: string | null; studentName?: string; admissionNo?: string | null }

export function useExamVenues() {
  return useQuery({ queryKey: ['school', 'exam-venues'], queryFn: async () => (await api.get<Paginated<ExamVenue>>(EV, { params: { pageSize: 200 } })).data });
}
export function useCreateExamVenue() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: { name: string; code?: string; campusId?: string; capacity?: number }) => (await api.post<ExamVenue>(EV, dto)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['school', 'exam-venues'] }),
  });
}
export function useExamRegistrations(examId: string | undefined) {
  return useQuery({
    queryKey: ['school', 'exam-registrations', examId],
    enabled: !!examId,
    queryFn: async () => (await api.get<ExamRegistration[]>(`${ER}/by-exam/${examId}`)).data,
  });
}
export function useRegisterClass() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: { examId: string; classId: string }) => (await api.post(`${ER}/register-class`, dto)).data,
    onSuccess: (_d, v) => qc.invalidateQueries({ queryKey: ['school', 'exam-registrations', v.examId] }),
  });
}
export function useRegisterCandidates() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: { examId: string; studentProfileIds: string[]; classId?: string }) => (await api.post(`${ER}/register`, dto)).data,
    onSuccess: (_d, v) => qc.invalidateQueries({ queryKey: ['school', 'exam-registrations', v.examId] }),
  });
}
export function useAllocateSeats() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: { examId: string; venueId: string }) => (await api.post(`${ER}/allocate-seats`, dto)).data,
    onSuccess: (_d, v) => qc.invalidateQueries({ queryKey: ['school', 'exam-registrations', v.examId] }),
  });
}
export function useUpdateRegistration() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { id: string; examId: string; status: string; venueId?: string; seatNumber?: string }) =>
      (await api.patch(`${ER}/${v.id}`, { status: v.status, venueId: v.venueId, seatNumber: v.seatNumber })).data,
    onSuccess: (_d, v) => qc.invalidateQueries({ queryKey: ['school', 'exam-registrations', v.examId] }),
  });
}

/* ── A5 CBT engine ────────────────────────────────────────────────────────── */

export interface QuestionBank { id: string; name: string; subjectId?: string | null; description?: string | null }
export interface Question { id: string; bankId: string; type: string; prompt: string; marks?: number | null; difficulty?: string | null }
export interface Paper { id: string; name: string; subjectId?: string | null; durationMinutes?: number | null; isRandom?: boolean; questionCount?: number }
export interface PaperQuestion { id: string; paperId: string; questionId: string; order?: number | null; marks?: number | null; prompt?: string; type?: string }
export interface QuizAttempt { id: string; paperId: string; studentProfileId: string; status: string; startedAt: string; expiresAt?: string | null; submittedAt?: string | null; score?: number | null; totalMarks?: number | null; autoMarked?: boolean; studentView?: { paperId: string; questions: Array<{ id: string; prompt: string; type: string; options?: Array<{ id: string; label: string }> }> } | null }

export function useQuestionBanks() {
  return useQuery({ queryKey: ['school', 'question-banks'], queryFn: async () => (await api.get<Paginated<QuestionBank>>(QB, { params: { pageSize: 200 } })).data });
}
export function useCreateQuestionBank() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: { name: string; subjectId?: string; description?: string }) => (await api.post<QuestionBank>(QB, dto)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['school', 'question-banks'] }),
  });
}
export function useBankQuestions(bankId: string | undefined) {
  return useQuery({
    queryKey: ['school', 'bank-questions', bankId],
    enabled: !!bankId,
    queryFn: async () => (await api.get<Question[]>(`${QB}/${bankId}/questions`)).data,
  });
}
export function useCreateQuestion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: { bankId: string; type: string; prompt: string; marks?: number; answerKey?: unknown; difficulty?: string; options?: Array<{ label: string; isCorrect?: boolean; order?: number }> }) =>
      (await api.post<Question>(Q, dto)).data,
    onSuccess: (_d, v) => qc.invalidateQueries({ queryKey: ['school', 'bank-questions', v.bankId] }),
  });
}
export function usePapers() {
  return useQuery({ queryKey: ['school', 'papers'], queryFn: async () => (await api.get<Paginated<Paper>>(PP, { params: { pageSize: 200 } })).data });
}
export function usePaper(id: string | undefined) {
  return useQuery({ queryKey: ['school', 'paper', id], enabled: !!id, queryFn: async () => (await api.get<Paper & { questions: PaperQuestion[] }>(`${PP}/${id}`)).data });
}
export function useCreatePaper() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: { name: string; subjectId?: string; durationMinutes?: number; isRandom?: boolean; blueprint?: unknown }) => (await api.post<Paper>(PP, dto)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['school', 'papers'] }),
  });
}
export function useAddPaperQuestion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { paperId: string; questionId: string; order?: number; marks?: number }) => (await api.post(`${PP}/${v.paperId}/questions`, v)).data,
    onSuccess: (_d, v) => qc.invalidateQueries({ queryKey: ['school', 'paper', v.paperId] }),
  });
}
export function useStartAttempt() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: { paperId: string; studentProfileId: string; studentAssessmentId?: string }) => (await api.post<QuizAttempt>(`${CBT}/start`, dto)).data,
    onSuccess: (d) => qc.invalidateQueries({ queryKey: ['school', 'attempt', (d as QuizAttempt).id] }),
  });
}
export function useAttempt(id: string | undefined) {
  return useQuery({ queryKey: ['school', 'attempt', id], enabled: !!id, queryFn: async () => (await api.get<QuizAttempt>(`${CBT}/attempts/${id}`)).data, refetchInterval: false });
}
export function useSaveResponse() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: { attemptId: string; questionId: string; clientEventId?: string; sequenceNumber: number; response: Record<string, unknown> }) =>
      (await api.post(`${CBT}/response`, dto)).data,
    onSuccess: (_d, v) => qc.invalidateQueries({ queryKey: ['school', 'attempt', v.attemptId] }),
  });
}
export function useSubmitAttempt() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: { attemptId: string; idempotencyKey?: string }) => (await api.post<QuizAttempt>(`${CBT}/submit`, dto)).data,
    onSuccess: (_d, v) => qc.invalidateQueries({ queryKey: ['school', 'attempt', v.attemptId] }),
  });
}

/* ── A6 Certification ─────────────────────────────────────────────────────── */

export interface Transcript { id: string; studentProfileId: string; builtAt: string; cumulativeGpa?: number | null; generatedUrl?: string | null }
export interface ExternalResult { id: string; studentProfileId: string; board?: string | null; level: string; year: number; indexNumber?: string | null; aggregate?: number | null; division?: string | null; verified?: boolean; subjects?: Array<{ subject: string; grade: string; mark?: string | null; result?: string | null }> }
export interface Certificate { id: string; studentProfileId: string; type: string; title: string; serial?: string | null; code?: string | null; status: string; issuedAt: string; revokedAt?: string | null; voidedAt?: string | null }

export function useTranscript(studentProfileId: string | undefined) {
  return useQuery({ queryKey: ['school', 'transcript', studentProfileId], enabled: !!studentProfileId, queryFn: async () => (await api.get<Transcript>(`${TR}/by-student/${studentProfileId}`)).data });
}
export function useBuildTranscript() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (studentProfileId: string) => (await api.post<Transcript>(`${TR}/build/${studentProfileId}`)).data,
    onSuccess: (_d, v) => qc.invalidateQueries({ queryKey: ['school', 'transcript', v] }),
  });
}
export function useExternalResults(studentProfileId: string | undefined) {
  return useQuery({ queryKey: ['school', 'external-results', studentProfileId], enabled: !!studentProfileId, queryFn: async () => (await api.get<ExternalResult[]>(`${EXT}/by-student/${studentProfileId}`)).data });
}
export function useRecordExternalResult() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: { studentProfileId: string; level: string; year: number; board?: string; indexNumber?: string; aggregate?: number; division?: string; verified?: boolean; subjects?: Array<{ subject: string; grade: string; mark?: string; result?: string }> }) =>
      (await api.post<ExternalResult>(EXT, dto)).data,
    onSuccess: (_d, v) => qc.invalidateQueries({ queryKey: ['school', 'external-results', v.studentProfileId] }),
  });
}
export function useCertificates(studentProfileId: string | undefined) {
  return useQuery({ queryKey: ['school', 'certificates', studentProfileId], enabled: !!studentProfileId, queryFn: async () => (await api.get<Certificate[]>(`${CERT}/by-student/${studentProfileId}`)).data });
}
export function useIssueCertificate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: { studentProfileId: string; type: string; title: string; payload?: unknown }) => (await api.post<Certificate>(`${CERT}/issue`, dto)).data,
    onSuccess: (_d, v) => qc.invalidateQueries({ queryKey: ['school', 'certificates', v.studentProfileId] }),
  });
}
export function useRevokeCertificate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { id: string; studentProfileId: string; reason: string; void?: boolean }) => (await api.post(`${CERT}/${v.id}/revoke`, { reason: v.reason, void: v.void })).data,
    onSuccess: (_d, v) => qc.invalidateQueries({ queryKey: ['school', 'certificates', v.studentProfileId] }),
  });
}

/* ── A7 Analytics ─────────────────────────────────────────────────────────── */

export interface Overview { resultSetId: string; resultSetRevision: number; termId: string; studentCount: number; meanPercent: number; passRate: number; eligibleRate: number; atRiskCount: number; gradeDistribution: Array<{ grade: string; count: number }>; subjects: Array<{ subjectId: string; count: number; mean: number; median: number; passRate: number }> }
export interface GradeDist { resultSetId: string; resultSetRevision: number; termId: string; distribution: Array<{ grade: string; count: number }> }
export interface SubjectPerf { resultSetId: string; subjects: Array<{ subjectId: string; count: number; mean: number; median: number; passRate: number }> }
export interface ClassPerf { resultSetId: string; studentCount: number; meanPercent: number; passRate: number; eligibleRate: number }
export interface CaExamDiv { resultSetId: string; threshold: number; flagged: Array<{ studentProfileId: string; subjectId: string; caScore: number; examScore: number; gap: number }> }
export interface AtRisk { resultSetId: string; passMark: number; register: Array<{ studentProfileId: string; meanPercent: number; failingSubjects: number; reasons: string[] }> }
export interface StudentTrend { studentProfileId: string; points: Array<{ termId: string; resultSetRevision: number; meanPercent: number; gpa: number; classRank?: number | null }> }
export interface AssignmentMetrics { classId: string; termId: string; totalAssigned: number; submissionRate: number; gradedRate: number; missingRate: number }
export interface ExamAttendance { examId: string; total: number; byStatus: Record<string, number>; attendanceRate: number; absenceRate: number }

export function useAnalyticsOverview(resultSetId: string | undefined) {
  return useQuery({ queryKey: ['school', 'analytics', 'overview', resultSetId], enabled: !!resultSetId, queryFn: async () => (await api.get<Overview>(`${AN}/overview/${resultSetId}`)).data });
}
export function useGradeDistribution(resultSetId: string | undefined) {
  return useQuery({ queryKey: ['school', 'analytics', 'grade-dist', resultSetId], enabled: !!resultSetId, queryFn: async () => (await api.get<GradeDist>(`${AN}/grade-distribution/${resultSetId}`)).data });
}
export function useSubjectPerformance(resultSetId: string | undefined, passMark?: number) {
  return useQuery({ queryKey: ['school', 'analytics', 'subject-perf', resultSetId, passMark], enabled: !!resultSetId, queryFn: async () => (await api.get<SubjectPerf>(`${AN}/subject-performance/${resultSetId}`, { params: passMark ? { passMark } : {} })).data });
}
export function useClassPerformance(resultSetId: string | undefined) {
  return useQuery({ queryKey: ['school', 'analytics', 'class-perf', resultSetId], enabled: !!resultSetId, queryFn: async () => (await api.get<ClassPerf>(`${AN}/class-performance/${resultSetId}`)).data });
}
export function useCaVsExam(resultSetId: string | undefined, threshold?: number) {
  return useQuery({ queryKey: ['school', 'analytics', 'ca-exam', resultSetId, threshold], enabled: !!resultSetId, queryFn: async () => (await api.get<CaExamDiv>(`${AN}/ca-vs-exam/${resultSetId}`, { params: threshold ? { threshold } : {} })).data });
}
export function useAtRisk(resultSetId: string | undefined, passMark?: number) {
  return useQuery({ queryKey: ['school', 'analytics', 'at-risk', resultSetId, passMark], enabled: !!resultSetId, queryFn: async () => (await api.get<AtRisk>(`${AN}/at-risk/${resultSetId}`, { params: passMark ? { passMark } : {} })).data });
}
export function useStudentTrend(studentProfileId: string | undefined) {
  return useQuery({ queryKey: ['school', 'analytics', 'trend', studentProfileId], enabled: !!studentProfileId, queryFn: async () => (await api.get<StudentTrend>(`${AN}/student-trend/${studentProfileId}`)).data });
}
export function useAssignmentMetrics(classId: string | undefined, termId: string | undefined) {
  return useQuery({ queryKey: ['school', 'analytics', 'assignment-metrics', classId, termId], enabled: !!(classId && termId), queryFn: async () => (await api.get<AssignmentMetrics>(`${AN}/assignment-metrics/${classId}/term/${termId}`)).data });
}
export function useExamAttendance(examId: string | undefined) {
  return useQuery({ queryKey: ['school', 'analytics', 'exam-attendance', examId], enabled: !!examId, queryFn: async () => (await api.get<ExamAttendance>(`${AN}/exam-attendance/${examId}`)).data });
}

/* ── A8 Portals (student / parent / teacher) + Promotion gate ─────────────── */

const POR = `${S}/portals`;
const PRO = `${S}/promotion`;

export interface StudentPortal {
  studentProfileId: string;
  timetable: unknown[];
  attendance: unknown[];
  grades: unknown[];
  assignments: Array<{ id: string; title: string; dueAt?: string | null; status: string }>;
  announcements: unknown[];
  publishedResults?: { termId: string; meanPercent?: number | null; classRank?: number | null; promotionRecommendation?: string | null } | null;
  certificates?: Array<{ id: string; type: string; title: string; code?: string | null; status: string }>;
}
export interface TeacherPortal {
  teacherPartnerId: string;
  timetable: unknown[];
  classes: unknown[];
  markingQueue: Array<{ id: string; title: string; pending: number }>;
  submissions: unknown[];
}
export interface PromotionPlanEntry { studentProfileId: string; fromClassId?: string | null; toClassId?: string | null; outcome: string; reason?: string | null }

export function useStudentPortal(studentProfileId: string | undefined) {
  return useQuery({ queryKey: ['school', 'portal-student', studentProfileId], enabled: !!studentProfileId, queryFn: async () => (await api.get<StudentPortal>(`${POR}/student/${studentProfileId}`)).data });
}
export function useTeacherPortal(teacherPartnerId: string | undefined) {
  return useQuery({ queryKey: ['school', 'portal-teacher', teacherPartnerId], enabled: !!teacherPartnerId, queryFn: async () => (await api.get<TeacherPortal>(`${POR}/teacher/${teacherPartnerId}`)).data });
}
export function useRolloverPlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: { fromTermId: string; toTermId: string; dryRun?: boolean }) => (await api.post<{ plan: PromotionPlanEntry[]; dryRun: boolean }>(`${PRO}/rollover`, dto)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['school', 'rollover'] }),
  });
}
