import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { PortalContext } from '@/stores/auth.store';

/**
 * Every endpoint the portal talks to.
 *
 * Nothing here is new API surface: these are the self-scoped routes that already
 * existed and had no client. Where a route still takes a `studentProfileId` in
 * the path, the server re-checks it against the caller's portal claim, so the id
 * the UI passes is a request, not a permission.
 */
const S = '/school';

/* ────────────────────────────── Session ────────────────────────────── */

/** Who this session speaks for. The first call the app makes after login. */
export function usePortalContext(enabled: boolean) {
  return useQuery({
    queryKey: ['portal', 'me'],
    enabled,
    // The answer changes when a guardianship or enrolment changes, not on a
    // timer; refetching it on every window focus would cost a query per tab
    // switch for information that is stable within a session.
    staleTime: 5 * 60_000,
    queryFn: async () => (await api.get<PortalContext>(`${S}/portals/me`)).data,
  });
}

export interface PortalNotice {
  id: string;
  channel: string;
  category: string;
  title: string;
  body: string;
  status: string;
  readAt: string | null;
  sentAt: string | null;
  createdAt: string;
}

/**
 * The notice history for whoever is signed in.
 *
 * A parent who was told by SMS that fees are due, or that results are out, has
 * no copy once the phone deletes it. The school's own record is the only
 * durable one, so the portal shows it. The subject is the token, not a
 * parameter — there is nothing here for a caller to edit.
 */
export function useMyNotices(enabled: boolean) {
  return useQuery({
    queryKey: ['portal', 'notices'],
    enabled,
    queryFn: async () => (await api.get<PortalNotice[]>(`${S}/portals/notifications`, { params: { limit: 100 } })).data,
  });
}

export function useMarkNoticeRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => (await api.post<{ updated: number }>(`${S}/portals/notifications/${id}/read`, {})).data,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['portal', 'notices'] }),
  });
}

/* ────────────────────────────── Parent ────────────────────────────── */

export interface ParentChildRow {
  student: {
    id: string;
    admissionNo: string;
    partnerId: string;
    currentClass?: { name: string; gradeLevel?: { name: string } | null } | null;
    currentSection?: { name: string } | null;
    partner?: { name: string } | null;
  };
  /** `rate` is null when it depends on a late policy the school has not chosen. */
  attendance: { total: number; present: number; late: number; absent: number; rate: number | null; policyMissing?: boolean };
  fees: { billed: number; collected: number; waived: number; balance: number; invoiceCount: number };
  announcements: Array<{ id: string; title: string; body: string; publishedAt: string | null }>;
}

export function useParentDashboard(studentProfileIds: string[]) {
  const key = studentProfileIds.join(',');
  return useQuery({
    queryKey: ['portal', 'parent', key],
    enabled: key.length > 0,
    queryFn: async () => (await api.get<ParentChildRow[]>(`${S}/portals/parent/${key}`)).data,
  });
}

export interface BalanceExplainer {
  studentProfileId: string;
  studentName: string | null;
  admissionNo: string | null;
  className: string | null;
  /** A sentence the bursar would read aloud at the window. Rendered verbatim. */
  headline: string;
  summary: {
    billed: number;
    paid: number;
    waived: number;
    credited: number;
    adjusted: number;
    outstanding: number;
  };
  lines: Array<{
    date: string;
    label: string;
    /** Signed as a family reads it: a charge adds, everything else subtracts. */
    amount: number;
    kind: string;
    reference: string;
    runningBalance: number;
  }>;
  clearance: { status: 'cleared' | 'partial' | 'blocked'; settledPercent: number; shortfall: number } | null;
  generatedAt: string;
}

/**
 * Outstanding, split by whether it is actually due.
 *
 * Computed in the finance service, never here — a portal that derives its own
 * figures is how it comes to contradict the bursar's statement.
 */
export interface OutstandingBreakdown {
  studentProfileId: string;
  outstanding: number;
  overdue: number;
  dueLater: number;
  /** Owed but with no invoice due date — a balance carried forward, typically. */
  undated: number;
  nextDueDate: string | null;
  overdueInvoiceCount: number;
}

export function useOutstanding(studentProfileId?: string) {
  return useQuery({
    queryKey: ['portal', 'outstanding', studentProfileId],
    enabled: !!studentProfileId,
    queryFn: async () =>
      (await api.get<OutstandingBreakdown>(`${S}/portals/parent/${studentProfileId}/outstanding`)).data,
  });
}

