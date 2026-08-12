import { useCallback, useState } from 'react';

/**
 * Scale abstraction. Manual entry today; Bluetooth (Web Bluetooth) and USB/serial
 * (Web Serial / WebHID) adapters can be added here without touching the count
 * screen — the UI just calls `readWeight()` and stamps the reading's source.
 */
export type ScaleSource = 'MANUAL' | 'BLUETOOTH' | 'USB';

export interface ScaleHook {
  supported: boolean;
  source: ScaleSource;
  reading: number | null;
  readWeight: () => Promise<number | null>;
}

export function useScale(): ScaleHook {
  const [reading] = useState<number | null>(null);

  // No live scale wired yet — returns null so the UI falls back to manual entry.
  const readWeight = useCallback(async (): Promise<number | null> => null, []);

  return { supported: false, source: 'MANUAL', reading, readWeight };
}
