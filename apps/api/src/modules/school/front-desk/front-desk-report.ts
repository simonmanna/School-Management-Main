/**
 * Front-desk report aggregation — pure functions, no database.
 *
 * All day/hour/week bucketing is done in the caller's local time: the client
 * sends `tzOffset` (Date#getTimezoneOffset, minutes, UTC − local) and every
 * timestamp is shifted by it before the UTC getters are read.
 */

export type ReportGroupBy = 'day' | 'week' | 'month';

export interface ReportVisitorRow {
  id: string;
  visitorName: string;
  phone: string | null;
  purpose: string | null;
  personVisited: string | null;
  status: string;
  checkInAt: Date;
  checkOutAt: Date | null;
}

export interface ReportCallRow {
  id: string;
  direction: string;
  contactName: string;
  phone: string;
  subject: string | null;
  outcome: string | null;
  durationSec: number | null;
  status: string;
  callAt: Date;
}

export interface ReportComplaintRow {
  id: string;
  category: string;
  subject: string;
  status: string;
  priority: string;
  assignedToId: string | null;
  receivedAt: Date;
  resolvedAt: Date | null;
}

export interface CountRow {
  key: string;
  count: number;
}

const DAY_MS = 86_400_000;
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const RESOLVED = new Set(['resolved', 'closed']);

/** A visitor still checked in this long after arrival is flagged as an overstay. */
export const OVERSTAY_HOURS = 4;
/** An unresolved complaint older than this many days counts as overdue. */
export const COMPLAINT_SLA_DAYS = 7;

/** Parse YYYY-MM-DD as local midnight, returned as a UTC instant. */
export function localDayStart(ymd: string, tzOffset: number): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return null;
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (Number.isNaN(ms)) return null;
  return new Date(ms + tzOffset * 60_000);
}

const toLocal = (d: Date, tzOffset: number) => new Date(d.getTime() - tzOffset * 60_000);
const ymd = (d: Date) => d.toISOString().slice(0, 10);

/** Bucket key for a local-shifted date. Weeks start on Monday. */
export function periodKey(local: Date, groupBy: ReportGroupBy): string {
  if (groupBy === 'month') return ymd(local).slice(0, 7);
  if (groupBy === 'week') {
    const back = (local.getUTCDay() + 6) % 7;
    return ymd(new Date(local.getTime() - back * DAY_MS));
  }
  return ymd(local);
}

/** Every bucket key between two local-shifted instants (from inclusive, to exclusive). */
export function periodKeys(fromLocal: Date, toLocalExcl: Date, groupBy: ReportGroupBy): string[] {
  const keys: string[] = [];
  const seen = new Set<string>();
  for (let t = fromLocal.getTime(); t < toLocalExcl.getTime() && keys.length < 2000; t += DAY_MS) {
    const k = periodKey(new Date(t), groupBy);
    if (!seen.has(k)) {
      seen.add(k);
      keys.push(k);
    }
  }
  return keys;
}

function countBy<T>(rows: T[], keyOf: (r: T) => string | null | undefined, limit?: number): CountRow[] {
  const map = new Map<string, number>();
  for (const r of rows) {
    const raw = keyOf(r);
    const k = raw && raw.trim() ? raw.trim() : 'Unspecified';
    map.set(k, (map.get(k) ?? 0) + 1);
  }
  const out = [...map.entries()].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
  return limit ? out.slice(0, limit) : out;
}

/** Case-insensitive grouping that keeps the first-seen spelling as the label. */
function countByLoose<T>(rows: T[], keyOf: (r: T) => string | null | undefined, limit?: number): CountRow[] {
  const label = new Map<string, string>();
  return countBy(rows, (r) => {
    const raw = keyOf(r)?.trim();
    if (!raw) return null;
    const norm = raw.toLowerCase().replace(/\s+/g, ' ');
    if (!label.has(norm)) label.set(norm, raw);
    return label.get(norm);
  }, limit);
}

const hours = () => Array.from({ length: 24 }, (_, hour) => ({ hour, count: 0 }));
const weekdays = () => WEEKDAYS.map((day) => ({ day, count: 0 }));
const round1 = (n: number) => Math.round(n * 10) / 10;
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};
const pct = (n: number, d: number) => (d ? round1((n / d) * 100) : 0);

