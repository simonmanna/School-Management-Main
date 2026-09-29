/**
 * Offline queue for attendance and mark entry.
 *
 * The POS has had one of these since P11; the school side had none, so a
 * teacher taking a register or typing marks on a school's own connection lost
 * the lot the moment it dropped. In a Ugandan school that is not an edge case —
 * it is Tuesday. This mirrors `features/pos/offline-queue.ts`: writes go to
 * IndexedDB when the server is unreachable and replay in order when it returns.
 *
 * Differences from the POS queue, because of what is being queued:
 *
 *  - A register and a mark are LAST-WRITE-WINS per cell, not an append-only
 *    ledger. Queuing two edits of the same pupil's mark and replaying both is
 *    pointless work and can resurrect a value the teacher already corrected, so
 *    entries are keyed by what they address and a later edit replaces an
 *    earlier pending one.
 *  - Every entry belongs to the school and staff member who typed it (audit
 *    R02). Only that person, signed in to that school, sees or sends it; a
 *    refused entry is kept with the reason until they discard it. The rules
 *    live in `offline-queue-core.ts`.
 *
 * Public surface:
 *   enqueue(entry) · listPending() · replayAll() · retry(id) · discard(id)
 *   · useSchoolOfflineQueue()
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { api, getApiBaseUrl } from '@/lib/api';
import { useAuthStore } from '@/stores/auth.store';
import {
  countOthers,
  discardOrphaned,
  discardOwn,
  listOwn,
  makeEntry,
  replayOwn,
  retryOwn,
  toOrphan,
  type NewQueuedWrite,
  type QueueOwner,
  type QueueStore,
  type QueuedWrite,
  type ReplayResult,
} from './offline-queue-core';

export type { QueuedKind, QueuedWrite, QueuedState, ReplayResult } from './offline-queue-core';

/* ── IndexedDB ────────────────────────────────────────────────────────────── */

const DB_NAME = 'school-offline-queue';
/** v2 (R02): entries are keyed by owner + key and carry their author. */
const DB_VERSION = 2;
const LEGACY_STORE = 'pending-writes';
const STORE = 'owned-writes';

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB not available'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      const tx = req.transaction!;
      const target = db.objectStoreNames.contains(STORE)
        ? tx.objectStore(STORE)
        : db.createObjectStore(STORE, { keyPath: 'id' });
      if (db.objectStoreNames.contains(LEGACY_STORE)) {
        // Rows from before R02 have no author. Keep them as orphans nobody can
        // send, rather than guessing whose they were.
        const legacy = tx.objectStore(LEGACY_STORE).getAll();
        legacy.onsuccess = () => {
          (legacy.result as Record<string, unknown>[]).forEach((row, i) => target.put(toOrphan(row, i)));
          db.deleteObjectStore(LEGACY_STORE);
        };
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

const idbStore: QueueStore = {
  async put(value) {
    const db = await openDb();
    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(value);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  },
  async all() {
    const db = await openDb();
    return new Promise<QueuedWrite[]>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).getAll();
      req.onsuccess = () => resolve(req.result as QueuedWrite[]);
      req.onerror = () => reject(req.error);
    });
  },
  async del(id) {
    const db = await openDb();
    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  },
};

/* ── session owner ────────────────────────────────────────────────────────── */

function currentOwner(): QueueOwner | null {
  const { user, organization } = useAuthStore.getState();
  return user?.id && organization?.id ? { organizationId: organization.id, userId: user.id } : null;
}

function changed() {
  window.dispatchEvent(new CustomEvent('school-queue-changed'));
}

/* ── server reachability ──────────────────────────────────────────────────── */

/**
 * Whether the API is reachable — not whether the laptop has internet. A school
 * running the server on the LAN is "offline" to the browser and perfectly able
 * to save, and a school with a captive-portal WiFi is the reverse.
 */
