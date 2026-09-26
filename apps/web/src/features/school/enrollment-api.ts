import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

/**
 * Phase 1 — canonical enrollment and placement (ADR-018 / ADR-019).
 *
 * Everything here talks to the canonical membership (`/school/student-enrollments`)
 * and the append-only placement history (`/school/placements`). The legacy
 * per-term `/school/enrollments` routes, streams-as-a-separate-model and the
 * one-off enrollment migration are gone from the API (ADR-029: a class's
 * subdivisions are its Sections), so nothing here may reference them — the
 * route-inventory spec (`apps/api/test/unit/web-api-contract.spec.ts`) fails
 * the build if a URL here has no controller behind it.
 */

const S = '/school';

/* ─────────────────────────────── Types ─────────────────────────────── */

export type ProgrammeStage =
  | 'PRE_PRIMARY'
  | 'PRIMARY'
  | 'PRIMARY_LOWER'
  | 'PRIMARY_UPPER'
  | 'LOWER_SECONDARY'
  | 'ADVANCED_SECONDARY'
  | 'OTHER';

export type EnrollmentStatus =
  | 'PENDING'
  | 'ACTIVE'
  | 'SUSPENDED'
  | 'WITHDRAWN'
  | 'TRANSFERRED'
  | 'COMPLETED'
  | 'CANCELLED';

export type EnrollmentTypeValue = 'NEW' | 'CONTINUING' | 'REPEAT' | 'TRANSFER_IN' | 'RE_ENTRY';

export type MovementReason =
  | 'INITIAL_PLACEMENT'
  | 'TERM_ROLLOVER'
  | 'CLASS_CHANGE'
  | 'SECTION_CHANGE'
  | 'STREAM_CHANGE'
  | 'PROMOTION'
  | 'REPEAT'
  | 'LATE_ADMISSION'
  | 'TRANSFER_IN'
  | 'TRANSFER_OUT'
  | 'WITHDRAWAL'
  | 'RE_ENTRY'
  | 'SUSPENSION'
  | 'COMPLETION'
  | 'CORRECTION'
  | 'BACKFILL';

export interface Programme {
  id: string;
  code: string;
  name: string;
  stage: ProgrammeStage;
  curriculumAuthority?: string | null;
  description?: string | null;
  effectiveFrom: string;
  effectiveTo?: string | null;
  isActive: boolean;
  config: Record<string, unknown>;
  gradeLevels?: Array<{ id: string; gradeLevelId: string; gradeLevel?: { id: string; name: string; order: number } }>;
  _count?: { cohorts: number; enrollments: number };
}

export interface ClassCohort {
  id: string;
  academicYearId: string;
  classId: string;
  programmeId?: string | null;
  /** Per-year override of the class's `allowsStreams`; null follows the class (ADR-029). */
  allowsSubdivision?: boolean | null;
  capacity?: number | null;
  status: 'PLANNED' | 'ACTIVE' | 'CLOSED' | 'ARCHIVED';
  schoolClass?: { id: string; name: string; allowsStreams?: boolean; gradeLevel?: { id: string; name: string; order: number } };
  academicYear?: { id: string; name: string };
  programme?: { id: string; code: string; name: string } | null;
  _count?: { placements: number };
}

/** `GET /school/class-cohorts/:id/grouping-options` (class-cohort.service.ts `groupingOptions`). */
export interface GroupingOptions {
  cohortId: string;
  classId: string;
  className: string | null;
  academicYearId: string;
  /** Whether this class is divided this year (cohort override, else the class). */
  allowsSubdivision: boolean;
  /** Divided AND has active sections — a placement must then name one. */
  requiresSection: boolean;
  sections: Array<{ id: string; name: string; code?: string | null; capacity: number | null; classId: string; displayOrder?: number }>;
}

