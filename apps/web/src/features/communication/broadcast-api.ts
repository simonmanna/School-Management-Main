import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { COMM_PREFIX } from './api';

/**
 * Broadcast console data layer.
 *
 * Kept separate from `api.ts` (the 1:1 inbox) because they have different
 * refresh characteristics: an inbox is SSE-driven and mostly idle, while a
 * draining broadcast needs a short poll for as long as it is in flight and none
 * at all once it completes.
 */

function uuid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return (crypto as { randomUUID(): string }).randomUUID();
  }
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

/* ── Types (mirror the API DTOs) ─────────────────────────────────────────── */

export type AudienceScope =
  | 'all'
  | 'class'
  | 'grade'
  | 'section'
  | 'stream'
  | 'campus'
  | 'house'
  | 'residence'
  | 'students'
  | 'staff'
  | 'department';

export type RecipientKind = 'guardians' | 'students' | 'both';

export interface AudienceSelector {
  scope: AudienceScope;
  ids?: string[];
  recipients?: RecipientKind;
  primaryGuardianOnly?: boolean;
  statementRecipientsOnly?: boolean;
  studentStatus?: string[];
  staffCategory?: string[];
  dedupe?: 'per_recipient' | 'per_student';
}

export interface ChannelPolicyStep {
  providerId: string;
  transport?: string;
  channelId?: string;
}

export interface ChannelPolicy {
  steps: ChannelPolicyStep[];
  fallbackOnFailure?: boolean;
}

export interface SmsSegmentation {
  encoding: 'GSM-7' | 'UCS-2';
  segments: number;
  units: number;
  remaining: number;
}

export interface AudiencePreview {
  description: string;
  policy: string;
  counts: {
    students: number;
    members: number;
    reachableByPhone: number;
    reachableByUser: number;
    unreachable: number;
  };
  segments: SmsSegmentation;
  estimatedSmsSegments: number;
  sample: {
    kind: string;
    displayName: string;
    address: string | null;
    studentName: string | null;
    className: string | null;
    relationship: string | null;
  }[];
  unreachableSample: {
    kind: string;
    displayName: string;
    studentName: string | null;
    className: string | null;
  }[];
}

export interface Broadcast {
  id: string;
  title: string | null;
  body: string;
  templateKey: string | null;
  audience: AudienceSelector;
  channelPolicy: ChannelPolicy;
  status: 'draft' | 'scheduled' | 'materializing' | 'sending' | 'completed' | 'cancelled' | 'failed';
  scheduledAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  totalRecipients: number;
  queuedCount: number;
  sentCount: number;
  deliveredCount: number;
  failedCount: number;
  suppressedCount: number;
  unreachableCount: number;
  estimatedSegments: number;
  costMicros: string;
  lastError: string | null;
  createdAt: string;
  policyDescription?: string;
}

export interface BroadcastRecipientRow {
  id: string;
  kind: string;
  displayName: string;
  address: string | null;
  studentName: string | null;
  className: string | null;
  relationship: string | null;
  status: string;
  providerId: string | null;
  suppressionReason: string | null;
  lastError: string | null;
}

export interface BroadcastReport {
  broadcast: Broadcast;
  byStatus: Record<string, number>;
  byProvider: { providerId: string | null; status: string; count: number }[];
  totals: { segments: number; costMicros: string };
}

const BC = [...COMM_PREFIX, 'broadcasts'] as const;

/** True while the server may still change the row — drives the poll interval. */
export function isBroadcastLive(status: string): boolean {
  return ['scheduled', 'materializing', 'sending'].includes(status);
}

/* ── Compose ─────────────────────────────────────────────────────────────── */

/**
 * Live audience count. Debouncing is the caller's job (the composer holds the
 * body in local state and only passes a settled value), so this hook stays a
 * plain query keyed on the exact inputs.
 */
export function useAudiencePreview(
  audience: AudienceSelector | null,
  body: string,
  channelPolicy?: ChannelPolicy,
  enabled = true,
) {
  return useQuery({
    queryKey: [...BC, 'preview', audience, body, channelPolicy],
    queryFn: async () =>
      (
        await api.post<AudiencePreview>('/communication/broadcasts/audience/preview', {
          audience,
          body,
          channelPolicy,
        })
      ).data,
    enabled: enabled && !!audience,
    // The roster changes on a human timescale; refetching on every focus would
    // re-run a whole-school resolve for nothing.
    staleTime: 30_000,
    retry: false,
  });
}