export function summariseVisitors(rows: ReportVisitorRow[], tzOffset: number, now: Date) {
  const byHour = hours();
  const byWeekday = weekdays();
  const staysMin: number[] = [];
  const identity = new Map<string, number>();
  const overstays: { id: string; visitorName: string; personVisited: string | null; checkInAt: Date; hoursIn: number }[] = [];
  for (const v of rows) {
    const local = toLocal(v.checkInAt, tzOffset);
    byHour[local.getUTCHours()].count++;
    byWeekday[local.getUTCDay()].count++;
    if (v.checkOutAt) staysMin.push(Math.max(0, (v.checkOutAt.getTime() - v.checkInAt.getTime()) / 60_000));
    const id = (v.phone?.replace(/\D/g, '') || v.visitorName.trim().toLowerCase());
    identity.set(id, (identity.get(id) ?? 0) + 1);
    if (v.status === 'in' && !v.checkOutAt) {
      const hoursIn = (now.getTime() - v.checkInAt.getTime()) / 3_600_000;
      if (hoursIn >= OVERSTAY_HOURS) overstays.push({ id: v.id, visitorName: v.visitorName, personVisited: v.personVisited, checkInAt: v.checkInAt, hoursIn: round1(hoursIn) });
    }
  }
  const stayBuckets = [
    { key: '< 15 min', count: 0 },
    { key: '15–30 min', count: 0 },
    { key: '30–60 min', count: 0 },
    { key: '1–2 h', count: 0 },
    { key: '> 2 h', count: 0 },
  ];
  for (const m of staysMin) stayBuckets[m < 15 ? 0 : m < 30 ? 1 : m < 60 ? 2 : m < 120 ? 3 : 4].count++;
  const busiest = [...byHour].sort((a, b) => b.count - a.count)[0];
  return {
    total: rows.length,
    checkedOut: rows.filter((v) => v.status === 'out').length,
    stillIn: rows.filter((v) => v.status === 'in').length,
    expected: rows.filter((v) => v.status === 'expected').length,
    uniqueVisitors: identity.size,
    repeatVisitors: [...identity.values()].filter((n) => n > 1).length,
    avgStayMin: staysMin.length ? Math.round(avg(staysMin)!) : null,
    medianStayMin: staysMin.length ? Math.round(median(staysMin)!) : null,
    peakHour: busiest && busiest.count > 0 ? busiest.hour : null,
    byPurpose: countByLoose(rows, (v) => v.purpose, 12),
    byPersonVisited: countByLoose(rows, (v) => v.personVisited, 12),
    topVisitors: countByLoose(rows, (v) => v.visitorName, 10),
    byStatus: countBy(rows, (v) => v.status),
    byHour,
    byWeekday,
    stayBuckets,
    overstays: overstays.sort((a, b) => b.hoursIn - a.hoursIn).slice(0, 20),
  };
}

export function summariseCalls(rows: ReportCallRow[], tzOffset: number) {
  const byHour = hours().map((h) => ({ ...h, inbound: 0, outbound: 0, missed: 0 }));
  const byWeekday = weekdays();
  const durations: number[] = [];
  for (const c of rows) {
    const local = toLocal(c.callAt, tzOffset);
    const h = byHour[local.getUTCHours()];
    h.count++;
    if (c.direction === 'inbound') h.inbound++;
    else h.outbound++;
    if (c.status === 'missed') h.missed++;
    byWeekday[local.getUTCDay()].count++;
    if (c.status === 'completed' && c.durationSec != null && c.durationSec > 0) durations.push(c.durationSec);
  }
  const inbound = rows.filter((c) => c.direction === 'inbound');
  const missed = rows.filter((c) => c.status === 'missed');
  const missedInbound = inbound.filter((c) => c.status === 'missed').length;
  const busiest = [...byHour].sort((a, b) => b.count - a.count)[0];
  return {
    total: rows.length,
    inbound: inbound.length,
    outbound: rows.length - inbound.length,
    completed: rows.filter((c) => c.status === 'completed').length,
    missed: missed.length,
    voicemail: rows.filter((c) => c.status === 'voicemail').length,
    scheduled: rows.filter((c) => c.status === 'scheduled').length,
    /** Share of inbound calls nobody answered — the number a front desk is judged on. */
    missedInboundRate: pct(missedInbound, inbound.length),
    answerRate: pct(inbound.length - missedInbound, inbound.length),
    avgDurationSec: durations.length ? Math.round(avg(durations)!) : null,
    totalTalkSec: durations.reduce((a, b) => a + b, 0),
    peakHour: busiest && busiest.count > 0 ? busiest.hour : null,
    byStatus: countBy(rows, (c) => c.status),
    byDirection: countBy(rows, (c) => c.direction),
    bySubject: countByLoose(rows, (c) => c.subject, 12),
    byOutcome: countByLoose(rows, (c) => c.outcome, 10),
    topContacts: countByLoose(rows, (c) => c.contactName, 10),
    byHour,
    byWeekday,
  };
}

