import { QueryClient } from '@tanstack/react-query';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { get, set, del } from 'idb-keyval';

/** Query keys whose data must survive a reload while the server is unreachable. */
const OFFLINE_CACHED_KEYS = [
  'products',
  'product-categories',
  'menu-items',
  'menu-categories',
  'pos-tables',
  'pos-lookup',
  'partners',
  'receipt-settings',
  'taxes',
];

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      staleTime: 30_000,
      refetchIntervalInBackground: false,
      // Cached catalog must outlive the tab. The default 5-minute gcTime would
      // evict it long before a cashier reopens the terminal mid-outage.
      gcTime: 7 * 24 * 60 * 60 * 1000,
    },
  },
});

/**
 * Offline catalog cache (P3).
 *
 * IndexedDB — not localStorage: a full menu with images/modifiers can exceed
 * the ~5MB localStorage budget, and blowing that quota throws mid-service.
 *
 * Only catalog-ish reads are persisted. Money and session state are
 * deliberately excluded: a stale cached invoice or cash session shown as
 * current would be worse than an empty screen. Queued sales live in the
 * offline-queue's own IndexedDB store, not here.
 */
export const queryPersister = createAsyncStoragePersister({
  storage: {
    getItem: async (key) => (await get(key)) ?? null,
    setItem: async (key, value) => set(key, value),
    removeItem: async (key) => del(key),
  },
  key: 'pos-query-cache',
  throttleTime: 2_000,
});

export const persistOptions = {
  persister: queryPersister,
  maxAge: 7 * 24 * 60 * 60 * 1000,
  // Bump when cached shapes change, so old entries are dropped rather than
  // rehydrated into a UI that no longer understands them.
  buster: 'v1',
  dehydrateOptions: {
    shouldDehydrateQuery: (query: { queryKey: readonly unknown[]; state: { status: string } }) => {
      if (query.state.status !== 'success') return false;
      const root = String(query.queryKey[0] ?? '');
      return OFFLINE_CACHED_KEYS.includes(root);
    },
  },
};