/** Segment/encoding counter for the composer, computed server-side so the UI and
 *  the biller never disagree about what a body costs. */
export function useSmsPreview(body: string, transliterate = false) {
  return useQuery({
    queryKey: [...COMM_PREFIX, 'sms-preview', body, transliterate],
    queryFn: async () =>
      (await api.post<SmsSegmentation & { body: string; transliterated: boolean }>('/communication/sms/preview', {
        body,
        transliterate,
      })).data,
    enabled: body.trim().length > 0,
    staleTime: 60_000,
    retry: false,
  });
}

/* ── CRUD + lifecycle ────────────────────────────────────────────────────── */

export function useBroadcasts(status?: string) {
  return useQuery({
    queryKey: [...BC, 'list', status ?? 'all'],
    queryFn: async () =>
      (await api.get<Broadcast[]>('/communication/broadcasts', { params: { status } })).data,
    // Poll only while something is actually in flight.
    refetchInterval: (query) =>
      (query.state.data ?? []).some((b) => isBroadcastLive(b.status)) ? 3_000 : false,
  });
}

export function useBroadcastReport(id: string | undefined) {
  return useQuery({
    queryKey: [...BC, 'report', id],
    queryFn: async () => (await api.get<BroadcastReport>(`/communication/broadcasts/${id}/report`)).data,
    enabled: !!id,
    refetchInterval: (query) =>
      query.state.data && isBroadcastLive(query.state.data.broadcast.status) ? 3_000 : false,
  });
}

export function useBroadcastRecipients(id: string | undefined, status?: string, search?: string) {
  return useQuery({
    queryKey: [...BC, 'recipients', id, status ?? 'all', search ?? ''],
    queryFn: async () =>
      (
        await api.get<{ rows: BroadcastRecipientRow[]; nextCursor: string | null }>(
          `/communication/broadcasts/${id}/recipients`,
          { params: { status, search, limit: 200 } },
        )
      ).data,
    enabled: !!id,
  });
}

export interface CreateBroadcastInput {
  title?: string;
  body: string;
  templateKey?: string;
  audience: AudienceSelector;
  channelPolicy?: ChannelPolicy;
  scheduledAt?: string;
}

export function useCreateBroadcast() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateBroadcastInput) =>
      (
        await api.post<Broadcast>('/communication/broadcasts', input, {
          // A double-click must not create two drafts.
          headers: { 'Idempotency-Key': uuid() },
        })
      ).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: [...BC, 'list'] }),
  });
}

export function useSubmitBroadcast() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, scheduledAt }: { id: string; scheduledAt?: string }) =>
      (
        await api.post<Broadcast>(
          `/communication/broadcasts/${id}/submit`,
          { scheduledAt },
          // The one request in this module where a retry would genuinely message
          // thousands of parents twice.
          { headers: { 'Idempotency-Key': uuid() } },
        )
      ).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: BC }),
  });
}

export function useCancelBroadcast() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason?: string }) =>
      (await api.post(`/communication/broadcasts/${id}/cancel`, { reason })).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: BC }),
  });
}

/* ── Consent / suppression list ──────────────────────────────────────────── */

export interface ConsentRow {
  id: string;
  channel: string;
  address: string;
  status: 'opted_in' | 'opted_out';
  source: string;
  reason: string | null;
  updatedAt: string;
}

export function useConsentList(params: { channel?: string; status?: string; search?: string } = {}) {
  return useQuery({
    queryKey: [...COMM_PREFIX, 'consent', params],
    queryFn: async () => (await api.get<ConsentRow[]>('/communication/consent', { params })).data,
  });
}

export function useSetConsent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      address: string;
      channel?: string;
      status: 'opted_in' | 'opted_out';
      reason?: string;
    }) => (await api.post('/communication/consent', input)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: [...COMM_PREFIX, 'consent'] }),
  });
}

/* ── Channel config (SMS gateway) ────────────────────────────────────────── */

export function useUpdateChannel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      ...body
    }: {
      id: string;
      name?: string;
      config?: Record<string, unknown>;
      /** Omit to keep the stored credentials — the UI never receives them back. */
      secrets?: Record<string, string>;
    }) => (await api.patch(`/communication/channels/${id}`, body)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: [...COMM_PREFIX, 'channels'] }),
  });
}
