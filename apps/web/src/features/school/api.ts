import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, resolveAssetUrl } from '@/lib/api';
import { queryClient } from '@/lib/query-client';
import { useAttemptKey } from '@/lib/use-attempt-key';
import { PERMISSIONS, TERMINOLOGY_DEFAULTS, type Terminology } from '@erp/shared';
import { useAuthStore } from '@/stores/auth.store';

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

/** Mirrors the API's StudentStatus enum (schema.prisma). `alumni` is legacy. */
export type StudentStatus =
  | 'applicant'
  | 'active'
  | 'suspended'
  | 'transferred'
  | 'withdrawn'
  | 'graduated'
  | 'deceased'
  | 'archived'
  | 'alumni';

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
  /** Derived by the API from placement history on every read. */
  currentClass?: { id: string; name: string } | null;
  currentSection?: { id: string; name: string } | null;
}

/**
 * The API no longer stores a class on the student (placement history is the
 * source, ADR-027); it returns `currentClass` / `currentSection` objects. The
 * id fields many screens read are filled in from those, so they keep working.
 */
export function normalizeStudent<T extends Partial<Student>>(s: T): T {
  return { ...s, currentClassId: s.currentClass?.id ?? null, currentSectionId: s.currentSection?.id ?? null };
}

export interface AcademicYear { id: string; name: string; startDate: string; endDate: string; isCurrent: boolean }
export interface Term { id: string; academicYearId: string; name: string; isCurrent: boolean }
export interface SchoolClass { id: string; name: string; gradeLevelId: string; campusId?: string | null; homeroomTeacher?: { id: string; partner?: { name: string } | null; employeeNo: string } | null }
export interface Section { id: string; classId: string; name: string; classTeacherId?: string | null; classTeacher?: { id: string; name: string; employeeNo: string } | null; schoolClass?: { id: string; name: string; homeroomTeacher?: { id: string; partner?: { name: string } | null; employeeNo: string } | null } | null }

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
  /**
   * Money actually RECEIVED — SUM(PaymentAllocation). Reconciles exactly with
   * the `payments` array below.
   *
   * Replaces `totalPaid`, which was derived as `billed - balance` and so
   * counted waivers and credits as if a family had paid them. Reductions are
   * reported as their own fields precisely so they are never mistaken for cash.
   */
  collected: number;
  waived: number;
  credited: number;
  adjusted: number;
  balance: number;
  invoices: Array<{ id: string; documentNumber: string; totalAmount: string; amountResidual: string; paymentStatus: string; issueDate: string }>;
  payments: Array<{ id: string; paymentNumber: string; amount: string; paymentDate: string; paymentMethod: string }>;
}

const S = '/school';

/* ───────────────────────── Overview ───────────────────────── */

export interface SchoolProfile {
  id?: string;
  name?: string;
  motto?: string | null;
  logoUrl?: string | null;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  address?: string | null;
  /** From the Organization — the single source for money and dates. */
  currencyCode?: string;
  timezone?: string;
  country?: string;
  educationLevel?: string;
  gradingSystem?: string;
  capacityPolicy?: 'ENFORCE' | 'WARN' | 'OFF';
  resultAbsencePolicy?: 'ABSENT_AS_ZERO' | 'ABSENT_BLOCKS' | 'ALL_BLOCK';
  classTeacherScope?: 'STREAM' | 'CLASS';
  /** ADR-032 P1: what a late mark counts as. Null = not chosen yet (no rate is shown). */
  attendanceLateContribution?: number | string | null;
  attendanceExcusedInDenominator?: boolean;
  /** ADR-032 P3: cash through a drawer session, or a cashbook. */
  cashCustodyMode?: 'drawer' | 'cashbook';
  /** Stored overrides only. */
  terminology?: Partial<Terminology>;
  /** Resolved labels: overrides with defaults filled in. */
  labels?: Terminology;
}
export function useSchoolProfile() {
  return useQuery({
    queryKey: ['school', 'profile'],
    queryFn: async () => (await api.get<SchoolProfile>(`${S}/profile`)).data,
  });
}

export type UpdateSchoolProfileInput = Omit<Partial<SchoolProfile>, 'id' | 'labels'>;

export function useUpdateSchoolProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: UpdateSchoolProfileInput) => (await api.patch<SchoolProfile>(`${S}/profile`, dto)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['school', 'profile'] });
      qc.invalidateQueries({ queryKey: ['school', 'terminology'] });
    },
  });
}

/**
 * The school's own words for its structures ("Stream" vs "Class Group",
 * "Pupil" vs "Learner"). Defaults are returned until the school overrides them,
 * so a label is never blank.
 */
export function useTerminology(): Terminology {
  const { data } = useQuery({
    queryKey: ['school', 'terminology'],
    queryFn: async () => (await api.get<Terminology>(`${S}/terminology`)).data,
    staleTime: 5 * 60 * 1000,
  });
  return data ?? TERMINOLOGY_DEFAULTS;
}

/**
 * The school's terminology outside a component (props, table headers built in
 * helpers). Reads the same cached query `useTerminology` fills; defaults until
 * it has loaded. Prefer the hook inside components.
 */
export function currentTerminology(): Terminology {
  return queryClient.getQueryData<Terminology>(['school', 'terminology']) ?? TERMINOLOGY_DEFAULTS;
}

/** One step of the "get your school ready" checklist (GET /school/setup-status). */
export interface SetupStep {
  id: string;
  title: string;
  why: string;
  done: boolean;
  detail: string | null;
  href: string;
  who: string;
}

export function useSetupStatus(enabled = true) {
  return useQuery({
    queryKey: ['school', 'setup-status'],
    queryFn: async () =>
      (await api.get<{ steps: SetupStep[]; done: number; total: number; ready: boolean }>(`${S}/setup-status`)).data,
    enabled,
    staleTime: 60 * 1000,
  });
}

export function useSchoolOverview() {
  return useQuery({
    queryKey: ['school', 'overview'],
    queryFn: async () => (await api.get<SchoolOverview>(`${S}/overview`)).data,
  });
}

export interface SchoolAdminDashboard {
  students: number;
  staff: number;
  /** Teaching staff only — the denominator for a teacher:pupil ratio. */
  teachers: number;
  campuses: number;
  classes: number;
  sections: number;
  /** Null when the caller lacks `school:fees:read`. */
  outstandingFees: number | null;
}

export function useSchoolAdminDashboard() {
  return useQuery({
    queryKey: ['school', 'reports', 'admin'],
    queryFn: async () => (await api.get<SchoolAdminDashboard>(`${S}/reports/admin`)).data,
  });
}

/**
 * The academic half of the dashboard.
 *
 * `/school/reports/academic`, `/attendance-today` and `/top-performers` all
 * existed on the server with no client at all — which is why the dashboard a
 * headteacher opens showed only money and headcount, and nothing about marks,
 * approvals or attendance.
 */
export interface SchoolAcademicDashboard {
  termId: string | null;
  termName: string | null;
  totalMarks: number;
  approved: number;
  passed: number;
  passRate: number;
  awaitingApproval: number;
  draft: number;
  rejected: number;
}

export function useSchoolAcademicDashboard() {
  return useQuery({
    queryKey: ['school', 'reports', 'academic'],
    queryFn: async () => (await api.get<SchoolAcademicDashboard>(`${S}/reports/academic`)).data,
  });
}

export type AttendanceToday = Record<string, number>;

export function useSchoolAttendanceToday() {
  return useQuery({
    queryKey: ['school', 'reports', 'attendance-today'],
    queryFn: async () => (await api.get<AttendanceToday>(`${S}/reports/attendance-today`)).data,
  });
}

export interface TopPerformer {
  id: string;
  admissionNo: string;
  name: string | null;
  className: string | null;
  classRank: number | null;
  gpa: number | null;
  meanPercent: number | null;
  division: string | null;
}

export function useSchoolTopPerformers(limit = 5) {
  return useQuery({
    queryKey: ['school', 'reports', 'top-performers', limit],
    queryFn: async () => (await api.get<TopPerformer[]>(`${S}/reports/top-performers`, { params: { limit } })).data,
  });
}

export interface SchoolFinanceDashboard {
  collectionsThisMonth: number;
  outstanding: number;
}

export function useSchoolFinanceDashboard() {
  return useQuery({
    queryKey: ['school', 'reports', 'finance'],
    enabled: canReadFees(),
    queryFn: async () => (await api.get<SchoolFinanceDashboard>(`${S}/reports/finance`)).data,
  });
}

export interface OutstandingByClass { classId: string; className: string; outstanding: number; studentCount: number }
export function useSchoolOutstandingByClass() {
  return useQuery({
    queryKey: ['school', 'reports', 'outstanding-by-class'],
    enabled: canReadFees(),
    queryFn: async () => (await api.get<OutstandingByClass[]>(`${S}/reports/outstanding-by-class`)).data,
  });
}

export interface DailyCollection { date: string; total: number }
export function useSchoolDailyCollections(days = 30) {
  return useQuery({
    queryKey: ['school', 'reports', 'daily-collections', days],
    enabled: canReadFees(),
    queryFn: async () => (await api.get<DailyCollection[]>(`${S}/reports/daily-collections`, { params: { days } })).data,
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

export interface EnrollmentSummaryRow {
  classId: string;
  className: string;
  gradeLevel: string;
  male: number;
  female: number;
  maleBoarding: number;
  femaleBoarding: number;
  maleDay: number;
  femaleDay: number;
  total: number;
}
export interface EnrollmentSummary {
  rows: EnrollmentSummaryRow[];
  totals: Omit<EnrollmentSummaryRow, 'classId' | 'className' | 'gradeLevel'>;
  termId: string | null;
  generatedAt: string;
}
export function useEnrollmentSummary(termId?: string) {
  return useQuery({
    queryKey: ['school', 'admissions', 'enrollment-summary', termId ?? 'current'],
    queryFn: async () =>
      (await api.get<EnrollmentSummary>(`${S}/admissions/reports/enrollment-summary`, { params: termId ? { termId } : {} })).data,
  });
}

export function useSections() {
  return useQuery({
    queryKey: ['school', 'sections'],
    queryFn: async () => (await api.get<Paginated<Section>>(`${S}/sections`, { params: { pageSize: 300 } })).data,
  });
}

/**
 * The subdivisions of one class — what a primary school calls its streams
 * ("P4 West"). Backed by Section, which is the subdivision that travels the
 * whole academic pipeline: attendance, assessments, class lists and results all
 * carry sectionId, while streamId stops at placement and the timetable.
 * Filtered from the single cached list rather than a second request.
 */
export function useSectionsForClass(classId: string | undefined) {
  const { data, ...rest } = useSections();
  const sections = (data?.data ?? []).filter((x) => x.classId === classId);
  return { ...rest, data: classId ? sections : [] };
}
export function useUpdateSection() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: async ({ id, ...dto }: { id: string; classId?: string; name?: string; capacity?: number; classTeacherId?: string }) => (await api.patch<Section>(`${S}/sections/${id}`, dto)).data, onSuccess: () => qc.invalidateQueries({ queryKey: ['school', 'sections'] }) });
}

/* ───────────────────────── Admissions ───────────────────────── */

/**
 * Mirrors the backend `AdmissionStatus` enum in full.
 *
 * This used to list 7 of the 15 states. Anything the backend put into
 * `screening`, `interview_scheduled`, `interviewed`, `scored`, `waitlisted`,
 * `offer_issued` or `offer_accepted` rendered as a bare enum string with no
 * available actions, so the record was stranded in the UI.
 */
export type AdmissionStatus =
  | 'draft'
  | 'submitted'
  | 'under_review'
  | 'documents_pending'
  | 'screening'
  | 'interview_scheduled'
  | 'interviewed'
  | 'exam_scheduled'
  | 'scored'
  | 'accepted'
  | 'waitlisted'
  | 'offer_issued'
  | 'offer_accepted'
  | 'offer_declined'
  | 'offer_expired'
  | 'enrolled'
  | 'rejected'
  | 'withdrawn';

/** Every action the admission FSM accepts on `POST /school/admissions/:id/review`. */
export type AdmissionAction =
  | 'submit'
  | 'review'
  | 'request_documents'
  | 'resolve_documents'
  | 'screen'
  | 'schedule_interview'
  | 'complete_interview'
  | 'reschedule'
  | 'schedule_exam'
  | 'exam_done'
  | 'score'
  | 'accept'
  | 'reject'
  | 'waitlist'
  | 'issue_offer'
  | 'accept_offer'
  | 'decline_offer'
  | 'expire_offer'
  // Routed through POST /enroll rather than /review, but it is an FSM action and the
  // workflow resolver returns it like any other.
  | 'enroll'
  | 'withdraw';

export interface AdmissionApplication {
  id: string;
  applicationNumber: string;
  applicantFirstName: string;
  applicantLastName: string;
  applicantGender?: string | null;
  applicantDob?: string | null;
  applyingForClassId?: string | null;
  academicYearId: string;
  status: AdmissionStatus;
  feeStatus?: 'unpaid' | 'pending' | 'paid' | 'waived';
  parentContactId?: string | null;
  admissionCycleId?: string | null;
  decisionNotes?: string | null;
  nationality?: string | null;
  residenceType?: string | null;
  entryStatus?: string | null;
  address?: string | null;
  studentCategoryId?: string | null;
  customFields?: Record<string, unknown>;
  createdAt: string;
  academicYear?: { id: string; name: string } | null;
  offerLetter?: AdmissionOffer | null;
  documents?: AdmissionDocument[];
  /**
   * Resolved on every list row by `GET /school/admissions`, so the pipeline table can
   * render the actions this application's workflow permits without an N+1 of
   * per-application requests. Eligibility is not included here — it is fetched on
   * demand by the Enroll dialog.
   */
  workflow?: Omit<AdmissionWorkflowState, 'applicationId' | 'status' | 'workflow' | 'stages' | 'eligibility'>;
  /** Structured guardians, included by GET /:id. Populated for read-only view. */
  guardians?: Array<{
    id: string;
    firstName: string;
    lastName?: string | null;
    relationship: string;
    phone?: string | null;
    altPhone?: string | null;
    email?: string | null;
    occupation?: string | null;
    address?: string | null;
    isPrimary?: boolean;
    isEmergency?: boolean;
    financiallyResponsible?: boolean;
  }> | null;
}

export interface AdmissionOffer {
  id: string;
  applicationId: string;
  status: 'issued' | 'viewed' | 'accepted' | 'declined' | 'expired' | 'withdrawn';
  issuedAt: string;
  expiresAt?: string | null;
  acceptedAt?: string | null;
  declinedAt?: string | null;
  conditions?: string | null;
  body?: string | null;
  version: number;
}

export interface AdmissionDocument {
  id: string;
  applicationId: string;
  type: string;
  fileId: string;
  required: boolean;
  verified: boolean;
  rejectionReason?: string | null;
  uploadedAt: string;
}

/** Result of `GET /school/admissions/:id/eligibility` — the enrollment gate. */
export interface AdmissionEligibility {
  applicationId: string;
  status: 'READY' | 'BLOCKED';
  missing: string[];
  capacity?: {
    capacity: number;
    reservedCapacity: number;
    occupied: number;
    available: number;
  } | null;
}

export interface CreateAdmissionInput {
  academicYearId: string;
  admissionCycleId?: string;
  applicantFirstName: string;
  applicantLastName: string;
  applicantDob?: string;
  applicantGender?: 'male' | 'female' | 'other';
  applyingForClassId?: string;
  parentContactId?: string;
  nin?: string;
  sourceOfEnquiry?: string;
  siblingOfStudentId?: string;
  /// Promoted operational fields (Task 3).
  nationality?: string;
  residenceType?: 'day' | 'boarder';
  entryStatus?: string;
  address?: string;
  studentCategoryId?: string;
  asDraft?: boolean;
  guardians?: AdmissionGuardianInput[];
  customFields?: Record<string, unknown>;
}

export interface UpdateAdmissionInput {
  applicantFirstName?: string;
  applicantLastName?: string;
  applicantDob?: string;
  applicantGender?: 'male' | 'female' | 'other';
  applyingForClassId?: string;
  parentContactId?: string;
  sourceOfEnquiry?: string;
  siblingOfStudentId?: string;
  admissionCycleId?: string;
  /// Promoted operational fields (Task 3).
  nationality?: string;
  residenceType?: 'day' | 'boarder';
  entryStatus?: string;
  address?: string;
  studentCategoryId?: string;
  customFields?: Record<string, unknown>;
}

export function useAdmissions(params: { page?: number; pageSize?: number } = {}) {
  return useQuery({
    queryKey: ['school', 'admissions', params],
    queryFn: async () => (await api.get<Paginated<AdmissionApplication>>(`${S}/admissions`, { params })).data,
  });
}

export function useAdmission(id?: string) {
  return useQuery({
    queryKey: ['school', 'admissions', 'one', id],
    enabled: !!id,
    queryFn: async () => (await api.get<AdmissionApplication>(`${S}/admissions/${id}`)).data,
  });
}

export function useCreateAdmission() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: CreateAdmissionInput) => (await api.post<AdmissionApplication>(`${S}/admissions`, dto)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['school', 'admissions'] }),
  });
}

export function useUpdateAdmission() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, dto }: { id: string; dto: UpdateAdmissionInput }) =>
      (await api.patch<AdmissionApplication>(`${S}/admissions/${id}`, dto)).data,
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
      action: AdmissionAction;
      notes?: string;
    }) => (await api.post(`${S}/admissions/${id}/review`, { action, notes })).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['school', 'admissions'] }),
  });
}

/**
 * Offer lifecycle. Without these the pipeline could not be completed from the
 * UI at all: `accepted` was a dead end, and the Enroll button called an endpoint
 * that requires `offer_accepted`.
 */
export function useIssueAdmissionOffer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, body, expiresAt, templateId }: { id: string; body?: string; expiresAt?: string; templateId?: string }) =>
      (await api.post<AdmissionOffer>(`${S}/admissions/${id}/offer`, { body, expiresAt, templateId })).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['school', 'admissions'] }),
  });
}

export function useAcceptAdmissionOffer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => (await api.post(`${S}/admissions/${id}/offer/accept`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['school', 'admissions'] }),
  });
}

export function useDeclineAdmissionOffer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => (await api.post(`${S}/admissions/${id}/offer/decline`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['school', 'admissions'] }),
  });
}

/** Records the admissions committee's decision (accept / reject / waitlist). */
export function useRecordAdmissionDecision() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, decision, reason }: { id: string; decision: 'accepted' | 'rejected' | 'waitlisted'; reason?: string }) =>
      (await api.post(`${S}/admissions/${id}/decision`, { decision, reason })).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['school', 'admissions'] }),
  });
}

/** The enrollment gate — required documents, fee settlement and seat availability. */
export function useAdmissionEligibility(id?: string) {
  return useQuery({
    queryKey: ['school', 'admissions', 'eligibility', id],
    enabled: !!id,
    queryFn: async () => (await api.get<AdmissionEligibility>(`${S}/admissions/${id}/eligibility`)).data,
  });
}

/* ───────────────────── Configurable admission workflow ─────────────────────
 *
 * Which business stages a school requires is configuration; the eligibility
 * conditions (documents, fee, capacity) never are. The backend resolves both and
 * this client renders them — it must NOT recompute skip logic from stage modes.
 */

export type AdmissionStageKey =
  | 'APPLICATION'
  | 'EVALUATION'
  | 'DECISION'
  | 'OFFER'
  | 'APPLICANT_ACCEPTANCE'
  | 'ENROLLMENT';

/**
 * - `required` blocks progression until complete
 * - `optional` is available to staff but never blocks
 * - `skip` is not part of this school's process (hidden, but not forbidden)
 */
export type AdmissionStageMode = 'required' | 'optional' | 'skip';

export type AdmissionEvaluationStep = 'screening' | 'interview' | 'exam';

export interface AdmissionStageConfig {
  stage: AdmissionStageKey;
  mode: AdmissionStageMode;
  order: number;
  steps?: Record<AdmissionEvaluationStep, AdmissionStageMode>;
}

export interface AdmissionWorkflow {
  id: string;
  organizationId: string;
  name: string;
  description?: string | null;
  /** Null once hand-tuned away from a preset. */
  presetKey?: string | null;
  isDefault: boolean;
  active: boolean;
  stages: AdmissionStageConfig[];
  createdAt: string;
  updatedAt: string;
}

/** `GET /school/admissions/workflows/schema` — drives the settings UI generically. */
export interface AdmissionWorkflowSchema {
  stages: Array<{
    stage: AdmissionStageKey;
    label: string;
    order: number;
    locked?: boolean;
    hasSteps?: boolean;
    help: string;
  }>;
  modes: Array<{ value: AdmissionStageMode; label: string; help: string }>;
  evaluationSteps: Array<{ key: AdmissionEvaluationStep; label: string }>;
  presets: Array<{ key: string; label: string; description: string; stages: AdmissionStageConfig[] }>;
  snapshotVersion: number;
}

export interface AdmissionStageState {
  stage: AdmissionStageKey;
  label: string;
  mode: AdmissionStageMode;
  order: number;
  complete: boolean;
  steps?: Record<string, { mode: AdmissionStageMode; complete: boolean }>;
}

/**
 * `GET /school/admissions/:id/workflow`.
 *
 * `requiredActions` may legitimately be empty while the application is not stuck —
 * under Standard at `submitted`, Decision is next but the operator gets there via the
 * optional `review`. Render both lists; enable from `eligibility`.
 */
export interface AdmissionWorkflowState {
  applicationId: string;
  status: AdmissionStatus;
  workflow: {
    name: string | null;
    presetKey: string | null;
    version: number | null;
    /** True for applications created before workflows existed. */
    inherited: boolean;
  };
  stages: AdmissionStageState[];
  nextRequiredStage: AdmissionStageKey | null;
  requiredActions: AdmissionAction[];
  optionalActions: AdmissionAction[];
  alwaysAvailable: AdmissionAction[];
  skippedStages: AdmissionStageKey[];
  eligibility: AdmissionEligibility;
}

export function useAdmissionWorkflowSchema() {
  return useQuery({
    queryKey: ['school', 'admissions', 'workflow-schema'],
    staleTime: Infinity,
    queryFn: async () => (await api.get<AdmissionWorkflowSchema>(`${S}/admissions/workflows/schema`)).data,
  });
}

export function useAdmissionWorkflows() {
  return useQuery({
    queryKey: ['school', 'admissions', 'workflows'],
    queryFn: async () => (await api.get<AdmissionWorkflow[]>(`${S}/admissions/workflows`)).data,
  });
}

/** Per-application resolution: stage state, permitted actions and eligibility. */
export function useApplicationWorkflow(id?: string) {
  return useQuery({
    queryKey: ['school', 'admissions', 'workflow', id],
    enabled: !!id,
    queryFn: async () => (await api.get<AdmissionWorkflowState>(`${S}/admissions/${id}/workflow`)).data,
  });
}

const invalidateWorkflows = (qc: ReturnType<typeof useQueryClient>) => {
  qc.invalidateQueries({ queryKey: ['school', 'admissions', 'workflows'] });
  qc.invalidateQueries({ queryKey: ['school', 'admissions', 'cycles'] });
};

export function useCreateAdmissionWorkflow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: { name: string; description?: string; presetKey?: string; stages?: AdmissionStageConfig[]; isDefault?: boolean }) =>
      (await api.post<AdmissionWorkflow>(`${S}/admissions/workflows`, dto)).data,
    onSuccess: () => invalidateWorkflows(qc),
  });
}

export function useUpdateAdmissionWorkflow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...dto }: { id: string; name?: string; description?: string; stages?: AdmissionStageConfig[]; isDefault?: boolean }) =>
      (await api.patch<AdmissionWorkflow>(`${S}/admissions/workflows/${id}`, dto)).data,
    onSuccess: () => invalidateWorkflows(qc),
  });
}

export function useApplyAdmissionWorkflowPreset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, presetKey }: { id: string; presetKey: string }) =>
      (await api.post<AdmissionWorkflow>(`${S}/admissions/workflows/${id}/preset`, { presetKey })).data,
    onSuccess: () => invalidateWorkflows(qc),
  });
}

/** Archives (active=false). Refused with 409 while any cycle or application uses it. */
export function useArchiveAdmissionWorkflow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => (await api.delete(`${S}/admissions/workflows/${id}`)).data,
    onSuccess: () => invalidateWorkflows(qc),
  });
}

export function useAssignCycleWorkflow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ cycleId, workflowId }: { cycleId: string; workflowId: string | null }) =>
      (await api.patch(`${S}/admissions/cycles/${cycleId}/workflow`, { workflowId })).data,
    onSuccess: () => invalidateWorkflows(qc),
  });
}

/* ── Phase 1–5: submit gate, timeline, guardians, committee, config, analytics, portal ── */

export interface AdmissionGuardianInput {
  firstName: string;
  lastName?: string;
  relationship: string;
  phone?: string;
  altPhone?: string;
  email?: string;
  occupation?: string;
  address?: string;
  isPrimary?: boolean;
  isEmergency?: boolean;
  financiallyResponsible?: boolean;
}

export interface AdmissionStatusHistoryRow {
  id: string;
  fromStatus?: string | null;
  toStatus: string;
  action: string;
  reason?: string | null;
  changedById?: string | null;
  changedAt: string;
}

export interface AdmissionReviewerAssignment {
  id: string;
  applicationId: string;
  reviewerId: string;
  role: string;
  status: 'assigned' | 'in_progress' | 'completed';
  recommendation?: string | null;
  score?: number | null;
  comments?: string | null;
  assignedAt: string;
  completedAt?: string | null;
}

export interface AdmissionCommitteeSummary {
  applicationId: string;
  assigned: number;
  completed: number;
  quorumMet: boolean;
  tally: Record<string, number>;
  leaning: string | null;
  averageScore: number | null;
}

export interface AdmissionRequirement {
  id: string;
  admissionCycleId?: string | null;
  classId?: string | null;
  kind: 'document' | 'field' | 'fee';
  code: string;
  label: string;
  required: boolean;
  gate: 'submit' | 'enroll';
  sortOrder: number;
}

export interface AdmissionOfferTemplate {
  id: string;
  name: string;
  body: string;
  validityDays: number;
  isDefault: boolean;
}

export interface AdmissionEnquiry {
  id: string;
  applicantName: string;
  guardianName?: string | null;
  phone?: string | null;
  email?: string | null;
  interestedClassId?: string | null;
  source?: string | null;
  status: 'new' | 'contacted' | 'converted' | 'closed';
  notes?: string | null;
  convertedApplicationId?: string | null;
  createdAt: string;
}

export interface AdmissionFunnel {
  drafts: number;
  total: number;
  stages: { submitted: number; reviewed: number; accepted: number; offered: number; offerAccepted: number; enrolled: number };
  buckets: { waitlisted: number; rejected: number };
  conversion: { acceptanceRate: number; offerAcceptanceRate: number; enrollmentRate: number; overallYield: number };
  byStatus: Record<string, number>;
}

export function useSubmitApplication() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => (await api.post(`${S}/admissions/${id}/submit`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['school', 'admissions'] }),
  });
}

export function useAdmissionHistory(id?: string) {
  return useQuery({
    queryKey: ['school', 'admissions', 'history', id],
    enabled: !!id,
    queryFn: async () => (await api.get<AdmissionStatusHistoryRow[]>(`${S}/admissions/${id}/history`)).data,
  });
}

