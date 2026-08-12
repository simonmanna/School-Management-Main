/**
 * School feature API client.
 * Wraps every /school/* endpoint as typed React Query hooks.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

// ── Shared types ───────────────────────────────────────────────────────────
export type Student = {
  id: string;
  admissionNo: string;
  currentClass?: { name: string };
  status: 'active' | 'suspended' | 'transferred' | 'withdrawn' | 'alumni';
  enrollmentDate: string;
};
export type Staff = {
  id: string;
  employeeNo: string;
  department?: { name: string };
  status: string;
};
export type Campus = { id: string; code: string; name: string; isActive: boolean };
export type AcademicYear = { id: string; name: string; startDate: string; endDate: string; isCurrent: boolean };
export type Term = { id: string; name: string; startDate: string; endDate: string; isCurrent: boolean };
export type Class = { id: string; name: string; gradeLevel?: { name: string } };
export type Subject = { id: string; code: string; name: string };
export type GradeLevel = { id: string; name: string; order: number };
export type FeeStructure = { id: string; name: string; components: Array<{ code: string; amount: number }> };
export type FeeSchedule = { id: string; termId: string; feeStructureId: string; dueDate: string };
export type Exam = { id: string; name: string; status: string; startDate: string; endDate: string };
export type ExamSchedule = { id: string; examId: string; classId: string; subjectId: string; date: string; maxMarks: number };
export type GradeEntry = { id: string; studentProfileId: string; marksObtained: number; grade: string; gradePoint: number };
export type Announcement = { id: string; title: string; body: string; publishedAt: string | null };

// ── Generic list helper ───────────────────────────────────────────────────
function list<T>(path: string, params?: Record<string, unknown>) {
  return useQuery({
    queryKey: ['school', path, params],
    queryFn: async () => {
      const r = await api.get(path, { params });
      return r.data.data as T[];
    },
  });
}

function one<T>(path: string) {
  return useQuery({
    queryKey: ['school', path],
    queryFn: async () => {
      const r = await api.get(path);
      return r.data as T;
    },
  });
}

function post<TVars, TRet>(path: string, invalidateKeys: string[][] = []) {
  return () => {
    const qc = useQueryClient();
    return useMutation({
      mutationFn: async (vars: TVars) => (await api.post<TRet>(path, vars)).data,
      onSuccess: () => invalidateKeys.forEach((k) => qc.invalidateQueries({ queryKey: k })),
    });
  };
}

function patch<TVars, TRet>(path: string, invalidateKeys: string[][] = []) {
  return (id: string) => {
    const qc = useQueryClient();
    return useMutation({
      mutationFn: async (vars: TVars) => (await api.patch<TRet>(`${path}/${id}`, vars)).data,
      onSuccess: () => invalidateKeys.forEach((k) => qc.invalidateQueries({ queryKey: k })),
    });
  };
}

// ── Foundation ────────────────────────────────────────────────────────────
export const useOverview = () => one<{
  students: number; staff: number; campuses: number; classes: number;
  terms: number; sections: number; outstandingFees: number;
}>('/school/overview');

export const useProfile = () => one<{ name: string; motto: string; country: string; currencyCode: string; educationLevel: string; gradingSystem: string }>('/school/profile');

export const useCampuses = () => list<Campus>('/school/campuses');
export const useAcademicYears = () => list<AcademicYear>('/school/academic-years');
export const useTerms = () => list<Term>('/school/terms');
export const useCurrentTerm = () => one<Term>('/school/terms/current');
export const useGradeLevels = () => list<GradeLevel>('/school/grade-levels');
export const useClasses = () => list<Class>('/school/classes');
export const useSubjects = () => list<Subject>('/school/subjects');
export const useCalendar = () => list<{ id: string; title: string; type: string; startDate: string; endDate: string }>('/school/calendar');

// ── People ────────────────────────────────────────────────────────────────
export const useStudents = (params?: { page?: number; pageSize?: number; search?: string }) =>
  useQuery({
    queryKey: ['school', '/school/students', params],
    queryFn: async () => (await api.get('/school/students', { params })).data,
  });
export const useStudentsByClass = (classId: string) =>
  useQuery({
    queryKey: ['school', '/school/students/by-class', classId],
    queryFn: async () => (await api.get(`/school/students/by-class/${classId}`)).data as Student[],
    enabled: !!classId,
  });
export const useStudentStatement = (id: string) =>
  one<any>(`/school/students/${id}/statement`);
export const useCreateStudent = post<any, any>('/school/students', [['school', '/school/students']]);
export const useUpdateStudent = patch<any, any>('/school/students', [['school', '/school/students']]);
export const useBulkImportStudents = post<{ rows: Array<Record<string, string>> }, { created: number; skipped: number }>(
  '/school/students/bulk-import',
  [['school', '/school/students']],
);

export const useStaff = () => list<Staff>('/school/staff');
export const useCreateStaff = post<any, any>('/school/staff', [['school', '/school/staff']]);

// ── Attendance ────────────────────────────────────────────────────────────
export const useMarkAttendance = post<any, { present: number; absent: number; late: number }>(
  '/school/attendance/mark',
  [['school', '/school/attendance']],
);
export const useDailyRegister = (classId: string, date: string) =>
  useQuery({
    queryKey: ['school', 'register', classId, date],
    queryFn: async () => (await api.get('/school/attendance/register', { params: { classId, date } })).data,
    enabled: !!classId && !!date,
  });

// ── Examinations ──────────────────────────────────────────────────────────
export const useExams = () => list<Exam>('/school/exams');
export const useExamSchedules = () => list<ExamSchedule>('/school/exam-schedules');
export const useGradeEntries = (examScheduleId: string) =>
  useQuery({
    queryKey: ['school', 'grades', examScheduleId],
    queryFn: async () => (await api.get(`/school/grades/by-class/${examScheduleId}`)).data,
    enabled: !!examScheduleId,
  });
export const useBulkUpsertGrades = post<any, any>('/school/grades/bulk-upsert', [['school', 'grades']]);
export const useApproveGrades = post<any, any>('/school/grades/approve/', [['school', 'grades']]);
export const useGenerateReportCard = post<any, any>('/school/report-cards/generate', []);

// ── Fees ──────────────────────────────────────────────────────────────────
export const useFeeStructures = () => list<FeeStructure>('/school/fee-structures');
export const useFeeSchedules = () => list<FeeSchedule>('/school/fee-schedules');
export const useGenerateBilling = post<{ termId: string; classId?: string }, { count: number }>(
  '/school/billing/generate',
  [['school', '/school/fee-schedules']],
);
export const usePenaltyRun = post<{ scheduleId: string }, any>('/school/billing/penalty-run/', []);
export const useCollectPayment = post<any, any>('/school/payments/collect', [['school', '/school/fee-schedules']]);

// ── Communication ────────────────────────────────────────────────────────
export const useAnnouncements = () => list<Announcement>('/school/announcements');
export const useCreateAnnouncement = post<any, any>('/school/announcements', [['school', '/school/announcements']]);

// ── Reports ───────────────────────────────────────────────────────────────
export const useAdminDashboard = () => one<any>('/school/reports/admin');
export const useAcademicDashboard = () => one<any>('/school/reports/academic');
export const useFinanceDashboard = () => one<any>('/school/reports/finance');
export const useOperationalDashboard = () => one<any>('/school/reports/operational');
export const useOutstandingByClass = () => one<any>('/school/reports/outstanding-by-class');
export const useTopPerformers = (limit = 10) => one<any>(`/school/reports/top-performers?limit=${limit}`);

// ── Portals ───────────────────────────────────────────────────────────────
export const useParentPortal = (studentProfileIds: string[]) =>
  useQuery({
    queryKey: ['portal', 'parent', studentProfileIds],
    queryFn: async () => (await api.get(`/school/portals/parent/${studentProfileIds.join(',')}`)).data,
    enabled: studentProfileIds.length > 0,
  });
export const useStudentPortal = (studentProfileId: string) =>
  one<any>(`/school/portals/student/${studentProfileId}`);
export const useTeacherPortal = (teacherPartnerId: string) =>
  one<any>(`/school/portals/teacher/${teacherPartnerId}`);