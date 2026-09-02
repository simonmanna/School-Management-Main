import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { AuditService } from '../../../kernel/audit/audit.service';
import { TeachingAccessService } from './teaching-access.service';
import type {
  CreateSchemeOfWorkDto,
  SchemeItemDto,
  UpdateSchemeOfWorkDto,
  UpsertSchemeWeekDto,
} from './teaching.dto';

/** Monday 00:00 of the week the given date falls in. */
export function weekStartOf(date: Date): Date {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const shift = (d.getUTCDay() + 6) % 7; // Sunday(0) → 6, Monday(1) → 0
  d.setUTCDate(d.getUTCDate() - shift);
  return d;
}

/** The Mondays a term spans, capped so a mis-keyed term cannot generate 500 weeks. */
export function termWeekStarts(start: Date, end: Date, cap = 20): Date[] {
  const weeks: Date[] = [];
  let cursor = weekStartOf(start);
  const last = weekStartOf(end);
  while (cursor <= last && weeks.length < cap) {
    weeks.push(new Date(cursor));
    cursor = new Date(cursor);
    cursor.setUTCDate(cursor.getUTCDate() + 7);
  }
  return weeks;
}

/**
 * Progress of a scheme of work.
 *
 * Planned periods come from the scheme, taught periods from lessons that were
 * actually delivered against a plan in that week. A week is "covered" when
 * every scheme item in it is claimed by a plan that has been delivered — a plan
 * that was written but never taught does not count, which is the whole point of
 * separating scheduled from delivered.
 */
export function schemeProgress(weeks: Array<{
  weekNumber: number;
  plannedPeriods: number;
  items: Array<{ id: string; plannedPeriods: number; learningOutcomeId: string | null }>;
  lessonPlans: Array<{ id: string; workflowStatus: string; delivered: boolean }>;
}>) {
  const rows = weeks.map((w) => {
    const itemPeriods = w.items.reduce((n, i) => n + (i.plannedPeriods ?? 0), 0);
    const planned = Math.max(w.plannedPeriods ?? 0, itemPeriods);
    const plans = w.lessonPlans.length;
    const deliveredPlans = w.lessonPlans.filter((p) => p.delivered).length;
    return {
      weekNumber: w.weekNumber,
      plannedPeriods: planned,
      items: w.items.length,
      plans,
      deliveredPlans,
      state: deliveredPlans > 0 && deliveredPlans >= plans && plans > 0
        ? ('covered' as const)
        : deliveredPlans > 0
          ? ('partial' as const)
          : plans > 0
            ? ('planned' as const)
            : ('open' as const),
    };
  });
  const totalPlanned = rows.reduce((n, r) => n + r.plannedPeriods, 0);
  const covered = rows.filter((r) => r.state === 'covered').length;
  const partial = rows.filter((r) => r.state === 'partial').length;
  return {
    weeks: rows,
    totalWeeks: rows.length,
    totalPlannedPeriods: totalPlanned,
    coveredWeeks: covered,
    partialWeeks: partial,
    coveragePct: rows.length ? Math.round(((covered + partial * 0.5) / rows.length) * 100) : 0,
  };
}

