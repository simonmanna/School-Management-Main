import { BadRequestException, Injectable } from '@nestjs/common';
import { CallDirection, CallStatus, ComplaintCategory, ComplaintPriority, ComplaintStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import {
  buildTrend, localDayStart, summariseCalls, summariseComplaints, summariseVisitors,
  COMPLAINT_SLA_DAYS, OVERSTAY_HOURS, type ReportGroupBy,
} from './front-desk-report';

export interface FrontDeskReportQuery {
  from?: string;
  to?: string;
  groupBy?: ReportGroupBy;
  tzOffset?: number;
  visitorStatus?: string;
  direction?: CallDirection;
  callStatus?: CallStatus;
  category?: ComplaintCategory;
  priority?: ComplaintPriority;
  complaintStatus?: ComplaintStatus;
}

const DAY_MS = 86_400_000;
const MAX_RANGE_DAYS = 3 * 366;
/** Detail rows returned alongside the aggregates (for the drill-down tables and CSV). */
const ROW_CAP = 5000;

@Injectable()
export class FrontDeskReportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
  ) {}

  private get orgId() {
    return this.tenant.organizationId;
  }

  async summary(q: FrontDeskReportQuery) {
    const tzOffset = Number.isFinite(q.tzOffset) && Math.abs(q.tzOffset!) <= 14 * 60 ? Math.trunc(q.tzOffset!) : 0;
    const groupBy: ReportGroupBy = q.groupBy ?? 'day';
    const now = new Date();
    const todayLocal = new Date(now.getTime() - tzOffset * 60_000).toISOString().slice(0, 10);
    const toYmd = q.to || todayLocal;
    const to = localDayStart(toYmd, tzOffset);
    const toExcl = to ? new Date(to.getTime() + DAY_MS) : null;
    const from = q.from ? localDayStart(q.from, tzOffset) : toExcl ? new Date(toExcl.getTime() - 30 * DAY_MS) : null;
    if (!from || !toExcl) throw new BadRequestException('from/to must be YYYY-MM-DD');
    if (from >= toExcl) throw new BadRequestException('from must be on or before to');
    const spanMs = toExcl.getTime() - from.getTime();
    if (spanMs > MAX_RANGE_DAYS * DAY_MS) throw new BadRequestException(`Range is limited to ${MAX_RANGE_DAYS} days`);

    const prevFrom = new Date(from.getTime() - spanMs);
    const window = (gte: Date, lt: Date) => ({ gte, lt });

    const visitorWhere = (range: { gte: Date; lt: Date }): Prisma.FrontDeskLogWhereInput => ({
      organizationId: this.orgId,
      checkInAt: range,
      ...(q.visitorStatus ? { status: q.visitorStatus } : {}),
    });
    const callWhere = (range: { gte: Date; lt: Date }): Prisma.PhoneCallWhereInput => ({
      organizationId: this.orgId,
      callAt: range,
      ...(q.direction ? { direction: q.direction } : {}),
      ...(q.callStatus ? { status: q.callStatus } : {}),
    });
    const complaintWhere = (range: { gte: Date; lt: Date }): Prisma.ComplaintWhereInput => ({
      organizationId: this.orgId,
      receivedAt: range,
      ...(q.category ? { category: q.category } : {}),
      ...(q.priority ? { priority: q.priority } : {}),
      ...(q.complaintStatus ? { status: q.complaintStatus } : {}),
    });

    const cur = window(from, toExcl);
    const prev = window(prevFrom, from);
    const db = this.prisma.client;
    const [visitors, calls, complaints, prevVisitors, prevCalls, prevMissed, prevComplaints] = await Promise.all([
      db.frontDeskLog.findMany({
        where: visitorWhere(cur),
        orderBy: { checkInAt: 'desc' },
        take: ROW_CAP,
        select: { id: true, visitorName: true, phone: true, purpose: true, personVisited: true, status: true, checkInAt: true, checkOutAt: true },
      }),
      db.phoneCall.findMany({
        where: callWhere(cur),
        orderBy: { callAt: 'desc' },
        take: ROW_CAP,
        select: { id: true, direction: true, contactName: true, phone: true, subject: true, outcome: true, durationSec: true, status: true, callAt: true },
      }),
      db.complaint.findMany({
        where: complaintWhere(cur),
        orderBy: { receivedAt: 'desc' },
        take: ROW_CAP,
        select: { id: true, category: true, subject: true, status: true, priority: true, assignedToId: true, receivedAt: true, resolvedAt: true },
      }),
      db.frontDeskLog.count({ where: visitorWhere(prev) }),
      db.phoneCall.count({ where: callWhere(prev) }),
      db.phoneCall.count({ where: { ...callWhere(prev), status: 'missed' } }),
      db.complaint.count({ where: complaintWhere(prev) }),
    ]);

    const fromLocal = new Date(from.getTime() - tzOffset * 60_000);
    const toLocalExcl = new Date(toExcl.getTime() - tzOffset * 60_000);
    return {
      range: { from: fromLocal.toISOString().slice(0, 10), to: toYmd, groupBy, tzOffset, days: Math.round(spanMs / DAY_MS) },
      thresholds: { overstayHours: OVERSTAY_HOURS, complaintSlaDays: COMPLAINT_SLA_DAYS },
      truncated: visitors.length >= ROW_CAP || calls.length >= ROW_CAP || complaints.length >= ROW_CAP,
      previous: {
        from: new Date(prevFrom.getTime() - tzOffset * 60_000).toISOString().slice(0, 10),
        visitors: prevVisitors,
        calls: prevCalls,
        missedCalls: prevMissed,
        complaints: prevComplaints,
      },
      visitors: summariseVisitors(visitors, tzOffset, now),
      calls: summariseCalls(calls, tzOffset),
      complaints: summariseComplaints(complaints, now),
      trend: buildTrend(visitors, calls, complaints, { fromLocal, toLocalExcl, groupBy, tzOffset }),
      rows: { visitors, calls, complaints },
    };
  }
}