export interface Placement {
  id: string;
  enrollmentId: string;
  termId: string;
  classCohortId: string;
  sectionId: string | null;
  rollNumber: string | null;
  effectiveFrom: string;
  effectiveTo: string | null;
  movementReason: MovementReason;
  endReason: MovementReason | null;
  notes: string | null;
  changedById: string | null;
  term?: { id: string; name: string };
  classCohort?: { id: string; classId: string; schoolClass?: { id: string; name: string }; academicYear?: { id: string; name: string } };
  section?: { id: string; name: string } | null;
}

export interface StudentEnrollmentRow {
  id: string;
  studentProfileId: string;
  academicYearId: string;
  programmeId: string;
  gradeLevelId: string;
  admissionDate: string;
  completionDate: string | null;
  status: EnrollmentStatus;
  enrollmentType: EnrollmentTypeValue;
  notes: string | null;
  student?: { id: string; admissionNo: string; partner?: { id: string; name: string; phone?: string | null } | null };
  academicYear?: { id: string; name: string };
  programme?: { id: string; code: string; name: string; stage: ProgrammeStage };
  gradeLevel?: { id: string; name: string; order: number };
  currentPlacement?: Placement | null;
  placements?: Placement[];
  events?: Array<{
    id: string;
    fromStatus: EnrollmentStatus | null;
    toStatus: EnrollmentStatus;
    reason: string | null;
    changedAt: string;
  }>;
}

export interface RosterRow {
  placementId: string;
  enrollmentId: string;
  studentProfileId: string;
  admissionNo: string | null;
  name: string | null;
  enrollmentStatus: EnrollmentStatus;
  rollNumber: string | null;
  sectionId: string | null;
  sectionName: string | null;
  termId: string;
  effectiveFrom: string;
  effectiveTo: string | null;
}

export interface PlacementPreview {
  ok: boolean;
  errors: string[];
  warnings: string[];
  /** The target is full and capacity is enforced; committing needs an override. */
  needsCapacityOverride?: boolean;
  from: { placementId: string; classCohortId: string; sectionId: string | null; termId: string } | null;
  to: {
    cohortId: string;
    classId: string;
    termId: string;
    sectionId: string | null;
    warnings: string[];
  } | null;
}

export interface BulkPlacementResult {
  dryRun: boolean;
  committed: boolean;
  total: number;
  ok: number;
  failed: number;
  rows: Array<{
    enrollmentId: string;
    studentProfileId?: string;
    ok: boolean;
    errors: string[];
    warnings: string[];
    placementId?: string;
  }>;
}

/* ─────────────────────────── Foundation lookups ────────────────────── */

export interface GradeLevel {
  id: string;
  name: string;
  order: number;
}

/** Grade levels, ordered P1 → S6. Needed to map programmes onto the ladder. */
export function useGradeLevels() {
  return useQuery({
    queryKey: ['school', 'grade-levels'],
    queryFn: async () => {
      // The foundation endpoints are paginated, but a couple return a bare
      // array. Accept both rather than depending on which one this build has.
      const res = await api.get<{ data?: GradeLevel[] } | GradeLevel[]>(`${S}/grade-levels`, {
        params: { pageSize: 200 },
      });
      const body = res.data;
      const rows: GradeLevel[] = Array.isArray(body) ? body : (body?.data ?? []);
      return [...rows].sort((a, b) => a.order - b.order);
    },
  });
}

/* ───────────────────────────── Programmes ──────────────────────────── */

export function useProgrammes(includeInactive = false) {
  return useQuery({
    queryKey: ['school', 'programmes', includeInactive],
    queryFn: async () =>
      (await api.get<Programme[]>(`${S}/programmes`, { params: { includeInactive: includeInactive || undefined } })).data,
  });
}

export function useCreateProgramme() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: Partial<Programme> & { code: string; name: string; gradeLevelIds?: string[] }) =>
      (await api.post(`${S}/programmes`, dto)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['school', 'programmes'] }),
  });
}