export interface FeeStatement {
  school: { name?: string | null } | null;
  student: { admissionNo: string; partner?: { name: string } | null } | null;
  term: { id: string; name: string } | null;
  ledger: {
    rows: Array<{
      date: string;
      ledgerType: string;
      reference: string;
      description: string;
      debit: number;
      credit: number;
      balance: number;
    }>;
  };
  balance: { billed: number; collected: number; waived: number; balance: number };
  generatedAt: string;
}

export function useStatement(studentProfileId?: string) {
  return useQuery({
    queryKey: ['portal', 'statement', studentProfileId],
    enabled: !!studentProfileId,
    queryFn: async () =>
      (await api.get<FeeStatement>(`${S}/portals/parent/${studentProfileId}/statement`)).data,
  });
}

export interface PortalReportCard {
  id: string;
  termId: string;
  termName: string | null;
  generatedAt: string;
  publishedAt: string | null;
  classTeacherComment: string | null;
  principalComment: string | null;
}

/** Released report cards. The server never returns an unpublished one. */
export function useReportCards(studentProfileId?: string) {
  return useQuery({
    queryKey: ['portal', 'report-cards', studentProfileId],
    enabled: !!studentProfileId,
    queryFn: async () =>
      (await api.get<PortalReportCard[]>(`${S}/portals/student/${studentProfileId}/report-cards`)).data,
  });
}

/**
 * Download a report card.
 *
 * Fetched as a blob rather than linked directly: the PDF route needs the bearer
 * token, and an `<a href>` carries no Authorization header. Putting the token in
 * the query string instead would write it into every access log between here and
 * the server.
 */
export async function downloadReportCard(reportCardId: string, filename: string): Promise<void> {
  const res = await api.get(`${S}/portals/report-cards/${reportCardId}/pdf`, { responseType: 'blob' });
  const url = URL.createObjectURL(res.data as Blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Wave 16: posted fee receipts for the pupil, newest first. */
export interface PortalReceipt {
  id: string;
  paymentNumber: string;
  paymentDate: string;
  amount: string;
  paymentMethod: string;
}
export function useFeeReceipts(studentProfileId?: string) {
  return useQuery({
    queryKey: ['portal', 'receipts', studentProfileId],
    enabled: !!studentProfileId,
    queryFn: async () => (await api.get<PortalReceipt[]>(`${S}/portals/parent/${studentProfileId}/receipts`)).data,
  });
}

/** Download a receipt (family copy). Blob, for the same reason as report cards. */
export async function downloadFeeReceipt(paymentId: string, filename: string): Promise<void> {
  const res = await api.get(`${S}/portals/receipts/${paymentId}/pdf`, { responseType: 'blob' });
  const url = URL.createObjectURL(res.data as Blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function useBalanceExplainer(studentProfileId?: string) {
  return useQuery({
    queryKey: ['portal', 'explain', studentProfileId],
    enabled: !!studentProfileId,
    queryFn: async () =>
      (await api.get<BalanceExplainer>(`${S}/portals/parent/${studentProfileId}/explain`)).data,
  });
}

export interface PayQuote {
  studentProfileId: string;
  outstanding: number;
  billed: number;
  collected: number;
  providers: { mtn: boolean; airtel: boolean };
}

export function usePayQuote(studentProfileId?: string) {
  return useQuery({
    queryKey: ['portal', 'pay-quote', studentProfileId],
    enabled: !!studentProfileId,
    queryFn: async () => (await api.get<PayQuote>(`${S}/portals/parent/${studentProfileId}/pay-quote`)).data,
  });
}

export interface MomoRequest {
  id: string;
  provider: string;
  amount: number | string;
  phone: string;
  status: string;
  reference: string | null;
  createdAt: string;
  failureReason?: string | null;
}

export function usePayments(studentProfileId?: string) {
  return useQuery({
    queryKey: ['portal', 'payments', studentProfileId],
    enabled: !!studentProfileId,
    // A phone prompt resolves in seconds and the parent is watching this list
    // while it does. Polling is what makes "did it go through?" answerable.
    refetchInterval: 8_000,
    queryFn: async () => (await api.get<MomoRequest[]>(`${S}/portals/parent/${studentProfileId}/payments`)).data,
  });
}

export function usePay() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: {
      studentProfileId: string;
      provider: 'mtn' | 'airtel';
      amount: number;
      phone: string;
    }) => {
      const { studentProfileId, ...body } = dto;
      return (
        await api.post<{ status: string; reference: string; message?: string }>(
          `${S}/portals/parent/${studentProfileId}/pay`,
          body,
        )
      ).data;
    },
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ['portal', 'payments', v.studentProfileId] });
      qc.invalidateQueries({ queryKey: ['portal', 'pay-quote', v.studentProfileId] });
    },
  });
}

