import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { EventBus } from '../../../kernel/events/event-bus';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { NotificationsService } from '../../../kernel/notifications/notifications.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { EVENTS } from '@erp/shared';

/**
 * P1b — Wires attendance events to guardian notifications.
 *
 *  - school.attendance.marked → for each entry that is absent / unexcused /
 *    late / early_departure, and only if the active threshold enables that
 *    channel, look up the student's guardians (via StudentGuardian → Contact)
 *    and send an in-app + (best-effort) SMS/email alert.
 *  - When a daily register marks a pupil absent, and the threshold sets
 *    `consecutiveAbsenceAlert` = N, the Nth absent school day in a row sends
 *    one extra alert (Wave 16).
 *  - A weekly scheduled sweep (belowThresholdSweep) flags students whose
 *    rolling attendance % has dropped below their class's threshold and alerts
 *    guardians, only where that threshold enables `notifyBelowThreshold`.
 *
 * Delivery uses the shared NotificationsService (email/SMS/push/in_app). SMS
 * and email are best-effort — if provider credentials are absent they are
 * logged but not sent. Each notification carries a dedupeKey so at-least-once
 * delivery does not create duplicates within a short window.
 */
type MarkedEntry = {
  studentProfileId: string;
  status: string;
  isPresent?: boolean;
  isLate?: boolean;
  isAbsent?: boolean;
  minutesLate?: number;
  earlyDepartureMinutes?: number | null;
};
type MarkedPayload = {
  organizationId: string;
  date: string;
  classId: string;
  periodId?: string | null;
  entries: MarkedEntry[];
};

@Injectable()
export class AttendanceNotificationsSubscriber implements OnModuleInit {
  private readonly logger = new Logger('AttendanceNotifications');

  constructor(
    private readonly events: EventBus,
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly tenant: TenantContextService,
  ) {}

  onModuleInit() {
    this.events.subscribe(EVENTS.SchoolAttendanceMarked, (p: MarkedPayload) => this.onMarked(p));
    this.events.subscribe(EVENTS.SchoolAttendanceCorrected, () => {/* corrections are audit-only; no parent alert by default */});
  }

  private async onMarked(p: MarkedPayload) {
    try {
      const threshold = await this.resolveThreshold(p.organizationId, p.classId);
      if (!threshold) return;

      for (const e of p.entries ?? []) {
        let channel = '';
        // P-att-status: channel is driven by the config flags carried on the
        // entry (isAbsent / isLate), not a hardcoded status literal. An early
        // departure is its own fact (minutes left early). It used to test
        // isAbsent, so real early departures never alerted and absences were
        // mislabelled "left early" whenever notifyAbsent was off (Wave 16).
        if (e.isAbsent && threshold.notifyAbsent) channel = 'absence';
        else if (e.isLate && threshold.notifyLate) channel = 'late';
        else if ((e.earlyDepartureMinutes ?? 0) > 0 && threshold.notifyEarly) channel = 'early';

        if (channel) {
          await this.notifyGuardians(p.organizationId, e.studentProfileId, channel as any, {
            date: p.date,
            status: e.status,
            minutesLate: e.minutesLate ?? 0,
            earlyDepartureMinutes: e.earlyDepartureMinutes ?? null,
          });
        }

        if (e.isAbsent && !p.periodId && threshold.consecutiveAbsenceAlert) {
          await this.checkConsecutiveAbsence(p.organizationId, e.studentProfileId, p.date, threshold.consecutiveAbsenceAlert);
        }
      }
    } catch (err) {
      this.logger.error(`attendance notify failed: ${(err as Error).message}`);
    }
  }

  /**
   * Alert once, on the Nth absent school day in a row. Streaks are counted over
   * daily register rows only, so a day with no register (weekend, holiday) does
   * not break or extend one. The (N+1)th day is silent: the guardian already
   * knows, and a daily repeat would train them to ignore the channel.
   */
  private async checkConsecutiveAbsence(orgId: string, studentProfileId: string, date: string, n: number) {
    const rows = await this.prisma.client.studentAttendance.findMany({
      where: { organizationId: orgId, studentProfileId, periodId: null, date: { lte: new Date(date) } },
      orderBy: { date: 'desc' },
      take: n + 1,
      select: { status: true },
    });
    if (rows.length < n) return;
    const cfgByCode = await this.catalogByCode(orgId);
    const absent = (code: string) => !!cfgByCode[code]?.isAbsent;
    const streak = rows.slice(0, n).every((r) => absent(r.status));
    const longer = rows.length > n && absent(rows[n].status);
    if (!streak || longer) return;
    await this.notifyGuardians(orgId, studentProfileId, 'consecutive_absence', { date, days: n });
  }

  /**
   * Weekly sweep across every school (Mondays 07:00 Kampala by default;
   * override with ATTENDANCE_THRESHOLD_SWEEP_CRON). One failing school never
   * stops the rest.
   */
  @Cron(process.env.ATTENDANCE_THRESHOLD_SWEEP_CRON ?? '0 4 * * 1', { name: 'attendance-threshold-sweep' })
  async runScheduledSweep() {
    const orgs = await this.prisma.raw.attendanceThreshold.findMany({
      where: { notifyBelowThreshold: true },
      distinct: ['organizationId'],
      select: { organizationId: true },
    });
    for (const { organizationId } of orgs) {
      await this.tenant.run({ organizationId }, async () => {
        try {
          const res = await this.belowThresholdSweep(organizationId);
          this.logger.log(`[org ${organizationId}] attendance sweep flagged ${res.flagged.length}`);
        } catch (err) {
          this.logger.error(`[org ${organizationId}] attendance sweep failed: ${(err as Error).message}`);
        }
      });
    }
  }

