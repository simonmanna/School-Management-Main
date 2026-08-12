import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '@/stores/auth.store';
import { getPosToken } from '@/features/pos/pos-session';
import { getApiBaseUrl } from '@/lib/api';

const SSE_URL = `${getApiBaseUrl()}/pos/tables/stream`;

export function usePosTablesStream() {
  const qc = useQueryClient();

  useEffect(() => {
    const token = useAuthStore.getState().accessToken;
    if (!token) return;

    const posToken = getPosToken();
    const url = new URL(SSE_URL, window.location.origin);
    url.searchParams.set('access_token', token);
    if (posToken) url.searchParams.set('pos_token', posToken);

    const es = new EventSource(url.toString());

    es.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data);
        if (msg.type === 'snapshot' && Array.isArray(msg.tables)) {
          qc.setQueriesData({ queryKey: ['pos-tables'] }, msg.tables);
          qc.setQueryData(['pos-tables', 'stats'], msg.stats);
        }
      } catch {
        // malformed event — ignore
      }
    };

    es.onerror = () => {
      // EventSource auto-reconnects; on permanent failure it will stop.
      // The poll-based fallback (refetchInterval) keeps data fresh.
    };

    return () => {
      es.close();
    };
  }, [qc]);
}
