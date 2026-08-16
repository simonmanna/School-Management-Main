import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../../kernel/prisma/prisma.service';

@Injectable()
export class TimetableAdvancedService {
  constructor(private readonly prisma: PrismaService) {}

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
      include: { subject: true, teacher: true } as any,
      orderBy: [{ dayOfWeek: 'asc' }, { period: { order: 'asc' } }],
    });
    let overrides: any[] = [];
    if (date) {
      const d = new Date(date);
    overrides = await (this.prisma.client as any).timetableOverride.findMany({
        where: { classId, sectionId: sectionId ?? null, effectiveFrom: { lte: d }, effectiveTo: { gte: d } },
        include: { subject: true, teacher: true } as any,
      });
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
  createOverride(dto: any) {
    return (this.prisma.client as any).timetableOverride.create({
      data: { ...dto, effectiveFrom: new Date(dto.effectiveFrom), effectiveTo: new Date(dto.effectiveTo) } as any,
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
