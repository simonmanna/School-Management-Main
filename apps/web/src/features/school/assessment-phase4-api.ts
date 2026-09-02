import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

const ROOT = '/school/assessment-board';
export function useRecordAssessmentWork() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: async (dto: { assignmentId: string; studentProfileId: string; content?: string }) => (await api.post('/school/assignments/record-received', dto)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['school', 'assessment-board'] }) });
}
export interface DraftMarkRow { studentProfileId: string; marks: number | null; participation: string; comment: string; expectedVersion: number }
export interface SavedMarkRow extends Omit<DraftMarkRow, 'expectedVersion'> { version: number; studentAssessmentId: string; approvalStatus: string }
export interface BulkSaveResponse { saved: number; savedAt: string; rows: SavedMarkRow[] }
export const saveAssessmentDraft = async (id: string, rows: DraftMarkRow[], key: string) =>
  (await api.post<BulkSaveResponse>(`${ROOT}/${id}/marks`, { rows }, { headers: { 'Idempotency-Key': key } })).data;

export function useAssessmentLifecycle() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: async ({ id, action, expectedVersion }: { id: string; action: string; expectedVersion: number }) =>
    (await api.post(`${ROOT}/${id}/lifecycle`, { action, expectedVersion })).data,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['school', 'assessment-board'] }); qc.invalidateQueries({ queryKey: ['school', 'teaching'] }); } });
}
export function useCaptureCourseAssessmentRoster() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: async (id: string) => (await api.post<{ id: string; memberCount: number; name: string; frozenAt: string }>(`${ROOT}/offerings/${id}/roster`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['school', 'rosters'] }) });
}
export interface InboxSubmission { id: string; studentAssessmentId: string; attemptNo: number; submittedAt: string | null; isLate: boolean; content: string | null; attachments: unknown[]; rawScore: number | null; penaltyApplied: number | null }
export interface AssessmentInbox {
  assignment: { id: string; instructions: string | null; gradingMode: string; maxAttempts: number; allowLate: boolean; latePenaltyPercent: number } | null;
  rubric: { id: string; name: string; version: number; criteria: Array<{ id: string; name: string; description: string | null; maxScore: number; weight: number; levels: Array<{ id: string; label: string; score: number }> }> } | null;
  submissions: InboxSubmission[];
}
export function useAssessmentInbox(id?: string) {
  return useQuery({ queryKey: ['school', 'assessment-board', 'inbox', id], enabled: !!id, queryFn: async () => (await api.get<AssessmentInbox>(`${ROOT}/${id}/inbox`)).data });
}
export function useAssessmentEvidence(id: string, studentId?: string) {
  return useQuery({ queryKey: ['school', 'assessment-board', 'evidence', id, studentId], enabled: !!studentId,
    queryFn: async () => (await api.get<any>(`${ROOT}/${id}/evidence/${studentId}`)).data });
}
export function usePolicyRevisionAction() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: async ({ id, action }: { id: string; action: 'publish' | 'fork' }) => (await api.post(`/school/assessment-policies/${id}/${action}`)).data,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['school', 'assessment-policies'] }); qc.invalidateQueries({ queryKey: ['school', 'assessment-policy-resolve'] }); qc.invalidateQueries({ queryKey: ['school', 'assessment-board'] }); } });
}