export function useRevealNin() {
  return useMutation({
    mutationFn: async (id: string) => (await api.post<{ nin: string | null }>(`${S}/admissions/${id}/reveal-nin`)).data,
  });
}

/* Committee / reviewers */
export function useAdmissionReviewers(id?: string) {
  return useQuery({
    queryKey: ['school', 'admissions', 'reviewers', id],
    enabled: !!id,
    queryFn: async () => (await api.get<AdmissionReviewerAssignment[]>(`${S}/admissions/${id}/reviewers`)).data,
  });
}

export function useCommitteeSummary(id?: string) {
  return useQuery({
    queryKey: ['school', 'admissions', 'committee', id],
    enabled: !!id,
    queryFn: async () => (await api.get<AdmissionCommitteeSummary>(`${S}/admissions/${id}/committee-summary`)).data,
  });
}

export function useAssignReviewers() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, reviewerIds, role }: { id: string; reviewerIds: string[]; role?: string }) =>
      (await api.post(`${S}/admissions/${id}/reviewers`, { reviewerIds, role })).data,
    onSuccess: (_d, v) => qc.invalidateQueries({ queryKey: ['school', 'admissions', 'reviewers', v.id] }),
  });
}

export function useSubmitReview() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ assignmentId, recommendation, score, comments }: { assignmentId: string; recommendation: string; score?: number; comments?: string }) =>
      (await api.post(`${S}/admissions/reviews/${assignmentId}`, { recommendation, score, comments })).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['school', 'admissions'] }),
  });
}

/* Requirements */
export function useAdmissionRequirements(admissionCycleId?: string) {
  return useQuery({
    queryKey: ['school', 'admissions', 'requirements', admissionCycleId ?? 'all'],
    queryFn: async () => (await api.get<AdmissionRequirement[]>(`${S}/admissions/requirements`, { params: admissionCycleId ? { admissionCycleId } : {} })).data,
  });
}

// ── Application documents ──────────────────────────────────────────────────
// Attach a platform File to an application as a named document (e.g. a required
// requirement code). Backend links it via ApplicationDocument.fileId.
export function useAddDocument(applicationId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: { type: string; fileId: string; required?: boolean }) =>
      (await api.post(`${S}/admissions/${applicationId}/documents`, dto)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['school', 'admissions', applicationId] });
      qc.invalidateQueries({ queryKey: ['school', 'admissions', 'eligibility', applicationId] });
    },
  });
}

// Verify or reject an attached document (decision-grade; rejection needs a reason).
export function useVerifyDocument(documentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ verified, rejectionReason }: { verified: boolean; rejectionReason?: string }) =>
      (await api.post(`${S}/admissions/documents/${documentId}/verify`, { verified, rejectionReason })).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['school', 'admissions'] });
      qc.invalidateQueries({ queryKey: ['school', 'admissions', 'eligibility'] });
    },
  });
}

// ── Admission cycles ────────────────────────────────────────────────────────
export interface AdmissionCycle {
  id: string;
  organizationId: string;
  academicYearId: string;
  name: string;
  opensAt?: string | null;
  closesAt?: string | null;
  status: 'open' | 'closed';
  /** Workflow applied to applications created in this cycle FROM NOW ON. */
  workflowId?: string | null;
  createdAt: string;
  updatedAt: string;
  capacities?: unknown[];
  criteriaSets?: unknown[];
}

export function useAdmissionCycles(academicYearId?: string) {
  return useQuery({
    queryKey: ['school', 'admissions', 'cycles', academicYearId ?? 'all'],
    queryFn: async () => (await api.get<AdmissionCycle[]>(`${S}/admissions/cycles`, { params: academicYearId ? { academicYearId } : {} })).data,
  });
}

// ── Nationalities (org-scoped master data) ──────────────────────────────────
export interface Nationality {
  id: string;
  organizationId: string;
  name: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export function useNationalities() {
  return useQuery({
    queryKey: ['school', 'nationalities'],
    queryFn: async () => (await api.get<Nationality[]>(`${S}/admissions/nationalities`)).data,
  });
}

export function useCreateNationality() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: { name: string }) => (await api.post<Nationality>(`${S}/admissions/nationalities`, dto)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['school', 'nationalities'] }),
  });
}

export function useUpdateNationality() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...dto }: { id: string; name?: string; isActive?: boolean }) =>
      (await api.patch<Nationality>(`${S}/admissions/nationalities/${id}`, dto)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['school', 'nationalities'] }),
  });
}

// ── Student Categories (org-scoped master data) ──────────────────────────────
export interface StudentCategory {
  id: string;
  organizationId: string;
  name: string;
  description: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export function useStudentCategories() {
  return useQuery({
    queryKey: ['school', 'studentCategories'],
    queryFn: async (): Promise<StudentCategory[]> => {
      // The API returns a paginated envelope `{ data, meta }`; unwrap it.
      // Also tolerate a stale persisted cache entry that still holds the
      // envelope (PersistQueryClientProvider) or a raw array, so consumers
      // (student-categories / student-360 / application-form) never receive an
      // object where they expect an array.
      const body = (await api.get<unknown>(`${S}/student-categories`)).data;
      if (Array.isArray(body)) return body as StudentCategory[];
      if (body && typeof body === 'object' && Array.isArray((body as { data?: unknown }).data)) {
        return (body as { data: StudentCategory[] }).data;
      }
      return [];
    },
  });
}

export function useCreateStudentCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: { name: string; description?: string }) =>
      (await api.post<StudentCategory>(`${S}/student-categories`, dto)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['school', 'studentCategories'] }),
  });
}

export function useUpdateStudentCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...dto }: { id: string; name?: string; description?: string; isActive?: boolean }) =>
      (await api.patch<StudentCategory>(`${S}/student-categories/${id}`, dto)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['school', 'studentCategories'] }),
  });
}

export function useUpsertRequirement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: Partial<AdmissionRequirement>) => (await api.put(`${S}/admissions/requirements`, dto)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['school', 'admissions', 'requirements'] }),
  });
}

export function useDeleteRequirement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => (await api.delete(`${S}/admissions/requirements/${id}`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['school', 'admissions', 'requirements'] }),
  });
}

/* Offer templates */
export function useOfferTemplates() {
  return useQuery({
    queryKey: ['school', 'admissions', 'offer-templates'],
    queryFn: async () => (await api.get<AdmissionOfferTemplate[]>(`${S}/admissions/offer-templates`)).data,
  });
}

export function useUpsertOfferTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: Partial<AdmissionOfferTemplate>) => (await api.put(`${S}/admissions/offer-templates`, dto)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['school', 'admissions', 'offer-templates'] }),
  });
}

export function useDeleteOfferTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => (await api.delete(`${S}/admissions/offer-templates/${id}`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['school', 'admissions', 'offer-templates'] }),
  });
}

/* Enquiries */
export function useEnquiries(status?: string) {
  return useQuery({
    queryKey: ['school', 'admissions', 'enquiries', status ?? 'all'],
    queryFn: async () => (await api.get<AdmissionEnquiry[]>(`${S}/admissions/enquiries`, { params: status ? { status } : {} })).data,
  });
}

export function useCreateEnquiry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: Partial<AdmissionEnquiry>) => (await api.post(`${S}/admissions/enquiries`, dto)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['school', 'admissions', 'enquiries'] }),
  });
}

export function useUpdateEnquiry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...dto }: { id: string; status?: string; notes?: string }) =>
      (await api.put(`${S}/admissions/enquiries/${id}`, dto)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['school', 'admissions', 'enquiries'] }),
  });
}

/* Analytics */
export function useAdmissionFunnel(academicYearId?: string) {
  return useQuery({
    queryKey: ['school', 'admissions', 'funnel', academicYearId ?? 'all'],
    queryFn: async () => (await api.get<AdmissionFunnel>(`${S}/admissions/analytics/funnel`, { params: academicYearId ? { academicYearId } : {} })).data,
  });
}

export function useAdmissionBySource(academicYearId?: string) {
  return useQuery({
    queryKey: ['school', 'admissions', 'by-source', academicYearId ?? 'all'],
    queryFn: async () => (await api.get<Array<{ source: string; count: number }>>(`${S}/admissions/analytics/by-source`, { params: academicYearId ? { academicYearId } : {} })).data,
  });
}

/* Portal link (staff-issued) */
export function useIssuePortalLink() {
  return useMutation({
    mutationFn: async ({ id, email }: { id: string; email: string }) =>
      (await api.post<{ issued: boolean; devToken?: string }>(`${S}/admissions/portal/${id}/link`, { email })).data,
  });
}

/**
 * A possible duplicate: this applicant may already be a pupil (or a sibling's
 * record). Enrolment is BLOCKED while any match is open, and there was no
 * screen to resolve one (E2E audit AD3).
 */
export interface IdentityMatch {
  id: string;
  applicationId: string;
  candidateType: string;
  candidateId: string;
  candidateName: string;
  matchMethod: string;
  matchScore: string | number | null;
  status: 'open' | 'confirmed_same' | 'dismissed';
  reviewedAt: string | null;
}

export function useIdentityMatches(applicationId: string | undefined) {
  return useQuery({
    queryKey: ['school', 'admissions', applicationId, 'identity-matches'],
    enabled: !!applicationId,
    queryFn: async () =>
      (await api.get<IdentityMatch[]>(`${S}/admissions/${applicationId}/identity-matches`)).data,
  });
}

export function useReviewIdentityMatch(applicationId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, decision }: { id: string; decision: 'confirmed_same' | 'dismissed' }) =>
      (await api.post(`${S}/admissions/identity-matches/${id}/review`, { decision })).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['school', 'admissions', applicationId, 'identity-matches'] });
      qc.invalidateQueries({ queryKey: ['school', 'admissions'] });
    },
  });
}

export interface EnrollAdmissionInput {
  applicationId: string;
  classId: string;
  /** Subdivision of the class — "Stream" in the UI. Optional server-side too. */
  sectionId?: string;
  termId: string;
  rollNumber: string;
  /** Overrides of what the application says; omitted fields come from the application (F13). */
  student?: { name?: string; email?: string; phone?: string; gender?: 'male' | 'female' | 'other'; dateOfBirth?: string; residenceType?: 'day' | 'boarder'; studentCategoryId?: string };
  /** Required when `student` contradicts the application. */
  confirmOverrides?: boolean;
}

export interface EnrollAdmissionResult {
  studentProfileId: string;
  studentProfile: { id: string };
  conversionSummary?: { carried: string[]; overridden: string[] };
}

/** Everything an enrollment changes: admissions, pupils, seats, placements, course rosters (F20). */
const ENROLLMENT_CONSUMERS = /admission|student|enrol|placement|course|roster|capacity|class|setup/i;

export function useEnrollAdmission() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: EnrollAdmissionInput) => (await api.post<EnrollAdmissionResult>(`${S}/admissions/enroll`, dto)).data,
    onSuccess: () => {
      qc.invalidateQueries({
        predicate: (q) => q.queryKey[0] === 'school' && ENROLLMENT_CONSUMERS.test(String(q.queryKey[1] ?? '')),
      });
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
  counts: { promoted: number; repeated: number; graduated: number; skipped: number; total: number };
  promote: RolloverPlanRow[];
  /** Learners whose published result recommends repeating (promotion-run.service.ts). */
  repeat: RolloverPlanRow[];
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
  /** Learners placed in this class now (resolved from placement history by the API). */
  classId?: string;
  sectionId?: string;
  /** Placed in the class during this term (a historical cohort), not now. */
  termId?: string;
}

export function useStudents(params: StudentListParams = {}) {
  return useQuery({
    queryKey: ['school', 'students', params],
    queryFn: async () => {
      const res = (await api.get<Paginated<Student>>(`${S}/students`, { params })).data;
      return { ...res, data: (res.data ?? []).map(normalizeStudent) };
    },
  });
}

export function useStudent(id: string | undefined) {
  return useQuery({
    queryKey: ['school', 'student', id],
    enabled: !!id,
    queryFn: async () => normalizeStudent((await api.get<Student>(`${S}/students/${id}`)).data),
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
  /** Admit straight into a class (creates the enrollment and opening placement). */
  classId?: string;
  sectionId?: string;
  termId?: string;
  /** Confirm this is a different child when the API reports a likely duplicate. */
  allowDuplicate?: boolean;
  duplicateReason?: string;
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

/** Quick "register & place" — create the student and enroll them in one action. */
export interface RegisterStudentInput {
  name: string;
  admissionNo?: string;
  dateOfBirth?: string | null;
  gender?: string | null;
  nationality?: string | null;
  religion?: string | null;
  house?: string | null;
  residenceType?: 'day' | 'boarder' | null;
  studentCategoryId?: string | null;
  classId: string;
  sectionId?: string | null;
  termId: string;
  rollNumber: string;
  guardianName?: string;
  guardianPhone?: string;
  guardianRelationship?: string;
  /** ADR-032 P4: a different child who matches an existing pupil, with the reason. */
  allowDuplicate?: boolean;
  duplicateReason?: string;
}
export function useRegisterStudent() {
  const qc = useQueryClient();
  return useMutation({
    // `POST /school/students/register` (StudentAdmissionService.register). The
    // old `/school/enrollments/register` route no longer exists — front-desk
    // registration 404'd (E2E audit E2). The DTO rejects null for sectionId.
    mutationFn: async ({ sectionId, ...dto }: RegisterStudentInput) =>
      (
        await api.post<{ profile: { id: string } }>(`${S}/students/register`, {
          ...dto,
          ...(sectionId ? { sectionId } : {}),
        })
      ).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['school', 'students'] });
      qc.invalidateQueries({ queryKey: ['school', 'student-enrollments'] });
    },
  });
}

/**
 * Profile edits only. `currentClassId` / `currentSectionId` are NOT accepted:
 * the API rejects them (forbidNonWhitelisted) because placement is an academic
 * event, not a profile field. Moving a pupil goes through `useEnrollStudent`,
 * which writes the Enrollment and the profile snapshot together.
 */
export function useUpdateStudent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, dto }: { id: string; dto: Omit<Partial<CreateStudentInput>, 'currentClassId' | 'currentSectionId'> & { status?: StudentStatus; reason?: string } }) =>
      (await api.patch<Student>(`${S}/students/${id}`, dto)).data,
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ['school', 'students'] });
      qc.invalidateQueries({ queryKey: ['school', 'student', v.id] });
    },
  });
}

export interface EnrollStudentInput {
  studentProfileId: string;
  /** The academic year of `termId` — the membership is per year. */
  academicYearId: string;
  classId: string;
  /** The subdivision, shown to primary schools as "Stream". */
  sectionId?: string;
  termId: string;
  rollNumber: string;
  /**
   * The pupil's membership for that year, when one exists. Then this is a MOVE
   * (the open placement is end-dated, never overwritten); otherwise a new
   * enrollment is opened with this as its first placement.
   */
  existingEnrollmentId?: string;
  /** Required for a move — it is the audit trail. */
  reason?: string;
}

/**
 * Place a pupil in a class for a term — the authoritative placement write.
 *
 * The legacy per-term `POST /school/enrollments` is gone (E2E audit E2). A
 * pupil with no membership for the year gets one via `POST
 * /school/student-enrollments` with an opening `placement`; a pupil who already
 * has one is moved via `POST /school/placements/:enrollmentId/move`.
 */
export function useEnrollStudent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: EnrollStudentInput) => {
      const sectionId = dto.sectionId || null;
      if (dto.existingEnrollmentId) {
        return (
          await api.post(`${S}/placements/${dto.existingEnrollmentId}/move`, {
            termId: dto.termId,
            classId: dto.classId,
            sectionId,
            rollNumber: dto.rollNumber || undefined,
            movementReason: 'CLASS_CHANGE',
            reason: dto.reason?.trim() || 'Placed from the pupil profile',
          })
        ).data;
      }
      return (
        await api.post(`${S}/student-enrollments`, {
          studentProfileId: dto.studentProfileId,
          academicYearId: dto.academicYearId,
          status: 'ACTIVE',
          placement: {
            termId: dto.termId,
            classId: dto.classId,
            sectionId,
            rollNumber: dto.rollNumber || undefined,
            movementReason: 'INITIAL_PLACEMENT',
          },
        })
      ).data;
    },
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ['school', 'students'] });
      qc.invalidateQueries({ queryKey: ['school', 'student', v.studentProfileId] });
      qc.invalidateQueries({ queryKey: ['school', 'student-enrollments'] });
      qc.invalidateQueries({ queryKey: ['school', 'placement-at'] });
    },
  });
}

/**
 * A pupil's memberships, newest year first, each with its placement history —
 * `GET /school/student-enrollments/by-student/:id`.
 */
export interface PupilEnrollment {
  id: string;
  academicYearId: string;
  status: 'PENDING' | 'ACTIVE' | 'SUSPENDED' | 'WITHDRAWN' | 'TRANSFERRED' | 'COMPLETED' | 'CANCELLED';
  academicYear?: { id: string; name: string };
  gradeLevel?: { id: string; name: string };
  placements: Array<{
    id: string;
    termId: string;
    effectiveFrom: string;
    effectiveTo: string | null;
    movementReason: string;
    term?: { id: string; name: string } | null;
    classCohort?: { classId: string; schoolClass?: { id: string; name: string } } | null;
    section?: { id: string; name: string } | null;
  }>;
}

export function useStudentEnrollments(studentProfileId: string | undefined) {
  return useQuery({
    queryKey: ['school', 'student-enrollments', 'by-student', studentProfileId],
    enabled: !!studentProfileId,
    queryFn: async () =>
      (await api.get<PupilEnrollment[]>(`${S}/student-enrollments/by-student/${studentProfileId}`)).data,
  });
}

export function useStudentStatement(id: string | undefined) {
  return useQuery({
    queryKey: ['school', 'statement', id],
    enabled: !!id && canReadFees(),
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

export interface UpdateGuardianInput {
  id: string;
  studentProfileId: string;
  relationship?: string;
  isPrimary?: boolean;
  canPickup?: boolean;
  receivesStatements?: boolean;
  guardian?: { firstName?: string; lastName?: string; email?: string; phone?: string };
}
export function useUpdateGuardian() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: UpdateGuardianInput) => {
      const { id, studentProfileId, ...body } = dto;
      return (await api.patch<Guardian>(`${S}/guardians/${id}`, body)).data;
    },
    onSuccess: (_d, v) => qc.invalidateQueries({ queryKey: ['school', 'guardians', v.studentProfileId] }),
  });
}
export function useDeleteGuardian() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: { id: string; studentProfileId: string }) =>
      (await api.delete(`${S}/guardians/${dto.id}`)).data,
    onSuccess: (_d, v) => qc.invalidateQueries({ queryKey: ['school', 'guardians', v.studentProfileId] }),
  });
}

/* ───────────────────────── Student 360 (per-student reads) ───────────────────────── */

export interface AttendanceSummary {
  total: number;
  present: number;
  late: number;
  excused?: number;
  absent: number;
  /** Null when it depends on a late policy the school has not chosen (ADR-032 P1). */
  attendanceRate: number | null;
  policyMissing?: boolean;
}
export function useStudentAttendance(studentProfileId: string | undefined, from?: string, to?: string) {
  return useQuery({
    queryKey: ['school', 'attendance', 'by-student', studentProfileId, from, to],
    enabled: !!studentProfileId,
    queryFn: async () => {
      const params: Record<string, string> = {};
      if (from) params.from = from;
      if (to) params.to = to;
      return (await api.get<AttendanceSummary>(`${S}/attendance/by-student/${studentProfileId}`, { params })).data;
    },
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
export function useUpsertStudentMedical() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: { studentProfileId: string; bloodGroup?: string; allergies?: string[]; dietaryRequirements?: string[]; conditions?: string[]; medications?: string[]; emergencyNotes?: string; doctorName?: string; doctorPhone?: string }) =>
      (await api.post(`${S}/students/${dto.studentProfileId}/medical-record`, dto)).data,
    onSuccess: (_d, v) => qc.invalidateQueries({ queryKey: ['school', 'medical', v.studentProfileId] }),
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

export function useReportCards(studentProfileId: string | undefined) {
  return useQuery({
    queryKey: ['school', 'report-cards', studentProfileId],
    enabled: !!studentProfileId,
    queryFn: async () => (await api.get<ReportCard[]>(`${S}/report-cards/by-student/${studentProfileId}`)).data,
  });
}

export function useStudentTransport(studentProfileId: string | undefined) {
  return useQuery({
    queryKey: ['school', 'transport', 'by-student', studentProfileId],
    enabled: !!studentProfileId,
    queryFn: async () => (await api.get<TransportRow[]>(`${S}/transport/assignments/by-student/${studentProfileId}`)).data,
  });
}

/* ───────────────────────── Transport Management ─────────────────────────
 * Hooks target the real, registered STMS (TransportModule → /school/transport/*).
 * All list endpoints return plain arrays (not paginated).
 */
export interface Vehicle {
  id: string;
  code: string;
  plateNumber: string;
  type?: string | null;
  seatedCapacity?: number | null;
  status?: string | null;
}
export interface Route {
  id: string;
  name: string;
  code?: string | null;
  direction?: string | null;
  monthlyFee?: number | null;
  status?: string | null;
}
export interface Stop {
  id: string;
  routeId?: string | null;
  name: string;
  code?: string | null;
  order?: number | null;
  pickupTime?: string | null;
  dropoffTime?: string | null;
}
export interface StudentTransportAssignment {
  id: string;
  studentProfileId: string;
  routeId: string;
  stopId: string;
  termId?: string | null;
  startDate: string;
  endDate?: string | null;
  status?: string;
  monthlyFee?: number | null;
  student?: { id: string; partner?: { name: string } | null; admissionNo?: string } | null;
  route?: { id: string; name?: string } | null;
  stop?: { id: string; name?: string } | null;
}

export function useVehicles() {
  return useQuery({ queryKey: ['school', 'transport', 'vehicles'], queryFn: async () => (await api.get<Vehicle[]>(`${S}/transport/vehicles`)).data });
}
export function useCreateVehicle() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: async (dto: { code: string; plateNumber: string; seatedCapacity?: number; type?: string }) => (await api.post<Vehicle>(`${S}/transport/vehicles`, dto)).data, onSuccess: () => qc.invalidateQueries({ queryKey: ['school', 'transport', 'vehicles'] }) });
}
export function useRoutes() {
  return useQuery({ queryKey: ['school', 'transport', 'routes'], queryFn: async () => (await api.get<Route[]>(`${S}/transport/routes`)).data });
}
export function useCreateRoute() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: async (dto: { name: string; monthlyFee?: number; code?: string }) => (await api.post<Route>(`${S}/transport/routes`, dto)).data, onSuccess: () => qc.invalidateQueries({ queryKey: ['school', 'transport', 'routes'] }) });
}
export function useStops() {
  return useQuery({ queryKey: ['school', 'transport', 'stops'], queryFn: async () => (await api.get<Stop[]>(`${S}/transport/stops`)).data });
}
export function useCreateStop() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: async (dto: { routeId: string; name: string; order?: number; pickupTime?: string; dropoffTime?: string }) => (await api.post<Stop>(`${S}/transport/stops`, dto)).data, onSuccess: () => qc.invalidateQueries({ queryKey: ['school', 'transport', 'stops'] }) });
}
export function useStudentTransportAssignments() {
  return useQuery({ queryKey: ['school', 'transport', 'assignments'], queryFn: async () => (await api.get<StudentTransportAssignment[]>(`${S}/transport/assignments`)).data });
}
export function useAssignStudentTransport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: { studentProfileId: string; routeId: string; stopId: string; termId: string; startDate: string; monthlyFee?: number }) =>
      (await api.post<StudentTransportAssignment>(`${S}/transport/assignments`, dto)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['school', 'transport', 'assignments'] }),
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
  /** FeeCategory.code — the join between a structure and the categories catalog. */
  code: string;
  /** Display label on the invoice line (defaults to the category name). */
  name?: string;
  feeCategoryId?: string;
  /** Optional: with no product the line falls back to the default revenue account. */
  productId?: string;
  amount: number;
  /** Optional components bill ONLY students opted in via Optional Fees. */
  isOptional?: boolean;
}

export interface FeeStructure {
  id: string;
  name: string;
  academicYearId: string;
  components: FeeComponent[];
  /**
   * Targeting. Every dimension is AND-ed; an empty one means "no constraint on
   * this axis". `residenceTypes` prices boarders and day pupils apart.
   */
  applicableTo?: {
    classIds?: string[];
    gradeLevelIds?: string[];
    residenceTypes?: string[];
  } | null;
  isActive?: boolean;
  /** draft | published | archived. Only a published structure can be billed. */
  status?: string;
  /** The frozen version billing prices from. Null = never published = unbillable. */
  currentVersionId?: string | null;
  academicYear?: { id: string; name: string } | null;
  schedules?: Array<{ id: string; termId: string; dueDate: string }>;
}

export interface FeeSchedule {
  id: string;
  feeStructureId: string;
  termId: string;
  dueDate: string;
  feeStructure?: { name: string } | null;
}

export interface FeeCategory {
  id: string;
  code: string;
  name: string;
  type: 'mandatory' | 'optional';
  description: string | null;
  paymentOrder: number;
  isActive: boolean;
  createdAt?: string;
}

export function useFeeCategories() {
  return useQuery({
    queryKey: ['school', 'fee-categories'],
    queryFn: async () => (await api.get<Paginated<FeeCategory>>(`${S}/fee-categories`, { params: { pageSize: 200 } })).data,
  });
}

export function useCreateFeeCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: { code: string; name: string; type: 'mandatory' | 'optional'; description?: string; paymentOrder?: number; isActive?: boolean }) =>
      (await api.post<FeeCategory>(`${S}/fee-categories`, dto)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['school', 'fee-categories'] }),
  });
}

export function useUpdateFeeCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...dto }: { id: string; code?: string; name?: string; type?: 'mandatory' | 'optional'; description?: string; paymentOrder?: number; isActive?: boolean }) =>
      (await api.patch<FeeCategory>(`${S}/fee-categories/${id}`, dto)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['school', 'fee-categories'] }),
  });
}

export function useDeleteFeeCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => (await api.delete(`${S}/fee-categories/${id}`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['school', 'fee-categories'] }),
  });
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

export function useUpdateFeeStructure() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...dto }: { id: string } & Partial<{
      name: string;
      academicYearId: string;
      components: FeeComponent[];
      applicableTo: { classIds?: string[] };
      isActive: boolean;
    }>) => (await api.patch<FeeStructure>(`${S}/fee-structures/${id}`, dto)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['school', 'fee-structures'] }),
  });
}

export function useDeleteFeeStructure() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => (await api.delete(`${S}/fee-structures/${id}`)).data,
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

export function useDeleteFeeSchedule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => (await api.delete(`${S}/fee-schedules/${id}`)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['school', 'fee-schedules'] });
      qc.invalidateQueries({ queryKey: ['school', 'fee-structures'] });
    },
  });
}

/* ─────────────── Optional fees (per-student opt-in) ─────────────── */

export interface OptionalFeeRow {
  studentProfileId: string;
  admissionNo: string;
  name: string;
  className: string;
  classId: string | null;
  optedIn: boolean;
  amount: number | null;
  notes: string | null;
}

export interface OptionalFeeRoster {
  category: FeeCategory;
  rows: OptionalFeeRow[];
}