/* ────────────────────────────── Student ────────────────────────────── */

export interface StudentDashboard {
  profile: {
    id: string;
    admissionNo: string;
    currentClass?: { name: string; gradeLevel?: { name: string } | null } | null;
    partner?: { name: string } | null;
  } | null;
  timetable: Array<{
    id: string;
    dayOfWeek: number;
    subject?: { name: string } | null;
    period?: { name: string; startTime: string; endTime: string } | null;
    room?: string | null;
  }>;
  /** `rate` is null when it depends on a late policy the school has not chosen. */
  attendance: { total: number; present: number; late: number; absent: number; rate: number | null; policyMissing?: boolean };
  /**
   * Recent marks, off the assessment spine and approved only. The dashboard used
   * to read the legacy GradeEntry table with no approval filter, which put
   * unapproved marks in front of families.
   */
  grades: Array<{
    id: string;
    score: string | null;
    maxScore: string;
    percentage: string | null;
    recordedAt: string;
    subject: { name: string } | null;
    assessment: { id: string; title: string } | null;
  }>;
  assignments: Array<{ id: string; title: string; status: string; dueDate?: string | null }>;
  announcements: Array<{ id: string; title: string; body: string; publishedAt: string | null }>;
  /** Published term results, newest first. An ARRAY — one row per term. */
  publishedResults: Array<{
    termId: string;
    resultSetRevision: number;
    gpa: string | null;
    aggregate: number | null;
    division: string | null;
    meanPercent: string | null;
    classRank: number | null;
    promotionRecommendation: string | null;
  }>;
  certificates: Array<{ id: string; title: string; status: string; code: string | null }>;
}

export function useStudentDashboard(studentProfileId?: string) {
  return useQuery({
    queryKey: ['portal', 'student', studentProfileId],
    enabled: !!studentProfileId,
    queryFn: async () =>
      (await api.get<StudentDashboard>(`${S}/portals/student/${studentProfileId}`)).data,
  });
}

/* ── LMS ("my learning") — already self-scoped, `asStudent` is re-checked ── */

export interface MyCourse {
  courseOfferingId: string;
  name: string;
  progressPercent: number;
  shortName?: string | null;
}

export function useMyCourses(asStudent?: string) {
  return useQuery({
    queryKey: ['portal', 'lms', 'courses', asStudent],
    queryFn: async () =>
      (
        await api.get<{ studentProfileId: string; courses: MyCourse[] }>(`${S}/lms/my/courses`, {
          params: asStudent ? { asStudent } : undefined,
        })
      ).data,
  });
}

export interface DueItem {
  id: string;
  name: string;
  dueAt: string | null;
  courseName?: string | null;
  submitted?: boolean;
}

export function useDueSoon(asStudent?: string, days = 14) {
  return useQuery({
    queryKey: ['portal', 'lms', 'due', asStudent, days],
    queryFn: async () =>
      (
        await api.get<DueItem[] | { items: DueItem[] }>(`${S}/lms/my/due`, {
          params: { ...(asStudent ? { asStudent } : {}), days },
        })
      ).data,
  });
}

/* ────────────────────────────── Teacher ────────────────────────────── */

export interface TeacherDashboard {
  classes: Array<{ id?: string; name?: string; classId?: string }>;
  todaySchedule: Array<{
    id: string;
    subject?: { name: string } | null;
    schoolClass?: { name: string } | null;
    period?: { name: string; startTime: string; endTime: string } | null;
    room?: string | null;
  }>;
  pendingGrades: number | Array<unknown>;
  marking: { pendingApprovals: number; draftMarks: number };
}

export function useTeacherDashboard(staffProfileId?: string) {
  return useQuery({
    queryKey: ['portal', 'teacher', staffProfileId],
    enabled: !!staffProfileId,
    queryFn: async () => (await api.get<TeacherDashboard>(`${S}/portals/teacher/${staffProfileId}`)).data,
  });
}

export interface TeacherOverview {
  lessonPlans: { draft: number; submitted: number; approved: number };
  examPapers: Array<{
    examScheduleId: string;
    examName: string;
    subject: string;
    classId: string;
    entered: number;
    total: number;
  }>;
  [k: string]: unknown;
}

export function useTeacherOverview(staffProfileId?: string) {
  return useQuery({
    queryKey: ['portal', 'teaching', staffProfileId],
    enabled: !!staffProfileId,
    queryFn: async () => (await api.get<TeacherOverview>(`${S}/portals/teaching/${staffProfileId}`)).data,
  });
}

/* ────────────────────────── Employee self-service ────────────────────────── */