export function useUpdateProgramme() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...dto }: { id: string } & Record<string, unknown>) =>
      (await api.patch(`${S}/programmes/${id}`, dto)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['school', 'programmes'] }),
  });
}

export function useSeedUgandaProgrammes() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: { linkGradeLevels?: boolean } = {}) =>
      (await api.post<{ created: string[]; updated: string[]; unmatchedGrades: string[] }>(`${S}/programmes/seed-uganda`, dto)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['school', 'programmes'] });
      qc.invalidateQueries({ queryKey: ['school', 'class-cohorts'] });
    },
  });
}

/* ──────────────────────────── Class cohorts ────────────────────────── */

export function useClassCohorts(params: { academicYearId?: string; classId?: string } = {}) {
  return useQuery({
    queryKey: ['school', 'class-cohorts', params],
    queryFn: async () => (await api.get<ClassCohort[]>(`${S}/class-cohorts`, { params })).data,
  });
}

export function useGroupingOptions(cohortId?: string) {
  return useQuery({
    queryKey: ['school', 'class-cohorts', cohortId, 'grouping'],
    enabled: !!cohortId,
    queryFn: async () => (await api.get<GroupingOptions>(`${S}/class-cohorts/${cohortId}/grouping-options`)).data,
  });
}

export function useGenerateCohorts() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: { academicYearId: string; classIds?: string[]; allowsSubdivision?: boolean | null }) =>
      (await api.post(`${S}/class-cohorts/generate`, dto)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['school', 'class-cohorts'] }),
  });
}

export function useUpdateCohort() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...dto }: { id: string } & Record<string, unknown>) =>
      (await api.patch(`${S}/class-cohorts/${id}`, dto)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['school', 'class-cohorts'] }),
  });
}

/* ──────────────────────────── Enrollments ──────────────────────────── */

export interface EnrollmentListParams {
  academicYearId?: string;
  programmeId?: string;
  status?: EnrollmentStatus;
  studentProfileId?: string;
  classCohortId?: string;
  search?: string;
  page?: number;
  pageSize?: number;
}

export function useStudentEnrollments(params: EnrollmentListParams = {}, enabled = true) {
  return useQuery({
    queryKey: ['school', 'student-enrollments', params],
    enabled,
    queryFn: async () =>
      (
        await api.get<{
          data: StudentEnrollmentRow[];
          meta: { page: number; pageSize: number; total: number; totalPages: number };
        }>(`${S}/student-enrollments`, { params })
      ).data,
  });
}

export function useStudentEnrollment(id?: string) {
  return useQuery({
    queryKey: ['school', 'student-enrollments', id],
    enabled: !!id,
    queryFn: async () => (await api.get<StudentEnrollmentRow>(`${S}/student-enrollments/${id}`)).data,
  });
}

export function useEnrollmentsForStudent(studentProfileId?: string) {
  return useQuery({
    queryKey: ['school', 'student-enrollments', 'by-student', studentProfileId],
    enabled: !!studentProfileId,
    queryFn: async () =>
      (await api.get<StudentEnrollmentRow[]>(`${S}/student-enrollments/by-student/${studentProfileId}`)).data,
  });
}

export function usePlacementHistory(enrollmentId?: string) {
  return useQuery({
    queryKey: ['school', 'student-enrollments', enrollmentId, 'placements'],
    enabled: !!enrollmentId,
    queryFn: async () => (await api.get<Placement[]>(`${S}/student-enrollments/${enrollmentId}/placements`)).data,
  });
}

/** Point-in-time placement: which class was this learner in on `at`? */
export function usePlacementAt(studentProfileId?: string, at?: string) {
  return useQuery({
    queryKey: ['school', 'placement-at', studentProfileId, at],
    enabled: !!studentProfileId,
    queryFn: async () =>
      (await api.get<Placement | null>(`${S}/student-enrollments/placement-at/${studentProfileId}`, { params: { at } })).data,
  });
}

