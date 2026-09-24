import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

/**
 * Phase 6 — the national-submission desk.
 *
 * Backend controller: `/school/statutory`. Readiness is computed server-side
 * from the canonical mark store; nothing here recomputes a score, and nothing
 * here can make a blocked candidate look ready.
 */
const ROOT = '/school/statutory';

export type ExamLevel = 'PLE' | 'UCE' | 'UACE';
export type ReferenceStatus = 'provisional' | 'registered' | 'confirmed' | 'withdrawn';

export interface CandidateReference {
  id: string;
  studentProfileId: string;
  board: string;
  level: string;
  registrationYear: number;
  centreNumber: string | null;
  candidateNumber: string | null;
  indexNumber: string | null;
  status: ReferenceStatus;
  verifiedAt: string | null;
  note: string | null;
  student: { name: string | null; admissionNo: string; classId: string | null; className: string | null } | null;
}

export interface CaFinding {
  code: string;
  severity: 'blocking' | 'warning';
  detail: string;
  studentProfileId?: string;
  subjectId?: string;
}

export interface CaSubjectRow {
  subjectId: string;
  subjectCode: string | null;
  subjectName: string;
  subjectAchievement: number | null;
  activityOfIntegration: number | null;
  projectScore: number | null;
  caTotal: number | null;
  caPercent: number | null;
  assessmentCount: number;
  approvedCount: number;
  pendingCount: number;
}

export interface CaCandidate {
  studentProfileId: string;
  name: string | null;
  admissionNo: string;
  sex: string | null;
  className: string | null;
  streamName: string | null;
  centreNumber: string | null;
  candidateNumber: string | null;
  indexNumber: string | null;
  referenceStatus: string | null;
  subjects: CaSubjectRow[];
  findings: CaFinding[];
  ready: boolean;
}

export interface CaReadiness {
  term: { id: string; name: string; academicYear: string | null };
  level: string;
  registrationYear: number;
  requires: { activitiesOfIntegration: boolean; projectWork: boolean };
  summary: {
    candidates: number;
    ready: number;
    blocked: number;
    blockingFindings: number;
    warningFindings: number;
    byCode: Record<string, number>;
  };
  candidates: CaCandidate[];
  note?: string;
}

export interface DatasetField { key: string; label: string; type: string; hint?: string }
export interface DatasetDefinition {
  scope: string; name: string; description: string; filters: string[]; fields: DatasetField[];
}

export interface TemplateColumn {
  header: string; source: string; required?: boolean; fallback?: string; transform?: string;
}

export interface ExportTemplate {
  id: string; code: string; name: string; description: string | null;
  board: string; level: string | null; scope: string;
  delimiter: string; includeHeader: boolean; columns: TemplateColumn[];
  version: number; isActive: boolean; publishedAt: string | null;
  _count?: { runs: number };
}

export interface ExportRun {
  id: string; templateId: string; templateVersion: number; scope: string;
  termId: string | null; rowCount: number; checksum: string;
  warnings: Array<{ code: string; detail: string }>;
  status: string; submittedAt: string | null; submissionReference: string | null;
  generatedAt: string;
  template?: { code: string; name: string; board: string; level: string | null };
}

export interface ExportRunResult {
  runId: string; templateCode: string; templateVersion: number;
  filename: string; content: string; rowCount: number; checksum: string;
  warnings: Array<{ code: string; detail: string }>;
}

// ── candidate references ─────────────────────────────────────────────────────

export function useCandidateReferences(params: { level?: string; registrationYear?: number; status?: string; classId?: string; search?: string }) {
  return useQuery({
    queryKey: ['statutory', 'candidates', params],
    queryFn: async () => (await api.get<CandidateReference[]>(`${ROOT}/candidates`, { params })).data,
  });
}

export function useMissingReferences(level: string | undefined, registrationYear: number | undefined) {
  return useQuery({
    enabled: !!level && !!registrationYear,
    queryKey: ['statutory', 'candidates', 'missing', level, registrationYear],
    queryFn: async () =>
      (await api.get<Array<{ studentProfileId: string; gradeLevel: { name: string } | null; programmeCode: string | null; student: { name: string | null; admissionNo: string; className: string | null } | null }>>(
        `${ROOT}/candidates/missing`,
        { params: { level, registrationYear } },
      )).data,
  });
}

