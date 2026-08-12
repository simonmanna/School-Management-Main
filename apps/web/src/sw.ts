/// <reference lib="webworker" />
/* eslint-disable no-undef */

/**
 * POS service worker (P3) — injectManifest source.
 *
 * Two jobs:
 *  1. Precache the app shell so the terminal loads with no network at all
 *     (a cashier reloading mid-outage must not get the dinosaur).
 *  2. Web Push (VAPID) — carried over verbatim from the previous
 *     public/sw.js, which this file replaces. Losing push while gaining
 *     offline would be a regression.
 *
 * API calls are deliberately NOT cached here: reads go through React Query's
 * IndexedDB persistence (lib/query-client.ts) and writes go through the
 * offline queue. A service worker replaying a POST would double-charge.
 */

import { precacheAndRoute, cleanupOutdatedCaches, createHandlerBoundToURL } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: Array<{ url: string; revision: string | null }> };

// ---------------------------------------------------------------- app shell

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

// SPA: every navigation resolves to index.html from the precache. API and
// upload paths are excluded so they always hit the network.
registerRoute(
  new NavigationRoute(createHandlerBoundToURL('index.html'), {
    denylist: [/^\/api\//, /^\/uploads\//],
  }),
);

self.addEventListener('install', () => {
  void self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// ------------------------------------------------------------------- push

self.addEventListener('push', (event) => {
  let payload: { title: string; body: string; href: string | null; tag: string | null } = {
    title: 'Notification',
    body: '',
    href: null,
    tag: null,
  };
  try {
    if (event.data) payload = { ...payload, ...event.data.json() };
  } catch {
    // ignore parse errors
  }
  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      data: { href: payload.href },
      tag: payload.tag || undefined,
      requireInteraction: false,
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const href = (event.notification?.data as { href?: string } | undefined)?.href;
  if (!href) return;
  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then((clients) => {
      for (const client of clients) {
        if ('focus' in client) {
          void (client as WindowClient).navigate?.(href);
          return (client as WindowClient).focus();
        }
      }
      return self.clients.openWindow?.(href);
    }),
  );
});
