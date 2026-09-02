import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

/**
 * Phase 5 — the exam office's console.
 *
 * Backend controller: `/school/exam-operations`. Every gate decision, every
 * anonymity rule and every authorization check lives server-side; these hooks
 * render what the server decided and never re-decide it here.
 */
const ROOT = '/school/exam-operations';

export type ExamLifecycleState =
  | 'draft' | 'setup' | 'scheduled' | 'candidates_locked' | 'in_progress'
  | 'marking' | 'moderation' | 'results_ready' | 'closed' | 'archived';

export type ExamAttendanceStatus = 'present' | 'absent' | 'late' | 'excused' | 'malpractice' | 'withdrawn';
export type MarkingMode = 'single' | 'double' | 'blind_double';
export type CustodyAction =
  | 'authored' | 'moderated' | 'approved' | 'printed' | 'sealed' | 'stored' | 'dispatched'
  | 'received' | 'opened' | 'distributed' | 'collected' | 'returned' | 'archived' | 'destroyed' | 'incident';

export interface ExamGateConflict {
  code: string;
  detail: string;
  examScheduleId?: string;
  studentProfileId?: string;
}

export interface ExamStep {
  key: string;
  label: string;
  done: boolean;
  detail: string;
}

export interface ExamOpsPaper {
  id: string;
  subjectId: string; subjectName: string | null;
  classId: string; className: string | null;
  date: string; startTime: string; durationMinutes: number;
  paperNumber: number | null; sitting: string | null; isResit: boolean;
  maxMarks: string | number;
  venueId: string | null; venueName: string | null; venueCapacity: number | null;
  markingMode: MarkingMode; markToleranceMarks: string | number; moderationRequired: boolean;
  marksLockedAt: string | null;
  invigilators: Array<{ id: string; name: string | null }>;
  questionPapers: Array<{ id: string; title: string; paperKind: string; totalMarks: string | number }>;
  attendanceRecorded: number; scriptsAllocated: number; moderationSamples: number;
}

export interface ExamOpsOverview {
  exam: {
    id: string; name: string; termId: string; termName: string | null;
    examTypeId: string; examTypeName: string | null;
    startDate: string; endDate: string; status: string;
    lifecycleState: ExamLifecycleState; markingMode: MarkingMode;
    activeSnapshotId: string | null;
    candidatesLockedAt: string | null; resultsReadyAt: string | null; closedAt: string | null;
    version: number; allowedTransitions: ExamLifecycleState[];
  };
  steps: ExamStep[];
  papers: ExamOpsPaper[];
  candidates: Array<{
    id: string; studentProfileId: string; studentName: string | null; admissionNo: string | null;
    classId: string | null; venueId: string | null; seatNumber: string | null; status: string;
  }>;
  snapshots: Array<{ id: string; revision: number; checksum: string; candidateCount: number; frozenAt: string; reason: string | null; isActive: boolean }>;
  incidents: ExamIncident[];
  considerations: SpecialConsideration[];
}

export interface ExamIncident {
  id: string; examId: string; examScheduleId: string | null; studentProfileId: string | null;
  studentName?: string | null; type: string; status: string; severity: string;
  description: string; occurredAt: string; resolution: string | null; reviewedAt: string | null;
}

export interface SpecialConsideration {
  id: string; examId: string; examScheduleId: string | null; studentProfileId: string;
  studentName?: string | null; type: string; status: string; extraTimeMinutes: number | null;
  reason: string; exemptsFromResult: boolean; decisionNote: string | null; decidedAt: string | null;
}

export interface RegisterRow {
  studentProfileId: string; studentName: string | null; admissionNo: string | null;
  candidateNumber: string | null; seatNumber: string | null; venueId: string | null;
  status: ExamAttendanceStatus | null; arrivedAt: string | null; scriptNumber: string | null;
  note: string | null; recorded: boolean;
  considerations: Array<{ id: string; type: string; extraTimeMinutes: number | null; exemptsFromResult: boolean }>;
}

export interface ExamRegister {
  paper: {
    id: string; examId: string; examName: string; lifecycleState: ExamLifecycleState;
    subjectId: string; subjectName: string | null; classId: string; className: string | null;
    date: string; startTime: string; durationMinutes: number; maxMarks: string | number;
    venueId: string | null; venueName: string | null; markingMode: MarkingMode; marksLockedAt: string | null;
  };
  rows: RegisterRow[];
  summary: { expected: number; recorded: number; present: number; absent: number };
}

export interface ScriptRow {
  id: string; anonymousCode: string; role: string; status: string;
  markerId?: string; score: string | number | null; maxScore: string | number;
  comment: string | null; submittedAt: string | null; version: number;
  studentProfileId?: string; studentName?: string | null;
}

