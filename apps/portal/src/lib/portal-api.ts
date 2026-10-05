import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { PortalContext } from '@/stores/auth.store';
import type { CourseHeader, CourseModuleView, CoursePageView, ModuleViewEnvelope } from '@/lib/lms-types';

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

/**
 * One enrolled course.
 *
 * The server returns the course header spread with its progress
 * (`learner.service.ts#myCourses`), so `id` is the course offering's id and the
 * figure to show is `progress.percent`. An earlier shape here claimed
 * `courseOfferingId` and `progressPercent`, neither of which the API sends —
 * which is why the course list rendered "undefined%".
 */
export interface MyCourse extends CourseHeader {
  progress: { completed: number; tracked: number; percent: number };
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

/**
 * A piece of work that is actually actionable.
 *
 * The server already drops anything hidden, unavailable, handed in or marked,
 * so there is no `submitted` flag to read — if it is in this list, it is still
 * to do. It is a module view spread with its course, so it carries completion,
 * availability and grade too.
 */
export interface DueItem extends CourseModuleView {
  courseId: string | null;
  courseName: string | null;
  overdue: boolean;
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

/**
 * Marks that have actually been released.
 *
 * The server returns only APPROVED marks whose assessment is past its release
 * date (`learner.service.ts#recentGrades`), so nothing on this list is
 * provisional. `score` can still be null for a mark approved without a figure.
 */
export interface ReleasedGrade {
  assessmentId: string;
  title: string;
  score: number | null;
  maxScore: number;
  percentage: number | null;
  at: string;
}

export function useRecentGrades(asStudent?: string) {
  return useQuery({
    queryKey: ['portal', 'lms', 'grades', asStudent],
    // The route takes no limit — the server fixes the window at ten.
    queryFn: async () =>
      (
        await api.get<ReleasedGrade[]>(`${S}/lms/my/grades`, {
          params: asStudent ? { asStudent } : undefined,
        })
      ).data,
  });
}

/* ── Course consumption ──────────────────────────────────────────────────── */

/**
 * The course page, the activity page, and the actions a learner may run.
 *
 * These are the same `school/lms/*` routes the staff app calls — not a second,
 * learner-only API. The server resolves the subject from the token's portal
 * claim and accepts `asStudent` only when a guardian names one of their own
 * children, so what comes back is already scoped; the envelope's `viewingAs`
 * says who the server thinks is looking.
 */
export function useCoursePage(courseId?: string, asStudent?: string) {
  return useQuery({
    queryKey: ['portal', 'lms', 'course', courseId, asStudent],
    enabled: !!courseId,
    queryFn: async () =>
      (
        await api.get<CoursePageView>(`${S}/lms/courses/${courseId}`, {
          params: asStudent ? { asStudent } : undefined,
        })
      ).data,
  });
}

export function useModuleView(moduleId?: string, asStudent?: string) {
  return useQuery({
    queryKey: ['portal', 'lms', 'module', moduleId, asStudent],
    enabled: !!moduleId,
    queryFn: async () =>
      (
        await api.get<ModuleViewEnvelope>(`${S}/lms/modules/${moduleId}/view`, {
          params: asStudent ? { asStudent } : undefined,
        })
      ).data,
  });
}

/**
 * Run a plugin-defined verb on an activity — `submit` for homework, `post` for
 * a forum reply. The action list belongs to the activity's plugin, so this
 * takes the verb as data rather than exposing one hook per verb.
 */
export function useModuleAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      moduleId,
      action,
      body,
      asStudent,
    }: {
      moduleId: string;
      action: string;
      body?: Record<string, unknown>;
      asStudent?: string;
    }) =>
      (
        await api.post(`${S}/lms/modules/${moduleId}/action/${action}`, {
          ...(body ?? {}),
          ...(asStudent ? { asStudent } : {}),
        })
      ).data,
    // Progress, due lists and the course page all move when an activity does.
    onSuccess: () => qc.invalidateQueries({ queryKey: ['portal', 'lms'] }),
  });
}

/** Tick (or untick) a manually-completed activity. */
export function useSetCompletion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      moduleId,
      state,
      asStudent,
    }: {
      moduleId: string;
      state: 'complete' | 'incomplete';
      asStudent?: string;
    }) =>
      (
        await api.post(`${S}/lms/modules/${moduleId}/completion`, {
          state,
          ...(asStudent ? { asStudent } : {}),
        })
      ).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['portal', 'lms'] }),
  });
}

/* ── Files ───────────────────────────────────────────────────────────────── */

export interface LmsFileRef {
  id: string;
  filename: string;
  contentType?: string | null;
  byteSize?: number | null;
}

