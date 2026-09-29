/**
 * Owner-bound replay rules for the school offline queue (audit R02).
 *
 * Pure logic with no browser, API or store imports, so the rules that decide
 * whose work is sent — and what happens when the server says no — are tested
 * directly. `offline-queue.ts` wires this to IndexedDB, the API client and the
 * signed-in session.
 *
 * The rules:
 *  - Every entry records the school and the staff member who entered it. Only
 *    that same person, signed in to that same school, can see or send it. On a
 *    shared staff-room laptop, A's register is never posted under B's login.
 *  - Signing out does not erase anything. The work waits for its author.
 *  - 401/403 is "not now, not as this session" — the entry stays, marked
 *    blocked, for its author to retry. It is never silently dropped.
 *  - Any other 4xx is a real refusal (paper locked, pupil moved class). The
 *    entry is kept as `rejected` with the server's reason until the author
 *    discards it, so the teacher sees what did not save instead of it vanishing.
 *  - 5xx / no response leaves the entry pending and stops the run.
 */

export type QueuedKind = 'attendance' | 'mark';

/**
 * pending      — waiting to be sent
 * auth-blocked — the server refused the session (401/403); retry after signing in again
 * rejected     — the server refused the content; kept until the author discards it
 * orphaned     — saved by an older version that did not record its author; nobody can send it
 */
export type QueuedState = 'pending' | 'auth-blocked' | 'rejected' | 'orphaned';

export interface QueueOwner {
  organizationId: string;
  userId: string;
}

export interface QueuedWrite {
  /** Storage key: owner + `key`, so two staff never overwrite each other's entry. */
  id: string;
  /**
   * Identity of the thing being written — pupil + paper, or class + date +
   * period. A second edit of the same cell by the same person replaces the first.
   */
  key: string;
  kind: QueuedKind;
  endpoint: string;
  payload: unknown;
  organizationId: string | null;
  userId: string | null;
  state: QueuedState;
  createdAt: number;
  attempts: number;
  lastError?: string;
  /** Replay follows this, not storage order. */
  seq: number;
  /** Human label for the pending list — "P4 West · Mathematics". */
  label?: string;
}

export interface QueueStore {
  put(value: QueuedWrite): Promise<void>;
  all(): Promise<QueuedWrite[]>;
  del(id: string): Promise<void>;
}

export type NewQueuedWrite = Pick<QueuedWrite, 'key' | 'kind' | 'endpoint' | 'payload' | 'label'>;

export interface ReplayResult {
  sent: number;
  rejected: Array<{ label?: string; reason: string }>;
  authBlocked: number;
  stillPending: number;
}

export function entryId(owner: QueueOwner, key: string): string {
  return `${owner.organizationId}:${owner.userId}:${key}`;
}

export function ownedBy(item: QueuedWrite, owner: QueueOwner | null | undefined): boolean {
  return (
    !!owner &&
    item.state !== 'orphaned' &&
    item.organizationId === owner.organizationId &&
    item.userId === owner.userId
  );
}

export function makeEntry(owner: QueueOwner, entry: NewQueuedWrite, seq: number, now = Date.now()): QueuedWrite {
  if (!owner?.organizationId || !owner?.userId) {
    throw new Error('Cannot save work on this device without a signed-in school account.');
  }
  return {
    ...entry,
    id: entryId(owner, entry.key),
    organizationId: owner.organizationId,
    userId: owner.userId,
    state: 'pending',
    createdAt: now,
    attempts: 0,
    seq,
  };
}

/** The signed-in person's own entries, oldest first. Never anyone else's. */
export async function listOwn(store: QueueStore, owner: QueueOwner | null | undefined): Promise<QueuedWrite[]> {
  const all = await store.all();
  return all.filter((i) => ownedBy(i, owner)).sort((a, b) => a.seq - b.seq);
}

/** How many entries on this device belong to someone else — a count only, no content. */
export async function countOthers(store: QueueStore, owner: QueueOwner | null | undefined): Promise<number> {
  const all = await store.all();
  return all.filter((i) => !ownedBy(i, owner)).length;
}