export interface ScriptWorklist {
  paper: {
    id: string; examId: string; examName: string; subjectName: string | null; className: string | null;
    maxMarks: string | number; markingMode: MarkingMode; markToleranceMarks: string | number; marksLockedAt: string | null;
  };
  blind: boolean;
  rows: ScriptRow[];
}

export interface ReconciliationRow {
  studentProfileId: string; studentName: string | null; anonymousCode: string | null;
  first: { id: string; score: string | number | null; markerId: string; status: string } | null;
  second: { id: string; score: string | number | null; markerId: string; status: string } | null;
  reconciliation: { id: string; score: string | number | null; markerId: string; status: string } | null;
  difference: string | null; withinTolerance: boolean | null; agreedScore: string | null;
  reconciled: boolean; needsThirdRead: boolean;
}

export interface ReconciliationBoard {
  paper: ScriptWorklist['paper'] & { lifecycleState: ExamLifecycleState };
  summary: { scripts: number; reconciled: number; needsThirdRead: number; awaitingMarks: number };
  rows: ReconciliationRow[];
}

export interface ModerationSample {
  id: string; examScheduleId: string; method: string; seed: string | null; sampleSize: number;
  toleranceMarks: string | number; status: string; drawnAt: string; reviewedAt: string | null;
  note: string | null; outcome: Record<string, unknown>;
  subjectName?: string | null; className?: string | null;
  items: Array<{
    id: string; studentProfileId: string; studentName?: string | null; anonymousCode: string | null;
    originalScore: string | number | null; moderatedScore: string | number | null;
    delta: string | number | null; withinTolerance: boolean | null; comment: string | null;
  }>;
}

export interface CustodyEvent {
  id: string; action: CustodyAction; occurredAt: string; actorName: string | null;
  custodianId: string | null; custodianName: string | null; sealNumber: string | null;
  copies: number | null; location: string | null; note: string | null; chainHash: string;
  chainVerified: boolean;
}

export interface CustodyChain {
  questionPaper: {
    id: string; title: string; paperKind: string; paperNumber: number | null;
    totalMarks: string | number; examScheduleId: string; examId: string | null;
    examName: string | null; subjectName: string | null;
  };
  chainIntact: boolean;
  brokenAt: string | null;
  currentCustodian: { id: string | null; name: string | null } | null;
  lastAction: CustodyAction | null;
  events: CustodyEvent[];
}

export interface CustodyBoardRow {
  questionPaperId: string; title: string; paperKind: string; paperNumber: number | null;
  examScheduleId: string; subjectName: string | null; className: string | null;
  date: string; startTime: string; events: number;
  lastAction: CustodyAction | null; lastAt: string | null;
  currentCustodian: string | null; sealed: boolean; returned: boolean;
}

const key = (...parts: unknown[]) => ['school', 'exam-operations', ...parts];

// ── console ──────────────────────────────────────────────────────────────────

export function useExamOpsOverview(examId?: string) {
  return useQuery({
    queryKey: key('overview', examId),
    enabled: !!examId,
    queryFn: async () => (await api.get<ExamOpsOverview>(`${ROOT}/${examId}/overview`)).data,
  });
}

export function useExamGate(examId?: string, target?: ExamLifecycleState) {
  return useQuery({
    queryKey: key('gate', examId, target),
    enabled: !!(examId && target),
    queryFn: async () => (await api.get<{ ready: boolean; conflicts: ExamGateConflict[] }>(`${ROOT}/${examId}/gate`, { params: { target } })).data,
    staleTime: 0,
  });
}

export function useMarkerDirectory() {
  return useQuery({
    queryKey: key('markers'),
    queryFn: async () => (await api.get<Array<{ userId: string; name: string; employeeNo: string | null; staffCategory: string | null; departmentName: string | null }>>(`${ROOT}/markers`)).data,
    staleTime: 5 * 60 * 1000,
  });
}

function useExamInvalidate() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ['school', 'exam-operations'] });
    qc.invalidateQueries({ queryKey: ['school', 'exams'] });
  };
}

export function useExamTransition() {
  const invalidate = useExamInvalidate();
  return useMutation({
    mutationFn: async (dto: { examId: string; target: ExamLifecycleState; reason?: string; expectedVersion?: number }) =>
      (await api.post(`${ROOT}/${dto.examId}/lifecycle`, { target: dto.target, reason: dto.reason, expectedVersion: dto.expectedVersion })).data,
    onSuccess: invalidate,
  });
}

export function useFreezeCandidates() {
  const invalidate = useExamInvalidate();
  return useMutation({
    mutationFn: async (dto: { examId: string; reason?: string }) =>
      (await api.post<{ id: string; revision: number; candidateCount: number; checksum: string }>(`${ROOT}/${dto.examId}/candidates/freeze`, { reason: dto.reason })).data,
    onSuccess: invalidate,
  });
}

