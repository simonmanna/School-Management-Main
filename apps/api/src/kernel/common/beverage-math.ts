import { BadRequestException } from '@nestjs/common';
import type { BottleConfidence } from '@erp/shared';

/**
 * Beverage Control — pure weight↔volume math (single source of truth).
 *
 * Shared by Product setup (compute + validate the stored conversion factor) and
 * the bottle-count service (convert a weighed gram value → remaining ml). No Nest
 * DI, no DB — just numbers, so it is trivially unit-testable.
 */

export interface BottleInput {
  containerVolumeMl?: number | string | null;
  emptyBottleWeightG?: number | string | null;
  /** Optional measured tare override; used instead of the nominal empty weight. */
  actualEmptyWeightG?: number | string | null;
  fullBottleWeightG?: number | string | null;
}

export interface BottleConfig {
  effectiveEmptyWeightG: number;
  liquidWeightG: number;
  conversionFactorMlPerG: number;
}

/**
 * Validate the bottle weights/volume and compute the derived fields stored on the
 * product. Throws BadRequestException on any physically-invalid relationship.
 */
export function computeBottleConfig(input: BottleInput): BottleConfig {
  const volume = num(input.containerVolumeMl);
  const empty = num(input.actualEmptyWeightG ?? input.emptyBottleWeightG);
  const full = num(input.fullBottleWeightG);
  if (volume === null || empty === null || full === null) {
    throw new BadRequestException(
      'Digital-weight products require container volume, empty bottle weight, and full bottle weight.',
    );
  }
  if (volume <= 0) throw new BadRequestException('Container volume (ml) must be greater than 0.');
  if (empty >= full) {
    throw new BadRequestException('Empty bottle weight must be less than full bottle weight.');
  }
  const liquidWeightG = round(full - empty, 6);
  if (liquidWeightG <= 0) throw new BadRequestException('Liquid weight must be greater than 0.');
  const conversionFactorMlPerG = round(volume / liquidWeightG, 10);
  if (conversionFactorMlPerG <= 0) {
    throw new BadRequestException('Conversion factor must be greater than 0.');
  }
  return { effectiveEmptyWeightG: empty, liquidWeightG, conversionFactorMlPerG };
}

/** Remaining liquid volume (ml) for a measured gross bottle weight (grams). */
export function remainingMlFromWeight(
  measuredWeightG: number,
  effectiveEmptyWeightG: number,
  conversionFactorMlPerG: number,
): number {
  const liquidNowG = measuredWeightG - effectiveEmptyWeightG;
  return round(Math.max(0, liquidNowG) * conversionFactorMlPerG, 6);
}

/** Convert a remaining volume (ml) back to an expected gross bottle weight (g). */
export function weightFromRemainingMl(
  remainingMl: number,
  effectiveEmptyWeightG: number,
  conversionFactorMlPerG: number,
): number {
  if (conversionFactorMlPerG <= 0) return effectiveEmptyWeightG;
  return round(effectiveEmptyWeightG + remainingMl / conversionFactorMlPerG, 6);
}

export interface ReadingCheck {
  outOfRange: boolean;
  reason?: string;
}

/**
 * Physical sanity of a single reading: below tare or above the full bottle weight
 * is impossible (glass/liquid can't weigh less than empty or more than full).
 */
export function checkReading(
  measuredWeightG: number,
  effectiveEmptyWeightG: number,
  fullBottleWeightG: number,
): ReadingCheck {
  if (measuredWeightG < effectiveEmptyWeightG) {
    return { outOfRange: true, reason: 'Weight is below the empty bottle weight (below tare).' };
  }
  if (fullBottleWeightG > 0 && measuredWeightG > fullBottleWeightG + 0.5) {
    return { outOfRange: true, reason: 'Weight exceeds the full bottle weight.' };
  }
  return { outOfRange: false };
}

/**
 * Classify a line/reading variance: OUT_OF_RANGE when physically impossible, else
 * GOOD within tolerance / SUSPICIOUS beyond it (grams).
 */
export function classifyConfidence(
  varianceG: number,
  toleranceG: number,
  outOfRange = false,
): BottleConfidence {
  if (outOfRange) return 'OUT_OF_RANGE';
  const t = Math.max(0, toleranceG);
  return Math.abs(varianceG) <= t ? 'GOOD' : 'SUSPICIOUS';
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function round(n: number, dp: number): number {
  const f = Math.pow(10, dp);
  return Math.round(n * f) / f;
}