export function useUpsertCandidateReference() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: Partial<CandidateReference> & { studentProfileId: string; level: ExamLevel; registrationYear: number }) =>
      (await api.post(`${ROOT}/candidates`, dto)).data,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['statutory'] }),
  });
}

export function useAssignCandidateNumbers() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: {
      level: ExamLevel; registrationYear: number; classIds?: string[];
      centreNumber?: string; prefix?: string; startAt?: number; padTo?: number; orderBy?: 'admissionNo' | 'name';
    }) => (await api.post<{ assigned: number; skipped: number }>(`${ROOT}/candidates/assign-numbers`, dto)).data,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['statutory'] }),
  });
}

export function useImportIndexNumbers() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: { level: ExamLevel; registrationYear: number; rows: Array<{ candidateNumber: string; indexNumber: string }> }) =>
      (await api.post<{ matched: number; exceptions: Array<{ candidateNumber: string; indexNumber: string; reason: string }> }>(
        `${ROOT}/candidates/import-index-numbers`, dto,
      )).data,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['statutory'] }),
  });
}

export function useWithdrawReference() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: { id: string; reason: string }) =>
      (await api.post(`${ROOT}/candidates/${dto.id}/withdraw`, { reason: dto.reason })).data,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['statutory'] }),
  });
}

// ── readiness ────────────────────────────────────────────────────────────────

export function useCaReadiness(params: { termId?: string; level?: string; registrationYear?: number; classIds?: string[] }) {
  return useQuery({
    enabled: !!params.termId && !!params.level,
    queryKey: ['statutory', 'ca-readiness', params],
    queryFn: async () =>
      (await api.get<CaReadiness>(`${ROOT}/uneb-ca/readiness`, {
        params: {
          termId: params.termId,
          level: params.level,
          registrationYear: params.registrationYear,
          classIds: params.classIds?.length ? params.classIds.join(',') : undefined,
        },
      })).data,
  });
}

// ── templates and exports ────────────────────────────────────────────────────

export function useStatutoryDatasets() {
  return useQuery({
    queryKey: ['statutory', 'datasets'],
    queryFn: async () => (await api.get<DatasetDefinition[]>(`${ROOT}/datasets`)).data,
  });
}

export function useExportTemplates(scope?: string) {
  return useQuery({
    queryKey: ['statutory', 'templates', scope],
    queryFn: async () => (await api.get<ExportTemplate[]>(`${ROOT}/templates`, { params: { scope } })).data,
  });
}

export function useSeedDefaultTemplates() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => (await api.post<{ created: string[]; skipped: number }>(`${ROOT}/templates/seed-defaults`, {})).data,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['statutory', 'templates'] }),
  });
}

export function useUpdateExportTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: { id: string; name?: string; delimiter?: string; includeHeader?: boolean; isActive?: boolean; columns?: TemplateColumn[] }) =>
      (await api.put(`${ROOT}/templates/${dto.id}`, dto)).data,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['statutory', 'templates'] }),
  });
}

export interface RunExportDto {
  templateId: string;
  termId?: string;
  classIds?: string[];
  level?: ExamLevel;
  registrationYear?: number;
  allowIncomplete?: boolean;
  reason?: string;
}

export function usePreviewExport() {
  return useMutation({
    mutationFn: async (dto: RunExportDto) =>
      (await api.post<{ columns: string[]; rowCount: number; rows: string[][]; warnings: Array<{ code: string; detail: string }> }>(
        `${ROOT}/exports/preview`, dto,
      )).data,
  });
}

export function useRunExport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: RunExportDto) => (await api.post<ExportRunResult>(`${ROOT}/exports/run`, dto)).data,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['statutory', 'runs'] }),
  });
}

export function useExportRuns(scope?: string) {
  return useQuery({
    queryKey: ['statutory', 'runs', scope],
    queryFn: async () => (await api.get<ExportRun[]>(`${ROOT}/exports/runs`, { params: { scope } })).data,
  });
}

export function useMarkExportSubmitted() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: { id: string; submissionReference: string; note?: string }) =>
      (await api.post(`${ROOT}/exports/runs/${dto.id}/submitted`, { submissionReference: dto.submissionReference, note: dto.note })).data,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['statutory', 'runs'] }),
  });
}

/**
 * Turn a produced file into a download in the browser.
 *
 * The bytes come from the server's run — the client never assembles a file of
 * its own, because a file the server has no run record for is a submission
 * nobody can account for later.
 */
export function downloadExport(result: ExportRunResult) {
  const blob = new Blob([result.content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = result.filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
