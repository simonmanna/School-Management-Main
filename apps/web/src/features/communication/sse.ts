import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '@/stores/auth.store';
import { getApiBaseUrl } from '@/lib/api';
import { COMM_PREFIX } from './api';
import type { MessageView, StreamEvent } from './types';

/** Channel status/QR pushed over the same stream — consumed by the Channels page. */
export interface ChannelStatusEvent {
  type: 'channel.status';
  channelId: string;
  status: string;
  qrPngDataUrl?: string;
  expiresAt?: string;
}

/**
 * Live inbox stream. Mirrors features/tables/sse.ts: EventSource cannot send an
 * Authorization header, so the access token rides as a query param (the
 * `/communication/stream` path is allow-listed in the API's main.ts). Falls back
 * to react-query polling when the stream drops.
 */
export function useCommunicationStream(activeConversationId?: string) {
  const qc = useQueryClient();

  useEffect(() => {
    const token = useAuthStore.getState().accessToken;
    if (!token) return;

    const url = new URL(`${getApiBaseUrl()}/communication/stream`, window.location.origin);
    url.searchParams.set('access_token', token);
    const es = new EventSource(url.toString());

    es.onmessage = (evt) => {
      let msg: StreamEvent;
      try {
        msg = JSON.parse(evt.data);
      } catch {
        return;
      }
      if (msg.type === 'message.created' && msg.conversationId) {
        // Append to the open conversation's cache if we have it; always refresh
        // the conversation list (unread + last-message preview).
        if (msg.message && msg.conversationId === activeConversationId) {
          qc.setQueryData<MessageView[]>([...COMM_PREFIX, 'messages', msg.conversationId], (prev) => {
            if (!prev) return prev;
            if (prev.some((m) => m.id === msg.message!.id)) return prev;
            return [...prev, msg.message!];
          });
        }
        qc.invalidateQueries({ queryKey: [...COMM_PREFIX, 'conversations'] });
      } else if (msg.type === 'delivery.status' && msg.conversationId) {
        qc.invalidateQueries({ queryKey: [...COMM_PREFIX, 'messages', msg.conversationId] });
      }
    };

    es.onerror = () => {
      // EventSource auto-reconnects; poll fallback keeps data fresh meanwhile.
    };

    return () => es.close();
  }, [qc, activeConversationId]);
}

/**
 * Subscribes to `channel.status` events (connection state + the pairing QR PNG,
 * rendered server-side so the web needs no QR library). Used by the Channels
 * admin page while a WhatsApp channel is being linked.
 */
export function useChannelStatusStream(onStatus: (e: ChannelStatusEvent) => void): void {
  const qc = useQueryClient();
  useEffect(() => {
    const token = useAuthStore.getState().accessToken;
    if (!token) return;
    const url = new URL(`${getApiBaseUrl()}/communication/stream`, window.location.origin);
    url.searchParams.set('access_token', token);
    const es = new EventSource(url.toString());
    es.onmessage = (evt) => {
      let msg: ChannelStatusEvent;
      try {
        msg = JSON.parse(evt.data);
      } catch {
        return;
      }
      if (msg.type === 'channel.status') {
        onStatus(msg);
        qc.invalidateQueries({ queryKey: [...COMM_PREFIX, 'channels'] });
      }
    };
    es.onerror = () => {
      /* auto-reconnects */
    };
    return () => es.close();
  }, [qc, onStatus]);
}
