import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

/**
 * Phase 3 — the teacher's course workspace.
 *
 * Backend controller: `/school/teaching`. Every route is scoped to a course
 * offering and checked against the caller's teaching allocation server-side, so
 * these hooks never send a teacher id as proof of identity.
 */
const ROOT = '/school/teaching';

export type DeliveryStatus = 'in_progress' | 'delivered' | 'partially_delivered' | 'cancelled';
export type EvidenceKind = 'ASSESSMENT' | 'ASSIGNMENT' | 'RESOURCE' | 'OBSERVATION' | 'NOTE' | 'LINK';
export type FollowUpStatus = 'open' | 'in_progress' | 'done' | 'cancelled';
export type OutcomeState = 'not_planned' | 'planned' | 'delivered' | 'assessed';

export interface MyCourse {
  id: string; code: string; name: string; status: string; termId: string;
  subject?: { id: string; name: string } | null;
  section?: { name: string } | null;
  stream?: { name: string } | null;
  classCohort?: { schoolClass?: { name: string } } | null;
  term?: { id: string; name: string };
  _count: { courseEnrollments: number; lessonPlans: number };
}

export interface SchemeWeek {
  id: string; weekNumber: number; weekStart: string | null; theme: string | null;
  plannedPeriods: number; notes: string | null;
  items: Array<{
    id: string; title: string; order: number; plannedPeriods: number;
    topicId: string | null; learningOutcomeId: string | null;
    learningOutcome?: { id: string; title: string } | null;
  }>;
  lessonPlans: Array<{ id: string; title: string; workflowStatus: string; weekOf: string; delivered: boolean }>;
}

export interface SchemeOfWork {
  id: string; title: string; status: string; summary: string | null; courseOfferingId: string;
  weeks: SchemeWeek[];
  progress: {
    weeks: Array<{ weekNumber: number; plannedPeriods: number; items: number; plans: number; deliveredPlans: number; state: 'covered' | 'partial' | 'planned' | 'open' }>;
    totalWeeks: number; totalPlannedPeriods: number; coveredWeeks: number; partialWeeks: number; coveragePct: number;
  };
}

export interface LessonDelivery {
  id: string; status: DeliveryStatus; completedAt: string | null; reflectedAt: string | null;
  coveredContent: string | null; varianceReason: string | null; participationNote: string | null;
  whatWorked: string | null; whatDidntWork: string | null; studentsNeedingSupport: string | null; followUpNote: string | null;
  attendanceDate: string | null; attendanceMarked: boolean; presentCount: number | null; absentCount: number | null;
  evidence: Array<{ id: string; kind: EvidenceKind; note: string | null; url: string | null; assessmentId: string | null }>;
  followUps: Array<{ id: string; action: string; status: FollowUpStatus }>;
}

export interface ScheduledLesson {
  id: string; plannedDate: string; status: string; room: string | null; lessonPlanId: string | null;
  delivery: LessonDelivery | null;
  lessonPlan?: { id: string; title: string; workflowStatus: string; schemeOfWorkWeekId: string | null } | null;
}

export interface TeachingWeek {
  offering: { id: string; name: string; code: string; status: string; subject: string | null; className: string | null; section: string | null; stream: string | null; termId: string };
  weekStart: string; weekEnd: string;
  timetable: Array<{ id: string; dayOfWeek: number; room: string | null; period?: { id: string; name: string; startTime?: string } }>;
  lessons: ScheduledLesson[];
  plans: Array<{ id: string; title: string; workflowStatus: string; weekOf: string; schemeOfWorkWeekId: string | null }>;
  schemeWeek: SchemeWeek | null;
  stats: { scheduled: number; delivered: number; cancelled: number; outstanding: number; deliveryPct: number };
}

export interface WorkspaceOverview {
  offering: {
    id: string; code: string; name: string; status: string; offeringType: string;
    subject: string | null; className: string | null; section: string | null; stream: string | null;
    term: { id: string; name: string; startDate: string; endDate: string };
    curriculum: { id: string; name: string; version: number; status: string } | null;
    teachers: Array<{ id: string; name: string; role: string; isResponsible: boolean }>;
  };
  delivery: { scheduled: number; delivered: number; cancelled: number; outstanding: number; deliveryPct: number };
  lessonsNeedingPlan: number; lessonsNeedingReflection: number;
  plans: Record<string, number>;
  openFollowUps: number; learners: number; resources: number; assessments: number;
  scheme: { id: string; title: string; status: string; progress: SchemeOfWork['progress'] } | null;
  upcoming: Array<{ id: string; plannedDate: string; status: string; lessonPlanId: string | null }>;
}