export function useCandidateSnapshot(snapshotId?: string) {
  return useQuery({
    queryKey: key('snapshot', snapshotId),
    enabled: !!snapshotId,
    queryFn: async () => (await api.get<any>(`${ROOT}/snapshots/${snapshotId}`)).data,
  });
}

export function useConfigurePaper() {
  const invalidate = useExamInvalidate();
  return useMutation({
    mutationFn: async (dto: { examScheduleId: string; markingMode?: MarkingMode; markToleranceMarks?: number; moderationRequired?: boolean }) => {
      const { examScheduleId, ...body } = dto;
      return (await api.post(`${ROOT}/papers/${examScheduleId}/configure`, body)).data;
    },
    onSuccess: invalidate,
  });
}

// ── attendance ───────────────────────────────────────────────────────────────

export function useExamRegister(examScheduleId?: string) {
  return useQuery({
    queryKey: key('register', examScheduleId),
    enabled: !!examScheduleId,
    queryFn: async () => (await api.get<ExamRegister>(`${ROOT}/papers/${examScheduleId}/register`)).data,
  });
}

export function useRecordAttendance() {
  const invalidate = useExamInvalidate();
  return useMutation({
    mutationFn: async (dto: {
      examScheduleId: string;
      rows: Array<{ studentProfileId: string; status: ExamAttendanceStatus; seatNumber?: string; scriptNumber?: string; note?: string }>;
    }) => (await api.post(`${ROOT}/papers/${dto.examScheduleId}/register`, { rows: dto.rows })).data,
    onSuccess: invalidate,
  });
}

// ── incidents ────────────────────────────────────────────────────────────────

export function useExamIncidents(examId?: string) {
  return useQuery({
    queryKey: key('incidents', examId),
    enabled: !!examId,
    queryFn: async () => (await api.get<ExamIncident[]>(`${ROOT}/${examId}/incidents`)).data,
  });
}

export function useRaiseIncident() {
  const invalidate = useExamInvalidate();
  return useMutation({
    mutationFn: async (dto: {
      examId: string; examScheduleId?: string; studentProfileId?: string;
      type: string; severity?: 'low' | 'medium' | 'high'; description: string;
    }) => (await api.post(`${ROOT}/incidents`, dto)).data,
    onSuccess: invalidate,
  });
}

export function useResolveIncident() {
  const invalidate = useExamInvalidate();
  return useMutation({
    mutationFn: async (dto: { id: string; status: 'resolved' | 'dismissed'; resolution: string; upholdMalpractice?: boolean }) => {
      const { id, ...body } = dto;
      return (await api.post(`${ROOT}/incidents/${id}/resolve`, body)).data;
    },
    onSuccess: invalidate,
  });
}

// ── special consideration ────────────────────────────────────────────────────

export function useConsiderations(examId?: string) {
  return useQuery({
    queryKey: key('considerations', examId),
    enabled: !!examId,
    queryFn: async () => (await api.get<SpecialConsideration[]>(`${ROOT}/${examId}/considerations`)).data,
  });
}

export function useRequestConsideration() {
  const invalidate = useExamInvalidate();
  return useMutation({
    mutationFn: async (dto: {
      examId: string; studentProfileId: string; examScheduleId?: string;
      type: string; extraTimeMinutes?: number; reason: string; exemptsFromResult?: boolean;
    }) => (await api.post(`${ROOT}/considerations`, dto)).data,
    onSuccess: invalidate,
  });
}

export function useDecideConsideration() {
  const invalidate = useExamInvalidate();
  return useMutation({
    mutationFn: async (dto: { id: string; status: 'approved' | 'rejected'; decisionNote?: string }) => {
      const { id, ...body } = dto;
      return (await api.post(`${ROOT}/considerations/${id}/decision`, body)).data;
    },
    onSuccess: invalidate,
  });
}

// ── custody ──────────────────────────────────────────────────────────────────

export function useCustodyBoard(examId?: string) {
  return useQuery({
    queryKey: key('custody', examId),
    enabled: !!examId,
    queryFn: async () => (await api.get<CustodyBoardRow[]>(`${ROOT}/${examId}/custody`)).data,
  });
}

export function useCustodyChain(questionPaperId?: string) {
  return useQuery({
    queryKey: key('custody-chain', questionPaperId),
    enabled: !!questionPaperId,
    queryFn: async () => (await api.get<CustodyChain>(`${ROOT}/question-papers/${questionPaperId}/custody`)).data,
  });
}