/**
 * The editable roster behind the Optional Fees screen. Disabled until a term
 * AND a category are chosen — the endpoint requires both, and firing it early
 * would just render a 400.
 */
export function useOptionalFeeRoster(params: {
  termId: string;
  feeCategoryId: string;
  classId?: string;
}) {
  const { termId, feeCategoryId, classId } = params;
  return useQuery({
    queryKey: ['school', 'optional-fees', termId, feeCategoryId, classId ?? ''],
    enabled: !!termId && !!feeCategoryId,
    queryFn: async () =>
      (
        await api.get<OptionalFeeRoster>(`${S}/student-optional-fees/roster`, {
          params: { termId, feeCategoryId, classId: classId || undefined },
        })
      ).data,
  });
}

export function useSaveOptionalFees() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: {
      termId: string;
      feeCategoryId: string;
      rows: Array<{ studentProfileId: string; amount?: number | null; isActive?: boolean }>;
    }) =>
      (await api.post<{ created: number; updated: number; removed: number }>(
        `${S}/student-optional-fees/bulk`,
        dto,
      )).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['school', 'optional-fees'] }),
  });
}

export function useStudentOptionalFees(studentProfileId: string) {
  return useQuery({
    queryKey: ['school', 'optional-fees', 'by-student', studentProfileId],
    enabled: !!studentProfileId,
    queryFn: async () =>
      (await api.get<any[]>(`${S}/student-optional-fees/by-student/${studentProfileId}`)).data,
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
  payment: { id: string; paymentNumber?: string; amount: string; paymentMethod?: string; paymentDate?: string } | null;
  allocations: Array<{ documentId: string; amount: number }>;
  unallocated: number;
  /** B1: the fee credit an overpayment became, when conversion was requested. */
  overpaymentCredit?: { id: string; code: string; amount: string } | null;
  replayed: boolean;
}

/** Everything a receipt, refund, credit or waiver changes on screen. */
function invalidateMoney(qc: ReturnType<typeof useQueryClient>, studentProfileId?: string) {
  qc.invalidateQueries({ queryKey: ['school', 'finance'] });
  qc.invalidateQueries({ queryKey: ['school', 'reports'] });
  qc.invalidateQueries({ queryKey: ['school', 'fee-defaulters'] });
  qc.invalidateQueries({ queryKey: ['school', 'fee-credits'] });
  qc.invalidateQueries({ queryKey: ['school', 'refund-requests'] });
  if (studentProfileId) qc.invalidateQueries({ queryKey: ['school', 'statement', studentProfileId] });
  else qc.invalidateQueries({ queryKey: ['school', 'statement'] });
}

export function useCollectPayment() {
  const qc = useQueryClient();
  // One Idempotency-Key per attempt, reused on retry (F9): a dropped response
  // retried by the bursar used to record the cash twice.
  const attempt = useAttemptKey('collect');
  return useMutation({
    mutationFn: async (dto: {
      studentProfileId: string;
      amount: number;
      paymentMethod: 'cash' | 'bank' | 'mobile_money' | 'card';
      cashSessionId?: string;
      reference?: string;
      /** Machine-issued idempotency key (MoMo/bank txn id) — never narration. */
      externalReference?: string;
      externalReferenceType?: 'mobile_money_txn' | 'bank_txn' | 'card_txn' | 'import_row';
      paymentDate?: string;
      allocations?: Array<{ documentId: string; amount: number }>;
      /** B1: turn whatever the tender does not settle into a fee credit. */
      convertOverpaymentToCredit?: boolean;
    }) =>
      (
        await api.post<CollectResult>(`${S}/payments/collect`, dto, {
          headers: { 'Idempotency-Key': attempt.keyFor(dto) },
        })
      ).data,
    onSuccess: (_d, v) => {
      attempt.reset();
      invalidateMoney(qc, v.studentProfileId);
    },
  });
}

/* ── B4 · reporting day: a whole class of receipts at once ── */

export interface BatchRow {
  studentProfileId: string;
  amount: number;
  paymentMethod?: 'cash' | 'bank' | 'mobile_money' | 'card';
  reference?: string;
  externalReference?: string;
  externalReferenceType?: 'import_row';
  convertOverpaymentToCredit?: boolean;
}
export interface BatchResult {
  total: number;
  posted: number;
  replayed: number;
  failed: number;
  totalCollected: number;
  results: Array<{
    studentProfileId: string;
    status: 'posted' | 'replayed' | 'failed';
    paymentNumber?: string;
    allocated?: number;
    unallocated?: number;
    creditCode?: string;
    error?: string;
  }>;
}
export function useCollectBatch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: { rows: BatchRow[]; paymentDate?: string; cashSessionId?: string }) =>
      (await api.post<BatchResult>(`${S}/payments/collect-batch`, dto)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['school', 'reports'] });
      qc.invalidateQueries({ queryKey: ['school', 'finance'] });
    },
  });
}

/* ── B2 · receipts a bursar can find again ── */

export interface ReceiptRow {
  id: string;
  paymentNumber: string;
  paymentDate: string;
  paymentMethod: string;
  amount: number;
  allocatedAmount: number;
  unallocatedAmount: number;
  reference?: string | null;
  externalReference?: string | null;
  status: string;
  reversed: boolean;
  studentProfileId: string | null;
  admissionNo: string | null;
  studentName: string | null;
  phone: string | null;
  allocations: Array<{ id: string; documentId: string; documentNumber: string | null; amount: number; status: string }>;
  reversedAllocations: number;
}
export function useReceiptSearch(params: { q?: string; from?: string; to?: string; page?: number; pageSize?: number }) {
  return useQuery({
    queryKey: ['school', 'finance', 'receipts', params],
    queryFn: async () =>
      (await api.get<{ data: ReceiptRow[]; total: number; page: number; pageSize: number }>(
        `${S}/finance/receipts`,
        { params },
      )).data,
  });
}
export function useReceipt(id?: string) {
  return useQuery({
    queryKey: ['school', 'finance', 'receipt', id],
    enabled: !!id,
    queryFn: async () => (await api.get<any>(`${S}/finance/receipts/${id}`)).data,
  });
}

/* ── B3 · correcting a mis-keyed receipt ── */

export function useReverseAllocation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ allocationId, reason }: { allocationId: string; reason: string }) =>
      (await api.post<CorrectionOutcome>(`${S}/finance/allocations/${allocationId}/reverse`, { reason })).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['school'] }),
  });
}
export function useReversePayment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ paymentId, reason }: { paymentId: string; reason: string }) =>
      (await api.post<CorrectionOutcome>(`${S}/finance/payments/${paymentId}/reverse`, { reason })).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['school'] }),
  });
}
export function useReallocatePayment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      paymentId,
      allocations,
      reason,
    }: {
      paymentId: string;
      allocations: Array<{ documentId: string; amount: number }>;
      reason: string;
    }) => (await api.post<CorrectionOutcome>(`${S}/finance/payments/${paymentId}/reallocate`, { allocations, reason })).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['school'] }),
  });
}

/**
 * D4 (re-audit #3): reversals, reallocations and manual credits are
 * maker-checker. A request comes back `pending_approval` unless the caller
 * holds both sides (then `applied`).
 */
export type CorrectionOutcome = { status: 'applied' | 'pending_approval'; requestId?: string };
export interface FeeCorrectionRequest {
  id: string;
  status: string;
  createdAt: string;
  createdById: string | null;
  snapshot: {
    kind: 'reverse_allocation' | 'reallocate' | 'reverse_payment' | 'credit';
    amount: number | null;
    correction: Record<string, any> & { reason?: string };
  };
}
export function useFeeCorrections(status: 'pending' | 'approved' | 'rejected' = 'pending') {
  return useQuery({
    queryKey: ['school', 'fee-corrections', status],
    enabled: canReadFees(),
    queryFn: async () =>
      (await api.get<FeeCorrectionRequest[]>(`${S}/finance/corrections`, { params: { status } })).data,
  });
}
export function useDecideFeeCorrection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { id: string; decision: 'approve' | 'reject'; reason?: string }) =>
      (
        await api.post(
          `${S}/finance/corrections/${v.id}/${v.decision}`,
          v.decision === 'approve' ? { comment: v.reason } : { reason: v.reason },
        )
      ).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['school'] }),
  });
}

/* ── C1 · fee clearance before exams ── */

export interface ClearanceRow {
  studentProfileId: string;
  admissionNo?: string | null;
  studentName?: string;
  status: 'cleared' | 'partial' | 'blocked';
  billed: number;
  settled: number;
  outstanding: number;
  settledPercent: number;
  thresholdPercent: number;
  shortfall: number;
}
export function useFeeClearance(studentProfileId?: string) {
  return useQuery({
    queryKey: ['school', 'finance', 'clearance', studentProfileId],
    enabled: !!studentProfileId,
    queryFn: async () =>
      (await api.get<ClearanceRow>(`${S}/finance/clearance/student/${studentProfileId}`)).data,
  });
}
export function useClassFeeClearance(classId?: string, thresholdPercent?: number) {
  return useQuery({
    queryKey: ['school', 'finance', 'clearance', 'class', classId, thresholdPercent],
    enabled: !!classId,
    queryFn: async () =>
      (await api.get<{
        classId: string;
        thresholdPercent: number;
        total: number;
        cleared: number;
        partial: number;
        blocked: number;
        rows: ClearanceRow[];
      }>(`${S}/finance/clearance/class/${classId}`, { params: { thresholdPercent } })).data,
  });
}

/* ── C2 · SMS reminders ── */

export function useSendFeeReminders() {
  return useMutation({
    mutationFn: async (dto: { classId?: string; daysAhead?: number; overdue?: boolean; minBalance?: number }) =>
      (await api.post<{ sent: number; skipped: number; students: number }>(
        `${S}/finance/reminders/send`,
        dto,
      )).data,
  });
}

/* ── C4 · the statement a parent is handed ── */

export function useTermStatement(studentProfileId?: string, termId?: string) {
  return useQuery({
    queryKey: ['school', 'finance', 'statement', studentProfileId, termId],
    enabled: !!studentProfileId,
    queryFn: async () =>
      (await api.get<any>(`${S}/finance/statement/${studentProfileId}`, { params: { termId } })).data,
  });
}

/* ── Live mobile money (MTN MoMo / Airtel) ── */

export interface MomoRequest {
  id: string;
  provider: string;
  providerRef: string;
  msisdn: string;
  amount: number;
  status: 'pending' | 'succeeded' | 'failed' | 'needs_review';
  receivedAmount?: number | string | null;
  currency?: string | null;
  paymentId?: string | null;
  settlementId?: string | null;
  failureReason?: string | null;
  settledAt?: string | null;
  createdAt: string;
  studentProfile?: { admissionNo: string; partner?: { name: string } | null } | null;
}
export function useMomoAvailability() {
  return useQuery({
    queryKey: ['school', 'momo', 'availability'],
    queryFn: async () => (await api.get<{ mtn: boolean; airtel: boolean }>(`${S}/mobile-money/availability`)).data,
  });
}
export function useMomoRequests(params: { studentProfileId?: string; status?: string } = {}) {
  return useQuery({
    queryKey: ['school', 'momo', 'requests', params],
    refetchInterval: 10_000, // a pending prompt resolves on the parent's phone
    queryFn: async () => (await api.get<MomoRequest[]>(`${S}/mobile-money/requests`, { params })).data,
  });
}
export function useRequestMomoPayment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: { provider: 'mtn' | 'airtel'; studentProfileId: string; amount: number; phone: string; note?: string }) => {
      const { provider, ...body } = dto;
      return (await api.post<{ id: string; reference: string; status: string; message?: string }>(
        `${S}/mobile-money/${provider}/request`,
        body,
      )).data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['school', 'momo'] }),
  });
}

/* ── "Why does this pupil owe this?" ── */

export interface BalanceExplainer {
  studentProfileId: string;
  studentName: string | null;
  admissionNo: string;
  className: string | null;
  headline: string;
  summary: { billed: number; paid: number; waived: number; credited: number; adjusted: number; outstanding: number };
  lines: Array<{
    date: string;
    label: string;
    amount: number;
    kind: string;
    sourceType: string;
    sourceId: string;
    reference: string;
    runningBalance: number;
  }>;
  clearance?: ClearanceRow | null;
}
export function useBalanceExplainer(studentProfileId?: string) {
  return useQuery({
    queryKey: ['school', 'finance', 'explain', studentProfileId],
    enabled: !!studentProfileId,
    queryFn: async () => (await api.get<BalanceExplainer>(`${S}/finance/explain/${studentProfileId}`)).data,
  });
}

/* ── Parent self-service payment ── */

export function useParentPayQuote(studentProfileId?: string) {
  return useQuery({
    queryKey: ['school', 'portal', 'pay-quote', studentProfileId],
    enabled: !!studentProfileId,
    queryFn: async () =>
      (await api.get<{
        studentProfileId: string;
        outstanding: number;
        billed: number;
        collected: number;
        providers: { mtn: boolean; airtel: boolean };
      }>(`${S}/portals/parent/${studentProfileId}/pay-quote`)).data,
  });
}
export function useParentPay() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: { studentProfileId: string; provider: 'mtn' | 'airtel'; amount: number; phone: string }) => {
      const { studentProfileId, ...body } = dto;
      return (await api.post<{ status: string; reference: string; message?: string }>(
        `${S}/portals/parent/${studentProfileId}/pay`,
        body,
      )).data;
    },
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ['school', 'portal', 'payments', v.studentProfileId] });
      qc.invalidateQueries({ queryKey: ['school', 'portal', 'pay-quote', v.studentProfileId] });
    },
  });
}
export function useParentPayments(studentProfileId?: string) {
  return useQuery({
    queryKey: ['school', 'portal', 'payments', studentProfileId],
    enabled: !!studentProfileId,
    refetchInterval: 10_000,
    queryFn: async () => (await api.get<MomoRequest[]>(`${S}/portals/parent/${studentProfileId}/payments`)).data,
  });
}

/* ───────────────────── Portal accounts (registrar provisioning) ─────────────────────
 *
 * The endpoints behind these have existed since the PortalIdentity migration and
 * had no caller anywhere in the web app — so there was no way to create a portal
 * login at all, and the portal had no users. Gated on `school:portal:accounts:write`,
 * deliberately separate from the portal permissions themselves: being able to USE
 * the parent portal must not imply being able to MINT accounts that see other
 * families.
 */

export interface PortalAccount {
  id: string;
  userId: string;
  subjectType: 'student' | 'guardian';
  studentProfileId: string | null;
  guardianContactId: string | null;
  revokedAt: string | null;
  createdAt: string;
  user?: {
    id: string;
    email: string;
    firstName: string;
    lastName: string | null;
    /** False until the invite is accepted — an unaccepted invite is not a login. */
    isActive: boolean;
    lastLoginAt: string | null;
  } | null;
}

export interface InvitePortalAccountInput {
  subjectType: 'student' | 'guardian';
  /** Required iff subjectType === 'student'. */
  studentProfileId?: string;
  /** Required iff subjectType === 'guardian'. FK to Contact. */
  guardianContactId?: string;
  /** Where the invite is sent. Becomes the login identifier. */
  email: string;
  firstName?: string;
  lastName?: string;
}

export interface InvitePortalAccountResult {
  userId: string;
  /** Empty when the account was already linked — nothing new was sent. */
  inviteToken: string;
  expiresInDays: number;
}

export function usePortalAccounts(studentProfileId: string | undefined) {
  return useQuery({
    queryKey: ['school', 'portal-accounts', studentProfileId],
    enabled: !!studentProfileId,
    queryFn: async () =>
      (await api.get<PortalAccount[]>(`${S}/portal-accounts/student/${studentProfileId}`)).data,
  });
}

export function useInvitePortalAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: InvitePortalAccountInput) =>
      (await api.post<InvitePortalAccountResult>(`${S}/portal-accounts/invite`, dto)).data,
    onSuccess: (_d, v) =>
      qc.invalidateQueries({ queryKey: ['school', 'portal-accounts', v.studentProfileId] }),
  });
}

export function useRevokePortalAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: { portalIdentityId: string; studentProfileId?: string }) =>
      (await api.delete<{ ok: true }>(`${S}/portal-accounts/${dto.portalIdentityId}`)).data,
    onSuccess: (_d, v) =>
      qc.invalidateQueries({ queryKey: ['school', 'portal-accounts', v.studentProfileId] }),
  });
}

export interface BulkInviteOutcome {
  studentProfileId: string;
  studentName: string;
  guardianName: string;
  email: string | null;
  status: 'invited' | 'already-linked' | 'no-email' | 'failed';
  detail?: string;
}

/**
 * Invite every guardian in a class, one term-start action instead of forty.
 *
 * Fanned out on the client rather than added as a bulk endpoint: it composes
 * two routes that already exist and already enforce their own permissions, and
 * a server-side loop would need its own partial-failure reporting to say the
 * same thing this returns. Guardians with no email on file are reported, never
 * skipped silently — an unreported skip is a family that never hears from the
 * school and nobody notices.
 */
export function useBulkInviteGuardians() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: { classId: string }): Promise<BulkInviteOutcome[]> => {
      const roster = (await api.get<RosterStudent[]>(`${S}/students/by-class/${dto.classId}`)).data;
      const results: BulkInviteOutcome[] = [];

      for (const student of roster) {
        const studentName = student.partner?.name ?? student.admissionNo;
        let guardians: Guardian[] = [];
        try {
          guardians = (await api.get<Guardian[]>(`${S}/guardians/by-student/${student.id}`)).data;
        } catch {
          results.push({
            studentProfileId: student.id,
            studentName,
            guardianName: '—',
            email: null,
            status: 'failed',
            detail: 'could not read guardians',
          });
          continue;
        }

        for (const g of guardians) {
          const name = [g.contact?.firstName, g.contact?.lastName].filter(Boolean).join(' ') || 'Guardian';
          const email = g.contact?.email?.trim() || null;
          if (!email) {
            results.push({ studentProfileId: student.id, studentName, guardianName: name, email: null, status: 'no-email' });
            continue;
          }
          try {
            const res = await api.post<InvitePortalAccountResult>(`${S}/portal-accounts/invite`, {
              subjectType: 'guardian',
              guardianContactId: g.guardianContactId,
              email,
              firstName: g.contact?.firstName,
              lastName: g.contact?.lastName ?? undefined,
            });
            results.push({
              studentProfileId: student.id,
              studentName,
              guardianName: name,
              email,
              // An empty token means the account was already linked, so nothing
              // was sent. Saying "invited" there would promise an email that
              // never arrives.
              status: res.data.inviteToken ? 'invited' : 'already-linked',
            });
          } catch (e: any) {
            results.push({
              studentProfileId: student.id,
              studentName,
              guardianName: name,
              email,
              status: 'failed',
              detail: e?.response?.data?.message ?? 'invite failed',
            });
          }
        }
      }
      return results;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['school', 'portal-accounts'] }),
  });
}

/* ── D3 · per-pupil fee overrides ── */

export interface StudentFeeAssignment {
  id: string;
  studentProfileId: string;
  feeStructureId: string;
  termId: string;
  /** { componentCode: amount } — what THIS pupil pays for that component. */
  customDiscount: Record<string, number>;
  studentProfile?: { admissionNo: string; partner?: { name: string } | null } | null;
  feeStructure?: { name: string } | null;
  term?: { name: string } | null;
}

export function useStudentFeeAssignments(studentProfileId?: string) {
  return useQuery({
    queryKey: ['school', 'fee-assignments', studentProfileId],
    enabled: !!studentProfileId,
    queryFn: async () =>
      (await api.get<StudentFeeAssignment[]>(`${S}/student-fee-assignments/by-student/${studentProfileId}`)).data,
  });
}
export function useUpsertStudentFeeAssignment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: {
      id?: string;
      studentProfileId: string;
      feeStructureId: string;
      termId: string;
      customDiscount: Record<string, number>;
    }) => {
      const { id, ...body } = dto;
      // An override for a (pupil, structure, term) already exists or it does
      // not; the caller does not need to care which.
      return id
        ? (await api.patch(`${S}/student-fee-assignments/${id}`, body)).data
        : (await api.post(`${S}/student-fee-assignments`, body)).data;
    },
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ['school', 'fee-assignments', v.studentProfileId] });
    },
  });
}
export function useDeleteStudentFeeAssignment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => (await api.delete(`${S}/student-fee-assignments/${id}`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['school', 'fee-assignments'] }),
  });
}

/* ── D2 · instalment progress ── */

export function useInstallmentProgress(studentProfileId?: string, termId?: string) {
  return useQuery({
    queryKey: ['school', 'finance', 'installments', studentProfileId, termId],
    enabled: !!studentProfileId,
    queryFn: async () =>
      (await api.get<any>(`${S}/finance/installments/${studentProfileId}`, { params: { termId } })).data,
  });
}

/* ── E1 / E2 · reports ── */

export interface CashBook {
  date: string;
  byMethod: Array<{ method: string; count: number; total: number }>;
  totalCollected: number;
  receiptCount: number;
  cashTotal: number;
  refundsPaid: number;
  refundCount: number;
  netCash: number;
  reversedCount: number;
  reversedTotal: number;
  receipts: Array<{
    id: string; paymentNumber: string; time: string; payer: string;
    method: string; reference?: string | null; amount: number;
  }>;
}
export function useCashBook(date?: string) {
  return useQuery({
    queryKey: ['school', 'finance', 'cash-book', date],
    queryFn: async () => (await api.get<CashBook>(`${S}/finance/reports/cash-book`, { params: { date } })).data,
  });
}
export function useBudgetVariance(termId?: string) {
  return useQuery({
    queryKey: ['school', 'finance', 'budget-variance', termId],
    queryFn: async () =>
      (await api.get<{
        rows: Array<{
          id: string; category: string; name: string; termName?: string | null;
          planned: number; actual: number; variance: number; achievedPercent: number | null;
        }>;
        totalPlanned: number;
        totalActual: number;
      }>(`${S}/finance/reports/budget-variance`, { params: { termId } })).data,
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

/* ───────────────────────── Fees — discounts, scholarships, installments, penalties ───────────────────────── */

export interface Discount {
  id: string;
  code: string;
  name: string;
  type: 'percentage' | 'fixed_amount';
  value: number;
  isActive?: boolean;
  appliesTo?: DiscountAppliesTo | null;
}
/** Who a discount reaches. Empty means no one; the whole school must be chosen explicitly. */
export interface DiscountAppliesTo {
  allStudents?: boolean;
  studentProfileIds?: string[];
  classIds?: string[];
  gradeLevelIds?: string[];
  feeCodes?: string[];
}
export function useDiscounts() {
  return useQuery({
    queryKey: ['school', 'discounts'],
    queryFn: async () => (await api.get<Paginated<Discount>>(`${S}/discounts`, { params: { pageSize: 100 } })).data,
  });
}
export function useCreateDiscount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: { code: string; name: string; type: 'percentage' | 'fixed_amount'; value: number; appliesTo: DiscountAppliesTo }) =>
      (await api.post<Discount>(`${S}/discounts`, dto)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['school', 'discounts'] }),
  });
}

export interface Scholarship {
  id: string;
  studentProfileId: string;
  code: string;
  name: string;
  type: 'percent' | 'fixed';
  value: number;
  validFrom: string;
  validTo?: string | null;
  isActive?: boolean;
}
export function useScholarships() {
  return useQuery({
    queryKey: ['school', 'scholarships'],
    queryFn: async () => (await api.get<Paginated<Scholarship>>(`${S}/scholarships`, { params: { pageSize: 100 } })).data,
  });
}
export function useCreateScholarship() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: {
      studentProfileId: string;
      code: string;
      name: string;
      type: 'percent' | 'fixed';
      value: number;
      validFrom: string;
      validTo?: string;
    }) => (await api.post<Scholarship>(`${S}/scholarships`, dto)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['school', 'scholarships'] }),
  });
}

export interface InstallmentPlan {
  id: string;
  studentProfileId: string;
  termId: string;
  totalAmount: number;
  installments: Array<{ number: number; dueDate: string; amount: number }>;
}
export function useInstallmentPlans() {
  return useQuery({
    queryKey: ['school', 'installment-plans'],
    queryFn: async () => (await api.get<Paginated<InstallmentPlan>>(`${S}/installment-plans`, { params: { pageSize: 100 } })).data,
  });
}
export function useCreateInstallmentPlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: {
      studentProfileId: string;
      termId: string;
      totalAmount: number;
      installments: Array<{ number: number; dueDate: string; amount: number }>;
    }) => (await api.post<InstallmentPlan>(`${S}/installment-plans`, dto)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['school', 'installment-plans'] }),
  });
}

export interface PenaltyRule {
  id: string;
  feeScheduleId: string;
  type: 'percent' | 'fixed';
  value: number;
  graceDays?: number;
  isActive?: boolean;
}
export function usePenaltyRules() {
  return useQuery({
    queryKey: ['school', 'penalty-rules'],
    queryFn: async () => (await api.get<Paginated<PenaltyRule>>(`${S}/penalty-rules`, { params: { pageSize: 100 } })).data,
  });
}
export function useCreatePenaltyRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: { feeScheduleId: string; type: 'percent' | 'fixed'; value: number; graceDays?: number }) =>
      (await api.post<PenaltyRule>(`${S}/penalty-rules`, dto)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['school', 'penalty-rules'] }),
  });
}

export interface PenaltyRun {
  id: string;
  scheduleId: string;
  cronDate: string;
  totalAssessed: number;
  createdInvoices: string[];
}
export function usePenaltyRuns() {
  return useQuery({
    queryKey: ['school', 'penalty-runs'],
    queryFn: async () => (await api.get<Paginated<PenaltyRun>>(`${S}/penalty-runs`, { params: { pageSize: 100 } })).data,
  });
}

export function useRefundFee() {
  const qc = useQueryClient();
  const attempt = useAttemptKey('refund');
  return useMutation({
    mutationFn: async (dto: {
      studentProfileId: string;
      amount: number;
      paymentMethod: 'cash' | 'bank' | 'mobile_money' | 'card';
      cashSessionId?: string;
      bankAccountId?: string;
      reference?: string;
      notes?: string;
    }) =>
      (
        await api.post<
          | { status: 'refunded'; payment: { id: string; paymentNumber?: string }; replayed: boolean; overpaymentCredit: number }
          | { status: 'pending_approval'; requestId: string }
        >(`${S}/payments/refund`, dto, { headers: { 'Idempotency-Key': attempt.keyFor(dto) } })
      ).data,
    onSuccess: (_d, v) => {
      attempt.reset();
      invalidateMoney(qc, v.studentProfileId);
      qc.invalidateQueries({ queryKey: ['school', 'statement', v.studentProfileId] });
      qc.invalidateQueries({ queryKey: ['school', 'reports'] });
    },
  });
}

/**
 * Refunds are maker-checker (Wave 2.3): a Bursar's refund is filed as a
 * request and paid out when a second person with the approve grant releases it.
 */
export interface RefundRequest {
  id: string;
  status: 'pending' | 'approved' | 'rejected';
  createdById: string | null;
  createdAt: string;
  decidedAt: string | null;
  snapshot: {
    amount: number;
    studentName: string | null;
    admissionNo: string | null;
    dto: { studentProfileId: string; paymentMethod: string; reference?: string; notes?: string };
  };
  decisions: Array<{ approverId: string; status: string; comment: string | null; decidedAt: string }>;
}