  /** Alert guardians of students below their class's threshold (where it asks to). */
  async belowThresholdSweep(orgId: string, days = 30, classId?: string | null) {
    const flagged = await this.attendanceBelow(orgId, days, classId);
    for (const f of flagged.flagged) {
      await this.notifyGuardians(orgId, f.studentProfileId, 'below_threshold', {
        pct: f.pct,
        floor: f.floor,
      });
    }
    return flagged;
  }

  /**
   * Each pupil is judged against the threshold of the class their rows belong
   * to (class-specific, else the school default), not one school-wide floor,
   * and a threshold with notifyBelowThreshold off excludes its pupils.
   */
  private async attendanceBelow(orgId: string, days: number, classId?: string | null) {
    const start = new Date(Date.now() - days * 86400000);
    const where: any = { organizationId: orgId, date: { gte: start }, periodId: null };
    if (classId) where.classId = classId;
    const rows = await this.prisma.client.studentAttendance.findMany({
      where,
      select: { studentProfileId: true, classId: true, status: true },
    });
    const thresholds = await this.prisma.client.attendanceThreshold.findMany({ where: { organizationId: orgId } });
    const orgDefault = thresholds.find((t) => t.classId === null) ?? null;
    const thresholdFor = (cid: string) => thresholds.find((t) => t.classId === cid) ?? orgDefault;
    // P-att-status: resolve present/late via the live config flags, not literals.
    const cfgByCode = await this.catalogByCode(orgId);
    const agg = new Map<string, { classId: string; total: number; good: number }>();
    for (const r of rows) {
      const a = agg.get(r.studentProfileId) ?? { classId: r.classId, total: 0, good: 0 };
      a.total++;
      const cfg = cfgByCode[r.status];
      if (cfg?.isPresent || cfg?.isLate) a.good++;
      agg.set(r.studentProfileId, a);
    }
    const flagged: Array<{ studentProfileId: string; pct: number; floor: number }> = [];
    for (const [sid, v] of agg) {
      const t = thresholdFor(v.classId);
      if (!t || !t.notifyBelowThreshold) continue;
      const pct = v.total > 0 ? (v.good / v.total) * 100 : 100;
      if (pct < t.minAttendancePct) flagged.push({ studentProfileId: sid, pct: Math.round(pct * 100) / 100, floor: t.minAttendancePct });
    }
    return { floor: orgDefault?.minAttendancePct ?? 75, flagged };
  }

  private async resolveThreshold(orgId: string, classId?: string | null) {
    if (classId) {
      const specific = await this.prisma.client.attendanceThreshold.findFirst({ where: { organizationId: orgId, classId } });
      if (specific) return specific;
    }
    return this.prisma.client.attendanceThreshold.findFirst({ where: { organizationId: orgId, classId: null } });
  }

  private async catalogByCode(orgId: string): Promise<Record<string, any>> {
    const rows = await this.prisma.client.attendanceStatusConfig.findMany({ where: { organizationId: orgId } });
    return Object.fromEntries(rows.map((r) => [r.code, r]));
  }

  private async notifyGuardians(
    orgId: string,
    studentProfileId: string,
    kind: 'absence' | 'late' | 'early' | 'consecutive_absence' | 'below_threshold',
    detail: Record<string, unknown>,
  ) {
    const links = await this.prisma.client.studentGuardian.findMany({
      where: { organizationId: orgId, studentProfileId },
      include: { guardianContact: true },
    });
    const student = await this.prisma.client.studentProfile.findFirst({
      where: { id: studentProfileId },
      include: { partner: true },
    });
    const name = student?.partner ? `${student.partner.name ?? ''}`.trim() : studentProfileId.slice(0, 8);
    const date = typeof detail.date === 'string' ? detail.date.slice(0, 10) : new Date().toISOString().slice(0, 10);

    let title = '';
    let body = '';
    if (kind === 'absence') { title = 'Absence alert'; body = `${name} was absent on ${date}.`; }
    else if (kind === 'late') { title = 'Late arrival'; body = `${name} arrived late on ${date} (${detail.minutesLate ?? 0} min).`; }
    else if (kind === 'early') { title = 'Left early'; body = `${name} left early on ${date} (${detail.earlyDepartureMinutes ?? 0} min).`; }
    else if (kind === 'consecutive_absence') { title = 'Repeated absence'; body = `${name} has been absent ${detail.days} school days in a row (to ${date}). Please contact the school.`; }
    else { title = 'Attendance warning'; body = `${name}'s attendance has dropped to ${detail.pct ?? '?'}% (below ${detail.floor ?? '?'}%).`; }

    const dedupeKey = `att:${kind}:${studentProfileId}:${date}`;
    for (const link of links) {
      const c: any = link.guardianContact;
      if (!c) continue;
      // Portal inbox, SMS and email to the guardian's own details; the key
      // makes a re-marked register not text the parent twice (N1).
      await this.notifications.notifyContact({
        organizationId: orgId,
        contact: { id: c.id, email: c.email, phone: c.phone },
        category: 'attendance',
        title,
        body,
        payload: { studentProfileId, kind, ...detail },
        dedupeKey,
      });
    }
  }
}