export function summariseComplaints(rows: ReportComplaintRow[], now: Date) {
  const resolutionH: number[] = [];
  const aging = [
    { key: '0–2 days', count: 0 },
    { key: '3–7 days', count: 0 },
    { key: '8–30 days', count: 0 },
    { key: '> 30 days', count: 0 },
  ];
  const catStats = new Map<string, { total: number; resolved: number; hours: number[] }>();
  const overdue: { id: string; subject: string; category: string; priority: string; status: string; receivedAt: Date; ageDays: number }[] = [];
  for (const c of rows) {
    const isResolved = RESOLVED.has(c.status);
    const cat = catStats.get(c.category) ?? { total: 0, resolved: 0, hours: [] };
    cat.total++;
    if (isResolved) {
      cat.resolved++;
      if (c.resolvedAt) {
        const h = Math.max(0, (c.resolvedAt.getTime() - c.receivedAt.getTime()) / 3_600_000);
        resolutionH.push(h);
        cat.hours.push(h);
      }
    } else {
      const ageDays = (now.getTime() - c.receivedAt.getTime()) / DAY_MS;
      aging[ageDays <= 2 ? 0 : ageDays <= 7 ? 1 : ageDays <= 30 ? 2 : 3].count++;
      if (ageDays > COMPLAINT_SLA_DAYS) overdue.push({ id: c.id, subject: c.subject, category: c.category, priority: c.priority, status: c.status, receivedAt: c.receivedAt, ageDays: Math.floor(ageDays) });
    }
    catStats.set(c.category, cat);
  }
  const resolved = rows.filter((c) => RESOLVED.has(c.status)).length;
  const prioRank: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3 };
  return {
    total: rows.length,
    open: rows.length - resolved,
    resolved,
    escalated: rows.filter((c) => c.status === 'escalated').length,
    urgentOpen: rows.filter((c) => !RESOLVED.has(c.status) && (c.priority === 'urgent' || c.priority === 'high')).length,
    unassignedOpen: rows.filter((c) => !RESOLVED.has(c.status) && !c.assignedToId).length,
    resolutionRate: pct(resolved, rows.length),
    avgResolutionHours: resolutionH.length ? round1(avg(resolutionH)!) : null,
    medianResolutionHours: resolutionH.length ? round1(median(resolutionH)!) : null,
    overdueCount: overdue.length,
    byCategory: countBy(rows, (c) => c.category),
    byStatus: countBy(rows, (c) => c.status),
    byPriority: countBy(rows, (c) => c.priority),
    aging,
    categoryPerformance: [...catStats.entries()]
      .map(([key, s]) => ({ key, total: s.total, resolved: s.resolved, resolutionRate: pct(s.resolved, s.total), avgResolutionHours: s.hours.length ? round1(avg(s.hours)!) : null }))
      .sort((a, b) => b.total - a.total),
    overdue: overdue.sort((a, b) => (prioRank[a.priority] ?? 9) - (prioRank[b.priority] ?? 9) || b.ageDays - a.ageDays).slice(0, 25),
  };
}

export function buildTrend(
  visitors: ReportVisitorRow[],
  calls: ReportCallRow[],
  complaints: ReportComplaintRow[],
  opts: { fromLocal: Date; toLocalExcl: Date; groupBy: ReportGroupBy; tzOffset: number },
) {
  const buckets = new Map(periodKeys(opts.fromLocal, opts.toLocalExcl, opts.groupBy).map((k) => [k, { period: k, visitors: 0, calls: 0, missedCalls: 0, complaints: 0, resolvedComplaints: 0 }]));
  const at = (d: Date) => buckets.get(periodKey(toLocal(d, opts.tzOffset), opts.groupBy));
  for (const v of visitors) { const b = at(v.checkInAt); if (b) b.visitors++; }
  for (const c of calls) {
    const b = at(c.callAt);
    if (b) { b.calls++; if (c.status === 'missed') b.missedCalls++; }
  }
  for (const c of complaints) {
    const b = at(c.receivedAt);
    if (b) { b.complaints++; if (RESOLVED.has(c.status)) b.resolvedComplaints++; }
  }
  return [...buckets.values()];
}