export function useRefundRequests(status: 'pending' | 'approved' | 'rejected' = 'pending', enabled = true) {
  return useQuery({
    queryKey: ['school', 'refund-requests', status],
    enabled: enabled && canReadFees(),
    queryFn: async () =>
      (await api.get<RefundRequest[]>(`${S}/payments/refund-requests`, { params: { status } })).data,
  });
}

export function useDecideRefundRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { id: string; decision: 'approve' | 'reject'; reason?: string }) =>
      (
        await api.post(
          `${S}/payments/refund-requests/${v.id}/${v.decision}`,
          v.decision === 'approve' ? { comment: v.reason } : { reason: v.reason },
        )
      ).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['school', 'refund-requests'] });
      qc.invalidateQueries({ queryKey: ['school', 'statement'] });
      qc.invalidateQueries({ queryKey: ['school', 'finance'] });
      qc.invalidateQueries({ queryKey: ['school', 'reports'] });
    },
  });
}

/* ───────────────────────── Partners (for sponsors) ───────────────────────── */

export function usePartners() {
  return useQuery({
    queryKey: ['partners'],
    queryFn: async () => (await api.get<{ data: { id: string; name: string }[] }>(`/partners`, { params: { pageSize: 200 } })).data,
  });
}

/* ───────────────────────── Fees — sponsorships, waivers, credits, aging (P1/P2) ───────────────────────── */

export interface Sponsorship {
  id: string;
  sponsorId: string;
  studentProfileId: string;
  code: string;
  name: string;
  capAmount?: number | null;
  validFrom: string;
  validTo?: string | null;
  isActive?: boolean;
}
export function useSponsorships(studentProfileId?: string) {
  return useQuery({
    queryKey: ['school', 'sponsorships', studentProfileId ?? 'all'],
    queryFn: async () => (await api.get<Paginated<Sponsorship>>(`${S}/finance/sponsorships`, { params: { pageSize: 100, studentProfileId } })).data,
  });
}
export function useCreateSponsorship() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: { sponsorId: string; studentProfileId: string; code: string; name: string; capAmount?: number; validFrom: string; validTo?: string; notes?: string }) =>
      (await api.post<Sponsorship>(`${S}/finance/sponsorships`, dto)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['school', 'sponsorships'] }),
  });
}

export interface Waiver {
  id: string;
  studentProfileId: string;
  code: string;
  name: string;
  amount: number;
  reason?: string | null;
  applied: boolean;
  documentId?: string | null;
}
export function useWaivers(studentProfileId?: string) {
  return useQuery({
    queryKey: ['school', 'waivers', studentProfileId ?? 'all'],
    queryFn: async () => (await api.get<Paginated<Waiver>>(`${S}/finance/waivers`, { params: { pageSize: 100, studentProfileId } })).data,
  });
}
export function useCreateWaiver() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: { studentProfileId: string; code: string; name: string; amount: number; reason?: string; documentId?: string }) =>
      (await api.post<Waiver>(`${S}/finance/waivers`, dto)).data,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['school', 'waivers'] }); qc.invalidateQueries({ queryKey: ['school', 'fee-defaulters'] }); qc.invalidateQueries({ queryKey: ['school', 'bad-debtors'] }); },
  });
}
export function useApplyWaiver() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => (await api.post<Waiver>(`${S}/finance/waivers/${id}/apply`)).data,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['school', 'waivers'] }); qc.invalidateQueries({ queryKey: ['school', 'bad-debtors'] }); invalidateMoney(qc); },
  });
}

export interface FeeCredit {
  id: string;
  studentProfileId: string;
  code: string;
  amount: number;
  remaining: number;
  source: string;
  isActive?: boolean;
}
export function useFeeCredits(studentProfileId?: string) {
  return useQuery({
    queryKey: ['school', 'fee-credits', studentProfileId ?? 'all'],
    queryFn: async () => (await api.get<Paginated<FeeCredit>>(`${S}/finance/credits`, { params: { pageSize: 100, studentProfileId } })).data,
  });
}
export function useCreateFeeCredit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: { studentProfileId: string; amount: number; source: 'opening_balance' | 'approved_adjustment' | 'overpayment'; sourcePaymentId?: string; sourceDocumentId?: string; expiresAt?: string }) =>
      (await api.post<CorrectionOutcome>(`${S}/finance/credits`, dto)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['school', 'fee-credits'] }),
  });
}
export function useApplyCredits() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (studentProfileId: string) => (await api.post<{ totalApplied: string; appliedCreditIds: string[] }>(`${S}/finance/credits/${studentProfileId}/apply`)).data,
    onSuccess: (_d, v) => invalidateMoney(qc, v),
  });
}

export interface AgingRow { documentNumber: string; partnerName: string; dueDate: string; daysOverdue: number; residual: number; bucket: string }
export interface AgingResult { asOf: string; buckets: Record<string, number>; rows: AgingRow[] }
export function useFeeAging() {
  return useQuery({
    queryKey: ['school', 'finance', 'aging'],
    queryFn: async () => (await api.get<AgingResult>(`${S}/finance/aging`)).data,
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

/* ───────────────────────── Curriculum (versioned foundation) ───────────────────────── */

export interface Curriculum {
  id: string;
  classId: string;
  academicYearId: string;
  name: string;
  description?: string | null;
  version: number;
  status: 'draft' | 'published' | 'archived';
  parentVersionId?: string | null;
  publishedAt?: string | null;
  archivedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export function useCurricula() {
  return useQuery({
    queryKey: ['school', 'curricula'],
    queryFn: async () => (await api.get<Curriculum[]>(`${S}/curricula`, { params: { pageSize: 300 } })).data,
  });
}

export function useCreateCurriculum() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: { classId: string; academicYearId: string; name: string; description?: string; subjects: { subjectId: string; periodsPerWeek: number; isCore: boolean }[] }) =>
      (await api.post<Curriculum>(`${S}/curricula`, dto)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['school', 'curricula'] }),
  });
}

export function useUpdateCurriculum() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...dto }: { id: string; name?: string; description?: string }) =>
      (await api.patch<Curriculum>(`${S}/curricula/${id}`, dto)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['school', 'curricula'] }),
  });
}

export function usePublishCurriculum() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => (await api.post<Curriculum>(`${S}/curricula/${id}/publish`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['school', 'curricula'] }),
  });
}

export function useArchiveCurriculum() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => (await api.post<Curriculum>(`${S}/curricula/${id}/archive`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['school', 'curricula'] }),
  });
}

export function useCloneCurriculum() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => (await api.post<Curriculum>(`${S}/curricula/${id}/clone`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['school', 'curricula'] }),
  });
}

export function useDeleteCurriculum() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => (await api.delete(`${S}/curricula/${id}`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['school', 'curricula'] }),
  });
}

/* ───────────────────────── Teacher Assignments ───────────────────────── */

export interface TeacherAssignment {
  id: string;
  teacherPartnerId: string;
  subjectId: string;
  classId: string;
  sectionId?: string | null;
  streamId?: string | null;
  termId?: string | null;
  periodsPerWeek: number;
  createdAt: string;
  updatedAt: string;
  subject?: Subject;
  schoolClass?: { id: string; name: string; gradeLevel?: { name: string } };
  section?: { id: string; name: string } | null;
}

export function useTeacherAssignments() {
  return useQuery({
    queryKey: ['school', 'teacher-assignments'],
    queryFn: async () => (await api.get<Paginated<TeacherAssignment>>(`${S}/teacher-assignments`, { params: { pageSize: 400 } })).data.data,
  });
}

export function useCreateTeacherAssignment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: { teacherPartnerId: string; subjectId: string; classId: string; sectionId?: string; termId?: string; periodsPerWeek?: number }) =>
      (await api.post<TeacherAssignment>(`${S}/teacher-assignments`, dto)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['school', 'teacher-assignments'] }),
  });
}

export function useUpdateTeacherAssignment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...dto }: { id: string; periodsPerWeek?: number; sectionId?: string; termId?: string }) =>
      (await api.patch<TeacherAssignment>(`${S}/teacher-assignments/${id}`, dto)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['school', 'teacher-assignments'] }),
  });
}

export function useDeleteTeacherAssignment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => (await api.delete(`${S}/teacher-assignments/${id}`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['school', 'teacher-assignments'] }),
  });
}

/* ───────────────────────── Attendance ───────────────────────── */

// P-att-status: status is now a free string (the AttendanceStatusConfig.code),
// not a fixed union — schools configure their own catalog. Kept as `string`.
export type AttendanceStatus = string;

/** Org-configurable attendance status (AttendanceStatusConfig row). */
export interface AttendanceStatusConfig {
  id: string;
  organizationId: string;
  code: string;
  label: string;
  color: string;
  isDefault: boolean;
  sortOrder: number;
  isPresent: boolean;
  isLate: boolean;
  isAbsent: boolean;
  isExcused?: boolean;
  createdAt: string;
  updatedAt: string;
}

export function useAttendanceStatuses() {
  return useQuery({
    queryKey: ['school', 'attendance-statuses'],
    queryFn: async () => (await api.get<AttendanceStatusConfig[]>(`${S}/attendance/statuses`)).data,
  });
}

export function useCreateAttendanceStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: { code: string; label: string; color?: string; isDefault?: boolean; sortOrder?: number; isPresent?: boolean; isLate?: boolean; isAbsent?: boolean; isExcused?: boolean }) =>
      (await api.post(`${S}/attendance/statuses`, dto)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['school', 'attendance-statuses'] }),
  });
}

export function useUpdateAttendanceStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, dto }: { id: string; dto: Partial<{ code: string; label: string; color: string; isDefault: boolean; sortOrder: number; isPresent: boolean; isLate: boolean; isAbsent: boolean }> }) =>
      (await api.put(`${S}/attendance/statuses/${id}`, dto)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['school', 'attendance-statuses'] }),
  });
}

export function useDeleteAttendanceStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => (await api.delete(`${S}/attendance/statuses/${id}`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['school', 'attendance-statuses'] }),
  });
}

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
  status: string;
  statusConfig?: AttendanceStatusConfig | null;
  minutesLate: number;
  earlyDepartureMinutes?: number | null;
  reason?: string | null;
  studentProfile?: { partner?: { name?: string } };
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
      periodId?: string;
      entries: Array<{ studentProfileId: string; status: AttendanceStatus; minutesLate?: number; earlyDepartureMinutes?: number; reason?: string }>;
    }) => (await api.post(`${S}/attendance/mark`, dto)).data,
    onSuccess: (_d, v) => qc.invalidateQueries({ queryKey: ['school', 'register', v.classId, v.date] }),
  });
}

export function useCorrectAttendance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: { id: string; status: AttendanceStatus; minutesLate?: number; earlyDepartureMinutes?: number; reason?: string; correctionNote?: string }) =>
      (await api.patch(`${S}/attendance/${dto.id}`, {
        status: dto.status, minutesLate: dto.minutesLate, earlyDepartureMinutes: dto.earlyDepartureMinutes, reason: dto.reason, correctionNote: dto.correctionNote,
      })).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['school', 'register'] }),
  });
}

export interface AttendanceThreshold {
  id?: string; organizationId?: string; classId?: string | null;
  minAttendancePct: number; notifyAbsent: boolean; notifyLate: boolean; notifyEarly: boolean; notifyBelowThreshold: boolean;
}
export function useAttendanceThresholds(classId?: string) {
  return useQuery({
    queryKey: ['school', 'attendance-thresholds', classId ?? 'default'],
    queryFn: async () => (await api.get<AttendanceThreshold>(`${S}/attendance/thresholds`, { params: { classId } })).data,
  });
}
export function useUpsertAttendanceThreshold() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: Partial<AttendanceThreshold> & { classId?: string | null }) =>
      (await api.put(`${S}/attendance/thresholds`, dto)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['school', 'attendance-thresholds'] }),
  });
}
export function useAttendanceWeekly(classId: string | undefined, weekStart: string | undefined) {
  return useQuery({
    queryKey: ['school', 'attendance-weekly', classId, weekStart],
    enabled: !!classId && !!weekStart,
    queryFn: async () => (await api.get<{ from: string; to: string; byDate: Record<string, Record<string, number>> }>(`${S}/attendance/weekly`, { params: { classId, weekStart } })).data,
  });
}

export interface AttendanceReportRow {
  date: string;
  day: string;
  total: number;
  counts: Record<string, number>;
}
export interface AttendanceReport {
  classId: string;
  start: string;
  end: string;
  statuses: AttendanceStatusConfig[];
  summary: { present: number; absent: number; late: number; total: number };
  byDate: AttendanceReportRow[];
}
export function useAttendanceReport(classId: string | undefined, start: string | undefined, end: string | undefined) {
  return useQuery({
    queryKey: ['school', 'attendance-report', classId, start, end],
    enabled: !!classId && !!start && !!end,
    queryFn: async () => (await api.get<AttendanceReport>(`${S}/attendance/report`, { params: { classId, startDate: start, endDate: end } })).data,
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

export function useClassTimetable(classId: string | undefined, cycle?: string) {
  return useQuery({
    queryKey: ['school', 'timetable', classId, cycle],
    enabled: !!classId,
    queryFn: async () =>
      normalizeTimetable((await api.get<unknown>(`${S}/timetable/class/${classId}${cycle ? `?cycle=${cycle}` : ''}`)).data),
  });
}

export function useTeacherTimetable(teacherPartnerId: string | undefined, cycle?: string) {
  return useQuery({
    queryKey: ['school', 'timetable-teacher', teacherPartnerId, cycle],
    enabled: !!teacherPartnerId,
    queryFn: async () =>
      normalizeTimetable((await api.get<unknown>(`${S}/timetable/teacher/${teacherPartnerId}${cycle ? `?cycle=${cycle}` : ''}`)).data),
  });
}

export function useRoomTimetable(room: string | undefined, cycle?: string) {
  return useQuery({
    queryKey: ['school', 'timetable-room', room, cycle],
    enabled: !!room,
    queryFn: async () =>
      normalizeTimetable((await api.get<unknown>(`${S}/timetable/room/${encodeURIComponent(room!)}${cycle ? `?cycle=${cycle}` : ''}`)).data),
  });
}

export function useSubjectTimetable(subjectId: string | undefined, cycle?: string) {
  return useQuery({
    queryKey: ['school', 'timetable-subject', subjectId, cycle],
    enabled: !!subjectId,
    queryFn: async () =>
      normalizeTimetable((await api.get<unknown>(`${S}/timetable/subject/${subjectId}${cycle ? `?cycle=${cycle}` : ''}`)).data),
  });
}

export function useSpecialSchedule(from?: string, to?: string) {
  return useQuery({
    queryKey: ['school', 'timetable-special', from, to],
    enabled: !!from && !!to,
    queryFn: async () =>
      (await api.get<unknown>(`${S}/timetable/special?from=${from}&to=${to}`)).data as any[],
  });
}

export interface TimetableSlotInput {
  classId: string;
  dayOfWeek: number;
  periodId: string;
  subjectId: string;
  room?: string;
  teacherPartnerId?: string;
  type?: 'lesson' | 'break' | 'free';
  substituteTeacherId?: string;
}

export function useUpdateSlot() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, dto }: { id: string; dto: Partial<TimetableSlotInput> }) => {
      const res = await api.patch(`${S}/timetable/slots/${id}`, dto);
      return res.data;
    },
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ['school', 'timetable'] });
      if (v.dto.classId) qc.invalidateQueries({ queryKey: ['school', 'timetable', v.dto.classId] });
    },
  });
}

export function usePublishTimetable() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ classId, sectionId, published }: { classId: string; sectionId?: string; published: boolean }) => {
      const res = await api.post(`${S}/timetable/class/${classId}/publish`, { published }, {
        params: sectionId ? { sectionId } : {},
      });
      return res.data;
    },
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ['school', 'timetable', v.classId] });
      qc.invalidateQueries({ queryKey: ['school', 'timetable-teacher'] });
      qc.invalidateQueries({ queryKey: ['school', 'timetable-room'] });
      qc.invalidateQueries({ queryKey: ['school', 'timetable-subject'] });
    },
  });
}

/* ── Timetable advanced (P1/P2/P3) ──────────────────────────────────────── */

export function useStudentTimetable(studentProfileId: string | undefined, date?: string) {
  return useQuery({
    queryKey: ['school', 'timetable-student', studentProfileId, date],
    enabled: !!studentProfileId,
    queryFn: async () =>
      normalizeTimetable((await api.get<unknown>(`${S}/timetable/student/${studentProfileId}${date ? `?date=${date}` : ''}`)).data),
  });
}

export function useTeachingRooms() {
  return useQuery({
    queryKey: ['school', 'teaching-rooms'],
    queryFn: async () => (await api.get<unknown>(`${S}/timetable/rooms`)).data as any[],
  });
}
export function useCreateTeachingRoom() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: any) => (await api.post(`${S}/timetable/rooms`, dto)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['school', 'teaching-rooms'] }),
  });
}
export function useDeleteTeachingRoom() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => api.delete(`${S}/timetable/rooms/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['school', 'teaching-rooms'] }),
  });
}

export function useTeacherAvailability(teacherPartnerId: string | undefined) {
  return useQuery({
    queryKey: ['school', 'teacher-avail', teacherPartnerId],
    enabled: !!teacherPartnerId,
    queryFn: async () => (await api.get<unknown>(`${S}/timetable/availability/teacher/${teacherPartnerId}`)).data as any[],
  });
}
export function useSetAvailability() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: any) => (await api.post(`${S}/timetable/availability`, dto)).data,
    onSuccess: (_d, v) => qc.invalidateQueries({ queryKey: ['school', 'teacher-avail', v.teacherPartnerId] }),
  });
}

export function useRotation(classId: string | undefined) {
  return useQuery({
    queryKey: ['school', 'rotation', classId],
    enabled: !!classId,
    queryFn: async () => (await api.get<unknown>(`${S}/timetable/rotation/${classId}`)).data as any,
  });
}
export function useSetRotation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ classId, activeCycle }: { classId: string; activeCycle: string }) =>
      (await api.post(`${S}/timetable/rotation/${classId}`, { activeCycle })).data,
    onSuccess: (_d, v) => qc.invalidateQueries({ queryKey: ['school', 'rotation', v.classId] }),
  });
}

export function useOverrides(classId: string | undefined, sectionId?: string) {
  return useQuery({
    queryKey: ['school', 'overrides', classId, sectionId],
    enabled: !!classId,
    queryFn: async () =>
      (await api.get<unknown>(`${S}/timetable/overrides/${classId}${sectionId ? `?sectionId=${sectionId}` : ''}`)).data as any[],
  });
}
export function useCreateOverride() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: any) => (await api.post(`${S}/timetable/overrides`, dto)).data,
    onSuccess: (_d, v) => qc.invalidateQueries({ queryKey: ['school', 'overrides', v.classId] }),
  });
}
export function useDeleteOverride() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => api.delete(`${S}/timetable/overrides/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['school', 'overrides'] }),
  });
}

export function useGenerateTimetable() {
  return useMutation({
    mutationFn: async (dto: any) => (await api.post(`${S}/timetable/generate`, dto)).data,
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

/**
 * A school-side staff roster row.
 *
 * Schema-truth: `StaffProfile` has NO firstName/lastName/gender/designation/
 * dateOfJoining/qualification — those were declared here but never existed, so
 * the UI rendered empty columns and fell through to the employee number for
 * every Name cell. The person's identity lives on the linked `Partner`;
 * qualifications and job title live on the HR record.
 */
export interface StaffMember {
  id: string;
  employeeNo: string;
  staffCategory: string;
  joinDate?: string | null;
  contractType?: string | null;
  department?: { id: string; name: string } | null;
  position?: { id: string; name: string } | null;
  campus?: { id: string; name: string } | null;
  status?: string;
  partnerId?: string;
  partner?: { id?: string; name?: string; email?: string | null; phone?: string | null } | null;
}

export function useStaffById(id: string | undefined) {
  return useQuery({
    queryKey: ['school', 'staff', id],
    enabled: !!id,
    queryFn: async () => (await api.get<StaffMember>(`${S}/staff/${id}`)).data,
  });
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

export function usePositions() {
  return useQuery({
    queryKey: ['school', 'positions'],
    queryFn: async () => (await api.get<Paginated<{ id: string; name: string; code?: string }>>(`${S}/positions`, { params: { pageSize: 100 } })).data,
  });
}

export function useUpdateStaff() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, dto }: { id: string; dto: any }) => (await api.patch(`${S}/staff/${id}`, dto)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['school', 'staff'] }),
  });
}

export function useCreateStaff() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: any) => (await api.post(`${S}/staff`, dto)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['school', 'staff'] }),
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

export interface ReportCardPayloadSection {
  title: string;
  subjects: Array<{
    subject: string;
    subjectCode?: string;
    isCompulsory?: boolean;
    isPrincipal?: boolean;
    examScores: Array<{ examType: string; marks: number; maxMarks: number; grade: string | null; points: number | null }>;
    totalPercent: number;
    finalGrade: string | null;
    finalPoints: number | null;
    remark?: string | null;
  }>;
}
export interface ReportCardPayload {
  system?: string;
  term?: { id: string; name: string; startDate?: string; endDate?: string };
  termName?: string;
  gpa?: number | null;
  rank?: number | null;
  meanPercent?: number | null;
  totalMarks?: number | null;
  division?: string | null;
  promotionRecommendation?: string | null;
  sections?: ReportCardPayloadSection[];
  summary?: Array<{ label: string; value: string }>;
  eligible?: { qualifies: boolean; reason: string } | null;
  columnHeaders?: string[];
  footer?: string[];
  classTeacherComment?: string | null;
  principalComment?: string | null;
}
export interface ReportCard {
  id: string;
  studentProfileId: string;
  termId: string;
  payload?: ReportCardPayload;
  pdfUrl?: string | null;
  publishedAt?: string | null;
  generatedAt?: string;
}

/**
 * An ordered, tickable list (student biodata fields, table columns, page
 * blocks). Order is significant — it is the print order.
 */
export interface ReportCardColumnItem {
  key: string;
  label: string;
  enabled: boolean;
}

/**
 * The resolved report card configuration. The server merges stored values over
 * registry defaults, so every key is always present. Keys are open-ended: the
 * field registry is served by `useReportCardSettingsSchema`, and the settings
 * UI renders whatever it describes — a new server-side option needs no change
 * here. The named members below are the ones other pages read directly.
 */
export interface ReportCardSettings extends Record<string, unknown> {
  id: string;
  organizationId: string;
  presetKey: string | null;

  // Visibility (also stored as real columns for the report card viewer).
  showSchoolLogo: boolean;
  showStudentPhoto: boolean;
  showWatermark: boolean;
  showClassTeacherComment: boolean;
  showHeadTeacherComment: boolean;
  showTermStartDate: boolean;
  showTermEndDate: boolean;
  showFeesBalance: boolean;
  showSchoolMotto: boolean;

  // Header palette.
  schoolNameColor: string;
  schoolAddressColor: string;
  contactColor: string;
  websiteColor: string;
  emailColor: string;
  reportTitleColor: string;

  // Ordered lists.
  studentFields: ReportCardColumnItem[];
  tableColumns: ReportCardColumnItem[];
  blockOrder: ReportCardColumnItem[];
}

export type ReportCardFieldType =
  | 'boolean' | 'color' | 'number' | 'text' | 'textarea' | 'select' | 'list' | 'columns';

export interface ReportCardFieldDef {
  key: string;
  label: string;
  type: ReportCardFieldType;
  group: string;
  default: unknown;
  help?: string;
  options?: Array<{ value: string; label: string }>;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  column?: boolean;
  showIf?: { key: string; equals?: unknown };
  locked?: string[];
}

export interface ReportCardSettingsSchema {
  groups: Array<{ key: string; label: string; description: string; icon: string }>;
  fields: ReportCardFieldDef[];
  presets: Array<{ key: string; label: string; description: string; overrides: Record<string, unknown> }>;
  defaults: Record<string, unknown>;
}

const RCS_KEY = ['school', 'report-card-settings'] as const;

export function useReportCardSettings() {
  return useQuery({
    queryKey: RCS_KEY,
    queryFn: async () => (await api.get<ReportCardSettings>(`${S}/report-card-settings`)).data,
  });
}

/**
 * The field registry that drives the settings UI. Static for the life of a
 * deployment, so it is cached indefinitely rather than refetched per mount.
 */
export function useReportCardSettingsSchema() {
  return useQuery({
    queryKey: ['school', 'report-card-settings', 'schema'],
    queryFn: async () => (await api.get<ReportCardSettingsSchema>(`${S}/report-card-settings/schema`)).data,
    staleTime: Infinity,
  });
}

export function useUpdateReportCardSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: Record<string, unknown>) =>
      (await api.patch<ReportCardSettings>(`${S}/report-card-settings`, dto)).data,
    onSuccess: (data) => {
      qc.setQueryData(RCS_KEY, data);
      qc.invalidateQueries({ queryKey: RCS_KEY });
    },
  });
}

/** Replace the whole configuration with a named preset. */
export function useApplyReportCardPreset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (key: string) =>
      (await api.post<ReportCardSettings>(`${S}/report-card-settings/preset`, { key })).data,
    onSuccess: (data) => {
      qc.setQueryData(RCS_KEY, data);
      qc.invalidateQueries({ queryKey: RCS_KEY });
    },
  });
}