export interface CoverageReport {
  outcomes: Array<{ id: string; title: string; expectedLevel: string | null; schemeWeeks: number[]; planned: boolean; delivered: boolean; assessed: boolean; state: OutcomeState }>;
  totals: { total: number; planned: number; delivered: number; assessed: number; notPlanned: number; plannedPct: number; deliveredPct: number; assessedPct: number };
  scheme: { id: string; title: string; status: string; progress: SchemeOfWork['progress'] } | null;
  unmapped?: string;
}

export interface CourseLearner {
  courseEnrollmentId: string; studentProfileId: string; studentEnrollmentId: string;
  name: string; admissionNumber: string | null; source: string; status: string;
  section: string | null; stream: string | null;
  attendancePct: number | null; attendanceMarkedDays: number; openFollowUps: number;
}

export interface FollowUp {
  id: string; courseOfferingId: string; action: string; status: FollowUpStatus;
  dueDate: string | null; resolvedAt: string | null; resolutionNote: string | null;
  studentProfileId: string | null; lessonDeliveryId: string | null;
  courseOffering?: { id: string; name: string; code: string };
}

const key = (offeringId: string | undefined, ...rest: string[]) => ['school', 'teaching', offeringId ?? 'none', ...rest];

function useInvalidate(offeringId?: string) {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ['school', 'teaching'] , predicate: (q) => !offeringId || (q.queryKey as string[])[2] === offeringId || (q.queryKey as string[])[2] === 'none' });
}

// ───────────────────────── Courses ─────────────────────────

export function useMyCourses(params: { teacherPartnerId?: string; termId?: string } = {}) {
  return useQuery({
    queryKey: ['school', 'teaching', 'my-courses', params],
    queryFn: async () => (await api.get<MyCourse[]>(`${ROOT}/my-courses`, { params })).data,
  });
}

export function useWorkspaceOverview(offeringId?: string) {
  return useQuery({
    queryKey: key(offeringId, 'overview'),
    enabled: !!offeringId,
    queryFn: async () => (await api.get<WorkspaceOverview>(`${ROOT}/offerings/${offeringId}/overview`)).data,
  });
}

export function useCourseCoverage(offeringId?: string) {
  return useQuery({
    queryKey: key(offeringId, 'coverage'),
    enabled: !!offeringId,
    queryFn: async () => (await api.get<CoverageReport>(`${ROOT}/offerings/${offeringId}/coverage`)).data,
  });
}

export function useCourseLearners(offeringId?: string) {
  return useQuery({
    queryKey: key(offeringId, 'learners'),
    enabled: !!offeringId,
    queryFn: async () => (await api.get<CourseLearner[]>(`${ROOT}/offerings/${offeringId}/learners`)).data,
  });
}

export function useCourseAssessments(offeringId?: string) {
  return useQuery({
    queryKey: key(offeringId, 'assessments'),
    enabled: !!offeringId,
    queryFn: async () => (await api.get<any[]>(`${ROOT}/offerings/${offeringId}/assessments`)).data,
  });
}

export function useCourseOutcomeOptions(offeringId?: string) {
  return useQuery({
    queryKey: key(offeringId, 'outcome-options'),
    enabled: !!offeringId,
    queryFn: async () => (await api.get<Array<{ id: string; title: string; topic?: { title: string } | null }>>(`${ROOT}/offerings/${offeringId}/outcomes`)).data,
  });
}

// ───────────────────────── Resources ─────────────────────────

export function useCourseResources(offeringId?: string) {
  return useQuery({
    queryKey: key(offeringId, 'resources'),
    enabled: !!offeringId,
    queryFn: async () => (await api.get<any[]>(`${ROOT}/offerings/${offeringId}/resources`)).data,
  });
}

/**
 * The resource library to attach from. Lives here rather than in the school API
 * module because the teaching workspace is its only consumer today.
 */
export function useLearningResourceLibrary(params: { classId?: string; subjectId?: string } = {}) {
  return useQuery({
    queryKey: ['school', 'learning-resources', params],
    queryFn: async () => (await api.get<any>('/school/learning-resources', { params })).data,
  });
}

export function useAttachCourseResource(offeringId?: string) {
  const invalidate = useInvalidate(offeringId);
  return useMutation({
    mutationFn: async (dto: { learningResourceId: string; visibleToLearners?: boolean; order?: number }) =>
      (await api.post(`${ROOT}/offerings/${offeringId}/resources`, dto)).data,
    onSuccess: invalidate,
  });
}

