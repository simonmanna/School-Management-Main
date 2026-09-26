import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { AcademicRoster } from '@prisma/client';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { AuditService } from '../../../kernel/audit/audit.service';
import { EventBus } from '../../../kernel/events/event-bus';
import { EVENTS } from '@erp/shared';
import { BaseCrudService, type CrudDelegate } from '../../../kernel/common/base-crud.service';
import type { CaptureRosterDto, RosterMemberDto } from './dto.types';
import { PlacementLookupService } from '../enrollment/placement-lookup.service';

/**
 * AcademicRoster — the enrollment-independent academic cohort.
 *
 * A roster is captured (from the class's placements or a manual list), reviewed, and
 * then FROZEN. Frozen rosters are immutable: members can no longer be added or
 * removed, so an assignment's fan-out and a result run (A3) always bind to a
 * stable set of students. Live class membership is only ever an input to capture —
 * never academic truth — which is how results stay correctly attributed after a
 * mid-term promotion.
 */
@Injectable()
export class AcademicRosterService extends BaseCrudService<AcademicRoster, CaptureRosterDto, never> {
  protected readonly entityName = 'AcademicRoster';
  protected readonly searchFields = ['name'];
  protected readonly defaultInclude = { members: true };

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly audit: AuditService,
    private readonly events: EventBus,
    private readonly placements: PlacementLookupService,
  ) {
    super(prisma.client.academicRoster as unknown as CrudDelegate);
  }

  /**
   * Capture a class roster from the students currently assigned to the class.
   * The captured members snapshot each student's class/section/grade at capture
   * time. Nothing is frozen yet — the roster is reviewable until `freeze`.
   */
  async capture(dto: CaptureRosterDto): Promise<AcademicRoster> {
    const organizationId = this.tenant.organizationId;
    return this.prisma.client.$transaction(async (tx: any) => {
      const klass = dto.classId ? await tx.schoolClass.findFirst({ where: { id: dto.classId }, include: { gradeLevel: true } }) : null;
      if (dto.classId && !klass) throw new NotFoundException(`Class ${dto.classId} not found`);
      const term = await tx.term.findFirst({ where: { id: dto.termId }, select: { startDate: true, endDate: true, academicYearId: true } });
      if (!term) throw new NotFoundException(`Term ${dto.termId} not found`);
      // F12: a roster is "who was in the class" on a day inside ITS term — the
      // term's last day for a past term, today for the current one. Reading
      // today's class for last term's list swapped in this term's pupils and
      // dropped anyone who has left since.
      const now = new Date();
      const termEnd = new Date(term.endDate.getTime() + 24 * 60 * 60 * 1000 - 1);
      const asOf = dto.asOf ? new Date(dto.asOf) : termEnd < now ? termEnd : now;
      if (asOf < term.startDate || asOf > termEnd) {
        throw new BadRequestException('The roster date must fall inside the term it is captured for.');
      }

      const roster = await tx.academicRoster.create({
        data: {
          organizationId,
          termId: dto.termId,
          scopeType: dto.scopeType ?? 'class',
          classId: dto.classId ?? null,
          sectionId: dto.sectionId ?? null,
          subjectId: dto.subjectId ?? null,
          name: dto.name ?? null,
          source: dto.source ?? 'derived_current_class',
          capturedById: this.tenant.userId ?? null,
        },
      });

      // Derive members from the class's live membership. `derived_current_class`
      // is kept as the persisted source value (clients send it and stored
      // rosters carry it); what it is derived FROM is now placement history,
      // not the StudentProfile projection (ADR-027).
      if ((dto.source ?? 'derived_current_class') === 'derived_current_class' && dto.classId) {
        const at = { asOf, academicYearId: term.academicYearId };
        const found = await tx.studentProfile.findMany({
          where: this.placements.studentWhere(
            { classIds: [dto.classId], ...(dto.sectionId ? { sectionIds: [dto.sectionId] } : {}) },
            at,
          ),
        });
        // On `tx`: the placements this roster is derived from may have been
        // written in this same transaction, and the lookup must not go looking
        // for a second connection while this one holds it.
        const students = await this.placements.attach(found, { tx, ...at });
        if (students.length > 0) {
          await tx.academicRosterMember.createMany({
            data: students.map((s: any) => ({
              organizationId,
              rosterId: roster.id,
              studentProfileId: s.id,
              classId: s.placement?.classId ?? dto.classId,
              sectionId: s.placement?.sectionId ?? null,
              gradeLevelId: klass?.gradeLevelId ?? null,
              effectiveFrom: asOf,
              joinReason: 'captured_from_class_placement',
            })),
          });
        }
      }

      await this.audit.recordInTx(tx, {
        entity: 'AcademicRoster',
        entityId: roster.id,
        action: 'create',
        newValues: { termId: roster.termId, classId: roster.classId, source: roster.source, asOf: asOf.toISOString() },
      });
      return tx.academicRoster.findFirst({ where: { id: roster.id }, include: { members: true } });
    });
  }

  private async assertUnfrozen(tx: any, rosterId: string): Promise<AcademicRoster> {
    const roster = await tx.academicRoster.findFirst({ where: { id: rosterId } });
    if (!roster) throw new NotFoundException(`AcademicRoster ${rosterId} not found`);
    if (roster.frozenAt) throw new BadRequestException(`Roster ${rosterId} is frozen and cannot be edited`);
    return roster;
  }

  async addMember(rosterId: string, dto: RosterMemberDto) {
    return this.prisma.client.$transaction(async (tx: any) => {
      await this.assertUnfrozen(tx, rosterId);
      const found = await tx.studentProfile.findFirst({ where: { id: dto.studentProfileId } });
      if (!found) throw new NotFoundException(`Student ${dto.studentProfileId} not found`);
      const [student] = await this.placements.attach([found]);
      const row = await tx.academicRosterMember.upsert({
        where: { rosterId_studentProfileId: { rosterId, studentProfileId: dto.studentProfileId } },
        create: {
          organizationId: this.tenant.organizationId,
          rosterId,
          studentProfileId: dto.studentProfileId,
          classId: dto.classId ?? student.placement?.classId ?? null,
          sectionId: dto.sectionId ?? student.placement?.sectionId ?? null,
          gradeLevelId: dto.gradeLevelId ?? null,
          joinReason: dto.joinReason ?? 'manual_add',
        },
        update: { exitReason: null, effectiveTo: null },
      });
      return row;
    });
  }

  async removeMember(rosterId: string, studentProfileId: string) {
    return this.prisma.client.$transaction(async (tx: any) => {
      await this.assertUnfrozen(tx, rosterId);
      const res = await tx.academicRosterMember.deleteMany({ where: { rosterId, studentProfileId } });
      if (res.count === 0) throw new NotFoundException(`Member ${studentProfileId} not on roster ${rosterId}`);
      return { removed: res.count };
    });
  }

  /** Freeze the roster — after this its membership is immutable. */
  async freeze(rosterId: string): Promise<AcademicRoster> {
    return this.prisma.client.$transaction(async (tx: any) => {
      const roster = await tx.academicRoster.findFirst({ where: { id: rosterId }, include: { members: true } });
      if (!roster) throw new NotFoundException(`AcademicRoster ${rosterId} not found`);
      if (roster.frozenAt) return roster; // idempotent
      if (roster.members.length === 0) throw new BadRequestException('Cannot freeze an empty roster');
      await tx.academicRoster.updateMany({
        where: { id: rosterId },
        data: { frozenAt: new Date(), frozenById: this.tenant.userId ?? null, version: { increment: 1 } },
      });
      await this.audit.recordInTx(tx, {
        entity: 'AcademicRoster',
        entityId: rosterId,
        action: 'update',
        newValues: { action: 'freeze', memberCount: roster.members.length },
      });
      this.events.publish(EVENTS.SchoolRosterFrozen, {
        organizationId: this.tenant.organizationId,
        rosterId,
        memberCount: roster.members.length,
      });
      return tx.academicRoster.findFirst({ where: { id: rosterId }, include: { members: true } });
    });
  }

  async members(rosterId: string) {
    return this.prisma.client.academicRosterMember.findMany({
      where: { rosterId },
      orderBy: { studentProfileId: 'asc' },
    });
  }
}
