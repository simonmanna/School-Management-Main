import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { EventBus } from '../../../kernel/events/event-bus';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { NotificationsService } from '../../../kernel/notifications/notifications.service';
import { EVENTS } from '@erp/shared';

/* eslint-disable @typescript-eslint/no-explicit-any */

type LeaveApprovedPayload = {
  organizationId: string;
  leaveRequestId: string;
  employeeId: string;
  staffProfileId: string | null;
  startDate: string;
  endDate: string;
  leaveTypeName?: string;
};

/**
 * TeacherCoverService — turns approved leave into concrete cover work.
 *
 * ── Why leave is NOT projected into `TeacherAvailability` ───────────────────
 * The obvious move is to mark the teacher unavailable so `detectConflicts()`
 * picks it up. It is wrong: `TeacherAvailability` is keyed
 * `(teacherPartnerId, dayOfWeek, periodId)` — a WEEKLY RECURRING pattern with
 * no dates. Writing "Alice is on leave Mon 3rd" into it would mark Alice
 * unavailable EVERY Monday, permanently, for one day off.
 *
 * `TimetableOverride` is the date-ranged model (`effectiveFrom`/`effectiveTo`),
 * so that is where cover belongs. This service:
 *   1. lists the lessons an absence actually affects;
 *   2. notifies whoever manages the timetable, with the count;
 *   3. records a substitute as a dated override, clash-checked.
 *
 * HR publishes `hr.leave.approved`; this subscribes. Neither vertical imports
 * the other (ADR-011) — the event bus is the seam.
 */