export function useDetachCourseResource(offeringId?: string) {
  const invalidate = useInvalidate(offeringId);
  return useMutation({
    mutationFn: async (learningResourceId: string) =>
      (await api.delete(`${ROOT}/offerings/${offeringId}/resources/${learningResourceId}`)).data,
    onSuccess: invalidate,
  });
}

// ───────────────────────── Scheme of work ─────────────────────────

export function useSchemeOfWork(offeringId?: string) {
  return useQuery({
    queryKey: key(offeringId, 'scheme'),
    enabled: !!offeringId,
    queryFn: async () => (await api.get<SchemeOfWork | null>(`${ROOT}/offerings/${offeringId}/scheme`)).data,
  });
}

export function useCreateSchemeOfWork(offeringId?: string) {
  const invalidate = useInvalidate(offeringId);
  return useMutation({
    mutationFn: async (dto: { courseOfferingId: string; title?: string; summary?: string; generateWeeksFromTerm?: boolean }) =>
      (await api.post<SchemeOfWork>(`${ROOT}/schemes`, dto)).data,
    onSuccess: invalidate,
  });
}

export function useUpdateSchemeOfWork(offeringId?: string) {
  const invalidate = useInvalidate(offeringId);
  return useMutation({
    mutationFn: async ({ id, ...dto }: { id: string; title?: string; summary?: string; status?: string }) =>
      (await api.patch<SchemeOfWork>(`${ROOT}/schemes/${id}`, dto)).data,
    onSuccess: invalidate,
  });
}

export function useAddSchemeWeek(offeringId?: string) {
  const invalidate = useInvalidate(offeringId);
  return useMutation({
    mutationFn: async ({ id, ...dto }: { id: string; weekNumber?: number; weekStart?: string; theme?: string; plannedPeriods?: number; notes?: string }) =>
      (await api.post<SchemeOfWork>(`${ROOT}/schemes/${id}/weeks`, dto)).data,
    onSuccess: invalidate,
  });
}

export function useUpdateSchemeWeek(offeringId?: string) {
  const invalidate = useInvalidate(offeringId);
  return useMutation({
    mutationFn: async ({ weekId, ...dto }: { weekId: string; weekNumber?: number; weekStart?: string; theme?: string; plannedPeriods?: number; notes?: string }) =>
      (await api.patch<SchemeOfWork>(`${ROOT}/scheme-weeks/${weekId}`, dto)).data,
    onSuccess: invalidate,
  });
}

export function useRemoveSchemeWeek(offeringId?: string) {
  const invalidate = useInvalidate(offeringId);
  return useMutation({
    mutationFn: async (weekId: string) => (await api.delete<SchemeOfWork>(`${ROOT}/scheme-weeks/${weekId}`)).data,
    onSuccess: invalidate,
  });
}

export function useAddSchemeItem(offeringId?: string) {
  const invalidate = useInvalidate(offeringId);
  return useMutation({
    mutationFn: async ({ weekId, ...dto }: { weekId: string; title: string; topicId?: string; learningOutcomeId?: string; plannedPeriods?: number; order?: number }) =>
      (await api.post<SchemeOfWork>(`${ROOT}/scheme-weeks/${weekId}/items`, dto)).data,
    onSuccess: invalidate,
  });
}

export function useRemoveSchemeItem(offeringId?: string) {
  const invalidate = useInvalidate(offeringId);
  return useMutation({
    mutationFn: async (itemId: string) => (await api.delete<SchemeOfWork>(`${ROOT}/scheme-items/${itemId}`)).data,
    onSuccess: invalidate,
  });
}

// ───────────────────────── Weekly delivery ─────────────────────────

export function useTeachingWeek(offeringId?: string, weekStart?: string) {
  return useQuery({
    queryKey: key(offeringId, 'week', weekStart ?? 'current'),
    enabled: !!offeringId,
    queryFn: async () => (await api.get<TeachingWeek>(`${ROOT}/week`, { params: { courseOfferingId: offeringId, weekStart } })).data,
  });
}

export function useGenerateTeachingWeek(offeringId?: string) {
  const invalidate = useInvalidate(offeringId);
  return useMutation({
    mutationFn: async (dto: { courseOfferingId: string; weekStart: string }) =>
      (await api.post<{ created: number; existing: number; weekStart: string }>(`${ROOT}/week/generate`, dto)).data,
    onSuccess: invalidate,
  });
}

