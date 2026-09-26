import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { AuditService } from '../../../kernel/audit/audit.service';
import { PlacementLookupService } from '../enrollment/placement-lookup.service';
import type { UpsertCareLogDto } from './dto.types';

/** Midnight UTC for a date-only column, so one child has one log per day. */
export function careDay(value: string | Date): Date {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw new BadRequestException(`'${String(value)}' is not a date.`);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/**
 * The nursery day, written once per child and then shared with their family.
 *
 * Draft until `sharedAt`: a room writes the log across the day in whatever order
 * things happen, and a half-finished note about a child being unsettled is not
 * something a parent should be reading at lunchtime. Sharing is the deliberate
 * act, and after it the log is what a parent has already read — so it is
 * corrected by an explicit re-share, not silently.
 */
@Injectable()
export class CareLogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly audit: AuditService,
    private readonly placements: PlacementLookupService,
  ) {}

  /**
   * Create or update today's log. One call, because a room does not think in
   * terms of whether a record exists yet — it adds the nap it just observed.
   */
  async upsert(dto: UpsertCareLogDto) {
    const organizationId = this.tenant.organizationId;
    const onDate = careDay(dto.onDate);
    return this.prisma.client.$transaction(async (tx: any) => {
      const student = await tx.studentProfile.findFirst({ where: { id: dto.studentProfileId } });
      if (!student) throw new NotFoundException(`Student ${dto.studentProfileId} not found`);

      const existing = await tx.childCareLog.findFirst({
        where: { studentProfileId: dto.studentProfileId, onDate },
      });
      if (existing?.sharedAt) {
        throw new BadRequestException(
          "This day's log has already been shared with the family. Unshare it first, so the correction is deliberate.",
        );
      }

      const data = {
        arrivalMood: dto.arrivalMood ?? existing?.arrivalMood ?? null,
        departureMood: dto.departureMood ?? existing?.departureMood ?? null,
        meals: (dto.meals ?? existing?.meals ?? []) as any,
        naps: (dto.naps ?? existing?.naps ?? []) as any,
        nappyChanges: dto.nappyChanges ?? existing?.nappyChanges ?? null,
        usedToiletAlone: dto.usedToiletAlone ?? existing?.usedToiletAlone ?? null,
        activities: dto.activities ?? existing?.activities ?? null,
        teacherNote: dto.teacherNote ?? existing?.teacherNote ?? null,
        recordedById: this.tenant.userId ?? null,
      };

      const row = existing
        ? await tx.childCareLog.update({ where: { id: existing.id }, data })
        : await tx.childCareLog.create({
            data: { organizationId, studentProfileId: dto.studentProfileId, onDate, ...data },
          });

      await this.audit.recordInTx(tx, {
        entity: 'ChildCareLog',
        entityId: row.id,
        action: existing ? 'update' : 'create',
        oldValues: existing ?? undefined,
        newValues: row,
      });
      return row;
    });
  }

  /** Release the day to the guardians' portal, or take it back. */
  async setShared(id: string, shared: boolean) {
    return this.prisma.client.$transaction(async (tx: any) => {
      const row = await tx.childCareLog.findFirst({ where: { id } });
      if (!row) throw new NotFoundException(`Care log ${id} not found`);
      const updated = await tx.childCareLog.update({
        where: { id },
        data: {
          sharedAt: shared ? new Date() : null,
          sharedById: shared ? (this.tenant.userId ?? null) : null,
        },
      });
      await this.audit.recordInTx(tx, {
        entity: 'ChildCareLog',
        entityId: id,
        action: 'update',
        oldValues: { sharedAt: row.sharedAt },
        newValues: { sharedAt: updated.sharedAt },
      });
      return updated;
    });
  }

  /** One child's history, newest first — "has she stopped napping?" */
  async forStudent(studentProfileId: string, opts: { from?: string; to?: string; sharedOnly?: boolean } = {}) {
    return this.prisma.client.childCareLog.findMany({
      where: {
        studentProfileId,
        ...(opts.sharedOnly ? { sharedAt: { not: null } } : {}),
        ...(opts.from || opts.to
          ? {
              onDate: {
                ...(opts.from ? { gte: careDay(opts.from) } : {}),
                ...(opts.to ? { lte: careDay(opts.to) } : {}),
              },
            }
          : {}),
      },
      orderBy: { onDate: 'desc' },
      take: 120,
    });
  }

  /**
   * The room's day: every child placed in this class, with their log if it
   * exists. Driven from placement, so a child admitted this morning appears
   * without anyone refreshing a list — and a child with no log yet appears as a
   * blank, which is the point of the screen.
   */
  async forClass(classId: string, onDateRaw: string, sectionId?: string) {
    const onDate = careDay(onDateRaw);
    // As at the END of the care day: a child placed at nine in the morning was in
    // the room that day, and asking as at midnight would leave them off the list
    // the room is meant to be filling in.
    const endOfDay = new Date(onDate.getTime() + 24 * 60 * 60 * 1000 - 1);
    const learners = await this.placements.roster(
      { classIds: [classId], ...(sectionId ? { sectionIds: [sectionId] } : {}) },
      { asOf: endOfDay },
    );
    const logs = await this.prisma.client.childCareLog.findMany({
      where: { studentProfileId: { in: learners.map((l: any) => l.student.id) }, onDate },
    });
    const byStudent = new Map<string, any>(logs.map((l: any) => [l.studentProfileId, l]));
    return {
      onDate: onDate.toISOString().slice(0, 10),
      classId,
      sectionId: sectionId ?? null,
      children: learners.map((l: any) => ({
        studentProfileId: l.student.id,
        name: l.student.partner?.name ?? l.student.admissionNo,
        admissionNo: l.student.admissionNo,
        sectionName: l.sectionName,
        log: byStudent.get(l.student.id) ?? null,
      })),
    };
  }
}