/** Reset to defaults — the whole card, or one settings group. */
export function useResetReportCardSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (group?: string) =>
      (await api.post<ReportCardSettings>(`${S}/report-card-settings/reset`, { group })).data,
    onSuccess: (data) => {
      qc.setQueryData(RCS_KEY, data);
      qc.invalidateQueries({ queryKey: RCS_KEY });
    },
  });
}

    /* ───────────────── Fee Waivers & Categories ───────────────── */

    export interface WaiverCategory {
    id: string;
    organizationId: string;
    code: string;
    name: string;
    description?: string | null;
    type: 'percentage' | 'fixed';
    value: number;
    defaultReason?: string | null;
    appliesTo?: { gradeLevelIds?: string[]; classIds?: string[] } | null;
    isActive: boolean;
    createdAt?: string;
    updatedAt?: string;
    }

    export interface FeeDefaulterRow {
    studentProfileId: string;
    studentName: string;
    admissionNo?: string | null;
    className: string;
    totalBalance: number;
    oldestDueDate?: string | null;
    maxDaysOverdue: number;
    invoiceCount: number;
    waived: number;
    }

    const FIN = 'school/finance';

    export function useWaiverCategories(includeInactive = false) {
    return useQuery({
      queryKey: ['school', 'waiver-categories', includeInactive],
      queryFn: async () => (await api.get<WaiverCategory[]>(`${FIN}/waiver-categories${includeInactive ? '?includeInactive=true' : ''}`)).data,
    });
    }

    export function useCreateWaiverCategory() {
    const qc = useQueryClient();
    return useMutation({
      mutationFn: async (dto: Partial<WaiverCategory>) => (await api.post<WaiverCategory>(`${FIN}/waiver-categories`, dto)).data,
      onSuccess: () => qc.invalidateQueries({ queryKey: ['school', 'waiver-categories'] }),
    });
    }

    export function useUpdateWaiverCategory() {
    const qc = useQueryClient();
    return useMutation({
      mutationFn: async ({ id, ...dto }: Partial<WaiverCategory> & { id: string }) => (await api.patch<WaiverCategory>(`${FIN}/waiver-categories/${id}`, dto)).data,
      onSuccess: () => qc.invalidateQueries({ queryKey: ['school', 'waiver-categories'] }),
    });
    }

    export function useDeleteWaiverCategory() {
    const qc = useQueryClient();
    return useMutation({
      mutationFn: async (id: string) => (await api.delete(`${FIN}/waiver-categories/${id}`)).data,
      onSuccess: () => qc.invalidateQueries({ queryKey: ['school', 'waiver-categories'] }),
    });
    }

    export function useFeeDefaulters(asOf?: string, minBalance = 0, classId?: string) {
    return useQuery({
      queryKey: ['school', 'fee-defaulters', asOf, minBalance, classId],
      queryFn: async () => (await api.get<{ asOf: string; count: number; rows: FeeDefaulterRow[] }>(`${FIN}/fee-defaulters?minBalance=${minBalance}${asOf ? `&asOf=${asOf}` : ''}${classId ? `&classId=${classId}` : ''}`)).data,
    });
    }

    export function useBadDebtors(asOf?: string, thresholdDays = 90, classId?: string) {
    return useQuery({
      queryKey: ['school', 'bad-debtors', asOf, thresholdDays, classId],
      queryFn: async () => (await api.get<{ asOf: string; thresholdDays: number; count: number; rows: FeeDefaulterRow[] }>(`${FIN}/bad-debtors?thresholdDays=${thresholdDays}${asOf ? `&asOf=${asOf}` : ''}${classId ? `&classId=${classId}` : ''}`)).data,
    });
    }

    export function useWriteOffBadDebt() {
    const qc = useQueryClient();
    return useMutation({
      mutationFn: async ({ studentProfileId, reason }: { studentProfileId: string; reason?: string }) => (await api.post(`${FIN}/bad-debtors/${studentProfileId}/write-off`, { reason })).data,
      onSuccess: () => { qc.invalidateQueries({ queryKey: ['school', 'bad-debtors'] }); qc.invalidateQueries({ queryKey: ['school', 'fee-defaulters'] }); qc.invalidateQueries({ queryKey: ['school', 'waivers'] }); },
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

/* ── Class-wide report cards ────────────────────────────────────────────────
 * A term ends for a whole class at once. Generating, releasing and printing one
 * pupil at a time is the single biggest source of end-of-term clicking in the
 * app, so each of those three has a class-scoped counterpart.
 */

export interface ClassRollEntry {
  id: string;
  name: string | null;
  admissionNo: string | null;
  rollNumber: string | null;
}

export interface ClassReportCardScope {
  classId: string;
  termId: string;
  sectionId?: string;
}

/** Who a class run would cover, so the count is visible before committing to it. */
export function useReportCardClassRoll(scope: Partial<ClassReportCardScope>) {
  const { classId, termId, sectionId } = scope;
  return useQuery({
    queryKey: ['school', 'report-cards', 'class-roll', classId, termId, sectionId],
    enabled: !!classId && !!termId,
    queryFn: async () =>
      (await api.get<ClassRollEntry[]>(`${S}/report-cards/class-roll`, {
        params: { classId, termId, sectionId },
      })).data,
  });
}

export function useGenerateClassReportCards() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: ClassReportCardScope) =>
      (await api.post<{
        generated: number;
        skipped: Array<{ studentProfileId: string; name: string | null; reason: string }>;
      }>(`${S}/report-cards/generate-class`, dto)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['school', 'report-cards'] }),
  });
}

export function usePublishClassReportCards() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: ClassReportCardScope) =>
      (await api.post<{ published: number; alreadyPublished: number; notGenerated: number; awaitingResults?: number }>(
        `${S}/report-cards/publish-class`,
        dto,
      )).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['school', 'report-cards'] }),
  });
}

/** One PDF for the whole class. Released cards only — printing is distribution. */
export async function downloadClassReportCards(scope: ClassReportCardScope): Promise<Blob> {
  const res = await api.get(`${S}/report-cards/class-pdf`, {
    params: scope,
    responseType: 'blob',
  });
  return res.data as Blob;
}

/* ───────────────────────── Meals (V1) ───────────────────────── */

export interface MealProgram { id: string; name: string; kind: string; description?: string | null; isActive: boolean }
export interface MealType { id: string; name: string; order: number; startTime?: string | null; endTime?: string | null; isActive: boolean }
export interface MealPlan { id: string; name: string; type: string; pricePerTerm: string; billingModel: string; fundingModel: string; mealProgramId?: string | null; feeProductId?: string | null; isActive: boolean; trackInventory?: boolean; menus?: MealMenu[] }
export interface MealEntitlement { id: string; mealTypeId: string; mealType?: MealType }
export type MealAttendanceStatus = 'served' | 'absent' | 'excused' | 'not_eligible';
export interface MealPlanAssignment {
  id: string; studentProfileId: string; mealPlanId: string; termId: string;
  startDate: string; endDate?: string | null; status: string;
  mealPlan?: MealPlan; studentProfile?: { admissionNo: string; partner?: { name: string } | null } | null;
}
export interface MealSession { id: string; mealTypeId: string; date: string; classId?: string | null; expectedCount: number; servedCount: number; status: string; mealType?: MealType }
export interface MealRosterRow { studentProfileId: string; admissionNo?: string; name?: string | null; status: MealAttendanceStatus | null; allergies?: string[]; dietaryRequirements?: string[] }
export interface TodaysMeal { mealTypeId: string; mealType: string; expected: number; served: number; sessions: number; status: string; sessionIds: string[] }
export interface TodaysMeals { date: string; meals: TodaysMeal[] }
export interface MealMenu { id: string; mealTypeId: string; mealPlanId?: string | null; date?: string | null; dayOfWeek?: number | null; title?: string | null; items?: Array<{ id: string; name: string; notes?: string | null; sortOrder: number; posMenuItemId?: string | null; mealRecipeId?: string | null }>; mealType?: MealType }

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
export function useUpdateMealPlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: { id: string; name?: string; pricePerTerm?: number; type?: string; billingModel?: string; fundingModel?: string; mealProgramId?: string; isActive?: boolean; trackInventory?: boolean; mealMenuIds?: string[] }) =>
      (await api.patch<MealPlan>(`${CAFE}/plans/${dto.id}`, dto)).data,
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

/* ───────────────────────── Per-student (per-lunch) consumption ───────────────────────── */
export interface MealConsumptionRow {
  id: string;
  mealSessionId?: string | null;
  mealMenuId?: string | null;
  studentProfileId?: string | null;
  productId: string;
  quantity: number;
  unitCost: number;
  createdAt: string;
  product?: { id: string; name: string; sku?: string | null };
  studentProfile?: { partner?: { name: string } | null } | null;
  menu?: { id: string; title?: string | null } | null;
}
export function useRecordConsumption() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: { mealSessionId: string; studentProfileId: string; mealMenuId?: string; stockLocationId?: string }) =>
      (await api.post<MealConsumptionRow[]>(`${MEALS}/consumption/record`, dto)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['school', 'meal-consumption'] });
      qc.invalidateQueries({ queryKey: ['school', 'meals-today'] });
    },
  });
}
export function useMealConsumption(query: { mealSessionId?: string; studentProfileId?: string; mealMenuId?: string; mealPlanId?: string; from?: string; to?: string } = {}) {
  const params: Record<string, string> = {};
  if (query.mealSessionId) params.mealSessionId = query.mealSessionId;
  if (query.studentProfileId) params.studentProfileId = query.studentProfileId;
  if (query.mealMenuId) params.mealMenuId = query.mealMenuId;
  if (query.mealPlanId) params.mealPlanId = query.mealPlanId;
  if (query.from) params.from = query.from;
  if (query.to) params.to = query.to;
  return useQuery({
    queryKey: ['school', 'meal-consumption', query],
    queryFn: async () => (await api.get<MealConsumptionRow[]>(`${MEALS}/consumption`, { params })).data,
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
export function useWalletPurchase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: { mealAccountId: string; amount: number; description: string; reference?: string }) =>
      (await api.post<MealAccount>(`${MEALS}/wallet/purchase`, dto)).data,
    onSuccess: (_d, v) => qc.invalidateQueries({ queryKey: ['school', 'meal-wallet', v.mealAccountId] }),
  });
}
export function useWalletByStudent(studentProfileId: string | undefined) {
  return useQuery({
    queryKey: ['school', 'meal-wallet-by-student', studentProfileId],
    enabled: !!studentProfileId,
    queryFn: async () => (await api.get<{ exists: boolean; balance: number; mealPlan?: any }>(`${MEALS}/wallet/by-student/${studentProfileId}`)).data,
  });
}
export function useMealReports(from?: string, to?: string) {
  return useQuery({
    queryKey: ['school', 'meal-reports', from, to],
    queryFn: async () => (await api.get<any>(`${MEALS}/reports/summary`, { params: { from, to } })).data,
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
const INV = `${S}/invigilators`;
const LO = `${S}/learning-outcomes`;
const QP = `${S}/question-papers`;
const RC = `${S}/report-cards`;

/* ── A1 Assessment policy + components + instances ────────────────────────── */

export interface AssessmentPolicy { id: string; name: string; gradeLevelId?: string | null; classId?: string | null; subjectId?: string | null; termId?: string | null; passMark?: number | null; caCap?: number | null; roundingMode?: string; decimalPlaces?: number | null; isActive: boolean; version: number; revision: number; publishedAt: string | null; supersedesId: string | null }
export interface AssessmentComponent { id: string; policyId: string; name: string; kind: string; weight: number; aggregation?: string | null; bestN?: number | null; countsAbsentAsZero?: boolean; examTypeId?: string | null; order?: number | null }
export interface Assessment { id: string; subjectId: string; classId: string; termId: string; componentId?: string | null; title: string; maxScore?: number | null; weightInComponent?: number | null; sourceType?: string; status: string; component?: { name: string; kind: string } | null }

export function useAssessmentPolicies() {
  return useQuery({ queryKey: ['school', 'assessment-policies'], queryFn: async () => (await api.get<Paginated<AssessmentPolicy>>(AS, { params: { pageSize: 200 } })).data });
}
export function useCreateAssessmentPolicy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: { name: string; gradeLevelId?: string; classId?: string; subjectId?: string; termId?: string; programmeId?: string; passMark?: number; caCap?: number; roundingMode?: string; decimalPlaces?: number }) =>
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
    queryFn: async () => { const { data } = await api.get<{ ok: boolean; sum: string }>(`${AC}/validate/${policyId}`); return { valid: data.ok, totalWeight: Number(data.sum) }; },
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

// Shape returned by GET /marking/by-assessment/:id. The endpoint now attaches
// the pupil's name and admission number and sorts by name, so a marking screen
// no longer has to join a roster call to know whose mark it is showing.
export interface MarkRow {
  id: string; studentProfileId: string; classId?: string | null;
  admissionNo?: string | null;
  participation: string;
  maxScore?: number | null; originalScore?: number | null; effectiveScore?: number | null; percentage?: number | null;
  status: string; approvalStatus?: string; version?: number;
  studentName?: string;
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

export interface Roster { id: string; termId: string; name?: string | null; scopeType: string; classId?: string | null; sectionId?: string | null; subjectId?: string | null; status: string; frozenAt?: string | null; memberCount?: number | null }
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
    mutationFn: async (dto: { assignmentId: string; studentProfileId: string; rawScore?: number; complete?: boolean; feedback?: string; expectedVersion?: number; rubricScores?: Array<{ criterionId: string; levelId?: string; score: number; comment?: string }> }) =>
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
  // Phase 5 provenance: what the run was computed from and what it produced.
  // Shown so "can this be reproduced?" has an answer on the screen.
  calculationVersion?: string | null; gradingSystem?: string | null; roundingMode?: string | null;
  inputChecksum?: string | null; outputChecksum?: string | null;
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
export interface ResultReadiness {
  ready: boolean;
  conflicts: Array<{ code: string; studentProfileId?: string; detail: string }>;
  summary: {
    rosterFrozen: boolean;
    studentsCovered: number;
    studentsExpected: number;
    marksApproved: number;
    marksTotal: number;
    sodViolations: number;
    hasChecksums: boolean;
  };
}
export function useResultReadiness(id: string | undefined) {
  return useQuery({
    queryKey: ['school', 'result-readiness', id],
    enabled: !!id,
    queryFn: async () => (await api.get<ResultReadiness>(`${RES}/${id}/readiness`)).data,
    // Readiness is cheap and the admin is about to act on it; keep it fresh.
    staleTime: 0,
    refetchOnWindowFocus: true,
  });
}
export function usePublishResultSet() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => (await api.post(`${RES}/${id}/publish`)).data,
    onSuccess: (_d, v) => qc.invalidateQueries({ queryKey: ['school', 'result-set', v] }),
  });
}
export function useLockResultSet() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => (await api.post(`${RES}/${id}/lock`)).data,
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
export interface CaExamDiv { resultSetId: string; threshold: number; flagged: Array<{ studentProfileId: string; studentName: string | null; admissionNo: string | null; subjectId: string; subjectName: string | null; caScore: number; examScore: number; gap: number }> }
export interface AtRisk { resultSetId: string; passMark: number; register: Array<{ studentProfileId: string; studentName: string | null; admissionNo: string | null; meanPercent: number; failingSubjects: number; reasons: string[] }> }
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

export function useStudentPortal(studentProfileId: string | undefined) {
  return useQuery({ queryKey: ['school', 'portal-student', studentProfileId], enabled: !!studentProfileId, queryFn: async () => (await api.get<StudentPortal>(`${POR}/student/${studentProfileId}`)).data });
}
export function useTeacherPortal(teacherPartnerId: string | undefined) {
  return useQuery({ queryKey: ['school', 'portal-teacher', teacherPartnerId], enabled: !!teacherPartnerId, queryFn: async () => (await api.get<TeacherPortal>(`${POR}/teacher/${teacherPartnerId}`)).data });
}

/* ── P0-A Report card comments ─────────────────────────────────────────────── */

export function useUpdateReportCardComment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: {
      studentProfileId: string;
      termId: string;
      classTeacherComment?: string;
      principalComment?: string;
      competencyLevels?: Record<string, string>;
    }) => (await api.post(`${RC}/comment`, dto)).data,
    onSuccess: (_d, v) => qc.invalidateQueries({ queryKey: ['school', 'report-cards', v.studentProfileId] }),
  });
}

/* ── P0-B Invigilators ────────────────────────────────────────────────────── */

export interface Invigilator { id: string; staffId?: string | null; name: string; note?: string | null; isActive: boolean }
export interface InvigilatorAssignment { id: string; examScheduleId: string; invigilatorId: string; invigilator: Invigilator }

export function useInvigilators() {
  return useQuery({ queryKey: ['school', 'invigilators'], queryFn: async () => (await api.get<Paginated<Invigilator>>(INV, { params: { pageSize: 200 } })).data });
}
export function useCreateInvigilator() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: { name: string; staffId?: string; note?: string; isActive?: boolean }) => (await api.post<Invigilator>(INV, dto)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['school', 'invigilators'] }),
  });
}
export function useAssignInvigilator() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: { examScheduleId: string; invigilatorId: string }) => (await api.post(`${INV}/assign`, dto)).data,
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ['school', 'invigilators', 'by-schedule', v.examScheduleId] });
      qc.invalidateQueries({ queryKey: ['school', 'exam-schedules'] });
    },
  });
}
export function useUnassignInvigilator() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { examScheduleId: string; invigilatorId: string }) => (await api.delete(`${INV}/assign/${v.examScheduleId}/${v.invigilatorId}`)).data,
    onSuccess: (_d, v) => qc.invalidateQueries({ queryKey: ['school', 'invigilators', 'by-schedule', v.examScheduleId] }),
  });
}
export function useInvigilatorsBySchedule(examScheduleId: string | undefined) {
  return useQuery({
    queryKey: ['school', 'invigilators', 'by-schedule', examScheduleId],
    enabled: !!examScheduleId,
    queryFn: async () => (await api.get<InvigilatorAssignment[]>(`${INV}/by-schedule/${examScheduleId}`)).data,
  });
}

/* ── P1-B Learning outcomes ───────────────────────────────────────────────── */

export interface LearningOutcome {
  id: string;
  subjectId?: string | null;
  topicId?: string | null;
  competencyId?: string | null;
  title: string;
  description?: string | null;
  expectedLevel?: string | null;
  order: number;
}
export interface OutcomeAchievement {
  id: string;
  studentProfileId: string;
  learningOutcomeId: string;
  termId: string;
  level: 'not_met' | 'approaching' | 'met' | 'exceeded';
  masteryPercent?: number | null;
  comment?: string | null;
  learningOutcome?: LearningOutcome & { competency?: { id: string; code?: string } | null };
}

export function useLearningOutcomes() {
  return useQuery({ queryKey: ['school', 'learning-outcomes'], queryFn: async () => (await api.get<Paginated<LearningOutcome>>(LO, { params: { pageSize: 200 } })).data });
}
export function useCreateLearningOutcome() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: { title: string; description?: string; subjectId?: string; topicId?: string; competencyId?: string; expectedLevel?: string; order?: number }) =>
      (await api.post<LearningOutcome>(LO, dto)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['school', 'learning-outcomes'] }),
  });
}
export function useRecordOutcomeAchievement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: { studentProfileId: string; learningOutcomeId: string; termId: string; level: string; masteryPercent?: number; comment?: string }) =>
      (await api.post(`${LO}/achievement`, dto)).data,
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ['school', 'outcome-achievements', v.studentProfileId, v.termId] });
      qc.invalidateQueries({ queryKey: ['school', 'outcome-achievements', 'subject', v.learningOutcomeId] });
    },
  });
}
export function useOutcomeAchievements(studentProfileId: string | undefined, termId: string | undefined) {
  return useQuery({
    queryKey: ['school', 'outcome-achievements', studentProfileId, termId],
    enabled: !!studentProfileId && !!termId,
    queryFn: async () => (await api.get<OutcomeAchievement[]>(`${LO}/achievements/student/${studentProfileId}/term/${termId}`)).data,
  });
}

/* ── P2-A Traditional question papers ──────────────────────────────────────── */

export interface QuestionPaper {
  id: string;
  examScheduleId: string;
  title: string;
  paperKind: string;
  paperNumber?: number | null;
  totalMarks: number;
  questions: Array<{ number: number; text: string; marks: number }>;
  fileUrl?: string | null;
  setterId?: string | null;
  moderatorId?: string | null;
}

export function useQuestionPapersBySchedule(examScheduleId: string | undefined) {
  return useQuery({
    queryKey: ['school', 'question-papers', 'by-schedule', examScheduleId],
    enabled: !!examScheduleId,
    queryFn: async () => (await api.get<QuestionPaper[]>(`${QP}/by-schedule/${examScheduleId}`)).data,
  });
}
export function useCreateQuestionPaper() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: { examScheduleId: string; title: string; paperKind?: string; paperNumber?: number; totalMarks?: number; questions?: Array<{ number: number; text: string; marks: number }>; fileUrl?: string; setterId?: string; moderatorId?: string }) =>
      (await api.post<QuestionPaper>(QP, dto)).data,
    onSuccess: (_d, v) => qc.invalidateQueries({ queryKey: ['school', 'question-papers', 'by-schedule', v.examScheduleId] }),
  });
}

/* ── Grading scales (grade boundaries) ───────────────────────────────────── */
export interface GradingBand { min: number; max: number; grade: string; gpa: number; remark?: string }
export type BandRounding = 'none' | 'half_up_integer';
export interface GradingScale { id: string; name: string; bands: GradingBand[]; isDefault: boolean; system?: string | null; bandRounding?: BandRounding }

export function useGradingScales() {
  return useQuery({
    queryKey: ['school', 'grading-scales'],
    queryFn: async () => (await api.get<GradingScale[]>(`${S}/grading-scales`, { params: { pageSize: 100 } })).data,
  });
}
export function useDefaultGradingScale() {
  return useQuery({
    queryKey: ['school', 'grading-scale-default'],
    queryFn: async () => (await api.get<GradingScale>(`${S}/grading-scales/default`)).data,
  });
}
export function useCreateGradingScale() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: { name: string; bands: GradingBand[]; isDefault?: boolean; system?: string; bandRounding?: BandRounding }) =>
      (await api.post<GradingScale>(`${S}/grading-scales`, dto)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['school', 'grading-scales'] }),
  });
}
export function useUpdateGradingScale() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, dto }: { id: string; dto: Partial<{ name: string; bands: GradingBand[]; isDefault: boolean; system: string; bandRounding: BandRounding }> }) =>
      (await api.patch<GradingScale>(`${S}/grading-scales/${id}`, dto)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['school', 'grading-scales'] }),
  });
}
export function useDeleteGradingScale() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => api.delete(`${S}/grading-scales/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['school', 'grading-scales'] }),
  });
}

// ── Document Management (P0-P2): unified school documents ─────────────────
export interface SchoolDocRow {
  id: string;
  ownerType: 'student' | 'staff' | 'admission' | 'general';
  ownerId: string;
  category: string;
  type: string;
  title: string;
  fileId: string;
  signatureFileId?: string | null;
  version: number;
  expiresAt?: string | null;
  accessRoles: string[];
  verified: boolean;
  verifiedById?: string | null;
  verifiedAt?: string | null;
  signedAt?: string | null;
  signedById?: string | null;
  notes?: string | null;
  file?: { filename: string; contentType: string; byteSize: number } | null;
  signatureFile?: { filename: string; contentType: string } | null;
  createdAt: string;
  updatedAt: string;
}
export interface SchoolDocVersionRow {
  id: string;
  versionNo: number;
  snapshot: any;
  fileId?: string | null;
  changeNote?: string | null;
  createdById?: string | null;
  createdAt: string;
}

export function useSchoolDocs(filters: { ownerType?: string; ownerId?: string; category?: string; type?: string; verified?: boolean; expiry?: 'expiring' | 'expired'; expiryDays?: number } = {}) {
  const qc = useQueryClient();
  const key = ['school', 'docs', JSON.stringify(filters)];
  const query = useQuery<SchoolDocRow[]>({
    queryKey: key,
    queryFn: async () => {
      const p = new URLSearchParams();
      Object.entries(filters).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') p.set(k, String(v)); });
      return (await api.get<SchoolDocRow[]>(`${S}/documents?${p.toString()}`)).data;
    },
  });
  return { ...query, refetch: () => qc.invalidateQueries({ queryKey: key }) };
}

export function useCreateSchoolDoc() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: any) => (await api.post<SchoolDocRow>(`${S}/documents`, dto)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['school', 'docs'] }),
  });
}

export function useVerifySchoolDoc() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, verified }: { id: string; verified: boolean }) =>
      (await api.post(`${S}/documents/${id}/verify`, { verified })).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['school', 'docs'] }),
  });
}

export function useSignSchoolDoc() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, signatureFileId }: { id: string; signatureFileId: string }) =>
      (await api.post(`${S}/documents/${id}/sign`, { signatureFileId })).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['school', 'docs'] }),
  });
}

export function useUpdateSchoolDoc() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, dto }: { id: string; dto: any }) =>
      (await api.patch<SchoolDocRow>(`${S}/documents/${id}`, dto)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['school', 'docs'] }),
  });
}

export function useDeleteSchoolDoc() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => api.delete(`${S}/documents/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['school', 'docs'] }),
  });
}

export function useSchoolDocVersions(id: string | undefined) {
  return useQuery<SchoolDocVersionRow[]>({
    queryKey: ['school', 'doc-versions', id],
    enabled: !!id,
    queryFn: async () => (await api.get<SchoolDocVersionRow[]>(`${S}/documents/${id}/versions`)).data,
  });
}

/** Upload a file via the platform file service; returns the minted file id. */
export async function uploadSchoolFile(file: File, ownerType = 'school_doc', ownerId = 'school'): Promise<string> {
  const fd = new FormData();
  fd.append('file', file);
  fd.append('ownerType', ownerType);
  fd.append('ownerId', ownerId);
  const res = await api.post<{ id: string }>('/files/upload', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
  return res.data.id;
}

/**
 * Open a stored file in a new tab through a SIGNED, short-lived URL.
 *
 * `/files/:id/download` is public and demands a token/expiry/org signature, so
 * the unsigned link the pages used to render answered 400 and no document could
 * be viewed (E2E audit D1). `POST /files/:id/signed-url` applies the caller's
 * permission and sensitivity checks, then mints the link. The tab is opened
 * synchronously (before the await) so popup blockers allow it.
 */
export async function openStoredFile(id: string): Promise<void> {
  const tab = window.open('', '_blank');
  try {
    const { url } = (await api.post<{ url: string; expiresAt: string }>(`/files/${id}/signed-url`)).data;
    const href = resolveAssetUrl(url) ?? url;
    if (tab) tab.location.href = href;
    else window.location.assign(href);
  } catch (e) {
    tab?.close();
    throw e;
  }
}

/* ───────────────────────── School Calendar & Events ─────────────────────────
 * Both the Calendar (month grid) and Events (agenda/list) UIs consume the SAME
 * SchoolCalendarEvent data. CRUD goes through the CANONICAL `/school/calendar-events`
 * contract. Range reads use the legacy `/school/calendar/range` (overlap-fixed) —
 * the canonical controller has no /range yet; do NOT add new backend endpoints in V1.
 */

export type CalendarEventType =
  | 'holiday' | 'working_day' | 'event' | 'exam'
  | 'meeting' | 'trip' | 'sports' | 'ceremony';

export interface SchoolCalendarEvent {
  id: string;
  organizationId: string;
  termId?: string | null;
  title: string;
  type: CalendarEventType;
  startDate: string;
  endDate: string;
  description?: string | null;
  createdAt?: string;
  updatedAt?: string;
  deletedAt?: string | null;
}

export interface CalendarEventInput {
  title: string;
  type: CalendarEventType;
  startDate: string;
  endDate: string;
  termId?: string | null;
  description?: string;
}

/** Range read (overlap semantics: startDate<=to AND endDate>=from). */
export function useSchoolCalendarEvents(from?: string, to?: string) {
  return useQuery<SchoolCalendarEvent[]>({
    queryKey: ['school', 'calendar-events-range', from, to],
    queryFn: async () =>
      (await api.get<SchoolCalendarEvent[]>(`${S}/calendar/range`, { params: { from, to } })).data,
  });
}

export function useSchoolCalendarEvent(id: string | undefined) {
  return useQuery<SchoolCalendarEvent>({
    queryKey: ['school', 'calendar-events', id],
    enabled: !!id,
    queryFn: async () => (await api.get<SchoolCalendarEvent>(`${S}/calendar-events/${id}`)).data,
  });
}

export function useCreateCalendarEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: CalendarEventInput) =>
      (await api.post(`${S}/calendar-events`, dto)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['school', 'calendar-events'] }),
  });
}

export function useUpdateCalendarEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...dto }: CalendarEventInput & { id: string }) =>
      (await api.patch(`${S}/calendar-events/${id}`, dto)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['school', 'calendar-events'] }),
  });
}

