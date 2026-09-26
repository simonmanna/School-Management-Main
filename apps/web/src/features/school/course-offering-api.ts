import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

const ROOT = '/school/course-offerings';

export type OfferingType = 'SUBJECT' | 'LEARNING_AREA' | 'COMPETENCY' | 'SCHOOL_WIDE' | 'CO_CURRICULAR' | 'REMEDIAL' | 'CLUB_OR_HOUSE';
export type AudienceScope = 'COHORT' | 'SECTION' | 'STREAM' | 'CUSTOM' | 'SCHOOL';
export type OfferingStatus = 'DRAFT' | 'STAFFED' | 'ROSTER_READY' | 'PUBLISHED' | 'ACTIVE' | 'CLOSED' | 'ARCHIVED';

export interface CourseOffering {
  id: string; code: string; name: string; academicYearId: string; termId: string;
  programmeId: string | null; classCohortId: string | null; classId: string | null;
  offeringType: OfferingType; audienceScope: AudienceScope; subjectId: string | null;
  sectionId: string | null; curriculumId: string | null;
  competencyId: string | null; activityDefinitionId: string | null; status: OfferingStatus;
  effectiveFrom: string; effectiveTo: string | null; summary: string | null;
  subject?: { id: string; name: string; code: string } | null;
  programme?: { id: string; name: string; code: string } | null;
  term?: { id: string; name: string };
  classCohort?: { id: string; schoolClass?: { id: string; name: string } } | null;
  section?: { id: string; name: string } | null;
  curriculum?: { id: string; name: string; version: number; status: string } | null;
  competency?: { id: string; code: string; description?: string } | null;
  teachers: Array<{ id: string; teacherPartnerId: string; role: string; isResponsible: boolean; effectiveTo: string | null; teacher?: { partner?: { name?: string } } }>;
  _count: { courseEnrollments: number; timetableSlots: number };
  readiness: { checks: Record<string, boolean>; readyToPublish: boolean };
  /**
   * Learners who hold a seat in this offering's audience but are not on its
   * course roster. Placement reconciles compulsory rosters automatically, so a
   * non-zero count means an elective, an offering created after the class was
   * filled, or a deliberate opt-out — either way, something to see before
   * capturing an assessment roster from it.
   */
  rosterDrift?: number;
}

export interface OfferingInput {
  code?: string; name: string; academicYearId: string; termId: string; programmeId: string;
  classCohortId?: string; offeringType: OfferingType; audienceScope: AudienceScope;
  subjectId?: string; sectionId?: string; curriculumId?: string;
  competencyId?: string; activityDefinitionId?: string; effectiveFrom: string; effectiveTo?: string;
  summary?: string; teachers?: Array<{ teacherPartnerId: string; role?: string; isResponsible?: boolean }>;
}

const invalidate = (qc: ReturnType<typeof useQueryClient>) => qc.invalidateQueries({ queryKey: ['school', 'course-offerings'] });

export function useCanonicalCourseOfferings(filters: Record<string, string | undefined> = {}) {
  return useQuery({ queryKey: ['school', 'course-offerings', filters], queryFn: async () => (await api.get<CourseOffering[]>(ROOT, { params: filters })).data });
}
export function useCourseOffering(id?: string) {
  return useQuery({ queryKey: ['school', 'course-offerings', id], enabled: !!id, queryFn: async () => (await api.get<CourseOffering>(`${ROOT}/${id}`)).data });
}
export function useCreateCanonicalOffering() {
  const qc = useQueryClient(); return useMutation({ mutationFn: async (dto: OfferingInput) => (await api.post<CourseOffering>(ROOT, dto)).data, onSuccess: () => invalidate(qc) });
}
export function useTransitionOffering() {
  const qc = useQueryClient(); return useMutation({ mutationFn: async ({ id, toStatus }: { id: string; toStatus: OfferingStatus }) => (await api.post(`${ROOT}/${id}/transition`, { toStatus })).data, onSuccess: () => invalidate(qc) });
}
export function useAllocateOfferingTeacher() {
  const qc = useQueryClient(); return useMutation({ mutationFn: async ({ id, ...dto }: { id: string; teacherPartnerId: string; role: string; isResponsible?: boolean; replacedTeacherId?: string; effectiveFrom?: string; effectiveTo?: string }) => (await api.post(`${ROOT}/${id}/teachers`, dto)).data, onSuccess: () => invalidate(qc) });
}
export function useEndOfferingTeacher() {
  const qc = useQueryClient(); return useMutation({ mutationFn: async ({ id, teacherId }: { id: string; teacherId: string }) => (await api.delete(`${ROOT}/${id}/teachers/${teacherId}`)).data, onSuccess: () => invalidate(qc) });
}
export function useOfferingRoster(id?: string) {
  return useQuery({ queryKey: ['school', 'course-offerings', id, 'roster'], enabled: !!id, queryFn: async () => (await api.get<any[]>(`${ROOT}/${id}/roster`)).data });
}
export function useSyncOfferingRoster() {
  const qc = useQueryClient(); return useMutation({ mutationFn: async ({ id, includeElectives = false }: { id: string; includeElectives?: boolean }) => (await api.post(`${ROOT}/${id}/roster/sync`, { includeElectives })).data, onSuccess: (_d, v) => { invalidate(qc); qc.invalidateQueries({ queryKey: ['school', 'course-offerings', v.id, 'roster'] }); } });
}
export function useSetCourseEnrollment() {
  const qc = useQueryClient(); return useMutation({ mutationFn: async ({ id, ...dto }: { id: string; studentEnrollmentId: string; source: string; status?: string; withdrawalReason?: string }) => (await api.post(`${ROOT}/${id}/enrollments`, dto)).data, onSuccess: (_d, v) => { invalidate(qc); qc.invalidateQueries({ queryKey: ['school', 'course-offerings', v.id, 'roster'] }); } });
}
export function useBulkGenerateOfferings() {
  const qc = useQueryClient(); return useMutation({ mutationFn: async (dto: { academicYearId: string; termId: string; classCohortIds: string[]; includeElectives?: boolean }) => (await api.post(`${ROOT}/actions/bulk-generate`, dto)).data, onSuccess: () => invalidate(qc) });
}
export function useMigrateTeacherAssignments() {
  const qc = useQueryClient(); return useMutation({ mutationFn: async (dto: { termId?: string; dryRun?: boolean }) => (await api.post(`${ROOT}/actions/migrate-teacher-assignments`, dto)).data, onSuccess: () => invalidate(qc) });
}
export function useRolloverOffering() {
  const qc = useQueryClient(); return useMutation({ mutationFn: async ({ id, ...dto }: { id: string; academicYearId: string; termId: string; classCohortId?: string; curriculumId?: string; copyTeachers?: boolean; syncRoster?: boolean }) => (await api.post(`${ROOT}/${id}/rollover`, dto)).data, onSuccess: () => invalidate(qc) });
}
