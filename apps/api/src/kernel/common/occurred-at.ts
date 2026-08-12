import { BadRequestException } from '@nestjs/common';

/** Max age of an offline-captured business timestamp. Anything older is more
 *  likely a device clock fault than a real week-old queued sale. */
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
/** Small allowance for device clocks running slightly ahead of the server. */
const FUTURE_SKEW_MS = 5 * 60 * 1000;

/**
 * Offline-first (P0): clients stamp `occurredAt` when a sale/cash op happens
 * so a replay hours or days later still lands on the correct business date
 * (Invoice.issueDate → GL/journal date, payment date, Z-report bucket).
 *
 * Returns undefined when the client sent nothing — callers fall back to
 * `new Date()` exactly as before, so online behaviour is unchanged.
 */
export function resolveOccurredAt(value?: string | Date | null): Date | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new BadRequestException('occurredAt is not a valid ISO-8601 timestamp');
  }
  const now = Date.now();
  if (date.getTime() > now + FUTURE_SKEW_MS) {
    throw new BadRequestException('occurredAt is in the future — check the device clock');
  }
  if (date.getTime() < now - MAX_AGE_MS) {
    throw new BadRequestException('occurredAt is more than 7 days old — check the device clock');
  }
  return date;
}