@Injectable()
export class TeacherCoverService implements OnModuleInit {
  private readonly logger = new Logger('TeacherCover');

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly events: EventBus,
    private readonly notifications: NotificationsService,
  ) {}

  onModuleInit() {
    this.events.subscribe(EVENTS.HrLeaveApproved, (p: LeaveApprovedPayload) => this.onLeaveApproved(p));
  }

  /** Weekday numbers (1=Mon…7=Sun) actually covered by a date range. */
  private weekdaysInRange(from: Date, to: Date): number[] {
    const out = new Set<number>();
    const cursor = new Date(from);
    // A range longer than a week covers every weekday; cap the walk.
    let guard = 0;
    while (cursor <= to && guard++ < 400) {
      const dow = cursor.getDay() === 0 ? 7 : cursor.getDay();
      out.add(dow);
      cursor.setDate(cursor.getDate() + 1);
    }
    return [...out];
  }

  /**
   * The timetable slots a teacher's absence would leave uncovered between two
   * dates. Read-only — this is what the cover screen lists.
   */
  async affectedLessons(teacherPartnerId: string, from: Date, to: Date) {
    const organizationId = this.tenant.organizationId;
    const days = this.weekdaysInRange(from, to);
    if (days.length === 0) return [];

    return this.prisma.client.timetableSlot.findMany({
      where: {
        organizationId,
        teacherPartnerId,
        dayOfWeek: { in: days },
      },
      include: {
        subject: { select: { id: true, name: true, code: true } },
        schoolClass: { select: { id: true, name: true } },
        section: { select: { id: true, name: true } },
        period: { select: { id: true, name: true, startTime: true, endTime: true } },
      },
      orderBy: [{ dayOfWeek: 'asc' }],
    });
  }

  /**
   * Assign a substitute for one slot over a date window, as a dated override.
   *
   * Clash-checked: a substitute already teaching that period cannot be in two
   * rooms at once. `createOverride` did no checking at all, so cover could be
   * booked straight on top of the substitute's own lesson.
   */
  async assignSubstitute(dto: {
    timetableSlotId: string;
    substituteTeacherId: string;
    effectiveFrom: string | Date;
    effectiveTo: string | Date;
    reason?: string;
  }) {
    const organizationId = this.tenant.organizationId;
    const userId = this.tenant.userId;

    const slot = await this.prisma.client.timetableSlot.findFirst({
      where: { id: dto.timetableSlotId, organizationId },
    });
    if (!slot) throw new NotFoundException('Timetable slot not found');

    const substitute = await this.prisma.client.staffProfile.findFirst({
      where: { id: dto.substituteTeacherId, organizationId, deletedAt: null },
      select: { id: true },
    });
    if (!substitute) throw new NotFoundException('Substitute teacher not found');
    if (substitute.id === slot.teacherPartnerId) {
      throw new BadRequestException('The substitute is already the assigned teacher');
    }

    const from = new Date(dto.effectiveFrom);
    const to = new Date(dto.effectiveTo);
    if (to < from) throw new BadRequestException('effectiveTo must be on or after effectiveFrom');

    await this.assertSubstituteFree(substitute.id, slot, from, to);

    return this.prisma.client.timetableOverride.create({
      data: {
        organizationId,
        classId: slot.classId,
        sectionId: slot.sectionId ?? null,
        dayOfWeek: slot.dayOfWeek,
        periodId: slot.periodId,
        effectiveFrom: from,
        effectiveTo: to,
        subjectId: slot.subjectId ?? null,
        teacherPartnerId: substitute.id,
        reason: dto.reason ?? 'Cover for absent teacher',
        createdBy: userId,
      },
    });
  }

  /**
   * A substitute must not already be teaching that (dayOfWeek, period), either
   * on the base timetable or via another overlapping override.
   */
  private async assertSubstituteFree(
    substituteId: string,
    slot: { dayOfWeek: number; periodId: string; classId: string },
    from: Date,
    to: Date,
  ): Promise<void> {
    const organizationId = this.tenant.organizationId;

    const ownLesson = await this.prisma.client.timetableSlot.findFirst({
      where: {
        organizationId,
        teacherPartnerId: substituteId,
        dayOfWeek: slot.dayOfWeek,
        periodId: slot.periodId,
      },
      include: { schoolClass: { select: { name: true } } },
    });
    if (ownLesson) {
      throw new BadRequestException(
        `That teacher already teaches ${ownLesson.schoolClass?.name ?? 'another class'} in this period`,
      );
    }

    // Any override that puts them in another class at the same time, whose
    // window overlaps this one.
    const clashingOverride = await this.prisma.client.timetableOverride.findFirst({
      where: {
        organizationId,
        teacherPartnerId: substituteId,
        dayOfWeek: slot.dayOfWeek,
        periodId: slot.periodId,
        effectiveFrom: { lte: to },
        effectiveTo: { gte: from },
        NOT: { classId: slot.classId },
      },
    });
    if (clashingOverride) {
      throw new BadRequestException('That teacher is already covering another class in this period');
    }
  }

  /**
   * On approved leave: work out what it breaks and tell the timetable owners.
   *
   * Deliberately does NOT auto-assign a substitute — who covers a lesson is a
   * staffing judgement, and picking wrong silently is worse than asking.
   */
  private async onLeaveApproved(payload: LeaveApprovedPayload): Promise<void> {
    try {
      if (!payload.staffProfileId) {
        // Employee not bridged to a school staff record — nothing to cover.
        return;
      }
      await this.tenant.run({ organizationId: payload.organizationId }, async () => {
        const from = new Date(payload.startDate);
        const to = new Date(payload.endDate);
        const lessons = await this.affectedLessons(payload.staffProfileId!, from, to);
        if (lessons.length === 0) return;

        const profile = await this.prisma.client.staffProfile.findFirst({
          where: { id: payload.staffProfileId!, organizationId: payload.organizationId },
          include: { partner: { select: { name: true } } },
        });
        const who = profile?.partner?.name ?? profile?.employeeNo ?? 'A teacher';
        const day = (d: Date) => d.toISOString().slice(0, 10);

        await this.notifications
          .send({
            organizationId: payload.organizationId,
            channel: 'in_app',
            category: 'school',
            title: 'Lessons need cover',
            body:
              `${who} is on approved leave ${day(from)} → ${day(to)}. ` +
              `${lessons.length} timetabled lesson(s) need cover.`,
            payload: {
              kind: 'timetable_cover_needed',
              leaveRequestId: payload.leaveRequestId,
              staffProfileId: payload.staffProfileId,
              lessons: lessons.length,
              dedupeKey: `cover:${payload.leaveRequestId}`,
            },
          } as any)
          .catch((err: Error) => this.logger.error(`cover notify failed: ${err.message}`));
      });
    } catch (err) {
      // A subscriber must never take down the publisher's transaction.
      this.logger.error(`onLeaveApproved failed: ${String(err)}`);
    }
  }
}
