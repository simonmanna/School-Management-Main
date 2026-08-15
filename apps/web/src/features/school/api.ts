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