export interface Payslip {
  id: string;
  periodLabel?: string | null;
  grossPay: number | string;
  netPay: number | string;
  status: string;
  payDate?: string | null;
}

export function useMyPayslips(enabled: boolean) {
  return useQuery({
    queryKey: ['portal', 'hr', 'payslips'],
    enabled,
    queryFn: async () => (await api.get<Payslip[]>('/hr/self/payslips')).data,
  });
}

/* ──────────────────── Teacher writes (owner-scoped) ────────────────────
 *
 * Every route below is gated on a `:own` grant and re-checked server-side
 * against the caller's StaffProfile. The class or assessment id the UI sends is
 * a request, never a permission — a teacher who edits one gets a 403, not
 * somebody else's register.
 */

export interface AttendanceStatusOption {
  id: string;
  code: string;
  label: string;
  /** present | absent | late | excused — how the code rolls up in reports. */
  category?: string | null;
  sortOrder?: number | null;
  active?: boolean;
}

export function useAttendanceStatuses(enabled: boolean) {
  return useQuery({
    queryKey: ['portal', 'attendance', 'statuses'],
    enabled,
    staleTime: 10 * 60_000,
    queryFn: async () => (await api.get<AttendanceStatusOption[]>(`${S}/attendance/statuses`)).data,
  });
}

export interface ClassRosterPupil {
  id: string;
  admissionNo: string;
  partner?: { name: string } | null;
}

export function useClassRoster(classId?: string) {
  return useQuery({
    queryKey: ['portal', 'roster', classId],
    enabled: !!classId,
    queryFn: async () => (await api.get<ClassRosterPupil[]>(`${S}/students/by-class/${classId}`)).data,
  });
}

export interface RegisterRow {
  id: string;
  studentProfileId: string;
  status: string;
  minutesLate: number;
}

/** What has already been marked for this class on this date. */
export function useRegister(classId?: string, date?: string) {
  return useQuery({
    queryKey: ['portal', 'register', classId, date],
    enabled: !!classId && !!date,
    queryFn: async () =>
      (await api.get<RegisterRow[]>(`${S}/attendance/register`, { params: { classId, date } })).data,
  });
}

export function useMarkRegister() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: {
      classId: string;
      date: string;
      entries: Array<{ studentProfileId: string; status: string; minutesLate?: number }>;
    }) => (await api.post(`${S}/attendance/mark`, dto)).data,
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ['portal', 'register', v.classId, v.date] });
      qc.invalidateQueries({ queryKey: ['portal', 'teacher'] });
    },
  });
}

export interface TeacherAssessment {
  id: string;
  title: string;
  maxScore: number | string;
  classId: string;
  subjectId: string;
  kind: string;
}

export function useClassAssessments(classId?: string, termId?: string) {
  return useQuery({
    queryKey: ['portal', 'assessments', classId, termId],
    enabled: !!classId && !!termId,
    queryFn: async () =>
      (await api.get<TeacherAssessment[]>(`${S}/assessments/by-class/${classId}/term/${termId}`)).data,
  });
}

export interface MarkSheetRow {
  id: string;
  studentProfileId: string;
  studentName: string | null;
  admissionNo: string | null;
  maxScore: number | string;
  effectiveScore: number | string | null;
  approvalStatus: string;
  participation: string;
  /** Optimistic-concurrency token for rubric grading. */
  version?: number;
}

/** An assessment the signed-in teacher may mark (audit 2026-09-29 A07). */
export interface MyAssessment {
  id: string;
  title: string;
  kind: string;
  status: string;
  maxScore: number;
  dueAt: string | null;
  termId: string;
  termName: string | null;
  classId: string | null;
  className: string | null;
  sectionName: string | null;
  subjectName: string | null;
  total: number;
  entered: number;
  draft: number;
  submitted: number;
  approved: number;
}

export function useMyAssessments() {
  return useQuery({
    queryKey: ['portal', 'my-assessments'],
    queryFn: async () => (await api.get<MyAssessment[]>(`${S}/marking/mine`)).data,
  });
}

/** Hand a finished mark sheet to the approver. Whoever enters does not approve. */
export function useSubmitMarks() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (assessmentId: string) => (await api.post(`${S}/marking/submit`, { assessmentId })).data,
    onSuccess: (_d, assessmentId) => {
      qc.invalidateQueries({ queryKey: ['portal', 'marksheet', assessmentId] });
      qc.invalidateQueries({ queryKey: ['portal', 'my-assessments'] });
    },
  });
}

export function useMarkSheet(assessmentId?: string) {
  return useQuery({
    queryKey: ['portal', 'marksheet', assessmentId],
    enabled: !!assessmentId,
    queryFn: async () =>
      (await api.get<MarkSheetRow[]>(`${S}/marking/by-assessment/${assessmentId}`)).data,
  });
}

