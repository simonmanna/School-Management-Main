/**
 * Browser-side Web Push helper.
 *
 * On mount, asks for notification permission, fetches the VAPID public key
 * from the API, subscribes the browser, and registers the subscription with
 * the backend. Re-syncs on every login (push subscriptions are per-user ×
 * per-device, so a fresh access token refreshes the binding).
 *
 * The component renders nothing — it's a side-effect-only mount.
 */
import { useEffect } from 'react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/stores/auth.store';

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const pad = '='.repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + pad).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

export function PushBootstrap() {
  const isAuthed = useAuthStore((s) => !!s.accessToken);

  useEffect(() => {
    if (!isAuthed) return;
    if (typeof window === 'undefined' || !('serviceWorker' in navigator) || !('PushManager' in window)) return;

    let cancelled = false;
    (async () => {
      try {
        const permission = await Notification.requestPermission();
        if (permission !== 'granted' || cancelled) return;
        const reg = await navigator.serviceWorker.register('/sw.js').catch(() => null);
        if (!reg) return;
        const ready = await navigator.serviceWorker.ready;
        const { data: { publicKey } } = await api.get<{ publicKey: string }>('/push/vapid-public-key');
        if (!publicKey || cancelled) return;
        let sub = await ready.pushManager.getSubscription();
        if (!sub) {
          sub = await ready.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(publicKey) as unknown as BufferSource,
          });
        }
        const json = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
        await api.post('/push/subscribe', {
          endpoint: json.endpoint,
          keys: json.keys,
          userAgent: navigator.userAgent,
        });
      } catch (err) {
        // Silent — push is optional. Logged at debug level for diagnostics.
        // eslint-disable-next-line no-console
        console.debug('Push bootstrap skipped:', err);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isAuthed]);

  return null;
}
