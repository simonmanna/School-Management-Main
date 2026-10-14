import {
  buildTrend, localDayStart, periodKey, periodKeys, summariseCalls, summariseComplaints, summariseVisitors,
  type ReportCallRow, type ReportComplaintRow, type ReportVisitorRow,
} from '../../src/modules/school/front-desk/front-desk-report';

/** Front-desk report aggregation — pure functions, no database. */
const NOW = new Date('2026-10-14T12:00:00Z');
// UTC+3 (East Africa): getTimezoneOffset() = -180.
const EAT = -180;

const visitor = (o: Partial<ReportVisitorRow>): ReportVisitorRow => ({
  id: Math.random().toString(36), visitorName: 'Guest', phone: null, purpose: null, personVisited: null,
  status: 'out', checkInAt: new Date('2026-10-13T06:00:00Z'), checkOutAt: null, ...o,
});
const call = (o: Partial<ReportCallRow>): ReportCallRow => ({
  id: Math.random().toString(36), direction: 'inbound', contactName: 'Parent', phone: '0700', subject: null,
  outcome: null, durationSec: null, status: 'completed', callAt: new Date('2026-10-13T06:00:00Z'), ...o,
});
const complaint = (o: Partial<ReportComplaintRow>): ReportComplaintRow => ({
  id: Math.random().toString(36), category: 'fees', subject: 'x', status: 'open', priority: 'medium',
  assignedToId: null, receivedAt: new Date('2026-10-13T06:00:00Z'), resolvedAt: null, ...o,
});

describe('date bucketing', () => {
  it('parses a local day start into the right UTC instant', () => {
    expect(localDayStart('2026-10-14', EAT)?.toISOString()).toBe('2026-10-13T21:00:00.000Z');
    expect(localDayStart('14/10/2026', EAT)).toBeNull();
  });

  it('starts weeks on Monday and fills every period', () => {
    expect(periodKey(new Date('2026-10-18T10:00:00Z'), 'week')).toBe('2026-10-12'); // Sunday → Monday before
    expect(periodKey(new Date('2026-10-18T10:00:00Z'), 'month')).toBe('2026-10');
    const keys = periodKeys(new Date('2026-10-01T00:00:00Z'), new Date('2026-10-08T00:00:00Z'), 'day');
    expect(keys).toHaveLength(7);
    expect(keys[0]).toBe('2026-10-01');
  });

  it('buckets by local time, not UTC', () => {
    // 22:30 UTC on the 13th is 01:30 on the 14th in UTC+3.
    const late = call({ callAt: new Date('2026-10-13T22:30:00Z') });
    const trend = buildTrend([], [late], [], {
      fromLocal: new Date('2026-10-13T00:00:00Z'), toLocalExcl: new Date('2026-10-15T00:00:00Z'), groupBy: 'day', tzOffset: EAT,
    });
    expect(trend).toEqual([
      expect.objectContaining({ period: '2026-10-13', calls: 0 }),
      expect.objectContaining({ period: '2026-10-14', calls: 1 }),
    ]);
    expect(summariseCalls([late], EAT).byHour[1].count).toBe(1);
  });
});

describe('summariseVisitors', () => {
  it('computes stay time, repeat visitors, purposes and overstays', () => {
    const rows = [
      visitor({ visitorName: 'Ann', phone: '+256 700 111', purpose: 'Fees', checkInAt: new Date('2026-10-13T06:00:00Z'), checkOutAt: new Date('2026-10-13T06:20:00Z') }),
      visitor({ visitorName: 'ann', phone: '256700111', purpose: 'fees', checkInAt: new Date('2026-10-13T07:00:00Z'), checkOutAt: new Date('2026-10-13T08:00:00Z') }),
      visitor({ visitorName: 'Bob', status: 'in', purpose: 'Delivery', checkInAt: new Date('2026-10-14T06:00:00Z') }),
    ];
    const s = summariseVisitors(rows, 0, NOW);
    expect(s.total).toBe(3);
    expect(s.stillIn).toBe(1);
    expect(s.uniqueVisitors).toBe(2);
    expect(s.repeatVisitors).toBe(1);
    expect(s.avgStayMin).toBe(40);
    expect(s.byPurpose[0]).toEqual({ key: 'Fees', count: 2 });
    expect(s.overstays).toHaveLength(1);
    expect(s.overstays[0].hoursIn).toBe(6);
  });
});

describe('summariseCalls', () => {
  it('reports missed-inbound rate and talk time from completed calls only', () => {
    const rows = [
      call({ durationSec: 120 }),
      call({ durationSec: 60 }),
      call({ status: 'missed' }),
      call({ direction: 'outbound', status: 'missed' }),
      call({ direction: 'outbound', status: 'voicemail', durationSec: 30 }),
    ];
    const s = summariseCalls(rows, 0);
    expect(s.inbound).toBe(3);
    expect(s.outbound).toBe(2);
    expect(s.missed).toBe(2);
    expect(s.missedInboundRate).toBe(33.3);
    expect(s.avgDurationSec).toBe(90);
    expect(s.totalTalkSec).toBe(180);
  });
});

describe('summariseComplaints', () => {
  it('computes resolution time, aging and overdue (urgent first)', () => {
    const rows = [
      complaint({ status: 'resolved', receivedAt: new Date('2026-10-10T00:00:00Z'), resolvedAt: new Date('2026-10-11T00:00:00Z') }),
      complaint({ status: 'closed', category: 'transport', receivedAt: new Date('2026-10-10T00:00:00Z'), resolvedAt: new Date('2026-10-10T12:00:00Z') }),
      complaint({ receivedAt: new Date('2026-10-13T12:00:00Z') }),
      complaint({ priority: 'low', receivedAt: new Date('2026-09-01T00:00:00Z') }),
      complaint({ priority: 'urgent', receivedAt: new Date('2026-10-01T00:00:00Z'), assignedToId: 'u1' }),
    ];
    const s = summariseComplaints(rows, NOW);
    expect(s.resolved).toBe(2);
    expect(s.open).toBe(3);
    expect(s.resolutionRate).toBe(40);
    expect(s.avgResolutionHours).toBe(18);
    expect(s.unassignedOpen).toBe(2);
    expect(s.urgentOpen).toBe(1);
    expect(s.aging.map((a) => a.count)).toEqual([1, 0, 1, 1]);
    expect(s.overdue.map((o) => o.priority)).toEqual(['urgent', 'low']);
    expect(s.categoryPerformance.find((c) => c.key === 'transport')).toMatchObject({ total: 1, resolved: 1, resolutionRate: 100 });
  });
});
