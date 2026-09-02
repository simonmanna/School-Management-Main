import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../../kernel/prisma/prisma.service';

@Injectable()
export class TimetableAdvancedService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
  ) {}

  /* ── Teaching rooms ──────────────────────────────────────────────────── */
  listRooms() {
    return (this.prisma.client as any).teachingRoom.findMany({ orderBy: { name: 'asc' } });
  }
  createRoom(dto: any) {
    return (this.prisma.client as any).teachingRoom.create({ data: dto });
  }
  updateRoom(id: string, dto: any) {
    return (this.prisma.client as any).teachingRoom.update({ where: { id }, data: dto });
  }
  removeRoom(id: string) {
    return (this.prisma.client as any).teachingRoom.delete({ where: { id } });
  }

  /* ── Special schedules (exam / event overrides from calendar) ───────────── */
  async specialSchedule(from: string, to: string) {
    return (this.prisma.client as any).schoolCalendarEvent.findMany({
      where: {
        type: { in: ['exam', 'event'] },
        startDate: { lte: new Date(to) },
        endDate: { gte: new Date(from) },
      },
      orderBy: { startDate: 'asc' },
    });
  }

  /* ── Student timetable (resolve current enrollment -> class grid) ──────── */
  async gridForStudent(studentProfileId: string, date?: string) {
    const enrollment = await (this.prisma.client as any).enrollment.findFirst({
      where: { studentProfileId, status: 'enrolled' },
      orderBy: { effectiveDate: 'desc' },
    });
    if (!enrollment) return { slots: [], grid: {}, note: 'No active enrollment' };
    return this.classGridWithOverrides(enrollment.classId, enrollment.sectionId, date);
  }

  /** Build a class grid, then overlay any active overrides for the given date. */
  async classGridWithOverrides(classId: string, sectionId: string | null, date?: string) {
    const slots = await (this.prisma.client as any).timetableSlot.findMany({
      where: { classId, sectionId: sectionId ?? null },
      // `period` and the teacher's Partner are read by every caller that renders
      // a grid — the period order and the teacher's name. Leaving them out made
      // those columns silently blank rather than failing.
      include: {
        subject: true,
        teacher: { include: { partner: true } },
        period: true,
        teachingRoom: true,
      } as any,
      orderBy: [{ dayOfWeek: 'asc' }, { period: { order: 'asc' } }],
    });
    let overrides: any[] = [];
    if (date) {
      const d = new Date(date);
      // `TimetableOverride` holds loose `subjectId` / `teacherPartnerId` ids with
      // no Prisma relations, so the `include` this used to pass made the whole
      // query invalid — and the cells it fed read `ov.subject` / `ov.teacher`,
      // which could never have been populated. Resolve them explicitly instead.
      const rows = await (this.prisma.client as any).timetableOverride.findMany({
        where: { classId, sectionId: sectionId ?? null, effectiveFrom: { lte: d }, effectiveTo: { gte: d } },
      });
      const subjectIds = [...new Set(rows.map((o: any) => o.subjectId).filter(Boolean))] as string[];
      const teacherIds = [...new Set(rows.map((o: any) => o.teacherPartnerId).filter(Boolean))] as string[];
      const [subjects, teachers] = await Promise.all([
        subjectIds.length ? (this.prisma.client as any).subject.findMany({ where: { id: { in: subjectIds } } }) : [],
        teacherIds.length
          ? (this.prisma.client as any).staffProfile.findMany({ where: { id: { in: teacherIds } }, include: { partner: true } })
          : [],
      ]);
      const subjectById = new Map<string, any>((subjects as any[]).map((x: any) => [x.id, x]));
      const teacherById = new Map<string, any>((teachers as any[]).map((x: any) => [x.id, x]));
      overrides = rows.map((o: any) => ({
        ...o,
        subject: o.subjectId ? subjectById.get(o.subjectId) ?? null : null,
        teacher: o.teacherPartnerId ? teacherById.get(o.teacherPartnerId) ?? null : null,
      }));
    }
    const grid: Record<number, Record<string, any>> = {};
    for (const s of slots as any[]) {
      let cell: any = s;
      const ov = overrides.find((o) => o.dayOfWeek === s.dayOfWeek && o.periodId === s.periodId);
      if (ov) {
        cell = { ...s, overridden: true, overrideReason: ov.reason,
          subject: ov.subject ?? s.subject, teacherPartnerId: ov.teacherPartnerId ?? s.teacherPartnerId,
          teacher: ov.teacher ?? s.teacher };
      }
      grid[s.dayOfWeek] ??= {};
      grid[s.dayOfWeek][s.periodId] = cell;
    }
    return { slots, grid, overrides: overrides.length };
  }

  /* ── Teacher availability ─────────────────────────────────────────────── */
  async setAvailability(dto: {
    teacherPartnerId: string; dayOfWeek: number; periodId: string; status: string; reason?: string;
  }) {
    return (this.prisma.client as any).teacherAvailability.upsert({
      where: {
        organizationId_teacherPartnerId_dayOfWeek_periodId: {
          teacherPartnerId: dto.teacherPartnerId,
          dayOfWeek: dto.dayOfWeek,
          periodId: dto.periodId,
        } as any,
      },
      create: dto as any,
      update: { status: dto.status, reason: dto.reason },
    });
  }
  availabilityForTeacher(teacherPartnerId: string) {
    return (this.prisma.client as any).teacherAvailability.findMany({ where: { teacherPartnerId } });
  }

  /* ── Rotation ─────────────────────────────────────────────────────────── */
  async getRotation(classId: string) {
    const r = await (this.prisma.client as any).timetableRotation.findUnique({ where: { classId } });
    return r ?? { classId, activeCycle: 'all' };
  }
  async setRotation(classId: string, activeCycle: string) {
    return (this.prisma.client as any).timetableRotation.upsert({
      where: { classId },
      create: { classId, activeCycle } as any,
      update: { activeCycle, switchedAt: new Date() },
    });
  }

  /* ── Overrides (temporary changes) ────────────────────────────────────── */
  listOverrides(classId: string, sectionId?: string) {
    return (this.prisma.client as any).timetableOverride.findMany({
      where: { classId, sectionId: sectionId ?? null },
      include: { subject: true, teacher: true } as any,
      orderBy: { effectiveFrom: 'asc' },
    });
  }
  /**
   * A dated timetable override (cover, room move, one-off swap).
   *
   * Phase 7: this did NO clash checking at all, so an override could put a
   * teacher in two classes at once — the very thing `detectConflicts` exists to
   * prevent on the base grid.
   */
  async createOverride(dto: any) {
    const organizationId = this.tenant.organizationId;
    const effectiveFrom = new Date(dto.effectiveFrom);
    const effectiveTo = new Date(dto.effectiveTo);
    if (effectiveTo < effectiveFrom) {
      throw new BadRequestException('effectiveTo must be on or after effectiveFrom');
    }

    if (dto.teacherPartnerId) {
      // Already teaching this period on the base timetable, for another class?
      const ownLesson = await (this.prisma.client as any).timetableSlot.findFirst({
        where: {
          organizationId,
          teacherPartnerId: dto.teacherPartnerId,
          dayOfWeek: dto.dayOfWeek,
          periodId: dto.periodId,
          NOT: { classId: dto.classId },
        },
      });
      if (ownLesson) {
        throw new BadRequestException('That teacher already teaches another class in this period');
      }

      // Already covering elsewhere in an overlapping window?
      const overlapping = await (this.prisma.client as any).timetableOverride.findFirst({
        where: {
          organizationId,
          teacherPartnerId: dto.teacherPartnerId,
          dayOfWeek: dto.dayOfWeek,
          periodId: dto.periodId,
          effectiveFrom: { lte: effectiveTo },
          effectiveTo: { gte: effectiveFrom },
          NOT: { classId: dto.classId },
        },
      });
      if (overlapping) {
        throw new BadRequestException('That teacher is already covering another class in this window');
      }
    }

    return (this.prisma.client as any).timetableOverride.create({
      data: { ...dto, effectiveFrom, effectiveTo } as any,
    });
  }
  removeOverride(id: string) {
    return (this.prisma.client as any).timetableOverride.delete({ where: { id } });
  }

  /* ── Auto-generation (greedy constraint draft) ────────────────────────── */
  async generate(dto: {
    classId: string; sectionId?: string;
    subjectLoads?: { subjectId: string; perWeek: number }[];
    subjectTeachers?: { subjectId: string; teacherPartnerId: string }[];
    maxPerDay?: number;
  }) {
    const periods = await (this.prisma.client as any).period.findMany({ orderBy: { order: 'asc' } });
    if (periods.length === 0) throw new BadRequestException('Configure periods first');
    const days = [1, 2, 3, 4, 5, 6, 7];
    const loads = dto.subjectLoads ?? [];
    const teacherOf: Record<string, string | undefined> = Object.fromEntries(
      (dto.subjectTeachers ?? []).map((t) => [t.subjectId, t.teacherPartnerId]),
    );
    const maxPerDay = dto.maxPerDay ?? 2;

    await (this.prisma.client as any).timetableSlot.deleteMany({ where: { classId: dto.classId, sectionId: dto.sectionId ?? null } });

    const placed: any[] = [];
    const dayCount: Record<number, number> = {};
    for (const load of loads) {
      let remaining = load.perWeek;
      let guard = 0;
      while (remaining > 0 && guard++ < 1000) {
        const day = days[Math.floor(Math.random() * days.length)];
        const period = periods[Math.floor(Math.random() * periods.length)];
        if ((dayCount[day] ?? 0) >= maxPerDay) continue;
        const clash = await this.hasClash({
          classId: dto.classId, sectionId: dto.sectionId ?? null,
          dayOfWeek: day, periodId: period.id, teacherPartnerId: teacherOf[load.subjectId],
        });
        if (clash) continue;
        placed.push({
          classId: dto.classId, sectionId: dto.sectionId ?? null, dayOfWeek: day, periodId: period.id,
          subjectId: load.subjectId, teacherPartnerId: teacherOf[load.subjectId] ?? null, type: 'lesson',
        });
        dayCount[day] = (dayCount[day] ?? 0) + 1;
        remaining--;
      }
    }
    const res = await (this.prisma.client as any).timetableSlot.createMany({ data: placed });
    return { created: res.count };
  }

  private async hasClash(slot: {
    classId: string; sectionId: string | null; dayOfWeek: number; periodId: string; teacherPartnerId?: string;
  }): Promise<boolean> {
    const where: Prisma.TimetableSlotWhereInput = {
      dayOfWeek: slot.dayOfWeek, periodId: slot.periodId,
      OR: [
        { classId: slot.classId, sectionId: slot.sectionId ?? null },
        ...(slot.teacherPartnerId ? [{ teacherPartnerId: slot.teacherPartnerId }] : []),
      ],
    };
    const found = await (this.prisma.client as any).timetableSlot.findFirst({ where });
    return !!found;
  }
}