export function useUpdateScheduledLesson(offeringId?: string) {
  const invalidate = useInvalidate(offeringId);
  return useMutation({
    mutationFn: async ({ id, ...dto }: { id: string; lessonPlanId?: string; status?: string; plannedDate?: string }) =>
      (await api.patch<ScheduledLesson>(`${ROOT}/lessons/${id}`, dto)).data,
    onSuccess: invalidate,
  });
}

export function useDeliverLesson(offeringId?: string) {
  const invalidate = useInvalidate(offeringId);
  return useMutation({
    mutationFn: async ({ id, ...dto }: {
      id: string; status?: DeliveryStatus; coveredContent?: string; varianceReason?: string;
      participationNote?: string; attendanceDate?: string; attendancePeriodId?: string;
    }) => (await api.post<ScheduledLesson>(`${ROOT}/lessons/${id}/deliver`, dto)).data,
    onSuccess: invalidate,
  });
}

export function useReflectOnLesson(offeringId?: string) {
  const invalidate = useInvalidate(offeringId);
  return useMutation({
    mutationFn: async ({ id, ...dto }: { id: string; whatWorked?: string; whatDidntWork?: string; studentsNeedingSupport?: string; followUpNote?: string }) =>
      (await api.post<ScheduledLesson>(`${ROOT}/lessons/${id}/reflect`, dto)).data,
    onSuccess: invalidate,
  });
}

export function useAddLessonEvidence(offeringId?: string) {
  const invalidate = useInvalidate(offeringId);
  return useMutation({
    mutationFn: async ({ id, ...dto }: { id: string; kind: EvidenceKind; assessmentId?: string; learningResourceId?: string; learningOutcomeId?: string; url?: string; note?: string }) =>
      (await api.post<ScheduledLesson>(`${ROOT}/lessons/${id}/evidence`, dto)).data,
    onSuccess: invalidate,
  });
}

export function useRemoveLessonEvidence(offeringId?: string) {
  const invalidate = useInvalidate(offeringId);
  return useMutation({
    mutationFn: async (evidenceId: string) => (await api.delete(`${ROOT}/evidence/${evidenceId}`)).data,
    onSuccess: invalidate,
  });
}

// ───────────────────────── Follow-up ─────────────────────────

export function useFollowUps(params: { courseOfferingId?: string; status?: string; studentProfileId?: string } = {}) {
  return useQuery({
    queryKey: key(params.courseOfferingId, 'follow-ups', params.status ?? 'all', params.studentProfileId ?? 'all'),
    enabled: !!params.courseOfferingId,
    queryFn: async () => (await api.get<FollowUp[]>(`${ROOT}/follow-ups`, { params })).data,
  });
}

export function useCreateFollowUp(offeringId?: string) {
  const invalidate = useInvalidate(offeringId);
  return useMutation({
    mutationFn: async (dto: { courseOfferingId: string; action: string; studentProfileId?: string; lessonDeliveryId?: string; learningOutcomeId?: string; dueDate?: string }) =>
      (await api.post<FollowUp>(`${ROOT}/follow-ups`, dto)).data,
    onSuccess: invalidate,
  });
}

export function useUpdateFollowUp(offeringId?: string) {
  const invalidate = useInvalidate(offeringId);
  return useMutation({
    mutationFn: async ({ id, ...dto }: { id: string; status?: FollowUpStatus; action?: string; dueDate?: string; resolutionNote?: string }) =>
      (await api.patch<FollowUp>(`${ROOT}/follow-ups/${id}`, dto)).data,
    onSuccess: invalidate,
  });
}

// ───────────────────────── Plan ↔ curriculum links ─────────────────────────

export function useSetPlanOutcomes(offeringId?: string) {
  const invalidate = useInvalidate(offeringId);
  return useMutation({
    mutationFn: async ({ id, learningOutcomeIds }: { id: string; learningOutcomeIds: string[] }) =>
      (await api.post(`${ROOT}/lesson-plans/${id}/outcomes`, { learningOutcomeIds })).data,
    onSuccess: invalidate,
  });
}

export function useSetPlanSchemeWeek(offeringId?: string) {
  const invalidate = useInvalidate(offeringId);
  return useMutation({
    mutationFn: async ({ id, schemeOfWorkWeekId }: { id: string; schemeOfWorkWeekId?: string }) =>
      (await api.post(`${ROOT}/lesson-plans/${id}/scheme-week`, { schemeOfWorkWeekId })).data,
    onSuccess: invalidate,
  });
}