export function useRecordCustody() {
  const invalidate = useExamInvalidate();
  return useMutation({
    mutationFn: async (dto: {
      questionPaperId: string; action: CustodyAction; custodianName?: string;
      sealNumber?: string; copies?: number; location?: string; note?: string;
    }) => {
      const { questionPaperId, ...body } = dto;
      return (await api.post(`${ROOT}/question-papers/${questionPaperId}/custody`, body)).data;
    },
    onSuccess: invalidate,
  });
}

// ── script marking ───────────────────────────────────────────────────────────

export function useScriptWorklist(examScheduleId?: string, markerId?: string) {
  return useQuery({
    queryKey: key('scripts', examScheduleId, markerId ?? 'me'),
    enabled: !!examScheduleId,
    queryFn: async () => (await api.get<ScriptWorklist>(`${ROOT}/papers/${examScheduleId}/scripts`, { params: markerId ? { markerId } : undefined })).data,
  });
}

export function useAllocateScripts() {
  const invalidate = useExamInvalidate();
  return useMutation({
    mutationFn: async (dto: { examScheduleId: string; markerIds: string[] }) =>
      (await api.post<{ created: number; skipped: number; scripts: number; markingMode: MarkingMode }>(`${ROOT}/papers/${dto.examScheduleId}/scripts/allocate`, { markerIds: dto.markerIds })).data,
    onSuccess: invalidate,
  });
}

export function useVoidAllocations() {
  const invalidate = useExamInvalidate();
  return useMutation({
    mutationFn: async (dto: { examScheduleId: string; reason: string }) =>
      (await api.post(`${ROOT}/papers/${dto.examScheduleId}/scripts/void`, { reason: dto.reason })).data,
    onSuccess: invalidate,
  });
}

export function useSubmitScriptMark() {
  const invalidate = useExamInvalidate();
  return useMutation({
    mutationFn: async (dto: { allocationId: string; score: number | null; comment?: string; expectedVersion?: number }) => {
      const { allocationId, ...body } = dto;
      return (await api.post<ScriptRow>(`${ROOT}/scripts/${allocationId}/mark`, body)).data;
    },
    onSuccess: invalidate,
  });
}

export function useReconciliationBoard(examScheduleId?: string) {
  return useQuery({
    queryKey: key('reconciliation', examScheduleId),
    enabled: !!examScheduleId,
    queryFn: async () => (await api.get<ReconciliationBoard>(`${ROOT}/papers/${examScheduleId}/reconciliation`)).data,
  });
}

export function useReconcileScripts() {
  const invalidate = useExamInvalidate();
  return useMutation({
    mutationFn: async (dto: { examScheduleId: string; studentProfileIds?: string[]; note?: string }) => {
      const { examScheduleId, ...body } = dto;
      return (await api.post<{
        agreed: number;
        posted: Array<{ studentProfileId: string; agreedScore: string }>;
        blocked: Array<{ studentProfileId: string; code: string; detail: string }>;
      }>(`${ROOT}/papers/${examScheduleId}/reconciliation`, body)).data;
    },
    onSuccess: invalidate,
  });
}

// ── moderation ───────────────────────────────────────────────────────────────

export function useModerationSamples(examScheduleId?: string) {
  return useQuery({
    queryKey: key('moderation', examScheduleId),
    enabled: !!examScheduleId,
    queryFn: async () => (await api.get<ModerationSample[]>(`${ROOT}/papers/${examScheduleId}/moderation`)).data,
  });
}

export function useModerationSample(sampleId?: string) {
  return useQuery({
    queryKey: key('moderation-sample', sampleId),
    enabled: !!sampleId,
    queryFn: async () => (await api.get<ModerationSample>(`${ROOT}/moderation/${sampleId}`)).data,
  });
}

export function useDrawModerationSample() {
  const invalidate = useExamInvalidate();
  return useMutation({
    mutationFn: async (dto: {
      examScheduleId: string; method?: 'random' | 'stratified' | 'boundary' | 'manual';
      sampleSize?: number; seed?: string; toleranceMarks?: number;
    }) => {
      const { examScheduleId, ...body } = dto;
      return (await api.post<ModerationSample>(`${ROOT}/papers/${examScheduleId}/moderation`, body)).data;
    },
    onSuccess: invalidate,
  });
}

export function useRecordModeration() {
  const invalidate = useExamInvalidate();
  return useMutation({
    mutationFn: async (dto: {
      sampleId: string;
      items: Array<{ studentProfileId: string; moderatedScore: number; comment?: string }>;
      note?: string; applyAdjustments?: boolean;
    }) => {
      const { sampleId, ...body } = dto;
      return (await api.post<ModerationSample & { adjusted: number }>(`${ROOT}/moderation/${sampleId}/record`, body)).data;
    },
    onSuccess: invalidate,
  });
}
