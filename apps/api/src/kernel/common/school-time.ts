/**
 * Calendar arithmetic in the school's own time zone.
 *
 * The API server runs in UTC. `new Date().setHours(0,0,0,0)` is UTC midnight,
 * which in Kampala (UTC+3) is 03:00 — so "today" and "this month" on the
 * dashboards started three hours late and a payment taken at 01:00 on the 1st
 * landed in the previous month (re-audit #11).
 */

/** The calendar date (year, month 1-12, day) at `at` in `timeZone`. */
export function zonedDate(at: Date, timeZone: string): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return { year: get('year'), month: get('month'), day: get('day') };
}

/** Milliseconds `timeZone` is ahead of UTC at `at`. */
function offsetMs(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const local = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return local - Math.floor(at.getTime() / 1000) * 1000;
}

/** The instant local midnight of (year, month, day) begins in `timeZone`. */
export function zonedMidnight(year: number, month: number, day: number, timeZone: string): Date {
  const guess = Date.UTC(year, month - 1, day);
  return new Date(guess - offsetMs(new Date(guess), timeZone));
}

/** Start of the current local day and month, as instants. */
export function zonedPeriodStarts(timeZone: string, now: Date = new Date()): { dayStart: Date; monthStart: Date } {
  const { year, month, day } = zonedDate(now, timeZone);
  return { dayStart: zonedMidnight(year, month, day, timeZone), monthStart: zonedMidnight(year, month, 1, timeZone) };
}

/** A timezone string that Intl accepts, falling back to Kampala. */
export function safeTimeZone(tz: string | null | undefined): string {
  if (!tz) return 'Africa/Kampala';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return tz;
  } catch {
    return 'Africa/Kampala';
  }
}
