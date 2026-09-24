import { useCallback, useRef } from 'react';

/**
 * One idempotency key per payment ATTEMPT (E2E audit F9).
 *
 * A retry of the same payment (network drop, double click) must carry the SAME
 * `Idempotency-Key` so the server replays the first receipt instead of taking
 * the money twice; a genuinely new payment needs a new key. The key is tied to
 * the request body: same body → same key until the attempt succeeds and
 * `reset()` is called; a different body starts a new attempt.
 */
export function useAttemptKey(prefix: string) {
  const ref = useRef<{ sig: string; key: string } | null>(null);
  const keyFor = useCallback(
    (body: unknown) => {
      const sig = JSON.stringify(body);
      if (!ref.current || ref.current.sig !== sig) {
        ref.current = { sig, key: `${prefix}-${crypto.randomUUID()}` };
      }
      return ref.current.key;
    },
    [prefix],
  );
  const reset = useCallback(() => {
    ref.current = null;
  }, []);
  return { keyFor, reset };
}
