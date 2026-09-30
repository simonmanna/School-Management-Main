import { BadRequestException } from '@nestjs/common';
import { safeTimeZone, zonedMidnight } from './school-time';

/* eslint-disable @typescript-eslint/no-explicit-any */

const DAY_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Report date bounds in the organization's own time zone (wave 18).
 *
 * `new Date('2026-01-31')` is midnight UTC, so an inclusive `lte` on it dropped
 * almost every posting made on the last day of the range, and a school in
 * Kampala (UTC+3) saw its day start at 03:00. A calendar-day `from` now means
 * local midnight and a calendar-day `to` the last millisecond of that local
 * day — the same bounds fiscal periods use. A full timestamp is taken as-is.
 */
export function reportStart(value: string | Date | null | undefined, timeZone: string): Date | undefined {
  return bound(value, timeZone, 'start');
}

export function reportEnd(value: string | Date | null | undefined, timeZone: string): Date | undefined {
  return bound(value, timeZone, 'end');
}

function bound(value: string | Date | null | undefined, timeZone: string, edge: 'start' | 'end'): Date | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  if (value instanceof Date) return value;
  const s = String(value).trim();
  const m = DAY_ONLY.exec(s);
  if (!m) {
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) throw new BadRequestException(`Invalid date: ${s}`);
    return d;
  }
  const tz = safeTimeZone(timeZone);
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (edge === 'start') return zonedMidnight(y, mo, d, tz);
  const next = new Date(Date.UTC(y, mo - 1, d + 1));
  return new Date(zonedMidnight(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), tz).getTime() - 1);
}

/** The current organization's time zone (Kampala when unset or invalid). */
export async function orgTimeZone(client: any, organizationId: string | undefined): Promise<string> {
  if (!organizationId) return safeTimeZone(undefined);
  const org = await client.organization
    .findUnique({ where: { id: organizationId }, select: { timezone: true } })
    .catch(() => null);
  return safeTimeZone(org?.timezone);
}