export function useDeleteCalendarEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => api.delete(`${S}/calendar-events/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['school', 'calendar-events'] }),
  });
}

/* ───────────────────────── Library Management ─────────────────────────
 * Hooks target the real, registered LibraryModule (school/library/*).
 * BookMetadata requires a productId (FK to a stockable Product).
 */
export interface Book {
  id: string;
  productId: string;
  author?: string | null;
  isbn?: string | null;
  publisher?: string | null;
  edition?: string | null;
  category: string;
  shelfLocation?: string | null;
  totalCopies: number;
  availableCopies?: number;
  borrowedCopies?: number;
  product?: { id: string; name: string; code: string; type: string } | null;
}
export interface BookCopy {
  id: string;
  bookMetadataId: string;
  copyNumber: string;
  status: string;
  condition: string;
  book?: Book;
}
export interface Borrowing {
  id: string;
  bookCopyId: string;
  studentProfileId: string;
  borrowedAt: string;
  dueAt: string;
  returnedAt?: string | null;
  status: string;
  fineAmount?: number | null;
  bookCopy?: BookCopy;
  studentProfile?: { id: string; partner?: { name: string } | null; admissionNo?: string } | null;
  book?: Book;
}
export interface StudentLibraryInfo {
  id: string;
  partner?: { name: string } | null;
  admissionNo: string;
  currentClass?: { name: string } | null;
  borrowingCount?: number;
  overdueCount?: number;
  totalFines?: number;
}

export function useBooks() {
  return useQuery({ queryKey: ['school', 'library', 'books'], queryFn: async () => (await api.get<Paginated<Book>>(`${S}/library/books`, { params: { pageSize: 100 } })).data });
}
export function useCreateBook() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: async (dto: { productId: string; author?: string; isbn?: string; publisher?: string; edition?: string; category?: string; shelfLocation?: string; totalCopies?: number }) => (await api.post<Book>(`${S}/library/books`, dto)).data, onSuccess: () => qc.invalidateQueries({ queryKey: ['school', 'library', 'books'] }) });
}
export function useBookCopies() {
  return useQuery({ queryKey: ['school', 'library', 'copies'], queryFn: async () => (await api.get<Paginated<BookCopy>>(`${S}/library/copies`, { params: { pageSize: 200 } })).data });
}
export function useCreateBookCopy() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: async (dto: { bookMetadataId: string; copyNumber: string; status?: string; condition?: string }) => (await api.post<BookCopy>(`${S}/library/copies`, dto)).data, onSuccess: () => qc.invalidateQueries({ queryKey: ['school', 'library', 'copies'] }) });
}
export function useBorrowings() {
  return useQuery({ queryKey: ['school', 'library', 'borrowings'], queryFn: async () => (await api.get<Paginated<Borrowing>>(`${S}/library/borrowings`, { params: { pageSize: 200 } })).data });
}
export function useBorrowBook() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: async (dto: { bookCopyId: string; studentProfileId: string; dueAt: string; notes?: string }) => (await api.post<Borrowing>(`${S}/library/borrowings/borrow`, dto)).data, onSuccess: () => qc.invalidateQueries({ queryKey: ['school', 'library', 'borrowings'] }) });
}
export function useReturnBook() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: async (id: string) => (await api.post<Borrowing>(`${S}/library/borrowings/${id}/return`)).data, onSuccess: () => qc.invalidateQueries({ queryKey: ['school', 'library', 'borrowings'] }) });
}

// ── Additional library hooks ─────────────────────────

export interface BookDetail extends Book {
  availableCopies?: number;
  borrowedCopies?: number;
  copies?: BookCopy[];
}

export function useBook(id: string | undefined) {
  return useQuery({
    queryKey: ['school', 'library', 'book', id],
    enabled: !!id,
    queryFn: async () => (await api.get<BookDetail>(`${S}/library/books/${id}`)).data,
  });
}

export function useUpdateBook() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: async ({ id, dto }: { id: string; dto: any }) => (await api.patch<Book>(`${S}/library/books/${id}`, dto)).data, onSuccess: () => qc.invalidateQueries({ queryKey: ['school', 'library', 'books'] }) });
}

export function useDeleteBook() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: async (id: string) => (await api.delete(`${S}/library/books/${id}`)).data, onSuccess: () => qc.invalidateQueries({ queryKey: ['school', 'library', 'books'] }) });
}

export interface BookCopyDetail extends BookCopy {
  book?: Book;
}

export function useBookCopy(id: string | undefined) {
  return useQuery({
    queryKey: ['school', 'library', 'copy', id],
    enabled: !!id,
    queryFn: async () => (await api.get<BookCopyDetail>(`${S}/library/copies/${id}`)).data,
  });
}

export function useUpdateBookCopy() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: async ({ id, dto }: { id: string; dto: any }) => (await api.patch<BookCopy>(`${S}/library/copies/${id}`, dto)).data, onSuccess: () => qc.invalidateQueries({ queryKey: ['school', 'library', 'copies'] }) });
}

export function useDeleteBookCopy() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: async (id: string) => (await api.delete(`${S}/library/copies/${id}`)).data, onSuccess: () => qc.invalidateQueries({ queryKey: ['school', 'library', 'copies'] }) });
}

export interface LibraryStats {
  totalBooks: number;
  totalCopies: number;
  availableCopies: number;
  borrowedCopies: number;
  overdueCopies: number;
  activeStudents: number;
  totalBorrowings: number;
  totalFines: number;
  collectionValue: number;
}

export function useLibraryStats() {
  return useQuery({
    queryKey: ['school', 'library', 'stats'],
    queryFn: async () => (await api.get<LibraryStats>(`${S}/library/books/stats`)).data,
  });
}

export function useOverdueBooks() {
  return useQuery({
    queryKey: ['school', 'library', 'overdue'],
    queryFn: async () => (await api.get<any[]>(`${S}/library/books/overdue`)).data,
  });
}

export function usePopularBooks() {
  return useQuery({
    queryKey: ['school', 'library', 'popular'],
    queryFn: async () => (await api.get<any[]>(`${S}/library/books/popular`)).data,
  });
}

export function useBorrowingByStudent(studentProfileId: string | undefined) {
  return useQuery({
    queryKey: ['school', 'library', 'borrowings', 'by-student', studentProfileId],
    enabled: !!studentProfileId,
    queryFn: async () => (await api.get<Borrowing[]>(`${S}/library/borrowings/by-student/${studentProfileId}`)).data,
  });
}

/* ───────────────────────── Budgeting (Fees & School Finance) ───────────────────────── */
export interface Budget {
  id: string;
  category: string;
  name: string;
  amount: number | string;
  currency?: string | null;
  academicYearId?: string | null;
  termId?: string | null;
  periodFrom?: string | null;
  periodTo?: string | null;
  notes?: string | null;
  status: string;
}

export function useBudgets() {
  return useQuery({ queryKey: ['school', 'finance', 'budgets'], queryFn: async () => (await api.get<Budget[]>(`${S}/finance/budgets`)).data });
}
export function useCreateBudget() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: async (dto: { category: string; name: string; amount: number; academicYearId?: string; termId?: string; currency?: string; periodFrom?: string; periodTo?: string; notes?: string; status?: string }) => (await api.post<Budget>(`${S}/finance/budgets`, dto)).data, onSuccess: () => qc.invalidateQueries({ queryKey: ['school', 'finance', 'budgets'] }) });
}
export function useDeleteBudget() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: async (id: string) => api.delete(`${S}/finance/budgets/${id}`), onSuccess: () => qc.invalidateQueries({ queryKey: ['school', 'finance', 'budgets'] }) });
}

/* ───────────────────────── Front Desk (visitor log) ───────────────────────── */
export interface FrontDeskLog {
  id: string;
  partnerId?: string | null;
  visitorName: string;
  phone?: string | null;
  purpose?: string | null;
  personVisited?: string | null;
  status: string;
  notes?: string | null;
  checkInAt: string;
  checkOutAt?: string | null;
  partner?: { id: string; name: string } | null;
}

export function useFrontDeskLogs(status?: string) {
  return useQuery({ queryKey: ['school', 'front-desk', status ?? 'all'], queryFn: async () => (await api.get<FrontDeskLog[]>(`${S}/front-desk`, { params: status ? { status } : undefined })).data });
}
export function useCreateFrontDeskLog() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: async (dto: { partnerId?: string; visitorName: string; phone?: string; purpose?: string; personVisited?: string; notes?: string }) => (await api.post<FrontDeskLog>(`${S}/front-desk`, dto)).data, onSuccess: () => qc.invalidateQueries({ queryKey: ['school', 'front-desk'] }) });
}
export function useCheckoutFrontDeskLog() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: async ({ id, notes }: { id: string; notes?: string }) => (await api.patch<FrontDeskLog>(`${S}/front-desk/${id}/checkout`, { notes })).data, onSuccess: () => qc.invalidateQueries({ queryKey: ['school', 'front-desk'] }) });
}

/* ───────────────────────── Phone Calls ───────────────────────── */
const PC = `${S}/phone-calls`;

export type CallDirection = 'inbound' | 'outbound';
export type CallStatus = 'completed' | 'missed' | 'voicemail' | 'scheduled' | 'cancelled';

export interface PhoneCall {
  id: string;
  partnerId?: string | null;
  direction: CallDirection;
  contactName: string;
  phone: string;
  subject?: string | null;
  outcome?: string | null;
  notes?: string | null;
  durationSec?: number | null;
  status: CallStatus;
  callAt: string;
  partner?: { id: string; name: string } | null;
}

export function usePhoneCalls(filters?: { direction?: CallDirection; status?: CallStatus; partnerId?: string; fromDate?: string; toDate?: string }) {
  return useQuery({
    queryKey: ['school', 'phone-calls', filters ?? 'all'],
    queryFn: async () => (await api.get<PhoneCall[]>(PC, { params: filters })).data,
  });
}

export function usePhoneCall(id?: string) {
  return useQuery({
    queryKey: ['school', 'phone-call', id],
    enabled: !!id,
    queryFn: async () => (await api.get<PhoneCall>(`${PC}/${id}`)).data,
  });
}

export function useCreatePhoneCall() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: async (dto: { partnerId?: string; direction: CallDirection; contactName: string; phone: string; subject?: string; outcome?: string; notes?: string; durationSec?: number; status?: CallStatus; callAt?: string }) => (await api.post<PhoneCall>(PC, dto)).data, onSuccess: () => qc.invalidateQueries({ queryKey: ['school', 'phone-calls'] }) });
}

export function useUpdatePhoneCall() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: async ({ id, ...dto }: { id: string; partnerId?: string; direction?: CallDirection; contactName?: string; phone?: string; subject?: string; outcome?: string; notes?: string; durationSec?: number; status?: CallStatus; callAt?: string }) => (await api.put<PhoneCall>(`${PC}/${id}`, dto)).data, onSuccess: () => qc.invalidateQueries({ queryKey: ['school', 'phone-calls'] }) });
}

export function useDeletePhoneCall() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: async (id: string) => (await api.delete(`${PC}/${id}`)).data, onSuccess: () => qc.invalidateQueries({ queryKey: ['school', 'phone-calls'] }) });
}

/* ───────────────────────── Complaints ───────────────────────── */
const CP = `${S}/complaints`;

export type ComplaintCategory = 'academic' | 'behavior' | 'facilities' | 'staff_conduct' | 'communication' | 'fees' | 'transport' | 'meals' | 'safety' | 'other';
export type ComplaintStatus = 'open' | 'in_progress' | 'awaiting_response' | 'resolved' | 'closed' | 'escalated';
export type ComplaintPriority = 'low' | 'medium' | 'high' | 'urgent';

export interface Complaint {
  id: string;
  partnerId?: string | null;
  category: ComplaintCategory;
  subject: string;
  description: string;
  status: ComplaintStatus;
  priority: ComplaintPriority;
  assignedToId?: string | null;
  resolution?: string | null;
  resolvedAt?: string | null;
  receivedAt: string;
  createdAt: string;
  updatedAt: string;
}

export function useComplaints(filters?: { category?: ComplaintCategory; status?: ComplaintStatus; priority?: ComplaintPriority; partnerId?: string; assignedToId?: string; fromDate?: string; toDate?: string }) {
  return useQuery({
    queryKey: ['school', 'complaints', filters ?? 'all'],
    queryFn: async () => (await api.get<Complaint[]>(CP, { params: filters })).data,
  });
}

export function useComplaint(id?: string) {
  return useQuery({
    queryKey: ['school', 'complaint', id],
    enabled: !!id,
    queryFn: async () => (await api.get<Complaint>(`${CP}/${id}`)).data,
  });
}

export function useCreateComplaint() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: async (dto: { partnerId?: string; category: ComplaintCategory; subject: string; description: string; status?: ComplaintStatus; priority?: ComplaintPriority; assignedToId?: string; resolution?: string; receivedAt?: string }) => (await api.post<Complaint>(CP, dto)).data, onSuccess: () => qc.invalidateQueries({ queryKey: ['school', 'complaints'] }) });
}

export function useUpdateComplaint() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: async ({ id, ...dto }: { id: string; partnerId?: string; category?: ComplaintCategory; subject?: string; description?: string; status?: ComplaintStatus; priority?: ComplaintPriority; assignedToId?: string; resolution?: string; receivedAt?: string }) => (await api.put<Complaint>(`${CP}/${id}`, dto)).data, onSuccess: () => qc.invalidateQueries({ queryKey: ['school', 'complaints'] }) });
}

export function useDeleteComplaint() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: async (id: string) => (await api.delete(`${CP}/${id}`)).data, onSuccess: () => qc.invalidateQueries({ queryKey: ['school', 'complaints'] }) });
}

/* ───────────────────────── LMS (Lesson Planning + Basic LMS) ───────────────────────── */
/* Phases 1-5: Course Offering, Lesson Plans, Templates, Scheduled Lessons,
   Discussions, Homework, Evidence/Mastery, Reporting. Backend controller: /school/lp */

const LP = `${S}/lp`;

export interface CourseOffering {
  id: string;
  academicYearId: string;
  termId: string;
  subjectId: string;
  classId: string;
  sectionId: string | null;
  curriculumId: string;
  teacherPartnerIds: string[];
}

export function useCourseOfferings(termId?: string) {
  return useQuery({
    queryKey: ['school', 'lp', 'course-offerings', termId ?? 'all'],
    queryFn: async () => (await api.get<CourseOffering[]>(`${LP}/course-offerings`, { params: termId ? { termId } : {} })).data,
  });
}
export function useCreateCourseOffering() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: async (dto: any) => (await api.post<CourseOffering>(`${LP}/course-offerings`, dto)).data, onSuccess: () => qc.invalidateQueries({ queryKey: ['school', 'lp', 'course-offerings'] }) });
}
export function useUpsertCourseOfferingFromTeacherAssignment() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: async (teacherAssignmentId: string) => (await api.post<CourseOffering>(`${LP}/course-offerings/from-teacher-assignment`, { teacherAssignmentId })).data, onSuccess: () => qc.invalidateQueries({ queryKey: ['school', 'lp', 'course-offerings'] }) });
}

export interface LessonPlan {
  id: string;
  courseOfferingId: string | null;
  curriculumVersionId: string | null;
  unitId: string | null;
  topicId: string | null;
  subtopic: string | null;
  title: string;
  objectives: string[];
  materials: string[];
  workflowStatus: string;
  version: number;
  subjectId: string;
}
export function useLessonPlans(params: { courseOfferingId?: string; status?: string; termId?: string } = {}) {
  return useQuery({
    queryKey: ['school', 'lp', 'lesson-plans', params],
    queryFn: async () => (await api.get<any[]>(`${LP}/lesson-plans`, { params })).data,
  });
}
export function useLessonPlan(id?: string) {
  return useQuery({
    queryKey: ['school', 'lp', 'lesson-plan', id],
    enabled: !!id,
    queryFn: async () => (await api.get<any>(`${LP}/lesson-plans/${id}`)).data,
  });
}
export function useCreateLessonPlan() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: async (dto: any) => (await api.post<any>(`${LP}/lesson-plans`, dto)).data, onSuccess: () => qc.invalidateQueries({ queryKey: ['school', 'lp', 'lesson-plans'] }) });
}
export function useUpdateLessonPlan() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: async ({ id, ...dto }: any) => (await api.put<any>(`${LP}/lesson-plans/${id}`, dto)).data, onSuccess: () => qc.invalidateQueries({ queryKey: ['school', 'lp', 'lesson-plans'] }) });
}
export function useTransitionLessonPlan() {
  const qc = useQueryClient();
  // `version` is forwarded so the optimistic-concurrency guard on submit still
  // applies — omitting it lets a stale editor overwrite a newer revision.
  return useMutation({ mutationFn: async ({ id, action, version, comment, requestedChanges }: any) => (await api.post<any>(`${LP}/lesson-plans/${id}/transition`, { action, version, comment, requestedChanges })).data, onSuccess: () => qc.invalidateQueries({ queryKey: ['school', 'lp', 'lesson-plans'] }) });
}
export function useCreateFromTimetable() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: async (dto: any) => (await api.post<any>(`${LP}/lesson-plans/from-timetable`, dto)).data, onSuccess: () => qc.invalidateQueries({ queryKey: ['school', 'lp', 'lesson-plans'] }) });
}
export function useArchiveLessonPlan() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: async (id: string) => (await api.post<any>(`${LP}/lesson-plans/${id}/archive`)).data, onSuccess: () => qc.invalidateQueries({ queryKey: ['school', 'lp', 'lesson-plans'] }) });
}

export interface LessonPlanTemplate { id: string; name: string; subjectId: string; templateJson: any; isPublic: boolean }
export function useLessonPlanTemplates() {
  return useQuery({ queryKey: ['school', 'lp', 'templates'], queryFn: async () => (await api.get<LessonPlanTemplate[]>(`${LP}/templates`)).data });
}
export function useCreateLessonPlanTemplate() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: async (dto: any) => (await api.post<LessonPlanTemplate>(`${LP}/templates`, dto)).data, onSuccess: () => qc.invalidateQueries({ queryKey: ['school', 'lp', 'templates'] }) });
}
export function useInstantiateTemplate() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: async ({ id, ...dto }: any) => (await api.post<any>(`${LP}/templates/${id}/instantiate`, dto)).data, onSuccess: () => qc.invalidateQueries({ queryKey: ['school', 'lp', 'lesson-plans'] }) });
}

export function useTeacherDashboard(teacherPartnerId: string) {
  return useQuery({ queryKey: ['school', 'lp', 'teacher-dashboard', teacherPartnerId], enabled: !!teacherPartnerId, queryFn: async () => (await api.get<any>(`${LP}/teacher-dashboard`, { params: { teacherPartnerId } })).data });
}
export function useLessonPlanCoverage(subjectId?: string, termId?: string) {
  return useQuery({ queryKey: ['school', 'lp', 'coverage', subjectId, termId], enabled: !!subjectId, queryFn: async () => (await api.get<any>(`${LP}/curriculum-coverage`, { params: { subjectId, termId } })).data });
}

/* Phase 2: Scheduled lessons / delivery */
export function useScheduledLessons(params: { courseOfferingId?: string; status?: string } = {}) {
  return useQuery({ queryKey: ['school', 'lp', 'scheduled-lessons', params], queryFn: async () => (await api.get<any[]>(`${LP}/scheduled-lessons`, { params })).data });
}
export function useCreateScheduledLesson() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: async (dto: any) => (await api.post<any>(`${LP}/scheduled-lessons`, dto)).data, onSuccess: () => qc.invalidateQueries({ queryKey: ['school', 'lp', 'scheduled-lessons'] }) });
}
export function useDeliverLesson() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: async (dto: any) => (await api.post<any>(`${LP}/scheduled-lessons/deliver`, dto)).data, onSuccess: () => qc.invalidateQueries({ queryKey: ['school', 'lp', 'scheduled-lessons'] }) });
}

/* Phase 3: Discussions + Homework */
export function useDiscussions(courseOfferingId?: string) {
  return useQuery({ queryKey: ['school', 'lp', 'discussions', courseOfferingId ?? 'all'], queryFn: async () => (await api.get<any[]>(`${LP}/discussions`, { params: courseOfferingId ? { courseOfferingId } : {} })).data });
}
export function useDiscussion(id?: string) {
  return useQuery({ queryKey: ['school', 'lp', 'discussion', id], enabled: !!id, queryFn: async () => (await api.get<any>(`${LP}/discussions/${id}`)).data });
}
export function useCreateDiscussion() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: async (dto: any) => (await api.post<any>(`${LP}/discussions`, dto)).data, onSuccess: () => qc.invalidateQueries({ queryKey: ['school', 'lp', 'discussions'] }) });
}
export function useAddPost() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: async ({ id, ...dto }: any) => (await api.post<any>(`${LP}/discussions/${id}/posts`, dto)).data, onSuccess: () => qc.invalidateQueries({ queryKey: ['school', 'lp', 'discussions'] }) });
}
export function useSubmitHomework() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: async (dto: any) => (await api.post<any>(`${LP}/homework/submit`, dto)).data, onSuccess: () => qc.invalidateQueries({ queryKey: ['school', 'lp', 'homework'] }) });
}
export function useGradeHomework() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: async (dto: any) => (await api.post<any>(`${LP}/homework/grade`, dto)).data, onSuccess: () => qc.invalidateQueries({ queryKey: ['school', 'lp', 'homework'] }) });
}

/* Phase 4: Evidence + mastery */
export function useRecordEvidence() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: async (dto: any) => (await api.post<any>(`${LP}/evidence`, dto)).data, onSuccess: () => qc.invalidateQueries({ queryKey: ['school', 'lp', 'mastery'] }) });
}
export function useRecomputeObjective() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: async (dto: { studentProfileId: string; learningObjectiveId: string }) => (await api.post<any>(`${LP}/mastery/objective/recompute`, dto)).data, onSuccess: () => qc.invalidateQueries({ queryKey: ['school', 'lp', 'mastery'] }) });
}
export function useRecomputeCourse() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: async (dto: { studentProfileId: string; courseOfferingId: string }) => (await api.post<any>(`${LP}/mastery/course/recompute`, dto)).data, onSuccess: () => qc.invalidateQueries({ queryKey: ['school', 'lp', 'mastery'] }) });
}

/* Phase 5: Reporting */
export function useObjectiveMastery(params: { learningObjectiveId?: string; studentProfileId?: string } = {}) {
  return useQuery({ queryKey: ['school', 'lp', 'reporting', 'objective-mastery', params], queryFn: async () => (await api.get<any[]>(`${LP}/reporting/objective-mastery`, { params })).data });
}
export function useCourseProgress(params: { courseOfferingId?: string } = {}) {
  return useQuery({ queryKey: ['school', 'lp', 'reporting', 'course-progress', params], queryFn: async () => (await api.get<any[]>(`${LP}/reporting/course-progress`, { params })).data });
}





/* Fees & Finance production-hardening hooks (Phases 1-5). */

export interface StudentBalance {
  studentProfileId: string;
  billed: number; collected: number; waived: number; credited: number; adjusted: number;
  balance: number; invoiceCount: number;
}
export function useStudentBalance(studentProfileId?: string) {
  return useQuery({
    queryKey: ['school', 'finance', 'balance', studentProfileId],
    enabled: !!studentProfileId,
    queryFn: async () => (await api.get<StudentBalance>(`${S}/finance/students/${studentProfileId}/balance`)).data,
  });
}

export interface LedgerRow {
  date: string; ledgerType: string; sourceType: string; sourceId: string;
  reference: string; description: string; debit: number; credit: number; balance: number;
}
export interface StudentLedger { studentProfileId: string; rows: LedgerRow[]; closingBalance: number }
export function useStudentLedger(studentProfileId?: string, range?: { from?: string; to?: string }) {
  return useQuery({
    queryKey: ['school', 'finance', 'ledger', studentProfileId, range?.from, range?.to],
    enabled: !!studentProfileId,
    queryFn: async () =>
      (await api.get<StudentLedger>(`${S}/finance/students/${studentProfileId}/ledger`, { params: range })).data,
  });
}

export interface ArGlReconciliation {
  arControlAccountId: string; subledgerTotal: number; glTotal: number; variance: number;
  perStudent: Array<{ partnerId: string; subledger: number; gl: number; variance: number }>;
}
export function useArGlReconciliation() {
  return useQuery({
    queryKey: ['school', 'finance', 'recon', 'ar-gl'],
    queryFn: async () => (await api.get<ArGlReconciliation>(`${S}/finance/reconciliation/ar-gl`)).data,
  });
}
export interface CreditLiabilityReconciliation { outstanding: number; glBalance: number; variance: number }
export function useCreditLiabilityReconciliation() {
  return useQuery({
    queryKey: ['school', 'finance', 'recon', 'credit'],
    queryFn: async () => (await api.get<CreditLiabilityReconciliation>(`${S}/finance/reconciliation/credit-liability`)).data,
  });
}

export interface BillingRun {
  id: string; termId: string; classId?: string | null; status: string;
  totalStudents: number; postedCount: number; failedCount: number; skippedCount: number;
  createdAt: string; completedAt?: string | null;
}
export function useBillingRuns() {
  return useQuery({
    queryKey: ['school', 'billing-runs'],
    queryFn: async () => (await api.get<BillingRun[]>(`${S}/billing-runs`)).data,
  });
}
export function useBillingRun(id?: string) {
  return useQuery({
    queryKey: ['school', 'billing-runs', id],
    enabled: !!id,
    refetchInterval: (q: any) =>
      q.state.data?.run?.status === 'running' || q.state.data?.run?.status === 'queued' ? 1500 : false,
    queryFn: async () => (await api.get<{ run: BillingRun; items: any[] }>(`${S}/billing-runs/${id}`)).data,
  });
}
export function useStartBillingRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: { termId: string; classId?: string }) =>
      (await api.post<BillingRun>(`${S}/billing-runs`, dto)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['school', 'billing-runs'] }),
  });
}
export function useProcessBillingRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, limit }: { id: string; limit?: number }) =>
      (await api.post(`${S}/billing-runs/${id}/process`, {}, { params: { limit } })).data,
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ['school', 'billing-runs', v.id] });
      qc.invalidateQueries({ queryKey: ['school', 'billing-runs'] });
    },
  });
}

export function useApproveWaiver() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => (await api.post(`${S}/finance/waivers/${id}/approve`, {})).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['school', 'waivers'] }),
  });
}
export function useRejectWaiver() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason?: string }) =>
      (await api.post(`${S}/finance/waivers/${id}/reject`, { reason })).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['school', 'waivers'] }),
  });
}

export interface FeeAdjustment {
  id: string; code: string; studentProfileId: string; documentId?: string | null;
  direction: string; amount: string; reason: string; status: string; createdAt: string;
}
export function useAdjustments(status?: string) {
  return useQuery({
    queryKey: ['school', 'finance', 'adjustments', status],
    queryFn: async () => (await api.get<FeeAdjustment[]>(`${S}/finance/adjustments`, { params: { status } })).data,
  });
}
export function useCreateAdjustment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: {
      studentProfileId: string; documentId: string; direction: 'debit' | 'credit'; amount: number; reason: string;
    }) => (await api.post(`${S}/finance/adjustments`, dto)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['school', 'finance', 'adjustments'] }),
  });
}
export function useApproveAdjustment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => (await api.post(`${S}/finance/adjustments/${id}/approve`, {})).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['school', 'finance', 'adjustments'] });
      qc.invalidateQueries({ queryKey: ['school', 'finance', 'balance'] });
    },
  });
}
export function useRejectAdjustment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason?: string }) =>
      (await api.post(`${S}/finance/adjustments/${id}/reject`, { reason })).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['school', 'finance', 'adjustments'] }),
  });
}

export interface TermCloseStatus { id: string; termId: string; status: string; closedAt?: string | null; snapshot?: any }
export function useTermCloseStatus(termId?: string) {
  return useQuery({
    queryKey: ['school', 'finance', 'term-close', termId],
    enabled: !!termId,
    queryFn: async () => (await api.get<TermCloseStatus | null>(`${S}/finance/terms/${termId}/close-status`)).data,
  });
}
export function useCloseTerm() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (termId: string) => (await api.post(`${S}/finance/terms/${termId}/close`, {})).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['school', 'finance', 'term-close'] }),
  });
}
export function useReopenTerm() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ termId, reason }: { termId: string; reason?: string }) =>
      (await api.post(`${S}/finance/terms/${termId}/reopen`, { reason })).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['school', 'finance', 'term-close'] }),
  });
}

export interface PaymentImportBatch {
  id: string; provider: string; originalFilename: string; statementPeriod?: string | null;
  rowCount: number; totalAmount: string; matchedCount: number; postedCount: number; rejectedCount: number; uploadedAt: string;
}
export function usePaymentImportBatches() {
  return useQuery({
    queryKey: ['school', 'finance', 'imports'],
    queryFn: async () => (await api.get<PaymentImportBatch[]>(`${S}/finance/imports`)).data,
  });
}
export function usePaymentImportBatch(id?: string) {
  return useQuery({
    queryKey: ['school', 'finance', 'imports', id],
    enabled: !!id,
    queryFn: async () => (await api.get<{ batch: PaymentImportBatch; rows: any[] }>(`${S}/finance/imports/${id}`)).data,
  });
}
export function useImportPayments() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: { provider: string; filename: string; statementPeriod?: string; rows: any[] }) =>
      (await api.post(`${S}/finance/imports`, dto)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['school', 'finance', 'imports'] }),
  });
}
export function useConfirmImportRow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ batchId, rowId, studentProfileId }: { batchId: string; rowId: string; studentProfileId?: string }) =>
      (await api.post(`${S}/finance/imports/${batchId}/rows/${rowId}/confirm`, { studentProfileId })).data,
    onSuccess: (_d, v) => qc.invalidateQueries({ queryKey: ['school', 'finance', 'imports', v.batchId] }),
  });
}

/**
 * Publish a fee structure — freeze its priced components as an immutable
 * FeeStructureVersion. Billing prices from that version, never from the
 * editable components (FINANCIAL_INVARIANTS §Pricing provenance), so a
 * structure that has never been published cannot be billed at all.
 *
 * Pass `components` to REPRICE a structure that is already published: `PATCH`
 * refuses component edits once published, and this is the one door that writes
 * new amounts and freezes them as version N+1 in a single transaction.
 * Invoices already issued keep the version they were billed from.
 */
export function usePublishFeeStructure() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (arg: string | { id: string; components?: FeeComponent[] }) => {
      const { id, components } = typeof arg === 'string' ? { id: arg, components: undefined } : arg;
      return (await api.post(`${S}/fee-structures/${id}/publish`, components ? { components } : {})).data;
    },
    onSuccess: (_d, arg) => {
      const id = typeof arg === 'string' ? arg : arg.id;
      qc.invalidateQueries({ queryKey: ['school', 'fee-structures'] });
      qc.invalidateQueries({ queryKey: ['school', 'fee-structures', id, 'versions'] });
    },
  });
}

export interface FeeStructureVersion {
  id: string;
  versionNo: number;
  isImmutable: boolean;
  publishedAt?: string | null;
  publishedById?: string | null;
  createdAt: string;
  items?: Array<{ id: string; code: string; name: string; amount: number; isOptional: boolean }>;
}
export function useFeeStructureVersions(id?: string) {
  return useQuery({
    queryKey: ['school', 'fee-structures', id, 'versions'],
    enabled: !!id,
    queryFn: async () => (await api.get<FeeStructureVersion[]>(`${S}/fee-structures/${id}/versions`)).data,
  });
}

export interface SchoolFeeInvoiceRow {
  id: string; invoiceNumber: string; documentId: string; studentProfileId: string;
  termId?: string | null; classId?: string | null; status: string; issueDate: string; dueDate?: string | null;
  documentNumber?: string; totalAmount: number; amountResidual: number; amountPaid: number; amountWaived: number; paymentStatus?: string;
}
export function useSchoolInvoices(params: { studentProfileId?: string; termId?: string; status?: string; page?: number; pageSize?: number } = {}) {
  return useQuery({
    queryKey: ['school', 'invoices', params],
    queryFn: async () =>
      (await api.get<{ data: SchoolFeeInvoiceRow[]; total: number; page: number; pageSize: number }>(`${S}/finance/invoices`, { params })).data,
  });
}
export function useSchoolInvoice(id?: string) {
  return useQuery({
    queryKey: ['school', 'invoices', id],
    enabled: !!id,
    queryFn: async () => (await api.get<{ invoice: any; document: any }>(`${S}/finance/invoices/${id}`)).data,
  });
}

/* ───────────────────── Exam workspace (the 4-step marks flow) ─────────────────────
 * These wrap /school/marks/*, the flat task-shaped surface over the exam →
 * schedule → grade-entry chain. One hook per screen; nothing here needs the
 * caller to know what an ExamSchedule is.
 * ------------------------------------------------------------------------- */

export interface WorkspaceExam {
  id: string;
  name: string;
  status: string;
  papers?: Array<{ classId: string; subjectId: string }>;
  startDate: string;
  endDate: string;
  termId: string;
  termName: string | null;
  examTypeId: string;
  examTypeName: string | null;
  weight: number | null;
  isFinal: boolean;
  classCount: number;
  paperCount: number;
  lockedPaperCount: number;
  marksExpected: number;
  marksEntered: number;
}

export interface CoveragePaper {
  examScheduleId: string;
  subjectId: string;
  subjectName: string;
  subjectCode: string;
  maxMarks: number;
  locked: boolean;
  marksEntered: number;
  marksExpected: number;
}

export interface CoverageClass {
  classId: string;
  className: string;
  gradeLevelName: string | null;
  studentCount: number;
  applied: boolean;
  paperCount: number;
  lockedPaperCount: number;
  marksExpected: number;
  marksEntered: number;
  subjects: CoveragePaper[];
}

export interface MarkSheetStudent {
  index: number;
  studentProfileId: string;
  name: string;
  admissionNo: string;
  streamId: string | null;
  streamName: string | null;
  sectionId: string | null;
  gradeEntryId: string | null;
  marks: number | null;
  grade: string | null;
  remarks: string | null;
  participation: string;
  status: string;
  version: number;
}

export interface MarkSheet {
  exam: { id: string; name: string; termId: string; termName: string | null; examTypeName: string | null };
  class: { id: string; name: string };
  subject: { id: string; name: string; code: string };
  examScheduleId: string | null;
  applied: boolean;
  maxMarks: number;
  locked: boolean;
  lockedAt: string | null;
  approvalStatus: string;
  total: number;
  entered: number;
  students: MarkSheetStudent[];
}

export interface ResultGridStudent {
  studentProfileId: string;
  name: string;
  admissionNo: string;
  streamId: string | null;
  streamName: string | null;
  sectionId: string | null;
  cells: Record<string, { marks: number | null; grade: string | null; participation: string }>;
  subjectsMarked: number;
  total: number | null;
  average: number | null;
  percentage: number | null;
  grade: string | null;
  position: number;
}

export interface ResultGrid {
  exam: { id: string; name: string; termId: string; termName: string | null; examTypeName: string | null };
  subjects: Array<{ examScheduleId: string; subjectId: string; name: string; code: string; maxMarks: number; locked: boolean }>;
  students: ResultGridStudent[];
  classSize: number;
  marksExpected: number;
  marksEntered: number;
  complete: boolean;
  lockedPaperCount: number;
  paperCount: number;
}

export function useWorkspaceExams(params: { termId?: string; academicYearId?: string } = {}) {
  return useQuery({
    queryKey: ['school', 'marks', 'exams', params],
    queryFn: async () => (await api.get<WorkspaceExam[]>(`${S}/marks/exams`, { params })).data,
  });
}

export function useExamCoverage(examId: string | undefined) {
  return useQuery({
    queryKey: ['school', 'marks', 'coverage', examId],
    enabled: !!examId,
    queryFn: async () =>
      (await api.get<{ exam: any; classes: CoverageClass[] }>(`${S}/marks/coverage`, { params: { examId } })).data,
  });
}

export function useClassSubjects(classId: string | undefined) {
  return useQuery({
    queryKey: ['school', 'marks', 'subjects', classId],
    enabled: !!classId,
    queryFn: async () =>
      (await api.get<Array<{ id: string; name: string; code: string; isCore: boolean }>>(`${S}/marks/subjects`, { params: { classId } })).data,
  });
}

export function useApplyExamClasses() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: { examId: string; classIds: string[]; subjectIds?: string[]; maxMarks?: number }) =>
      (await api.post<{ created: number; skipped: number }>(`${S}/marks/apply-classes`, dto)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['school', 'marks'] }),
  });
}

export function useRemoveExamClass() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: { examId: string; classId: string }) =>
      (await api.post<{ removed: number }>(`${S}/marks/remove-class`, dto)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['school', 'marks'] }),
  });
}

export function useMarkSheet(params: { examId?: string; classId?: string; subjectId?: string; sectionId?: string }) {
  const ready = !!params.examId && !!params.classId && !!params.subjectId;
  return useQuery({
    queryKey: ['school', 'marks', 'sheet', params],
    enabled: ready,
    queryFn: async () => (await api.get<MarkSheet>(`${S}/marks/sheet`, { params })).data,
  });
}

/**
 * Saves one cell. Deliberately does NOT invalidate the sheet: the row is
 * patched in place by the caller so the input the user is typing in never
 * re-mounts under them.
 */
/**
 * Mark writes carry `expectedVersion` — the row version the marker had on
 * screen. The server has always been able to refuse a stale write; no client
 * ever sent the field, so two teachers on one paper silently overwrote each
 * other. A 409 now comes back instead, and the sheet asks for a reload.
 */
export function useSaveMark() {
  return useMutation({
    mutationFn: async (dto: {
      examId: string; classId: string; subjectId: string; studentProfileId: string;
      marks?: number | null; participation?: string; maxMarks?: number; expectedVersion?: number;
    }) => (await api.post(`${S}/marks/entry`, dto)).data,
  });
}

export function useResultGrid(params: { examId?: string; classId?: string; sectionId?: string }) {
  const ready = !!params.examId && !!params.classId;
  return useQuery({
    queryKey: ['school', 'marks', 'grid', params],
    enabled: ready,
    queryFn: async () => (await api.get<ResultGrid>(`${S}/marks/grid`, { params })).data,
  });
}

export function useLockMarks() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: { examId: string; classId: string; subjectId?: string; locked: boolean }) =>
      (await api.post<{ updated: number; locked: boolean }>(`${S}/marks/lock`, dto)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['school', 'marks'] }),
  });
}

export interface Stream { id: string; classId: string; name: string; capacity: number }
/**
 * The subdivisions of a class, as a school means them — "P4 West".
 *
 * The schema carries two models for one idea: `Section` and `Stream`. Only
 * Section reaches attendance, the class teacher, rosters and homework; only
 * Stream reached the mark screens. So whichever a school picked, half the
 * system could not see its streams.
 *
 * Section is the one that goes everywhere, so it is what the UI creates and
 * filters on, under the word a Ugandan school actually uses. Existing `Stream`
 * rows keep working — the server matches either column — and are listed here
 * too so a school that already created them is not stranded.
 */
export function useClassSubdivisions(classId?: string) {
  const sections = useSections();
  const streams = useStreams(classId);
  const fromSections = (sections.data?.data ?? []).filter((x) => !classId || x.classId === classId);
  const fromStreams = (streams.data?.data ?? []).filter((x) => !classId || x.classId === classId);
  const seen = new Set(fromSections.map((x) => x.name.toLowerCase()));
  return {
    isLoading: sections.isLoading || streams.isLoading,
    data: [
      ...fromSections.map((x) => ({ id: x.id, name: x.name, classId: x.classId })),
      // A Stream whose name already exists as a Section would be a duplicate
      // row for the same "West" — show it once.
      ...fromStreams
        .filter((x) => !seen.has(x.name.toLowerCase()))
        .map((x) => ({ id: x.id, name: x.name, classId: x.classId })),
    ],
  };
}

/**
 * A stream IS a section (ADR-029): the separate Stream table is gone, so this
 * reads sections and keeps the old shape for the screens still calling it.
 */
export function useStreams(classId?: string) {
  return useQuery({
    queryKey: ['school', 'streams', classId ?? 'all'],
    queryFn: async () => {
      const res = (await api.get<Paginated<Section & { capacity?: number | null }>>(`${S}/sections`, { params: { pageSize: 300 } })).data;
      const rows = (res.data ?? []).filter((x) => !classId || x.classId === classId);
      return { ...res, data: rows.map((x) => ({ id: x.id, classId: x.classId, name: x.name, capacity: x.capacity ?? 0 })) as Stream[] };
    },
  });
}

/* ═══════════════════════ Moodle-shaped LMS (ADR-014) ═══════════════════════ */
const LMS = `${S}/lms`;

/**
 * A catalog card. The server composes the display name (subject - class (term)),
 * because `CourseOffering` has no usable name column of its own; the browser used
 * to render "Course a1b2c3d4" for every row.
 */
export interface LmsCourse {
  id: string; name: string; subject: string | null; className: string | null;
  term: string | null; academicYear: string | null;
  format: string; numSections: number; visible: boolean; summary?: string | null;
  completionEnabled: boolean; showGradesToStudents: boolean; status?: string;
  startDate: string | null; endDate: string | null;
  teachers: string[]; counts: { modules: number; enrolments: number };
}
export interface LmsSection {
  id: string; sectionNo: number; name?: string | null; summary?: string | null;
  visible: boolean; weekOf?: string | null; sequence: string[];
  modules: LmsModule[]; availabilityInfo?: { available: boolean; reasons: string[] };
}
export interface LmsModule {
  id: string; activityType: string; instanceId: string; sectionId: string;
  visible: boolean; sequence: number; completionMode: string; assessmentId?: string | null;
  dueAt?: string | null; completion?: string; availabilityInfo?: { available: boolean; reasons: string[] };
}
export interface LmsActivityType { name: string; label: string; icon: string; gradable: boolean; hasSubmissions: boolean }

export function useLmsCourses(
  params: { termId?: string; classId?: string; subjectId?: string; q?: string; visible?: string } = {},
) {
  return useQuery({ queryKey: ['lms', 'courses', params], queryFn: async () => (await api.get<LmsCourse[]>(`${LMS}/courses`, { params })).data });
}
/**
 * `asStudent` is a REQUEST to view on a pupil's behalf, not an identity claim.
 * The server resolves who you are from your token and refuses this unless you
 * are that student, their guardian, or staff holding the preview capability —
 * so passing someone else's id yields a 403, not their data. A student omits it.
 */
export function useLmsCoursePage(id: string, asStudent?: string) {
  return useQuery({ queryKey: ['lms', 'course', id, asStudent ?? 'self'], enabled: !!id,
    queryFn: async () => (await api.get<{ offering: LmsCourse; sections: LmsSection[] }>(`${LMS}/courses/${id}`, { params: asStudent ? { asStudent } : {} })).data });
}
export function useLmsPermissions(id: string) {
  return useQuery({ queryKey: ['lms', 'permissions', id], enabled: !!id, queryFn: async () => (await api.get<Record<string, boolean>>(`${LMS}/courses/${id}/permissions`)).data });
}
export function useLmsEnsureSections() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: async (id: string) => (await api.post(`${LMS}/courses/${id}/sections/ensure`)).data, onSuccess: (_d, id) => qc.invalidateQueries({ queryKey: ['lms', 'course', id] }) });
}
export function useLmsUpdateCourseSettings() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: async ({ id, ...dto }: any) => (await api.patch(`${LMS}/courses/${id}/settings`, dto)).data, onSuccess: (_d, v: any) => qc.invalidateQueries({ queryKey: ['lms', 'course', v.id] }) });
}
export function useLmsAddSection() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: async ({ id, ...dto }: any) => (await api.post(`${LMS}/courses/${id}/sections`, dto)).data, onSuccess: (_d, v: any) => qc.invalidateQueries({ queryKey: ['lms', 'course', v.id] }) });
}
export function useLmsAddModule() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: async ({ courseId, ...dto }: any) => (await api.post(`${LMS}/courses/${courseId}/modules`, dto)).data, onSuccess: (_d, v: any) => qc.invalidateQueries({ queryKey: ['lms', 'course', v.courseId] }) });
}
export function useLmsMoveModule() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: async ({ id, ...dto }: any) => (await api.post(`${LMS}/modules/${id}/move`, dto)).data, onSuccess: () => qc.invalidateQueries({ queryKey: ['lms', 'course'] }) });
}
export function useLmsDeleteModule() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: async (id: string) => (await api.delete(`${LMS}/modules/${id}`)).data, onSuccess: () => qc.invalidateQueries({ queryKey: ['lms', 'course'] }) });
}
export function useLmsModuleView(id: string, asStudent?: string) {
  return useQuery({ queryKey: ['lms', 'module', id, asStudent ?? 'self'], enabled: !!id, queryFn: async () => (await api.get(`${LMS}/modules/${id}/view`, { params: asStudent ? { asStudent } : {} })).data });
}
export function useLmsModuleAction() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: async ({ id, action, ...dto }: any) => (await api.post(`${LMS}/modules/${id}/action/${action}`, dto)).data, onSuccess: () => qc.invalidateQueries({ queryKey: ['lms'] }) });
}
export function useLmsSyncRoster() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: async (id: string) => (await api.post(`${LMS}/courses/${id}/enrol/sync`)).data, onSuccess: (_d, id) => qc.invalidateQueries({ queryKey: ['lms', 'course', id] }) });
}
export function useLmsGradebook(id: string) {
  return useQuery({ queryKey: ['lms', 'gradebook', id], enabled: !!id, queryFn: async () => (await api.get(`${LMS}/courses/${id}/gradebook`)).data });
}
export function useLmsCompletionReport(id: string) {
  return useQuery({ queryKey: ['lms', 'completion', id], enabled: !!id, queryFn: async () => (await api.get(`${LMS}/courses/${id}/completion-report`)).data });
}
export function useLmsParticipants(courseOfferingId: string) {
  return useQuery({ queryKey: ['lms', 'participants', courseOfferingId], enabled: !!courseOfferingId, queryFn: async () => (await api.get<any[]>(`${LMS}/roles/participants`, { params: { courseOfferingId } })).data });
}
export function useLmsSeedRoles() {
  return useMutation({ mutationFn: async () => (await api.post(`${LMS}/roles/seed`)).data });
}
/**
 * "My learning" (L3.1). The subject is resolved from the caller's token; a
 * guardian passes `asStudent` to pick a child, which the server checks against
 * their guardianships. There is no way to ask for an arbitrary pupil.
 */
/**
 * CBT attempt hooks used by the in-course quiz runner.
 *
 * `studentProfileId` is intentionally absent from `start`: the server takes the
 * sitter from the caller's token and refuses an attempt opened in someone else's
 * name. Ownership is likewise re-checked on every save and on submit.
 */
export function useCbtStartAttempt() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: { paperId: string; studentAssessmentId?: string }) =>
      (await api.post(`${CBT}/start`, dto)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cbt'] }),
  });
}

export function useCbtAttempt(attemptId?: string) {
  return useQuery({
    queryKey: ['cbt', 'attempt', attemptId],
    enabled: !!attemptId,
    queryFn: async () => (await api.get(`${CBT}/attempts/${attemptId}`)).data,
  });
}

export function useCbtSaveResponse() {
  return useMutation({
    mutationFn: async (dto: {
      attemptId: string; questionId: string; response: Record<string, unknown>;
      sequenceNumber: number; clientEventId?: string;
    }) => (await api.post(`${CBT}/response`, dto)).data,
  });
}

export function useCbtSubmitAttempt() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: { attemptId: string; idempotencyKey?: string }) =>
      (await api.post(`${CBT}/submit`, dto)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cbt'] }),
  });
}

/** Spine fields only — visibility, dates, completion, availability. */
export function useLmsUpdateModule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...dto }: any) => (await api.patch(`${LMS}/modules/${id}`, dto)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['lms'] }),
  });
}

/** Plugin fields only. Kept separate so a plugin can never write spine state. */
export function useLmsUpdateInstance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...dto }: any) => (await api.patch(`${LMS}/modules/${id}/instance`, dto)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['lms'] }),
  });
}

/** Deadlines + lessons in a window. Scope is decided server-side. */
export function useLmsCalendar(from: string, to: string, asStudent?: string) {
  return useQuery({
    queryKey: ['lms', 'calendar', from, to, asStudent ?? 'self'],
    queryFn: async () => (await api.get(`${LMS}/calendar`, { params: { from, to, ...(asStudent ? { asStudent } : {}) } })).data,
  });
}

export function useLmsEngagement(courseId: string) {
  return useQuery({
    queryKey: ['lms', 'engagement', courseId],
    enabled: !!courseId,
    queryFn: async () => (await api.get(`${LMS}/courses/${courseId}/engagement`)).data,
  });
}

/**
 * Edit one gradebook cell.
 *
 * Routes through the LMS gradebook service, which delegates to the grade bridge
 * and ultimately `MarkingService` — the single permitted writer of a mark. Never
 * write StudentAssessment.score from anywhere else.
 */
export function useLmsEditCell() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ courseId, ...dto }: { courseId: string; studentAssessmentId: string; score: number }) =>
      (await api.patch(`${LMS}/courses/${courseId}/gradebook/cell`, dto)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['lms'] }),
  });
}

/** Export a course structure as a portable bundle. */
export function useLmsExportCourse() {
  return useMutation({
    mutationFn: async ({ id, includeUserData }: { id: string; includeUserData?: boolean }) =>
      (await api.post(`${LMS}/courses/${id}/export`, { includeUserData })).data,
  });
}

/** Clone a term's course structures into the next term. Structure only. */
export function useLmsRollover() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: { fromTermId: string; toTermId: string; offeringIds?: string[] }) =>
      (await api.post(`${LMS}/courses/rollover`, dto)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['lms'] }),
  });
}

export function useLmsMyDashboard(asStudent?: string) {
  return useQuery({
    queryKey: ['lms', 'my', asStudent ?? 'self'],
    queryFn: async () => (await api.get(`${LMS}/my`, { params: asStudent ? { asStudent } : {} })).data,
    retry: false,
  });
}

/** Children a guardian may switch between. Empty for students and staff. */
export function useLmsMyChildren() {
  return useQuery({
    queryKey: ['lms', 'my', 'children'],
    queryFn: async () => (await api.get(`${LMS}/my/children`)).data,
    retry: false,
  });
}

export function useLmsSetCompletion() {
  const qc = useQueryClient();
  // `asStudent` only; the server resolves the subject from the token and refuses
  // a mismatch, so a client cannot tick a classmate's box.
  return useMutation({ mutationFn: async ({ id, ...dto }: any) => (await api.post(`${LMS}/modules/${id}/completion`, dto)).data, onSuccess: () => qc.invalidateQueries({ queryKey: ['lms'] }) });
}
export function useLmsActivityReport(id: string) {
  return useQuery({ queryKey: ['lms', 'activity-report', id], enabled: !!id, queryFn: async () => (await api.get(`${LMS}/courses/${id}/activity-report`)).data });
}

/* ─────────────────── LMS operations: enrolment, groups, badges, reports ───────────────────
 * These routes existed on the server from P4/P7 but had no client at all, so the
 * enrolment manager, groups screen, badge wall and report suite could not be built.
 * Every one is capability-gated server-side; the hooks below never decide access.
 * ------------------------------------------------------------------------------------- */

export interface LmsEnrolment {
  id: string; courseOfferingId: string; studentProfileId: string | null; userId: string | null;
  status: 'active' | 'suspended'; startedAt: string | null; methodId: string;
  studentName: string | null; admissionNo: string | null;
}
export interface LmsEnrolmentMethod {
  id: string; method: string; enabled: boolean; sortOrder: number; enrolmentKey?: string | null;
}
export interface LmsGroupRow {
  id: string; name: string; description?: string | null; enrolmentKey?: string | null;
  _count?: { members: number };
}
export interface LmsBadgeRow {
  id: string; name: string; description?: string | null; imageUrl?: string | null;
  criteriaType: string; courseOfferingId?: string | null; _count?: { awards: number };
}

export function useLmsEnrolments(courseId: string, status?: 'active' | 'suspended') {
  return useQuery({
    queryKey: ['lms', 'enrolments', courseId, status ?? 'all'],
    enabled: !!courseId,
    queryFn: async () => (await api.get<LmsEnrolment[]>(`${LMS}/courses/${courseId}/enrolments`, { params: status ? { status } : {} })).data,
  });
}

export function useLmsEnrolmentMethods(courseId: string) {
  return useQuery({
    queryKey: ['lms', 'enrolment-methods', courseId],
    enabled: !!courseId,
    queryFn: async () => (await api.get<LmsEnrolmentMethod[]>(`${LMS}/courses/${courseId}/enrolment-methods`)).data,
  });
}

export function useLmsEnrol() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ courseId, ...dto }: { courseId: string; studentProfileId?: string; userId?: string; roleShortname?: string }) =>
      (await api.post(`${LMS}/courses/${courseId}/enrol`, dto)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['lms'] }),
  });
}

/** Suspend or reactivate one enrolment. Suspension keeps the history; removal does not. */
export function useLmsSetEnrolStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status: 'active' | 'suspended' }) =>
      (await api.patch(`${LMS}/enrolments/${id}`, { status })).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['lms', 'enrolments'] }),
  });
}

export function useLmsGroups(courseId: string) {
  return useQuery({
    queryKey: ['lms', 'groups', courseId],
    enabled: !!courseId,
    queryFn: async () => (await api.get<LmsGroupRow[]>(`${LMS}/courses/${courseId}/groups`)).data,
  });
}

export function useLmsCreateGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ courseId, ...dto }: { courseId: string; name: string; description?: string; enrolmentKey?: string }) =>
      (await api.post(`${LMS}/courses/${courseId}/groups`, dto)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['lms', 'groups'] }),
  });
}

export function useLmsGroupMembers(groupId?: string) {
  return useQuery({
    queryKey: ['lms', 'group-members', groupId],
    enabled: !!groupId,
    queryFn: async () => (await api.get<any[]>(`${LMS}/groups/${groupId}/members`)).data,
  });
}

export function useLmsAddGroupMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ groupId, ...dto }: { groupId: string; studentProfileId?: string; userId?: string }) =>
      (await api.post(`${LMS}/groups/${groupId}/members`, dto)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['lms'] }),
  });
}

export function useLmsRemoveGroupMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (memberId: string) => (await api.delete(`${LMS}/group-members/${memberId}`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['lms'] }),
  });
}

export function useLmsGroupings(courseId: string) {
  return useQuery({
    queryKey: ['lms', 'groupings', courseId],
    enabled: !!courseId,
    queryFn: async () => (await api.get<any[]>(`${LMS}/courses/${courseId}/groupings`)).data,
  });
}

export function useLmsCreateGrouping() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ courseId, ...dto }: { courseId: string; name: string; groupIds?: string[] }) =>
      (await api.post(`${LMS}/courses/${courseId}/groupings`, dto)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['lms', 'groupings'] }),
  });
}

export function useLmsBadges(courseOfferingId?: string) {
  return useQuery({
    queryKey: ['lms', 'badges', courseOfferingId ?? 'all'],
    queryFn: async () => (await api.get<LmsBadgeRow[]>(`${LMS}/badges`, { params: courseOfferingId ? { courseOfferingId } : {} })).data,
  });
}

export function useLmsCreateBadge() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: { name: string; description?: string; imageUrl?: string; criteriaType?: string; courseOfferingId?: string }) =>
      (await api.post(`${LMS}/badges`, dto)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['lms', 'badges'] }),
  });
}

export function useLmsAwardBadge() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ badgeId, ...dto }: { badgeId: string; studentProfileId?: string; userId?: string }) =>
      (await api.post(`${LMS}/badges/${badgeId}/award`, dto)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['lms'] }),
  });
}

export function useLmsBadgeAwards(badgeId?: string) {
  return useQuery({
    queryKey: ['lms', 'badge-awards', badgeId],
    enabled: !!badgeId,
    queryFn: async () => (await api.get<any[]>(`${LMS}/badges/${badgeId}/awards`)).data,
  });
}

/** The learner's own badge wall. Subject comes from the token. */
export function useLmsMyBadges(asStudent?: string) {
  return useQuery({
    queryKey: ['lms', 'my', 'badges', asStudent ?? 'self'],
    queryFn: async () => (await api.get<any[]>(`${LMS}/my/badges`, { params: asStudent ? { asStudent } : {} })).data,
    retry: false,
  });
}

export function useLmsLogs(courseId: string, filter: { action?: string; from?: string; to?: string } = {}) {
  return useQuery({
    queryKey: ['lms', 'logs', courseId, filter],
    enabled: !!courseId,
    queryFn: async () => (await api.get<any[]>(`${LMS}/courses/${courseId}/logs`, { params: filter })).data,
  });
}

export function useLmsParticipation(courseId: string, action?: string) {
  return useQuery({
    queryKey: ['lms', 'participation', courseId, action ?? 'all'],
    enabled: !!courseId,
    queryFn: async () => (await api.get<any[]>(`${LMS}/courses/${courseId}/participation`, { params: action ? { action } : {} })).data,
  });
}

export function useLmsOutline(courseId: string) {
  return useQuery({
    queryKey: ['lms', 'outline', courseId],
    enabled: !!courseId,
    queryFn: async () => (await api.get<any[]>(`${LMS}/courses/${courseId}/outline`)).data,
  });
}

/** Pupils who have not opened a given activity — the follow-up list. */
export function useLmsNotViewed(courseId: string, moduleId?: string) {
  return useQuery({
    queryKey: ['lms', 'not-viewed', courseId, moduleId],
    enabled: !!courseId && !!moduleId,
    queryFn: async () => (await api.get<any[]>(`${LMS}/courses/${courseId}/not-viewed/${moduleId}`)).data,
  });
}

/** One student's grade report — the same payload the pupil and their parent read. */
export function useLmsUserGrades(courseId: string, studentProfileId?: string) {
  return useQuery({
    queryKey: ['lms', 'user-grades', courseId, studentProfileId],
    enabled: !!courseId && !!studentProfileId,
    queryFn: async () => (await api.get(`${LMS}/courses/${courseId}/gradebook/user/${studentProfileId}`)).data,
  });
}

/** CSV text of the grader report. Called on demand, not on render. */
export function useLmsExportGrades() {
  return useMutation({
    mutationFn: async (courseId: string) => (await api.get<string>(`${LMS}/courses/${courseId}/gradebook/export`)).data,
  });
}

export function useLmsImportGrades() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ courseId, rows }: { courseId: string; rows: { studentAssessmentId: string; score: number }[] }) =>
      (await api.post(`${LMS}/courses/${courseId}/gradebook/import`, { rows })).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['lms'] }),
  });
}

/**
 * An override records a reason alongside the mark. Use it when replacing a mark
 * the system computed; a plain cell edit is for correcting data entry.
 */
export function useLmsOverrideGrade() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ courseId, ...dto }: { courseId: string; studentAssessmentId: string; score: number; reason?: string }) =>
      (await api.post(`${LMS}/courses/${courseId}/gradebook/override`, dto)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['lms'] }),
  });
}

/** Hide (withhold from pupils/parents) or lock (freeze) one gradebook column. */
export function useLmsSetGradeColumn() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ courseId, ...dto }: { courseId: string; assessmentId: string; hidden?: boolean; locked?: boolean }) =>
      (await api.patch(`${LMS}/courses/${courseId}/gradebook/column`, dto)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['lms'] }),
  });
}

export function useLmsImportCourse() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, bundle, includeUserData }: { id: string; bundle: unknown; includeUserData?: boolean }) =>
      (await api.post(`${LMS}/courses/${id}/import`, { bundle, includeUserData })).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['lms'] }),
  });
}

/** Course modules whose plugin instance row has vanished (ADR-014 §4 safety net). */
export function useLmsOrphans() {
  return useQuery({
    queryKey: ['lms', 'orphans'],
    queryFn: async () => (await api.get<any>(`${LMS}/maintenance/orphans`)).data,
  });
}

export function useLmsRepairOrphans() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (courseModuleIds: string[]) => (await api.post(`${LMS}/maintenance/orphans/repair`, { courseModuleIds })).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['lms', 'orphans'] }),
  });
}

/* ───────────────────── Gradebook (class × term × subject spreadsheet) ─────────────────────
 * One weighted total per student, computed by the same kernel the ResultSet
 * and report card use. Columns are Assessment rows; only manual columns are
 * editable here (exam/assignment/quiz marks live on their own screens).
 * ------------------------------------------------------------------------- */

export interface GradebookColumn {
  assessmentId: string;
  title: string;
  kind: string;
  maxScore: number;
  sourceType: string;
  componentId: string | null;
  groupId: string;
  locked: boolean;
  hiddenFromStudents: boolean;
  dueAt: string | null;
  editable: boolean;
}

export interface GradebookGroup {
  id: string;
  name: string;
  kind: string;
  weight: number | null;
  columnIds: string[];
}

export interface GradebookStudent {
  studentProfileId: string;
  name: string;
  admissionNo: string;
  streamName: string | null;
  cells: Record<string, { studentAssessmentId: string | null; marks: number | null; grade: string | null; participation: string; status: string }>;
  finalPercent: number | null;
  grade: string | null;
  componentPercents: Array<{ componentId: string; percent: number | null; weight: number }>;
}

export interface GradebookSheet {
  class: { id: string; name: string; gradeLevelId: string } | null;
  term: { id: string; name: string } | null;
  subjects: Array<{ id: string; name: string; code: string }>;
  subject: { id: string; name: string; code: string } | null;
  columns: GradebookColumn[];
  groups: GradebookGroup[];
  students: GradebookStudent[];
  policy: { id: string; name: string; weightsTotal: number; weightsValid: boolean } | null;
}

export function useGradebookSheet(params: { classId?: string; termId?: string; subjectId?: string; sectionId?: string }) {
  const ready = !!params.classId && !!params.termId;
  return useQuery({
    queryKey: ['school', 'gradebook', 'sheet', params],
    enabled: ready,
    queryFn: async () => (await api.get<GradebookSheet>(`${S}/gradebook/sheet`, { params })).data,
  });
}

export function useGradebookCell() {
  return useMutation({
    mutationFn: async (dto: { studentProfileId: string; assessmentId: string; marks?: number | null; participation?: string; expectedVersion?: number }) =>
      (await api.post(`${S}/gradebook/cell`, dto)).data,
  });
}

export function useCreateGradebookColumn() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: { classId: string; termId: string; subjectId: string; title: string; maxScore?: number; componentId?: string; dueAt?: string }) =>
      (await api.post(`${S}/gradebook/column`, dto)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['school', 'gradebook'] }),
  });
}

export function useUpdateGradebookColumn() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...dto }: { id: string; title?: string; maxScore?: number; componentId?: string | null; hiddenFromStudents?: boolean; dueAt?: string | null }) =>
      (await api.patch(`${S}/gradebook/column/${id}`, dto)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['school', 'gradebook'] }),
  });
}

export function useDeleteGradebookColumn() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, force }: { id: string; force?: boolean }) =>
      (await api.delete(`${S}/gradebook/column/${id}`, { params: force ? { force: 'true' } : {} })).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['school', 'gradebook'] }),
  });
}

export function useLockGradebookColumn() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, locked }: { id: string; locked: boolean }) =>
      (await api.post(`${S}/gradebook/column/${id}/lock`, { locked })).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['school', 'gradebook'] }),
  });
}

/* Weighting-policy components — for the "add column → attach to component" picker. */
export function usePolicyComponents(policyId?: string) {
  return useQuery({
    queryKey: ['school', 'assessment-components', policyId],
    enabled: !!policyId,
    queryFn: async () => (await api.get<Array<{ id: string; name: string; kind: string; weight: string }>>(`${S}/assessment-components/by-policy/${policyId}`)).data,
  });
}

/* ───────────────────── Teacher workspace (P5) ───────────────────── */

export interface TeacherOverview {
  teacher: { id: string; name: string } | null;
  classes: Array<{ classId: string; className: string; subjectId: string; subjectName: string }>;
  needsMarking: Array<{ assessmentId: string; title: string; subject: string; classId: string; count: number }>;
  dueSoon: Array<{ assessmentId: string; title: string; subject: string; classId: string; dueAt: string | null; overdue: boolean }>;
  awaitingApproval: number;
  returnedToMe: Array<{ studentAssessmentId: string; assessmentId: string; title: string; subject: string }>;
  examPapers: Array<{ examScheduleId: string; examName: string; subject: string; classId: string; entered: number; total: number }>;
  lessonPlans: { draft: number; submitted: number; approved: number };
}

export function useTeacherOverview(teacherPartnerId?: string) {
  return useQuery({
    queryKey: ['school', 'teaching', teacherPartnerId],
    enabled: !!teacherPartnerId,
    queryFn: async () => (await api.get<TeacherOverview>(`${S}/portals/teaching/${teacherPartnerId}`)).data,
  });
}

/* ───────────────────── Assessment board — the unified front door ─────────────────────
 * One list, one create form, one submit/approve path, whatever KIND of
 * assessment it is. The kind-specific surfaces (/school/marks, /school/homework,
 * /school/gradebook) still exist and still own the detail; this is the door.
 * ------------------------------------------------------------------------- */

export const ASSESSMENT_KINDS = [
  'cat', 'homework', 'assignment', 'quiz', 'project', 'practical', 'exam', 'oral', 'classwork', 'observation', 'activity_of_integration',
] as const;
export type AssessmentKind = (typeof ASSESSMENT_KINDS)[number];

/** School language, not database language. */
export const KIND_LABEL: Record<string, string> = {
  cat: 'CAT', homework: 'Homework', project: 'Project', practical: 'Practical',
  exam: 'Exam', oral: 'Oral', classwork: 'Classwork', attendance: 'Attendance',
  assignment: 'Assignment', quiz: 'Quiz', observation: 'Observation', activity_of_integration: 'Activity of Integration',
};

export const BOARD_STAGES = ['draft', 'open', 'marking', 'submitted', 'approved', 'returned'] as const;
export type BoardStage = (typeof BOARD_STAGES)[number];

export const STAGE_LABEL: Record<string, string> = {
  draft: 'Draft', open: 'Not started', marking: 'Marking',
  submitted: 'Awaiting approval', approved: 'Approved', returned: 'Returned',
};

export interface BoardRow {
  assessmentId: string;
  title: string;
  kind: string;
  sequence: number;
  subject: { id: string; name: string };
  class: { id: string; name: string };
  component: { id: string; name: string; weight: number } | null;
  maxScore: number;
  dueAt: string | null;
  status: string;
  approvalStatus: string;
  locked: boolean;
  sourceType: string;
  marked: number;
  total: number;
  version: number;
  courseOffering: { id: string; name: string } | null;
  rosterId: string | null;
  rosterFrozen: boolean;
  feedbackReleaseAt: string | null;
  marksReleaseAt: string | null;
}

export interface BoardPolicy {
  id: string;
  components: Array<{ id: string; name: string; kind: string; weight: number }>;
  totalWeight: number;
  valid: boolean;
}

export interface AssessmentBoard {
  rows: BoardRow[];
  policy: BoardPolicy | null;
  subjects: Array<{ id: string; name: string }>;
  counts: Record<string, number>;
}

export function useAssessmentBoard(q: {
  termId?: string; classId?: string; subjectId?: string; kind?: string; status?: string; courseOfferingId?: string; sectionId?: string;
}) {
  return useQuery({
    queryKey: ['school', 'assessment-board', q],
    enabled: !!q.termId,
    queryFn: async () => {
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries(q)) if (v) params.set(k, String(v));
      return (await api.get<AssessmentBoard>(`${S}/assessment-board?${params}`)).data;
    },
  });
}

export interface ApprovalRow {
  assessmentId: string;
  title: string;
  kind: string;
  subject: string;
  class: string;
  submittedBy: string | null;
  students: number;
  average: number | null;
  missing: number;
  maxScore: number;
}

export function useApprovalQueue(termId?: string, classId?: string) {
  return useQuery({
    queryKey: ['school', 'assessment-board', 'approvals', termId, classId],
    enabled: !!termId,
    queryFn: async () => {
      const params = new URLSearchParams({ termId: termId! });
      if (classId) params.set('classId', classId);
      return (await api.get<{ rows: ApprovalRow[] }>(`${S}/assessment-board/approvals?${params}`)).data;
    },
  });
}

export interface CreateAssessmentInput {
  kind: string;
  contribution?: 'formative' | 'summative';
  classId?: string;
  subjectId?: string;
  termId: string;
  title: string;
  maxScore?: number;
  sequence?: number;
  componentId?: string;
  teacherPartnerId?: string;
  description?: string;
  dueAt?: string;
  examId?: string;
  classIds?: string[];
  courseOfferingId: string;
  rosterId: string;
  openAt?: string;
  closeAt?: string;
  learningOutcomeIds?: string[];
  gradingMode?: 'points' | 'rubric' | 'complete_incomplete';
  rubricId?: string;
  allowLate?: boolean;
  latePenaltyPercent?: number;
  maxAttempts?: number;
}

export function useCreateAssessmentUnified() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: CreateAssessmentInput) =>
      (await api.post(`${S}/assessment-board`, dto)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['school', 'assessment-board'] });
      qc.invalidateQueries({ queryKey: ['school', 'gradebook'] });
      qc.invalidateQueries({ queryKey: ['school', 'homework'] });
    },
  });
}

export function useSubmitAssessmentMarks() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (assessmentId: string) =>
      (await api.post(`${S}/assessment-board/${assessmentId}/submit`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['school', 'assessment-board'] }),
  });
}

export function useApproveAssessmentMarks() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: { assessmentId: string; action: 'approve' | 'reject'; reason?: string }) =>
      (await api.post(`${S}/assessment-board/${dto.assessmentId}/approval`, {
        action: dto.action, reason: dto.reason,
      })).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['school', 'assessment-board'] }),
  });
}

export interface BoardSheetStudent {
  studentProfileId: string;
  name: string;
  admissionNo: string;
  studentAssessmentId: string | null;
  marks: number | null;
  percentage: number | null;
  participation: string;
  approvalStatus: string;
  version: number;
  comment: string;
  rejectionReason: string | null;
}

export interface BoardSheet {
  assessment: {
    id: string;
    title: string;
    kind: string;
    maxScore: number;
    dueAt: string | null;
    locked: boolean;
    status: string;
    version: number;
    courseOfferingId: string | null;
    courseName: string | null;
    rosterId: string | null;
    rosterFrozen: boolean;
    assignmentId: string | null;
    gradingMode: string;
    feedbackReleaseAt: string | null;
    marksReleaseAt: string | null;
    subject: { id: string; name: string };
    class: { id: string; name: string };
    component: { id: string; name: string; weight: number } | null;
  };
  approvalStatus: string;
  students: BoardSheetStudent[];
  marked: number;
  total: number;
}

export function useBoardSheet(assessmentId?: string) {
  return useQuery({
    queryKey: ['school', 'assessment-board', 'sheet', assessmentId],
    enabled: !!assessmentId,
    queryFn: async () => (await api.get<BoardSheet>(`${S}/assessment-board/${assessmentId}/sheet`)).data,
  });
}

/**
 * Deliberately does NOT invalidate: refetching the sheet would remount the input
 * the teacher is still typing in. The grid patches its own row from the result.
 */
export function useSaveBoardMark(assessmentId?: string) {
  return useMutation({
    mutationFn: async (dto: { studentProfileId: string; marks: number | null; participation?: string; expectedVersion?: number }) =>
      (await api.post(`${S}/assessment-board/${assessmentId}/mark`, dto)).data,
  });
}

/* ── Teacher cover (Phase 7) ─────────────────────────────────────────────── */

export interface AffectedLesson {
  id: string;
  dayOfWeek: number;
  subject?: { id: string; name: string; code?: string | null } | null;
  schoolClass?: { id: string; name: string } | null;
  section?: { id: string; name: string } | null;
  period?: { id: string; name: string; startTime?: string; endTime?: string } | null;
  teacherPartnerId?: string | null;
  substituteTeacherId?: string | null;
}

/** Lessons a teacher's absence leaves uncovered between two dates. */
export function useAffectedLessons(teacherPartnerId?: string, from?: string, to?: string) {
  return useQuery({
    enabled: !!teacherPartnerId && !!from && !!to,
    queryKey: ['school', 'cover', 'affected', teacherPartnerId, from, to],
    queryFn: async () =>
      (await api.get<AffectedLesson[]>(`${S}/timetable/cover/affected/${teacherPartnerId}`, { params: { from, to } })).data,
  });
}

/** Book a substitute for one slot over a date window. Clash-checked server-side. */
export function useAssignSubstitute() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: {
      timetableSlotId: string;
      substituteTeacherId: string;
      effectiveFrom: string;
      effectiveTo: string;
      reason?: string;
    }) => (await api.post(`${S}/timetable/cover/assign`, dto)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['school', 'cover'] }),
  });
}

/* ═══════════════ Fees ⇄ accounting hardening ═══════════════ */

/** A fee-produced journal entry — the accounting trail behind a receipt or invoice. */
export interface FeeJournal {
  id: string;
  entryNumber: string;
  journal?: { code: string; name: string } | null;
  postingDate: string;
  status: string;
  description?: string | null;
  sourceType?: string | null;
  sourceId?: string | null;
  reversedEntryId?: string | null;
  lines: Array<{ accountCode?: string; accountName?: string; description?: string | null; debit: number; credit: number }>;
}
export function useFeeJournal(id?: string | null) {
  return useQuery({
    queryKey: ['school', 'finance', 'journal', id],
    enabled: !!id,
    queryFn: async () => (await api.get<FeeJournal>(`${S}/finance/journal/${id}`)).data,
  });
}

/* ── Admission / application fee ── */

export type ApplicationFeeState = 'unpaid' | 'pending' | 'paid' | 'waived';
export interface ApplicationFeeStatus {
  applicationId: string;
  feeStatus: ApplicationFeeState;
  invoice: null | {
    id: string;
    documentNumber: string;
    status: string;
    totalAmount: number;
    amountPaid: number;
    amountResidual: number;
    journalEntryId?: string | null;
    payments: Array<{
      allocationId: string;
      amount: number;
      paymentId?: string;
      paymentNumber?: string;
      paymentDate?: string;
      paymentMethod?: string;
    }>;
  };
}
export function useApplicationFee(applicationId?: string) {
  return useQuery({
    queryKey: ['school', 'admissions', 'fee', applicationId],
    enabled: !!applicationId,
    queryFn: async () => (await api.get<ApplicationFeeStatus>(`${S}/admissions/${applicationId}/fee`)).data,
  });
}
function useAdmissionFeeMutation<T>(fn: (v: T) => Promise<unknown>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['school', 'admissions'] });
      qc.invalidateQueries({ queryKey: ['school', 'finance'] });
    },
  });
}
export function useChargeApplicationFee() {
  return useAdmissionFeeMutation(async ({ applicationId, amount }: { applicationId: string; amount: number }) =>
    (await api.post(`${S}/admissions/${applicationId}/fee`, { amount })).data,
  );
}
export function usePayApplicationFee() {
  // A fresh random key on EVERY call made the key useless: a retry was a new
  // payment (F9). One key per attempt, reused until it succeeds.
  const attempt = useAttemptKey('admfee');
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      applicationId,
      ...body
    }: {
      applicationId: string;
      amount?: number;
      paymentMethod: 'cash' | 'bank' | 'mobile_money' | 'card';
      reference?: string;
      cashSessionId?: string;
      bankAccountId?: string;
    }) =>
      (await api.post(`${S}/admissions/${applicationId}/fee/pay`, body, {
        headers: { 'Idempotency-Key': attempt.keyFor({ applicationId, ...body }) },
      })).data,
    onSuccess: () => {
      attempt.reset();
      qc.invalidateQueries({ queryKey: ['school', 'admissions'] });
      invalidateMoney(qc);
    },
  });
}
export function useWaiveApplicationFee() {
  return useAdmissionFeeMutation(async ({ applicationId, reason }: { applicationId: string; reason?: string }) =>
    (await api.post(`${S}/admissions/${applicationId}/fee/waive`, { reason })).data,
  );
}

/* ── Mobile money gateways, clearing and settlement ── */

export interface MomoGateway {
  id: string;
  provider: 'mtn' | 'airtel';
  label: string;
  environment: 'sandbox' | 'production';
  merchantCode?: string | null;
  baseUrl?: string | null;
  currency: string;
  isActive: boolean;
  credentialKeys: string[];
  hasCallbackSecret: boolean;
  clearingAccount?: { id: string; code: string; name: string } | null;
  callbackPath: string;
  updatedAt: string;
}
export function useMomoGateways() {
  return useQuery({
    queryKey: ['school', 'momo', 'gateways'],
    queryFn: async () => (await api.get<MomoGateway[]>(`${S}/mobile-money/gateways`)).data,
  });
}
export function useUpsertMomoGateway() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      provider,
      ...body
    }: {
      provider: 'mtn' | 'airtel';
      label?: string;
      environment?: 'sandbox' | 'production';
      merchantCode?: string | null;
      baseUrl?: string | null;
      currency?: string;
      credentials?: Record<string, string>;
      callbackSecret?: string;
      clearingAccountId?: string | null;
      isActive?: boolean;
    }) => (await api.put<MomoGateway>(`${S}/mobile-money/gateways/${provider}`, body)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['school', 'momo'] }),
  });
}
export interface MomoClearingPosition {
  provider: 'mtn' | 'airtel';
  clearingAccountId: string;
  glBalance: number;
  unsettledCollections: number;
  variance: number;
  unsettled: Array<{ id: string; amount: number; providerRef: string; settledAt?: string | null; msisdn: string; paymentId?: string | null }>;
}
export function useMomoClearing() {
  return useQuery({
    queryKey: ['school', 'momo', 'clearing'],
    queryFn: async () => (await api.get<MomoClearingPosition[]>(`${S}/mobile-money/clearing`)).data,
  });
}
export interface MomoSettlement {
  id: string;
  provider: string;
  reference: string;
  settlementDate: string;
  grossAmount: string | number;
  charges: string | number;
  netAmount: string | number;
  journalEntryId?: string | null;
  notes?: string | null;
}
export function useMomoSettlements() {
  return useQuery({
    queryKey: ['school', 'momo', 'settlements'],
    queryFn: async () => (await api.get<MomoSettlement[]>(`${S}/mobile-money/settlements`)).data,
  });
}
export function useRecordMomoSettlement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: {
      provider: 'mtn' | 'airtel';
      reference: string;
      settlementDate?: string;
      grossAmount: number;
      charges?: number;
      bankAccountId: string;
      requestIds?: string[];
      notes?: string;
    }) => (await api.post<MomoSettlement>(`${S}/mobile-money/settlements`, dto)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['school', 'momo'] }),
  });
}

/* ── Term close preview, statement import bulk confirm, projection integrity ── */

export interface TermCloseSnapshot {
  termId: string;
  termName?: string;
  academicYearId?: string | null;
  billed: number;
  collected: number;
  credited: number;
  waived: number;
  adjusted: number;
  balance: number;
  residual: number;
  residualVariance: number;
  studentCount: number;
  invoiceCount: number;
  bySource: Record<string, { invoices: number; billed: number; outstanding: number }>;
  computedAt: string;
}
export function useTermClosePreview(termId?: string) {
  return useQuery({
    queryKey: ['school', 'finance', 'term-close', termId, 'preview'],
    enabled: !!termId,
    queryFn: async () => (await api.get<TermCloseSnapshot>(`${S}/finance/terms/${termId}/close-preview`)).data,
  });
}
export function useConfirmHighImportRows() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (batchId: string) =>
      (await api.post<{ attempted: number; posted: number; results: Array<{ rowId: string; status: string; error?: string }> }>(
        `${S}/finance/imports/${batchId}/confirm-high`,
        {},
      )).data,
    onSuccess: (_d, batchId) => {
      qc.invalidateQueries({ queryKey: ['school', 'finance', 'imports'] });
      qc.invalidateQueries({ queryKey: ['school', 'finance', 'imports', batchId] });
    },
  });
}
export interface CachedProjectionReconciliation {
  checked: number;
  drifted: Array<{
    kind: 'amountPaid' | 'amountWaived' | 'amountResidual' | 'creditRemaining';
    id: string;
    reference: string;
    cached: number;
    subledger: number;
    variance: number;
  }>;
}
export function useCachedProjectionReconciliation() {
  return useQuery({
    queryKey: ['school', 'finance', 'recon', 'projections'],
    queryFn: async () =>
      (await api.get<CachedProjectionReconciliation>(`${S}/finance/reconciliation/cached-projections`)).data,
  });
}

/** Finance reads need `school:fees:read`; skip the request instead of eating a 403. */
function canReadFees(): boolean {
  return useAuthStore.getState().hasPermission(PERMISSIONS.school.readFees);
}

/* ───────────────────────── Fee desk cash drawer (ADR-032 P3, audit F09) ───────────────────────── */

export interface CashDeskStatus {
  mode: 'drawer' | 'cashbook';
  mustOpenDrawer: boolean;
  session: {
    id: string;
    openedAt: string;
    openingFloat: string;
    register: { id: string; name: string; code: string } | null;
    expectedCash: string | null;
  } | null;
}

export function useCashDesk() {
  return useQuery({
    queryKey: ['school', 'cash-desk'],
    queryFn: async () => (await api.get<CashDeskStatus>(`${S}/fees/cash-desk`)).data,
  });
}

export function useOpenCashDrawer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (openingFloat: number) => (await api.post<CashDeskStatus>(`${S}/fees/cash-desk/open`, { openingFloat })).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['school', 'cash-desk'] }),
  });
}

export function useCloseCashDrawer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: { closingCounted: number; varianceReason?: string }) =>
      (await api.post(`${S}/fees/cash-desk/close`, dto)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['school', 'cash-desk'] }),
  });
}
