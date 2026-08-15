/** Meals V1 — daily meal sessions + meal attendance (no inventory side-effects). */
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { EventBus } from '../../../kernel/events/event-bus';
import { EVENTS } from '@erp/shared';
import type { OpenMealSessionDto, BulkMarkMealAttendanceDto } from './dto.types';

@Injectable()
export class MealSessionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly events: EventBus,
  ) {}

  /** Active assignments valid on `date` whose plan is entitled to `mealTypeId`. */
  private eligibleAssignmentWhere(mealTypeId: string, date: Date, classId?: string | null) {
    return {
      status: 'active' as const,
      startDate: { lte: date },
      OR: [{ endDate: null }, { endDate: { gte: date } }],
      mealPlan: { entitlements: { some: { mealTypeId } } },
      ...(classId ? { studentProfile: { currentClassId: classId } } : {}),
    };
  }

  private async countExpected(mealTypeId: string, date: Date, classId?: string | null): Promise<number> {
    const rows = await this.prisma.client.mealPlanAssignment.findMany({
      where: this.eligibleAssignmentWhere(mealTypeId, date, classId ?? undefined),
      select: { studentProfileId: true },
    });
    return new Set(rows.map((r: any) => r.studentProfileId)).size;
  }

  /** Open (or return the existing) session for a date + meal type + optional scope. */
  async openSession(dto: OpenMealSessionDto) {
    const organizationId = this.tenant.organizationId;
    const date = new Date(dto.date);
    const classId = dto.classId ?? null;

    const existing = await this.prisma.client.mealSession.findFirst({
      where: { organizationId, date, mealTypeId: dto.mealTypeId, classId },
    });
    if (existing) return existing;

    const expectedCount = await this.countExpected(dto.mealTypeId, date, classId);
    const created = await this.prisma.client.mealSession.create({
      data: {
        organizationId,
        mealTypeId: dto.mealTypeId,
        date,
        classId,
        sectionId: dto.sectionId ?? null,
        mealPlanId: dto.mealPlanId ?? null,
        expectedCount,
        createdBy: this.tenant.userId ?? null,
        updatedBy: this.tenant.userId ?? null,
      },
    });

    this.events.publish(EVENTS.SchoolMealSessionOpened, {
      organizationId,
      mealSessionId: created.id,
      mealTypeId: created.mealTypeId,
      date: date.toISOString(),
      expectedCount,
    });
    return created;
  }

  /** Bulk-mark meal attendance for a session (idempotent find-then-upsert per row). */
  async markAttendance(sessionId: string, dto: BulkMarkMealAttendanceDto) {
    const organizationId = this.tenant.organizationId;
    const session = await this.prisma.client.mealSession.findFirst({ where: { id: sessionId }, select: { id: true } });
    if (!session) throw new NotFoundException(`MealSession ${sessionId} not found`);

    const counts = { served: 0, absent: 0, excused: 0, not_eligible: 0 };
    await this.prisma.client.$transaction(async (tx: any) => {
      for (const e of dto.entries) {
        const existing = await tx.mealAttendance.findFirst({
          where: { organizationId, mealSessionId: sessionId, studentProfileId: e.studentProfileId },
          select: { id: true },
        });
        const data = {
          status: e.status,
          reason: e.reason ?? null,
          markedById: this.tenant.userId ?? null,
          markedAt: new Date(),
        };
        if (existing) {
          await tx.mealAttendance.updateMany({ where: { id: existing.id }, data });
        } else {
          await tx.mealAttendance.create({
            data: { organizationId, mealSessionId: sessionId, studentProfileId: e.studentProfileId, ...data },
          });
        }
        counts[e.status]++;
      }
      const served = await tx.mealAttendance.count({ where: { mealSessionId: sessionId, status: 'served' } });
      await tx.mealSession.updateMany({ where: { id: sessionId }, data: { servedCount: served } });
    });

    this.events.publish(EVENTS.SchoolMealAttendanceRecorded, {
      organizationId,
      mealSessionId: sessionId,
      served: counts.served,
      absent: counts.absent,
      excused: counts.excused,
    });
    return counts;
  }

  /** Eligible students for a session + any status already marked (for the UI). */
  async roster(sessionId: string) {
    const session = await this.prisma.client.mealSession.findFirst({
      where: { id: sessionId },
      include: { mealType: true },
    });
    if (!session) throw new NotFoundException(`MealSession ${sessionId} not found`);

    const assignments = await this.prisma.client.mealPlanAssignment.findMany({
      where: this.eligibleAssignmentWhere(session.mealTypeId, session.date, session.classId),
      include: { studentProfile: { include: { partner: true } } },
    });
    const marked = await this.prisma.client.mealAttendance.findMany({ where: { mealSessionId: sessionId } });
    const status = new Map<string, string>(marked.map((a: any) => [a.studentProfileId, a.status]));

    const seen = new Set<string>();
    const roster: any[] = [];
    for (const a of assignments) {
      if (seen.has(a.studentProfileId)) continue;
      seen.add(a.studentProfileId);
      roster.push({
        studentProfileId: a.studentProfileId,
        admissionNo: a.studentProfile?.admissionNo,
        name: a.studentProfile?.partner?.name ?? null,
        status: status.get(a.studentProfileId) ?? null,
      });
    }
    return { session, roster };
  }

  getSession(id: string) {
    return this.prisma.client.mealSession.findFirst({
      where: { id },
      include: { mealType: true, attendances: { include: { studentProfile: { include: { partner: true } } } } },
    });
  }

  listSessions(from?: string, to?: string) {
    const where: any = {};
    if (from || to) {
      where.date = {};
      if (from) where.date.gte = new Date(from);
      if (to) where.date.lte = new Date(to);
    }
    return this.prisma.client.mealSession.findMany({
      where,
      include: { mealType: true },
      orderBy: [{ date: 'desc' }, { mealType: { order: 'asc' } }],
    });
  }

  /** "Today's Meals" home screen: per meal type, expected vs served + status. */
  async todaysMeals(dateStr?: string) {
    const day = dateStr ? new Date(dateStr) : new Date();
    const start = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate()));
    const end = new Date(start);
    end.setUTCDate(start.getUTCDate() + 1);

    const [types, sessions] = await Promise.all([
      this.prisma.client.mealType.findMany({ where: { isActive: true }, orderBy: { order: 'asc' } }),
      this.prisma.client.mealSession.findMany({ where: { date: { gte: start, lt: end } } }),
    ]);

    const byType = new Map<string, { expected: number; served: number; open: number; total: number; ids: string[] }>();
    for (const s of sessions) {
      const agg = byType.get(s.mealTypeId) ?? { expected: 0, served: 0, open: 0, total: 0, ids: [] };
      agg.expected += s.expectedCount;
      agg.served += s.servedCount;
      agg.total += 1;
      if (s.status === 'open') agg.open += 1;
      agg.ids.push(s.id);
      byType.set(s.mealTypeId, agg);
    }

    return {
      date: start.toISOString().slice(0, 10),
      meals: types.map((t: any) => {
        const agg = byType.get(t.id);
        return {
          mealTypeId: t.id,
          mealType: t.name,
          expected: agg?.expected ?? 0,
          served: agg?.served ?? 0,
          sessions: agg?.total ?? 0,
          status: !agg ? 'not_started' : agg.open > 0 ? 'in_progress' : 'complete',
          sessionIds: agg?.ids ?? [],
        };
      }),
    };
  }

  closeSession(id: string) {
    return this.prisma.client.mealSession.updateMany({ where: { id }, data: { status: 'closed', updatedBy: this.tenant.userId ?? null } });
  }
}
