/**
 * Offline queue for attendance and mark entry.
 *
 * The POS has had one of these since P11; the school side had none, so a
 * teacher taking a register or typing marks on a school's own connection lost
 * the lot the moment it dropped. In a Ugandan school that is not an edge case —
 * it is Tuesday. This mirrors `features/pos/offline-queue.ts`: writes go to
 * IndexedDB when the server is unreachable and replay in order when it returns.
 *
 * Two differences from the POS queue, both because of what is being queued:
 *
 *  - A register and a mark are LAST-WRITE-WINS per cell, not an append-only
 *    ledger. Queuing two edits of the same pupil's mark and replaying both is
 *    pointless work and can resurrect a value the teacher already corrected, so
 *    entries are keyed by what they address and a later edit replaces an
 *    earlier pending one.
 *  - There is no money here, so a 4xx is not something to preserve for a
 *    manager to reconcile. It is told to the teacher and dropped, because the
 *    common 4xx is the paper being locked while they were offline, and the
 *    honest outcome is "this did not save", not a queue that never drains.
 *
 * Public surface mirrors the POS one:
 *   enqueue(entry) · listPending() · replayAll() · useSchoolOfflineQueue()
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { api, getApiBaseUrl } from '@/lib/api';

export type QueuedKind = 'attendance' | 'mark';

export interface QueuedWrite {
  /**
   * Identity of the thing being written — pupil + paper, or pupil + date.
   * A second edit of the same cell replaces the first rather than stacking.
   */
  key: string;
  kind: QueuedKind;
  endpoint: string;
  payload: unknown;
  createdAt: number;
  attempts: number;
  lastError?: string;
  /** Replay follows this, not IndexedDB key order. */
  seq: number;
  /** Human label for the pending badge — "P4 West · Mathematics". */
  label?: string;
}

/* ── IndexedDB ────────────────────────────────────────────────────────────── */

const DB_NAME = 'school-offline-queue';
const DB_VERSION = 1;
const STORE = 'pending-writes';

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
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function idbPut(value: QueuedWrite): Promise<void> {
  const db = await openDb();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(value);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbAll(): Promise<QueuedWrite[]> {
  const db = await openDb();
  return new Promise<QueuedWrite[]>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result as QueuedWrite[]);
    req.onerror = () => reject(req.error);
  });
}

async function idbDel(key: string): Promise<void> {
  const db = await openDb();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
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

export async function enqueue(entry: Omit<QueuedWrite, 'createdAt' | 'attempts' | 'seq'>): Promise<void> {
  await idbPut({ ...entry, createdAt: Date.now(), attempts: 0, seq: seqCounter++ });
  window.dispatchEvent(new CustomEvent('school-queue-changed'));
}

export async function listPending(): Promise<QueuedWrite[]> {
  try {
    const all = await idbAll();
    return all.sort((a, b) => a.seq - b.seq);
  } catch {
    return [];
  }
}

export interface ReplayResult {
  sent: number;
  rejected: Array<{ label?: string; reason: string }>;
  stillPending: number;
}

/**
 * Replay everything pending, oldest first.
 *
 * A 4xx means the server refused this write on its merits — the paper is
 * locked, the marks are approved, the pupil moved class. Retrying will never
 * succeed, so it is dropped from the queue and reported. A network failure
 * leaves the entry alone to try again later.
 */
export async function replayAll(): Promise<ReplayResult> {
  const pending = await listPending();
  if (pending.length === 0) return { sent: 0, rejected: [], stillPending: 0 };

  let sent = 0;
  const rejected: Array<{ label?: string; reason: string }> = [];

  for (const item of pending) {
    try {
      await api.post(item.endpoint, item.payload);
      await idbDel(item.key);
      sent += 1;
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      if (status && status >= 400 && status < 500) {
        const reason =
          (err as { response?: { data?: { message?: string } } })?.response?.data?.message ??
          'The server would not accept this.';
        rejected.push({ label: item.label, reason: String(reason) });
        await idbDel(item.key);
      } else {
        // Still offline, or the server is down. Leave it queued and stop —
        // replaying the rest would just pile up the same failure.
        await idbPut({ ...item, attempts: item.attempts + 1, lastError: String(status ?? 'network') });
        break;
      }
    }
  }

  window.dispatchEvent(new CustomEvent('school-queue-changed'));
  const left = await listPending();
  return { sent, rejected, stillPending: left.length };
}

/* ── hook ─────────────────────────────────────────────────────────────────── */

/**
 * Watches connectivity and drains the queue when the server comes back.
 *
 * `online` reflects the API being reachable, which is what actually decides
 * whether a teacher's next keystroke saves.
 */
export function useSchoolOfflineQueue(onReplayed?: (r: ReplayResult) => void) {
  const [online, setOnline] = useState(true);
  const [pending, setPending] = useState<QueuedWrite[]>([]);
  const replaying = useRef(false);

  const refresh = useCallback(async () => {
    setPending(await listPending());
  }, []);

  const drain = useCallback(async () => {
    if (replaying.current) return;
    replaying.current = true;
    try {
      const result = await replayAll();
      await refresh();
      if (result.sent > 0 || result.rejected.length > 0) onReplayed?.(result);
    } finally {
      replaying.current = false;
    }
  }, [onReplayed, refresh]);

  useEffect(() => {
    let cancelled = false;

    const probe = async () => {
      const up = await checkServerOnline();
      if (cancelled) return;
      setOnline((was) => {
        // Only drain on the transition back up, not on every poll.
        if (!was && up) void drain();
        return up;
      });
    };

    void probe();
    void refresh();

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

  return { online, pending, replay: drain, refresh };
}