@Injectable()
export class SchemeOfWorkService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly audit: AuditService,
    private readonly access: TeachingAccessService,
  ) {}

  private get org() {
    return this.tenant.organizationId;
  }

  private get actor() {
    return this.tenant.userId ?? undefined;
  }

  private include = {
    weeks: {
      orderBy: { weekNumber: 'asc' as const },
      include: {
        items: { orderBy: { order: 'asc' as const }, include: { learningOutcome: true } },
        lessonPlans: {
          select: {
            id: true,
            title: true,
            workflowStatus: true,
            weekOf: true,
            scheduledLessons: { select: { id: true, status: true, delivery: { select: { status: true } } } },
          },
        },
      },
    },
  };

  private shape(scheme: any) {
    const weeks = scheme.weeks.map((w: any) => ({
      ...w,
      lessonPlans: w.lessonPlans.map((p: any) => ({
        ...p,
        delivered: p.scheduledLessons.some((s: any) => s.delivery?.status === 'delivered' || s.delivery?.status === 'partially_delivered'),
      })),
    }));
    return { ...scheme, weeks, progress: schemeProgress(weeks) };
  }

  async forOffering(courseOfferingId: string) {
    await this.access.assertMayView(courseOfferingId);
    const scheme = await this.prisma.client.schemeOfWork.findFirst({
      where: { courseOfferingId, deletedAt: null },
      include: this.include,
    });
    return scheme ? this.shape(scheme) : null;
  }

  async get(id: string) {
    const scheme = await this.prisma.client.schemeOfWork.findFirst({ where: { id }, include: this.include });
    if (!scheme) throw new NotFoundException(`Scheme of work ${id} not found`);
    await this.access.assertMayView(scheme.courseOfferingId);
    return this.shape(scheme);
  }

  async create(dto: CreateSchemeOfWorkDto) {
    await this.access.assertMayTeach(dto.courseOfferingId);
    const offering = await this.access.offering(dto.courseOfferingId);
    const existing = await this.prisma.client.schemeOfWork.findFirst({ where: { courseOfferingId: offering.id } });
    if (existing) throw new ConflictException('This course already has a scheme of work.');

    const weeks = dto.weeks?.length
      ? dto.weeks
      : dto.generateWeeksFromTerm
        ? termWeekStarts(offering.term.startDate, offering.term.endDate).map((weekStart, index) => ({
            weekNumber: index + 1,
            weekStart: weekStart.toISOString(),
            plannedPeriods: 0,
          }))
        : [];

    const created = await this.prisma.client.$transaction(async (tx: any) => {
      const scheme = await tx.schemeOfWork.create({
        data: {
          organizationId: this.org,
          courseOfferingId: offering.id,
          title: dto.title?.trim() || `${offering.name} — scheme of work`,
          summary: dto.summary,
          createdById: this.actor,
        },
      });
      for (const week of weeks) {
        const row = await tx.schemeOfWorkWeek.create({
          data: {
            organizationId: this.org,
            schemeOfWorkId: scheme.id,
            weekNumber: week.weekNumber,
            weekStart: week.weekStart ? new Date(week.weekStart) : null,
            theme: (week as any).theme,
            plannedPeriods: (week as any).plannedPeriods ?? 0,
            notes: (week as any).notes,
          },
        });
        for (const [index, item] of ((week as any).items ?? []).entries()) {
          await tx.schemeOfWorkItem.create({
            data: this.itemData(row.id, item, index),
          });
        }
      }
      await this.audit.recordInTx(tx, { entity: 'SchemeOfWork', entityId: scheme.id, action: 'create', newValues: scheme });
      return scheme;
    });
    return this.get(created.id);
  }

  private itemData(weekId: string, item: SchemeItemDto, index: number) {
    return {
      organizationId: this.org,
      schemeOfWorkWeekId: weekId,
      title: item.title.trim(),
      topicId: item.topicId,
      unitId: item.unitId,
      learningOutcomeId: item.learningOutcomeId,
      learningObjectiveId: item.learningObjectiveId,
      order: item.order ?? index,
      plannedPeriods: item.plannedPeriods ?? 1,
    };
  }

  async update(id: string, dto: UpdateSchemeOfWorkDto) {
    const current = await this.prisma.client.schemeOfWork.findFirst({ where: { id } });
    if (!current) throw new NotFoundException(`Scheme of work ${id} not found`);
    await this.access.assertMayTeach(current.courseOfferingId);
    if (current.status === 'archived' && dto.status !== 'active') {
      throw new BadRequestException('An archived scheme of work must be reactivated before it can be edited.');
    }
    const row = await this.prisma.client.schemeOfWork.update({
      where: { id },
      data: {
        title: dto.title?.trim(),
        summary: dto.summary,
        status: dto.status,
        approvedById: dto.status === 'active' ? this.actor : undefined,
        approvedAt: dto.status === 'active' ? new Date() : undefined,
      },
    });
    await this.audit.record({ entity: 'SchemeOfWork', entityId: id, action: 'update', oldValues: current, newValues: row });
    return this.get(id);
  }

  private async weekOwner(weekId: string) {
    const week = await this.prisma.client.schemeOfWorkWeek.findFirst({
      where: { id: weekId },
      include: { schemeOfWork: true },
    });
    if (!week) throw new NotFoundException(`Scheme week ${weekId} not found`);
    await this.access.assertMayTeach(week.schemeOfWork.courseOfferingId);
    return week;
  }

  async addWeek(schemeId: string, dto: UpsertSchemeWeekDto) {
    const scheme = await this.prisma.client.schemeOfWork.findFirst({ where: { id: schemeId }, include: { weeks: true } });
    if (!scheme) throw new NotFoundException(`Scheme of work ${schemeId} not found`);
    await this.access.assertMayTeach(scheme.courseOfferingId);
    const weekNumber = dto.weekNumber ?? Math.max(0, ...scheme.weeks.map((w: any) => w.weekNumber)) + 1;
    if (scheme.weeks.some((w: any) => w.weekNumber === weekNumber)) {
      throw new ConflictException(`Week ${weekNumber} already exists in this scheme.`);
    }
    await this.prisma.client.schemeOfWorkWeek.create({
      data: {
        organizationId: this.org,
        schemeOfWorkId: schemeId,
        weekNumber,
        weekStart: dto.weekStart ? new Date(dto.weekStart) : null,
        theme: dto.theme,
        plannedPeriods: dto.plannedPeriods ?? 0,
        notes: dto.notes,
      },
    });
    return this.get(schemeId);
  }

  async updateWeek(weekId: string, dto: UpsertSchemeWeekDto) {
    const week = await this.weekOwner(weekId);
    await this.prisma.client.schemeOfWorkWeek.update({
      where: { id: weekId },
      data: {
        weekNumber: dto.weekNumber,
        weekStart: dto.weekStart ? new Date(dto.weekStart) : undefined,
        theme: dto.theme,
        plannedPeriods: dto.plannedPeriods,
        notes: dto.notes,
      },
    });
    return this.get(week.schemeOfWorkId);
  }

  async removeWeek(weekId: string) {
    const week = await this.weekOwner(weekId);
    const plans = await this.prisma.client.lessonPlan.count({ where: { schemeOfWorkWeekId: weekId } });
    if (plans > 0) {
      throw new BadRequestException(`${plans} lesson plan(s) are written against this week. Move them before removing it.`);
    }
    await this.prisma.client.schemeOfWorkWeek.delete({ where: { id: weekId } });
    return this.get(week.schemeOfWorkId);
  }

  async addItem(weekId: string, dto: SchemeItemDto) {
    const week = await this.weekOwner(weekId);
    const count = await this.prisma.client.schemeOfWorkItem.count({ where: { schemeOfWorkWeekId: weekId } });
    await this.prisma.client.schemeOfWorkItem.create({ data: this.itemData(weekId, dto, count) });
    return this.get(week.schemeOfWorkId);
  }

  async updateItem(itemId: string, dto: SchemeItemDto) {
    const item = await this.prisma.client.schemeOfWorkItem.findFirst({ where: { id: itemId } });
    if (!item) throw new NotFoundException(`Scheme item ${itemId} not found`);
    const week = await this.weekOwner(item.schemeOfWorkWeekId);
    await this.prisma.client.schemeOfWorkItem.update({
      where: { id: itemId },
      data: {
        title: dto.title?.trim(),
        topicId: dto.topicId,
        unitId: dto.unitId,
        learningOutcomeId: dto.learningOutcomeId,
        learningObjectiveId: dto.learningObjectiveId,
        order: dto.order,
        plannedPeriods: dto.plannedPeriods,
      },
    });
    return this.get(week.schemeOfWorkId);
  }

  async removeItem(itemId: string) {
    const item = await this.prisma.client.schemeOfWorkItem.findFirst({ where: { id: itemId } });
    if (!item) throw new NotFoundException(`Scheme item ${itemId} not found`);
    const week = await this.weekOwner(item.schemeOfWorkWeekId);
    await this.prisma.client.schemeOfWorkItem.delete({ where: { id: itemId } });
    return this.get(week.schemeOfWorkId);
  }
}