export function useRecordMark() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: { assessmentId: string; studentAssessmentId: string; score: number }) => {
      const { assessmentId: _a, ...body } = dto;
      return (await api.post(`${S}/marking/mark`, body)).data;
    },
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ['portal', 'marksheet', v.assessmentId] });
      qc.invalidateQueries({ queryKey: ['portal', 'my-assessments'] });
    },
  });
}

/* ── Wave 16: going home — pick-up authorizations and transport ─────────── */

export interface FamilyPickup {
  guardians: Array<{ name: string; relationship: string }>;
  authorizations: Array<{
    id: string; name: string; phone: string | null; relationship: string | null;
    kind: 'STANDING' | 'ONE_OFF'; validFrom: string; validTo: string | null; status: 'pending' | 'approved';
  }>;
}
export function usePickup(studentProfileId?: string) {
  return useQuery({
    queryKey: ['portal', 'pickup', studentProfileId],
    enabled: !!studentProfileId,
    queryFn: async () => (await api.get<FamilyPickup>(`${S}/portals/parent/${studentProfileId}/pickup`)).data,
  });
}
export function useRequestPickup(studentProfileId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: { personName: string; personPhone: string; relationship: string; idType?: string; idNumber?: string; kind?: 'STANDING' | 'ONE_OFF'; validTo?: string }) =>
      (await api.post(`${S}/portals/parent/${studentProfileId}/pickup`, dto)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['portal', 'pickup', studentProfileId] }),
  });
}
export function useWithdrawPickup(studentProfileId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => (await api.patch(`${S}/portals/parent/${studentProfileId}/pickup/${id}/withdraw`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['portal', 'pickup', studentProfileId] }),
  });
}

export interface FamilyTransport {
  date: string;
  assignments: Array<{
    id: string; route: string | null; routeCode: string | null; serviceMode: string; daysOfWeek: number[];
    pickupStop: { name: string; landmark: string | null } | null;
    dropoffStop: { name: string; landmark: string | null } | null;
    status: string;
  }>;
  today: Array<{
    direction: string; tripStatus: string; plannedDeparture: string | null; actualDeparture: string | null;
    actualArrival: string | null; delayMinutes: number; passengerStatus: string;
    lastEvent: { eventType: string; occurredAt: string } | null;
  }>;
}
export function useTransport(studentProfileId?: string) {
  return useQuery({
    queryKey: ['portal', 'transport', studentProfileId],
    enabled: !!studentProfileId,
    refetchInterval: 60_000,
    queryFn: async () => (await api.get<FamilyTransport>(`${S}/portals/parent/${studentProfileId}/transport`)).data,
  });
}

/* ── Wave 16: rubric grading from the teacher portal ─────────────────────── */

export interface RubricCriterion {
  id: string;
  name: string;
  description: string | null;
  maxScore: number;
  weight: number;
  levels: Array<{ id: string; label: string; score: number }>;
}
export interface AssignmentInbox {
  assignment: { id: string; gradingMode: 'points' | 'rubric' | 'complete_incomplete' | string } | null;
  rubric: { id: string; name: string; criteria: RubricCriterion[] } | null;
}
/** The assignment behind an assessment, and its rubric when it is marked by one. */
export function useAssignmentInbox(assessmentId?: string) {
  return useQuery({
    queryKey: ['portal', 'assignment-inbox', assessmentId],
    enabled: !!assessmentId,
    queryFn: async () => (await api.get<AssignmentInbox>(`${S}/assessment-board/${assessmentId}/inbox`)).data,
  });
}
export function useEvidence(assessmentId: string, studentProfileId?: string) {
  return useQuery({
    queryKey: ['portal', 'evidence', assessmentId, studentProfileId],
    enabled: !!studentProfileId,
    queryFn: async () =>
      (await api.get<{ rubricScores?: Array<{ criterionId: string; score: number }> }>(`${S}/assessment-board/${assessmentId}/evidence/${studentProfileId}`)).data,
  });
}
/** Save a rubric grade as a draft; the server checks the teacher owns the paper. */
export function useGradeRubric(assessmentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: { assignmentId: string; studentProfileId: string; expectedVersion?: number; rubricScores: Array<{ criterionId: string; score: number }>; feedback?: string }) =>
      (await api.post(`${S}/assignments/grade`, dto)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['portal', 'marksheet', assessmentId] });
      qc.invalidateQueries({ queryKey: ['portal', 'my-assessments'] });
      qc.invalidateQueries({ queryKey: ['portal', 'evidence', assessmentId] });
    },
  });
}
