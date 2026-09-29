/**
 * Audit R02 / D02 — offline work belongs to the school and person who typed it.
 * Run: pnpm --filter @erp/api test -- web-offline-queue
 */
// Frontend rule tested in the API unit project: pure logic, no browser needed.
import {
  countOthers,
  discardOwn,
  listOwn,
  makeEntry,
  replayOwn,
  retryOwn,
  toOrphan,
  type QueueOwner,
  type QueueStore,
  type QueuedWrite,
} from '../../../web/src/features/school/offline-queue-core';

function memoryStore(): QueueStore & { rows: Map<string, QueuedWrite> } {
  const rows = new Map<string, QueuedWrite>();
  return {
    rows,
    async put(v) { rows.set(v.id, structuredClone(v)); },
    async all() { return [...rows.values()].map((r) => structuredClone(r)); },
    async del(id) { rows.delete(id); },
  };
}

const A: QueueOwner = { organizationId: 'school-1', userId: 'teacher-a' };
const B: QueueOwner = { organizationId: 'school-1', userId: 'teacher-b' };
const OTHER_SCHOOL_A: QueueOwner = { organizationId: 'school-2', userId: 'teacher-a' };

const register = (key = 'attendance:p4:2026-09-29:daily') => ({
  key, kind: 'attendance' as const, endpoint: '/school/attendance/mark', payload: { classId: 'p4' }, label: 'Register',
});

function httpError(status: number, message = 'refused') {
  return Object.assign(new Error(message), { response: { status, data: { message } } });
}

describe('offline queue ownership (R02)', () => {
  it('refuses to save work without a signed-in owner', () => {
    expect(() => makeEntry(null as any, register(), 1)).toThrow();
  });

  it("never lists or sends A's entry while B is signed in", async () => {
    const store = memoryStore();
    await store.put(makeEntry(A, register(), 1));
    const posted: unknown[] = [];

    expect(await listOwn(store, B)).toHaveLength(0);
    expect(await countOthers(store, B)).toBe(1);
    const r = await replayOwn(store, B, async (_e, p) => { posted.push(p); });
    expect(r.sent).toBe(0);
    expect(posted).toHaveLength(0);
    expect(store.rows.size).toBe(1);
  });

  it('does not send the same person’s work into a different school', async () => {
    const store = memoryStore();
    await store.put(makeEntry(A, register(), 1));
    const posted: unknown[] = [];
    await replayOwn(store, OTHER_SCHOOL_A, async (_e, p) => { posted.push(p); });
    expect(posted).toHaveLength(0);
    expect(store.rows.size).toBe(1);
  });

  it('A resumes and it is sent exactly once', async () => {
    const store = memoryStore();
    await store.put(makeEntry(A, register(), 1));
    let calls = 0;
    const post = async () => { calls++; };
    expect((await replayOwn(store, A, post)).sent).toBe(1);
    expect((await replayOwn(store, A, post)).sent).toBe(0);
    expect(calls).toBe(1);
    expect(store.rows.size).toBe(0);
  });

  it('two people editing the same register on one device do not overwrite each other', async () => {
    const store = memoryStore();
    await store.put(makeEntry(A, register(), 1));
    await store.put(makeEntry(B, register(), 2));
    expect(store.rows.size).toBe(2);
  });

  it('a later edit by the same person replaces their earlier pending one', async () => {
    const store = memoryStore();
    await store.put(makeEntry(A, { ...register(), payload: { v: 1 } }, 1));
    await store.put(makeEntry(A, { ...register(), payload: { v: 2 } }, 2));
    const own = await listOwn(store, A);
    expect(own).toHaveLength(1);
    expect(own[0].payload).toEqual({ v: 2 });
  });

  it('401/403 keeps the work (auth-blocked) instead of deleting it', async () => {
    for (const status of [401, 403]) {
      const store = memoryStore();
      await store.put(makeEntry(A, register('k1'), 1));
      await store.put(makeEntry(A, register('k2'), 2));
      const r = await replayOwn(store, A, async () => { throw httpError(status); });
      expect(r.authBlocked).toBe(2);
      const own = await listOwn(store, A);
      expect(own.map((o) => o.state)).toEqual(['auth-blocked', 'auth-blocked']);
    }
  });

  it('auth-blocked work is sent on the next replay once the session is good', async () => {
    const store = memoryStore();
    await store.put(makeEntry(A, register(), 1));
    await replayOwn(store, A, async () => { throw httpError(403); });
    const r = await replayOwn(store, A, async () => undefined);
    expect(r.sent).toBe(1);
    expect(store.rows.size).toBe(0);
  });

  it('a business refusal is kept as rejected with the reason, and the rest still go', async () => {
    const store = memoryStore();
    await store.put(makeEntry(A, { ...register('locked'), payload: { k: 'locked' } }, 1));
    await store.put(makeEntry(A, { ...register('ok'), payload: { k: 'ok' } }, 2));
    const r = await replayOwn(store, A, async (_e, p) => {
      if ((p as { k: string }).k === 'locked') throw httpError(422, 'The paper is locked.');
    });
    expect(r.sent).toBe(1);
    expect(r.rejected).toEqual([{ label: 'Register', reason: 'The paper is locked.' }]);
    const own = await listOwn(store, A);
    expect(own).toHaveLength(1);
    expect(own[0]).toMatchObject({ key: 'locked', state: 'rejected', lastError: 'The paper is locked.' });
    // rejected entries are not retried automatically
    let calls = 0;
    await replayOwn(store, A, async () => { calls++; });
    expect(calls).toBe(0);
  });

  it('network failure leaves the entry pending and stops', async () => {
    const store = memoryStore();
    await store.put(makeEntry(A, register('k1'), 1));
    await store.put(makeEntry(A, register('k2'), 2));
    let calls = 0;
    const r = await replayOwn(store, A, async () => { calls++; throw new Error('Network Error'); });
    expect(calls).toBe(1);
    expect(r.stillPending).toBe(2);
    expect((await listOwn(store, A))[0].attempts).toBe(1);
  });

  it('only the author can retry or discard', async () => {
    const store = memoryStore();
    const entry = makeEntry(A, register(), 1);
    await store.put({ ...entry, state: 'rejected' });
    expect(await discardOwn(store, B, entry.id)).toBe(false);
    expect(await retryOwn(store, B, entry.id)).toBe(false);
    expect(store.rows.size).toBe(1);
    expect(await retryOwn(store, A, entry.id)).toBe(true);
    expect((await listOwn(store, A))[0].state).toBe('pending');
    expect(await discardOwn(store, A, entry.id)).toBe(true);
    expect(store.rows.size).toBe(0);
  });

  it('pre-R02 entries without an author are never sent by anyone', async () => {
    const store = memoryStore();
    await store.put(toOrphan({ key: 'old', endpoint: '/school/attendance/mark', payload: {} }, 0));
    let calls = 0;
    await replayOwn(store, A, async () => { calls++; });
    expect(calls).toBe(0);
    expect(await listOwn(store, A)).toHaveLength(0);
  });
});

