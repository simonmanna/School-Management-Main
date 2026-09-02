import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

/**
 * Phase 5 — result integrity, report provenance and promotion.
 *
 * Backend: `/school/results`, `/school/report-documents`, `/school/promotion-decisions`.
 * Nothing here decides whether a result may be published or a learner promoted;
 * it renders the server's gate and the server's decision.
 */
const RESULTS = '/school/results';
const DOCUMENTS = '/school/report-documents';
const PROMOTION = '/school/promotion-decisions';

export interface ResultRunSummary {
  id: string; termId: string; rosterId: string | null;
  scopeType: string; scopeId: string | null; scopeName: string | null;
  status: string; revision: number; calculationVersion: string; gradingSystem: string | null;
  studentCount: number; publishedAt: string | null; computedAt: string;
  inputChecksum: string | null; outputChecksum: string | null;
  amendmentCount: number; coveragePct: number | null;
}

export interface ComponentContribution {
  componentId: string; kind: string; weight: string;
  componentPercent: string | null; contribution: string;
}

export interface ResultExplanation {
  resultSet: {
    id: string; revision: number; status: string; termId: string;
    gradingSystem: string | null; roundingMode: string; calculationVersion: string;
    gradingScaleSnapshot: unknown; rankingPolicySnapshot: unknown;
    inputChecksum: string | null; outputChecksum: string | null;
  };
  term: {
    studentProfileId: string; gpa: string | number | null; aggregate: number | null;
    division: string | null; meanPercent: string | number | null; classRank: number | null;
    subjectsCount: number; eligible: boolean; promotionRecommendation: string;
  };
  subjects: Array<{
    subjectId: string; subjectName: string | null; subjectCode: string | null;
    caScore: string | number | null; examScore: string | number | null;
    finalPercent: string | number | null; grade: string | null;
    gradePoint: string | number | null; points: number | null; subjectRank: number | null;
    componentBreakdown: ComponentContribution[];
    evidence: Array<{
      assessmentId: string; title: string; kind: string; componentId: string | null;
      score: string | number | null; maxScore: string | number;
      participation: string; approvalStatus: string; counted: boolean;
    }>;
  }>;
}

export interface AmendmentRow {
  id: string; resultSetId: string; reason: string; status: string;
  detail: Record<string, unknown>; decisionNote: string | null;
  requestedById: string | null; reviewedById: string | null;
  reviewedAt: string | null; newResultSetId: string | null; createdAt: string;
  canApprove?: boolean;
  resultSet?: { id: string; termId: string; revision: number; status: string; scopeId: string | null };
}

export interface ReportDocumentRow {
  id: string; studentProfileId: string; studentName: string | null; admissionNo: string | null;
  termId: string; documentType: string; resultSetId: string | null; resultSetRevision: number | null;
  templateVersionId: string | null; templateKey: string | null; revision: number; status: string;
  payloadChecksum: string; reportCardId: string | null;
  generatedAt: string; publishedAt: string | null;
  supersedesId: string | null; supersededById: string | null; voidReason: string | null;
}

export interface PromotionDecisionRow {
  id: string; studentProfileId: string; studentName: string | null; admissionNo: string | null;
  resultSetId: string; termId: string; recommendation: string; decision: string | null;
  status: string; fromClassId: string | null; fromClassName: string | null;
  toClassId: string | null; toClassName: string | null;
  toSectionId: string | null; toSectionName: string | null; toStreamId: string | null;
  basis: Record<string, unknown>; reason: string | null;
  decidedAt: string | null; appliedAt: string | null; enrollmentPlacementId: string | null;
}

export interface PromotionBoard {
  resultSet: { id: string; termId: string; revision: number; status: string; scopeId: string | null };
  counts: Record<string, number>;
  classes: Array<{ id: string; name: string; gradeLevelId: string | null; order: number | null }>;
  sections: Array<{ id: string; classId: string; name: string }>;
  streams: Array<{ id: string; classId: string; sectionId: string | null; name: string }>;
  rows: PromotionDecisionRow[];
}

// ── result runs ──────────────────────────────────────────────────────────────

export function useResultRuns(termId?: string, scopeId?: string) {
  return useQuery({
    queryKey: ['school', 'result-runs', termId, scopeId],
    enabled: !!termId,
    queryFn: async () => (await api.get<ResultRunSummary[]>(`${RESULTS}/by-term/${termId}`, { params: scopeId ? { scopeId } : undefined })).data,
  });
}

export function useResultExplanation(resultSetId?: string, studentProfileId?: string) {
  return useQuery({
    queryKey: ['school', 'result-explanation', resultSetId, studentProfileId],
    enabled: !!(resultSetId && studentProfileId),
    queryFn: async () => (await api.get<ResultExplanation>(`${RESULTS}/${resultSetId}/explain/${studentProfileId}`)).data,
  });
}

