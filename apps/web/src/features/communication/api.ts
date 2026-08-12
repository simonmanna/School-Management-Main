import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type {
  ConversationSummary,
  CreateConversationInput,
  MessageView,
  SendMessageInput,
} from './types';

export const COMM_PREFIX = ['communication'] as const;

function uuid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return (crypto as { randomUUID(): string }).randomUUID();
  }
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export function useConversations() {
  return useQuery({
    queryKey: [...COMM_PREFIX, 'conversations'],
    queryFn: async () => (await api.get<ConversationSummary[]>('/communication/conversations')).data,
    // Fallback poll; SSE keeps this fresh when connected.
    refetchInterval: 30_000,
  });
}

export function useMessages(conversationId: string | undefined) {
  return useQuery({
    queryKey: [...COMM_PREFIX, 'messages', conversationId],
    queryFn: async () =>
      (await api.get<MessageView[]>(`/communication/conversations/${conversationId}/messages`)).data,
    enabled: !!conversationId,
  });
}

export function useCreateConversation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateConversationInput) =>
      (await api.post<{ id: string }>('/communication/conversations', input, {
        headers: { 'Idempotency-Key': uuid() },
      })).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: [...COMM_PREFIX, 'conversations'] }),
  });
}

export function useSendMessage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ conversationId, ...body }: SendMessageInput) =>
      (await api.post<MessageView>(`/communication/conversations/${conversationId}/messages`, body, {
        headers: { 'Idempotency-Key': uuid() },
      })).data,
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: [...COMM_PREFIX, 'messages', vars.conversationId] });
      qc.invalidateQueries({ queryKey: [...COMM_PREFIX, 'conversations'] });
    },
  });
}

export function useMarkRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ conversationId, messageId }: { conversationId: string; messageId?: string }) =>
      (await api.post(`/communication/conversations/${conversationId}/read`, { messageId })).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: [...COMM_PREFIX, 'conversations'] }),
  });
}

/** Resolve (get-or-create) the conversation attached to a business record. */
export function useResolveContext() {
  return useMutation({
    mutationFn: async (input: { contextType: string; contextId: string }) =>
      (await api.post<{ id: string }>('/communication/conversations/resolve-context', input)).data,
  });
}

/* ── Phase 2 — templates & rules (admin) ─────────────────────────────────── */

export interface MessageTemplate {
  id: string;
  key: string;
  eventName: string | null;
  providerId: string | null;
  locale: string;
  version: number;
  subject: string | null;
  body: string;
  variables: string[];
  active: boolean;
}

export interface CommunicationRule {
  id: string;
  eventName: string;
  templateKey: string;
  recipientResolver: string;
  channelSelector: string;
  condition: Record<string, unknown>;
  enabled: boolean;
}

export function useTemplates() {
  return useQuery({
    queryKey: [...COMM_PREFIX, 'templates'],
    queryFn: async () => (await api.get<MessageTemplate[]>('/communication/templates')).data,
  });
}

export function useUpsertTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: Partial<MessageTemplate> & { key: string; body: string }) =>
      (await api.post<MessageTemplate>('/communication/templates', input)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: [...COMM_PREFIX, 'templates'] }),
  });
}

export function useRules() {
  return useQuery({
    queryKey: [...COMM_PREFIX, 'rules'],
    queryFn: async () => (await api.get<CommunicationRule[]>('/communication/rules')).data,
  });
}

export function useEventableEvents() {
  return useQuery({
    queryKey: [...COMM_PREFIX, 'rules', 'eventable'],
    queryFn: async () => (await api.get<string[]>('/communication/rules/eventable')).data,
  });
}

export function useUpsertRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: Partial<CommunicationRule> & { eventName: string; templateKey: string; recipientResolver: string }) =>
      (await api.post<CommunicationRule>('/communication/rules', input)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: [...COMM_PREFIX, 'rules'] }),
  });
}

export function useToggleRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, enabled }: { id: string; enabled: boolean }) =>
      (await api.patch(`/communication/rules/${id}/enabled`, { enabled })).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: [...COMM_PREFIX, 'rules'] }),
  });
}

export function useDeleteRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => (await api.delete(`/communication/rules/${id}`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: [...COMM_PREFIX, 'rules'] }),
  });
}

/* ── Phase 3/6 — channels (admin) ────────────────────────────────────────── */

export interface CommunicationChannel {
  id: string;
  providerId: string;
  transport: string;
  name: string;
  status: string;
  desiredState: string;
  pairedAt: string | null;
  lastConnectedAt: string | null;
  lastError: string | null;
  leaseHeartbeatAt: string | null;
  dailySentCount: number;
  providerEnabled: boolean;
  health: { status: string; ownedByThisProcess: boolean } | null;
}

export function useChannels() {
  return useQuery({
    queryKey: [...COMM_PREFIX, 'channels'],
    queryFn: async () => (await api.get<CommunicationChannel[]>('/communication/channels')).data,
    refetchInterval: 10_000,
  });
}

export function useCreateChannel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { providerId: string; name: string; transport?: string; config?: Record<string, unknown> }) =>
      (await api.post<CommunicationChannel>('/communication/channels', input)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: [...COMM_PREFIX, 'channels'] }),
  });
}

export function useConnectChannel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => (await api.post(`/communication/channels/${id}/connect`, {})).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: [...COMM_PREFIX, 'channels'] }),
  });
}

export function useDisconnectChannel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, logout }: { id: string; logout?: boolean }) =>
      (await api.post(`/communication/channels/${id}/disconnect`, { logout })).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: [...COMM_PREFIX, 'channels'] }),
  });
}

export function useDeleteChannel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => (await api.delete(`/communication/channels/${id}`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: [...COMM_PREFIX, 'channels'] }),
  });
}