type Poster = (endpoint: string, payload: unknown) => Promise<unknown>;

function errorStatus(err: unknown): number | undefined {
  return (err as { response?: { status?: number } })?.response?.status;
}

function errorReason(err: unknown): string {
  const msg = (err as { response?: { data?: { message?: unknown } } })?.response?.data?.message;
  if (Array.isArray(msg)) return msg.join('; ');
  return msg ? String(msg) : 'The server would not accept this.';
}

/**
 * Send the owner's pending (and previously auth-blocked) entries, oldest first.
 * Entries belonging to anyone else are not read, sent or changed.
 */
export async function replayOwn(store: QueueStore, owner: QueueOwner | null | undefined, post: Poster): Promise<ReplayResult> {
  const result: ReplayResult = { sent: 0, rejected: [], authBlocked: 0, stillPending: 0 };
  if (!owner) return result;
  const mine = (await listOwn(store, owner)).filter((i) => i.state === 'pending' || i.state === 'auth-blocked');

  for (let idx = 0; idx < mine.length; idx++) {
    const item = mine[idx];
    try {
      await post(item.endpoint, item.payload);
      await store.del(item.id);
      result.sent += 1;
    } catch (err) {
      const status = errorStatus(err);
      if (status === 401 || status === 403 || status === 419) {
        // The session is not allowed to send this. Keep every remaining entry
        // for the author and stop: the next one will fail the same way.
        for (const rest of mine.slice(idx)) {
          await store.put({ ...rest, state: 'auth-blocked', lastError: rest === item ? errorReason(err) : rest.lastError });
        }
        result.authBlocked = mine.length - idx;
        break;
      }
      if (status && status >= 400 && status < 500) {
        const reason = errorReason(err);
        await store.put({ ...item, state: 'rejected', attempts: item.attempts + 1, lastError: reason });
        result.rejected.push({ label: item.label, reason });
        continue;
      }
      // No server, or the server is failing. Leave it and stop.
      await store.put({ ...item, attempts: item.attempts + 1, lastError: String(status ?? 'network') });
      break;
    }
  }
  result.stillPending = (await listOwn(store, owner)).filter((i) => i.state !== 'rejected').length;
  return result;
}

/** Author-only: put a rejected/blocked entry back in line. */
export async function retryOwn(store: QueueStore, owner: QueueOwner | null | undefined, id: string): Promise<boolean> {
  const item = (await listOwn(store, owner)).find((i) => i.id === id);
  if (!item) return false;
  await store.put({ ...item, state: 'pending', lastError: undefined });
  return true;
}

/** Author-only: deliberately throw an entry away. */
export async function discardOwn(store: QueueStore, owner: QueueOwner | null | undefined, id: string): Promise<boolean> {
  const item = (await listOwn(store, owner)).find((i) => i.id === id);
  if (!item) return false;
  await store.del(item.id);
  return true;
}

/**
 * Entries written by the pre-R02 queue carry no author. They cannot be sent
 * safely by anyone, so any signed-in user may remove them — without seeing them.
 */
export async function discardOrphaned(store: QueueStore): Promise<number> {
  const orphans = (await store.all()).filter((i) => i.state === 'orphaned');
  for (const o of orphans) await store.del(o.id);
  return orphans.length;
}

/** Shape a pre-R02 row (keyed by `key`, no owner) as an orphan. */
export function toOrphan(legacy: Record<string, unknown>, seq: number): QueuedWrite {
  const key = String(legacy.key ?? `legacy-${seq}`);
  return {
    id: `orphan:${key}`,
    key,
    kind: (legacy.kind as QueuedKind) ?? 'attendance',
    endpoint: String(legacy.endpoint ?? ''),
    payload: legacy.payload,
    organizationId: null,
    userId: null,
    state: 'orphaned',
    createdAt: Number(legacy.createdAt ?? Date.now()),
    attempts: Number(legacy.attempts ?? 0),
    lastError: legacy.lastError as string | undefined,
    seq: Number(legacy.seq ?? seq),
    label: legacy.label as string | undefined,
  };
}