/**
 * Fetch a short-lived signed URL and hand the browser the download.
 *
 * The file id alone is not authority: the server checks the caller may see this
 * file (a classmate's submission is not course content) before it signs
 * anything, and the URL it returns expires.
 */
export async function downloadLmsFile(fileId: string, filename?: string): Promise<void> {
  const { data } = await api.post<{ url: string; filename: string }>(`${S}/lms/files/${fileId}/url`);
  const a = document.createElement('a');
  a.href = data.url;
  a.download = filename ?? data.filename ?? 'download';
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** Upload one file and return the reference an activity action expects. */
export async function uploadFile(file: File): Promise<LmsFileRef> {
  const form = new FormData();
  form.append('file', file);
  const { data } = await api.post<any>('/files/upload', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return {
    id: data.id,
    filename: data.filename ?? data.originalName ?? file.name,
    contentType: data.contentType ?? file.type,
    byteSize: data.byteSize ?? file.size,
  };
}

export function formatBytes(bytes?: number | null): string {
  if (bytes === null || bytes === undefined) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/* ── Sitting a quiz ──────────────────────────────────────────────────────── */

/**
 * The CBT engine owns attempt lifecycle, response persistence, marking and
 * server-authoritative expiry. The portal navigates, autosaves and submits; it
 * never scores anything and never decides that time is up.
 */
export function useStartAttempt() {
  return useMutation({
    /**
     * `studentProfileId` is required by the DTO even though the server replaces
     * a pupil's with their own and refuses anyone else's — so it is sent from
     * the portal context, not trusted from it.
     */
    mutationFn: async (dto: { paperId: string; studentProfileId: string }) =>
      (await api.post<any>(`${S}/cbt/start`, dto)).data,
  });
}

export function useAttempt(attemptId?: string) {
  return useQuery({
    queryKey: ['portal', 'cbt', 'attempt', attemptId],
    enabled: !!attemptId,
    // The attempt is live state the learner is editing; refetching it under them
    // would overwrite an answer they are part way through typing.
    staleTime: Infinity,
    queryFn: async () => (await api.get<any>(`${S}/cbt/attempts/${attemptId}`)).data,
  });
}

export function useSaveResponse() {
  return useMutation({
    mutationFn: async (dto: {
      attemptId: string;
      questionId: string;
      /** Shape is the marker's contract: {optionId} | {optionIds} | {value} | {text}. */
      response: Record<string, unknown>;
      sequenceNumber: number;
      clientEventId?: string;
    }) => (await api.post<any>(`${S}/cbt/response`, dto)).data,
  });
}

export function useSubmitAttempt() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: { attemptId: string; idempotencyKey?: string }) =>
      (await api.post<any>(`${S}/cbt/submit`, dto)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['portal', 'cbt'] });
      qc.invalidateQueries({ queryKey: ['portal', 'lms'] });
    },
  });
}

/* ────────────────────────────── Teacher ────────────────────────────── */

export interface TeacherDashboard {
  /**
   * Teaching ASSIGNMENTS (one per class × subject), not classes: `id` is the
   * assignment's id. Use `teacherClasses()` to get the classes themselves.
   */
  classes: Array<{
    id?: string;
    name?: string;
    classId?: string;
    sectionId?: string | null;
    schoolClass?: { name: string } | null;
    section?: { name: string } | null;
    subject?: { name: string } | null;
  }>;
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

/**
 * The distinct classes (and streams) a teacher teaches, with the subjects they
 * take there. The dashboard lists assignments, and reading an assignment's `id`
 * as a class id sent the register to an empty roster (Wave 16).
 */
export function teacherClasses(dashboard?: TeacherDashboard): Array<{ id: string; sectionId: string | null; name: string; subjects: string[] }> {
  const byKey = new Map<string, { id: string; sectionId: string | null; name: string; subjects: string[] }>();
  for (const a of dashboard?.classes ?? []) {
    const id = a.classId ?? '';
    if (!id) continue;
    const key = `${id}:${a.sectionId ?? ''}`;
    const name = [a.schoolClass?.name ?? a.name ?? 'Class', a.section?.name].filter(Boolean).join(' ');
    const entry = byKey.get(key) ?? { id, sectionId: a.sectionId ?? null, name, subjects: [] };
    if (a.subject?.name && !entry.subjects.includes(a.subject.name)) entry.subjects.push(a.subject.name);
    byKey.set(key, entry);
  }
  return [...byKey.values()].sort((x, y) => x.name.localeCompare(y.name));
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
  /** The school's own flags — these, not the list order, say what a status means (R10). */
  isDefault?: boolean | null;
  isPresent?: boolean | null;
  isLate?: boolean | null;
  isAbsent?: boolean | null;
  isExcused?: boolean | null;
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
