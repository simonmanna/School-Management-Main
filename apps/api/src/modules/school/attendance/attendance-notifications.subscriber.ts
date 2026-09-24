import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
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
 *  - A separate scheduled sweep (belowThresholdSweep) flags students whose
 *    rolling attendance % has dropped below the threshold and alerts guardians.
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
        // entry (isAbsent / isLate), not a hardcoded status literal.
        if (e.isAbsent && threshold.notifyAbsent) channel = 'absence';
        else if (e.isLate && threshold.notifyLate) channel = 'late';
        else if (e.isAbsent && threshold.notifyEarly) channel = 'early';
        if (!channel) continue;

        await this.notifyGuardians(p.organizationId, e.studentProfileId, channel as any, {
          date: p.date,
          status: e.status,
          minutesLate: e.minutesLate ?? 0,
          earlyDepartureMinutes: e.earlyDepartureMinutes ?? null,
        });
      }
    } catch (err) {
      this.logger.error(`attendance notify failed: ${(err as Error).message}`);
    }
  }

  /** Scheduled sweep: alert guardians of students below the threshold. */
  async belowThresholdSweep(orgId: string, days = 30, classId?: string | null) {
    const flagged = await this.attendanceBelow(orgId, days, classId);
    for (const f of flagged.flagged) {
      await this.notifyGuardians(orgId, f.studentProfileId, 'below_threshold', {
        pct: f.pct,
        floor: flagged.floor,
      });
    }
    return flagged;
  }

  private async attendanceBelow(orgId: string, days: number, classId?: string | null) {
    const start = new Date(Date.now() - days * 86400000);
    const threshold = await this.resolveThreshold(orgId, classId);
    const floor = threshold?.minAttendancePct ?? 75;
    const where: any = { organizationId: orgId, date: { gte: start } };
    if (classId) where.classId = classId;
    const rows = await this.prisma.client.studentAttendance.findMany({ where });
    // P-att-status: resolve present/late via the live config flags, not literals.
    const cfgByCode = await this.catalogByCode(orgId);
    const agg: Record<string, { total: number; good: number }> = {};
    for (const r of rows) {
      agg[r.studentProfileId] ??= { total: 0, good: 0 };
      agg[r.studentProfileId].total++;
      const cfg = cfgByCode[r.status];
      if (cfg?.isPresent || cfg?.isLate) agg[r.studentProfileId].good++;
    }
    const flagged: Array<{ studentProfileId: string; pct: number }> = [];
    for (const [sid, v] of Object.entries(agg)) {
      const pct = v.total > 0 ? (v.good / v.total) * 100 : 100;
      if (pct < floor) flagged.push({ studentProfileId: sid, pct: Math.round(pct * 100) / 100 });
    }
    return { floor, flagged };
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
    kind: 'absence' | 'late' | 'early' | 'below_threshold',
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
