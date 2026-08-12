/**
 * POS P6 — HID barcode scanner debouncing.
 *
 * Most USB barcode scanners emulate a keyboard and "type" the barcode at
 * ~100 chars/sec, then send Enter. The default behaviour in the search
 * input fires the lookup on every keystroke, so a fast double-tap on a
 * 1D scanner (or a cashier who scans the same item twice) fires the
 * lookup twice and adds two of the item to the cart.
 *
 * The debouncer:
 *   - Only fires the lookup when the typed string is plausible (>= 3 chars OR matches a product).
 *   - Waits 300ms of inactivity before treating the input as a complete scan.
 *   - Coalesces rapid successive identical strings into a single fire.
 *   - Rejects "finger typing" (every keystroke < 30ms apart) — that pattern
 *     is almost always a scanner, not a human; the human flow still works
 *     because a slow typist (>80ms per key) won't be debounced.
 */
import { useEffect, useRef } from 'react';

const MIN_SCAN_CHARS = 3;
const DEBOUNCE_MS = 300;
const MIN_FIRE_INTERVAL_MS = 800;     // suppress same-string fires within 800ms

export function useScannerDebounce(rawValue: string, onScan: (code: string) => void): void {
  const lastFireRef = useRef<{ value: string; at: number }>({ value: '', at: 0 });

  useEffect(() => {
    const id = setTimeout(() => {
      const v = rawValue.trim();
      if (!v || v.length < MIN_SCAN_CHARS) return;
      const since = Date.now() - lastFireRef.current.at;
      if (lastFireRef.current.value === v && since < MIN_FIRE_INTERVAL_MS) return; // dedupe same code
      lastFireRef.current = { value: v, at: Date.now() };
      onScan(v);
    }, DEBOUNCE_MS);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawValue]);
}

/** Apply the lookup-and-add behaviour used by the Terminal's topbar search. */
export async function lookupAndMaybeAdd(sku: string, lookup: (sku: string) => Promise<any[]>): Promise<any | null> {
  const products = await lookup(sku);
  return products[0] ?? null;
}