export interface PlacementInput {
  termId: string;
  classCohortId?: string;
  classId?: string;
  sectionId?: string | null;
  rollNumber?: string;
  effectiveFrom?: string;
  movementReason?: MovementReason;
  notes?: string;
}

/**
 * A placement change reaches pupils, placements, seats, course rosters and the
 * assessment wizard's drift warning — every one of them must refetch, or the
 * screen shows the old class until someone refreshes (F20).
 */
const ENROLLMENT_CONSUMERS = /student|enrol|placement|course|roster|capacity|class|assessment-board|setup/i;
const invalidateEnrollment = (qc: ReturnType<typeof useQueryClient>) =>
  qc.invalidateQueries({
    predicate: (q) => q.queryKey[0] === 'school' && ENROLLMENT_CONSUMERS.test(String(q.queryKey[1] ?? '')),
  });

export function useCreateEnrollment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: {
      studentProfileId: string;
      academicYearId: string;
      programmeId?: string;
      gradeLevelId?: string;
      admissionDate?: string;
      enrollmentType?: EnrollmentTypeValue;
      status?: EnrollmentStatus;
      notes?: string;
      placement?: PlacementInput;
    }) => (await api.post(`${S}/student-enrollments`, dto)).data,
    onSuccess: () => invalidateEnrollment(qc),
  });
}

export function useLateAdmission() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: {
      studentProfileId: string;
      academicYearId: string;
      admissionDate: string;
      placement?: PlacementInput;
      notes?: string;
    }) => (await api.post(`${S}/student-enrollments/late-admission`, dto)).data,
    onSuccess: () => invalidateEnrollment(qc),
  });
}

export function useEnrollmentAction(action: 'withdraw' | 'transfer-out' | 'suspend' | 'complete') {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, reason, effectiveAt }: { id: string; reason: string; effectiveAt?: string }) =>
      (await api.post(`${S}/student-enrollments/${id}/${action}`, { reason, effectiveAt })).data,
    onSuccess: () => invalidateEnrollment(qc),
  });
}

export function useChangeEnrollmentStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      ...dto
    }: {
      id: string;
      toStatus: EnrollmentStatus;
      reason: string;
      effectiveAt?: string;
      placement?: PlacementInput;
    }) => (await api.post(`${S}/student-enrollments/${id}/status`, dto)).data,
    onSuccess: () => invalidateEnrollment(qc),
  });
}

export function useRepeatGrade() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      ...dto
    }: {
      id: string;
      toAcademicYearId: string;
      toTermId: string;
      classId?: string;
      sectionId?: string | null;
      reason: string;
      effectiveFrom?: string;
    }) => (await api.post(`${S}/student-enrollments/${id}/repeat`, dto)).data,
    onSuccess: () => invalidateEnrollment(qc),
  });
}

export function usePromoteEnrollment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      ...dto
    }: {
      id: string;
      toAcademicYearId: string;
      toTermId: string;
      toClassId?: string;
      sectionId?: string | null;
      reason?: string;
      effectiveFrom?: string;
    }) => (await api.post(`${S}/student-enrollments/${id}/promote`, dto)).data,
    onSuccess: () => invalidateEnrollment(qc),
  });
}

/* ───────────────────────────── Placement ───────────────────────────── */

export function useRoster(cohortId?: string, params: { at?: string; sectionId?: string; termId?: string } = {}) {
  return useQuery({
    queryKey: ['school', 'placement-roster', cohortId, params],
    enabled: !!cohortId,
    queryFn: async () => (await api.get<RosterRow[]>(`${S}/placements/roster/${cohortId}`, { params })).data,
  });
}

export interface MoveInput {
  termId?: string;
  classCohortId?: string;
  classId?: string;
  sectionId?: string | null;
  rollNumber?: string;
  effectiveFrom?: string;
  movementReason: MovementReason;
  reason: string;
  notes?: string;
}

