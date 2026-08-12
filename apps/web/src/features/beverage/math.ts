import type { Product } from '@/features/products/api';

/** Client-side mirror of the server beverage math — for live display only; the
 *  server always recomputes authoritatively on save/submit. */
export interface BevConfig {
  productId: string;
  conversionFactorMlPerG: number;
  effectiveEmptyWeightG: number;
  containerVolumeMl: number;
  fullBottleWeightG: number;
  standardPourMl: number;
  toleranceG: number;
}

export function bevConfigFromProduct(p: Product, orgToleranceG = 5): BevConfig {
  const n = (v: unknown) => Number(v ?? 0);
  return {
    productId: p.id,
    conversionFactorMlPerG: n(p.conversionFactorMlPerG),
    effectiveEmptyWeightG: n(p.actualEmptyWeightG ?? p.emptyBottleWeightG),
    containerVolumeMl: n(p.containerVolumeMl),
    fullBottleWeightG: n(p.fullBottleWeightG),
    standardPourMl: n(p.standardPourMl),
    toleranceG: n(p.varianceToleranceG) || orgToleranceG,
  };
}

export function remainingMl(measuredWeightG: number, cfg: BevConfig): number {
  const liquid = measuredWeightG - cfg.effectiveEmptyWeightG;
  return cfg.conversionFactorMlPerG > 0 ? Math.max(0, liquid) * cfg.conversionFactorMlPerG : 0;
}

export function isOutOfRange(measuredWeightG: number, cfg: BevConfig): boolean {
  if (measuredWeightG < cfg.effectiveEmptyWeightG) return true;
  if (cfg.fullBottleWeightG > 0 && measuredWeightG > cfg.fullBottleWeightG + 0.5) return true;
  return false;
}

export type Confidence = 'GOOD' | 'SUSPICIOUS' | 'OUT_OF_RANGE';

export function confidenceFor(varianceG: number, cfg: BevConfig, anyOutOfRange: boolean): Confidence {
  if (anyOutOfRange) return 'OUT_OF_RANGE';
  return Math.abs(varianceG) <= Math.max(0, cfg.toleranceG) ? 'GOOD' : 'SUSPICIOUS';
}

/** Compute a line's counted ml + variance from sealed count + open-bottle grams. */
export function computeLine(
  cfg: BevConfig | undefined,
  sealedFullCount: number,
  grams: number[],
  systemMl: number,
) {
  if (!cfg) {
    return { countedMl: null as number | null, varianceMl: 0, varianceG: 0, confidence: 'GOOD' as Confidence, remainings: [] as number[] };
  }
  let anyOut = false;
  const remainings = grams.map((g) => {
    if (isOutOfRange(g, cfg)) anyOut = true;
    return remainingMl(g, cfg);
  });
  const counted = sealedFullCount > 0 || grams.length > 0;
  const countedMl = counted ? sealedFullCount * cfg.containerVolumeMl + remainings.reduce((s, r) => s + r, 0) : null;
  const varianceMl = countedMl === null ? 0 : countedMl - systemMl;
  const varianceG = cfg.conversionFactorMlPerG > 0 ? varianceMl / cfg.conversionFactorMlPerG : 0;
  return { countedMl, varianceMl, varianceG, confidence: confidenceFor(varianceG, cfg, anyOut), remainings };
}