export async function checkServerOnline(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);
    const base = getApiBaseUrl();
    const url = base ? `${base}/health` : '/api/v1/health';
    const res = await fetch(url, { method: 'GET', signal: controller.signal, credentials: 'omit' });
    clearTimeout(timeoutId);
    return res.ok;
  } catch {
    return false;
  }
}

/* ── queue ────────────────────────────────────────────────────────────────── */

let seqCounter = Date.now();

/** Save a write on this device, stamped with the signed-in school and staff member. */
export async function enqueue(entry: NewQueuedWrite): Promise<void> {
  const owner = currentOwner();
  if (!owner) throw new Error('Sign in again to save work on this device.');
  await idbStore.put(makeEntry(owner, entry, seqCounter++));
  changed();
}

/** The signed-in person's own saved entries. */
export async function listPending(): Promise<QueuedWrite[]> {
  try {
    return await listOwn(idbStore, currentOwner());
  } catch {
    return [];
  }
}

/** Send the signed-in person's own entries; nobody else's are touched. */
export async function replayAll(): Promise<ReplayResult> {
  const result = await replayOwn(idbStore, currentOwner(), (endpoint, payload) => api.post(endpoint, payload));
  changed();
  return result;
}

export async function retry(id: string): Promise<void> {
  await retryOwn(idbStore, currentOwner(), id);
  changed();
}

export async function discard(id: string): Promise<void> {
  await discardOwn(idbStore, currentOwner(), id);
  changed();
}

export async function discardUnattributed(): Promise<number> {
  const n = await discardOrphaned(idbStore);
  changed();
  return n;
}

/* ── hook ─────────────────────────────────────────────────────────────────── */

/**
 * Watches connectivity and drains the signed-in person's queue when the server
 * comes back or when they sign in. `othersCount` is how many entries on this
 * device belong to someone else — a number only, never their content.
 */
export function useSchoolOfflineQueue(onReplayed?: (r: ReplayResult) => void) {
  const [online, setOnline] = useState(true);
  const [pending, setPending] = useState<QueuedWrite[]>([]);
  const [othersCount, setOthersCount] = useState(0);
  const replaying = useRef(false);
  const onlineRef = useRef(true);
  const onReplayedRef = useRef(onReplayed);
  onReplayedRef.current = onReplayed;
  const userId = useAuthStore((s) => s.user?.id);
  const organizationId = useAuthStore((s) => s.organization?.id);

  const refresh = useCallback(async () => {
    try {
      const owner = currentOwner();
      setPending(await listOwn(idbStore, owner));
      setOthersCount(await countOthers(idbStore, owner));
    } catch {
      setPending([]);
      setOthersCount(0);
    }
  }, []);

  const drain = useCallback(async () => {
    if (replaying.current || !currentOwner()) return;
    replaying.current = true;
    try {
      const result = await replayAll();
      await refresh();
      if (result.sent > 0 || result.rejected.length > 0 || result.authBlocked > 0) onReplayedRef.current?.(result);
    } finally {
      replaying.current = false;
    }
  }, [refresh]);

  // A different person (or school) signed in: show their queue, and send it if we can.
  useEffect(() => {
    void refresh();
    if (userId && organizationId && onlineRef.current) void drain();
  }, [userId, organizationId, refresh, drain]);

  useEffect(() => {
    let cancelled = false;

    const probe = async () => {
      const up = await checkServerOnline();
      if (cancelled) return;
      const was = onlineRef.current;
      onlineRef.current = up;
      setOnline(up);
      // Only drain on the transition back up, not on every poll.
      if (!was && up) void drain();
    };

    void probe();

    const interval = window.setInterval(probe, 15_000);
    const onChange = () => void refresh();
    window.addEventListener('school-queue-changed', onChange);
    window.addEventListener('online', probe);
    window.addEventListener('offline', probe);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.removeEventListener('school-queue-changed', onChange);
      window.removeEventListener('online', probe);
      window.removeEventListener('offline', probe);
    };
  }, [drain, refresh]);

  return { online, pending, othersCount, replay: drain, refresh, retry, discard, discardUnattributed };
}