export function usePreviewPlacement() {
  return useMutation({
    mutationFn: async ({ enrollmentId, ...dto }: { enrollmentId: string } & MoveInput) =>
      (await api.post<PlacementPreview>(`${S}/placements/${enrollmentId}/preview`, dto)).data,
  });
}

export function useMovePlacement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ enrollmentId, ...dto }: { enrollmentId: string } & MoveInput) =>
      (await api.post(`${S}/placements/${enrollmentId}/move`, dto)).data,
    onSuccess: () => invalidateEnrollment(qc),
  });
}

export function useBulkPlacement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: {
      termId: string;
      movementReason: MovementReason;
      reason: string;
      effectiveFrom?: string;
      dryRun?: boolean;
      rows: Array<{
        enrollmentId: string;
        classCohortId?: string;
        classId?: string;
        sectionId?: string | null;
        rollNumber?: string;
      }>;
    }) => (await api.post<BulkPlacementResult>(`${S}/placements/bulk`, dto)).data,
    onSuccess: (result) => {
      if (result?.committed) invalidateEnrollment(qc);
    },
  });
}

export function useTermRollover() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: {
      fromTermId: string;
      toTermId: string;
      classCohortId?: string;
      dryRun?: boolean;
      reason?: string;
    }) =>
      (
        await api.post<{
          dryRun: boolean;
          committed: boolean;
          total: number;
          eligible: number;
          skipped: number;
          rows: Array<Record<string, unknown>>;
        }>(`${S}/placements/term-rollover`, dto)
      ).data,
    onSuccess: (result) => {
      if (result?.committed) invalidateEnrollment(qc);
    },
  });
}

/* ───────────────────────────── Presentation ────────────────────────── */

export const ENROLLMENT_STATUS_TONE: Record<EnrollmentStatus, string> = {
  PENDING: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  ACTIVE: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
  SUSPENDED: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  WITHDRAWN: 'bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300',
  TRANSFERRED: 'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300',
  COMPLETED: 'bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-300',
  CANCELLED: 'bg-muted text-muted-foreground',
};

/** Plain-language labels — school staff, not developers, read these. */
export const MOVEMENT_REASON_LABEL: Record<MovementReason, string> = {
  INITIAL_PLACEMENT: 'First placement',
  TERM_ROLLOVER: 'Rolled into the next term',
  CLASS_CHANGE: 'Moved to another class',
  SECTION_CHANGE: 'Moved to another section',
  STREAM_CHANGE: 'Moved to another stream',
  PROMOTION: 'Promoted',
  REPEAT: 'Repeating the class',
  LATE_ADMISSION: 'Joined late',
  TRANSFER_IN: 'Transferred in',
  TRANSFER_OUT: 'Transferred out',
  WITHDRAWAL: 'Withdrawn',
  RE_ENTRY: 'Came back',
  SUSPENSION: 'Suspended',
  COMPLETION: 'Finished the year',
  CORRECTION: 'Correction',
  BACKFILL: 'Migrated from the old records',
};

export const STAGE_LABEL: Record<ProgrammeStage, string> = {
  PRE_PRIMARY: 'Pre-Primary (Nursery)',
  PRIMARY: 'Primary',
  PRIMARY_LOWER: 'Lower Primary',
  PRIMARY_UPPER: 'Upper Primary',
  LOWER_SECONDARY: 'Lower Secondary',
  ADVANCED_SECONDARY: 'Advanced Secondary',
  OTHER: 'Other',
};

/** Pull a readable message out of an axios error shaped by the API. */
export function errorMessage(err: unknown, fallback = 'Something went wrong.'): string {
  const data = (err as { response?: { data?: { message?: string | string[] } } })?.response?.data;
  const message = data?.message;
  if (Array.isArray(message)) return message.join(' ');
  return message || (err as Error)?.message || fallback;
}