// ── amendments ───────────────────────────────────────────────────────────────

export function useAmendmentQueue(termId?: string) {
  return useQuery({
    queryKey: ['school', 'amendment-queue', termId],
    queryFn: async () => (await api.get<AmendmentRow[]>(`${RESULTS}/amendments/queue`, { params: termId ? { termId } : undefined })).data,
  });
}

export function useRejectAmendment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: { id: string; decisionNote: string }) =>
      (await api.post(`${RESULTS}/amendments/${dto.id}/reject`, { decisionNote: dto.decisionNote })).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['school', 'amendments'] });
      qc.invalidateQueries({ queryKey: ['school', 'amendment-queue'] });
    },
  });
}

// ── report documents ─────────────────────────────────────────────────────────

export function useReportDocuments(params: { termId?: string; resultSetId?: string; studentProfileId?: string; status?: string; documentType?: string }) {
  const enabled = !!(params.termId || params.resultSetId || params.studentProfileId);
  return useQuery({
    queryKey: ['school', 'report-documents', params],
    enabled,
    queryFn: async () => (await api.get<ReportDocumentRow[]>(DOCUMENTS, { params })).data,
  });
}

export function useReportDocument(id?: string) {
  return useQuery({
    queryKey: ['school', 'report-document', id],
    enabled: !!id,
    queryFn: async () => (await api.get<ReportDocumentRow & {
      checksumVerified: boolean;
      payload: Record<string, unknown>;
      resultSet: { id: string; revision: number; status: string; publishedAt: string | null; outputChecksum: string | null } | null;
      supersedes: Array<{ id: string; revision: number; status: string; generatedAt: string; payloadChecksum: string }>;
    }>(`${DOCUMENTS}/${id}`)).data,
  });
}

function useDocumentInvalidate() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ['school', 'report-documents'] });
    qc.invalidateQueries({ queryKey: ['school', 'report-document'] });
    qc.invalidateQueries({ queryKey: ['school', 'report-cards'] });
  };
}

export function useGenerateReportDocuments() {
  const invalidate = useDocumentInvalidate();
  return useMutation({
    mutationFn: async (dto: { resultSetId: string; documentType?: string; studentProfileIds?: string[]; reissue?: boolean; reason?: string }) =>
      (await api.post<{ issued: number; skipped: Array<{ studentProfileId: string; reason: string }>; templateVersionId: string }>(`${DOCUMENTS}/generate`, dto)).data,
    onSuccess: invalidate,
  });
}

export function usePublishReportDocuments() {
  const invalidate = useDocumentInvalidate();
  return useMutation({
    mutationFn: async (dto: { documentIds: string[] }) =>
      (await api.post<{ published: number; publishedAt: string }>(`${DOCUMENTS}/publish`, dto)).data,
    onSuccess: invalidate,
  });
}

export function useVoidReportDocument() {
  const invalidate = useDocumentInvalidate();
  return useMutation({
    mutationFn: async (dto: { id: string; reason: string }) =>
      (await api.post(`${DOCUMENTS}/${dto.id}/void`, { reason: dto.reason })).data,
    onSuccess: invalidate,
  });
}

// ── promotion ────────────────────────────────────────────────────────────────

export function usePromotionBoard(resultSetId?: string) {
  return useQuery({
    queryKey: ['school', 'promotion-board', resultSetId],
    enabled: !!resultSetId,
    queryFn: async () => (await api.get<PromotionBoard>(`${PROMOTION}/by-result-set/${resultSetId}`)).data,
  });
}

function usePromotionInvalidate() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ['school', 'promotion-board'] });
    qc.invalidateQueries({ queryKey: ['school', 'students'] });
  };
}

export function useProposePromotions() {
  const invalidate = usePromotionInvalidate();
  return useMutation({
    mutationFn: async (dto: { resultSetId: string }) =>
      (await api.post<{ proposed: number; refreshed: number; untouched: number; total: number }>(`${PROMOTION}/propose`, dto)).data,
    onSuccess: invalidate,
  });
}

export function useDecidePromotions() {
  const invalidate = usePromotionInvalidate();
  return useMutation({
    mutationFn: async (dto: {
      rows: Array<{
        id: string; status: 'approved' | 'rejected'; decision?: string;
        toClassId?: string; toSectionId?: string; toStreamId?: string; reason?: string;
      }>;
    }) => (await api.post<{ decided: number }>(`${PROMOTION}/decide`, dto)).data,
    onSuccess: invalidate,
  });
}

export function useApplyPromotions() {
  const invalidate = usePromotionInvalidate();
  return useMutation({
    mutationFn: async (dto: { resultSetId: string; toTermId?: string; decisionIds?: string[] }) =>
      (await api.post<{ applied: number; skipped: Array<{ id: string; studentProfileId: string; reason: string }> }>(`${PROMOTION}/apply`, dto)).data,
    onSuccess: invalidate,
  });
}
