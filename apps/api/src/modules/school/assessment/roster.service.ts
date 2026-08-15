import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { AcademicRoster } from '@prisma/client';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { AuditService } from '../../../kernel/audit/audit.service';
import { EventBus } from '../../../kernel/events/event-bus';
import { EVENTS } from '@erp/shared';
import { BaseCrudService, type CrudDelegate } from '../../../kernel/common/base-crud.service';
import type { CaptureRosterDto, RosterMemberDto } from './dto.types';

/**
 * AcademicRoster — the enrollment-independent academic cohort.
 *
 * A roster is captured (from `currentClassId` or a manual list), reviewed, and
 * then FROZEN. Frozen rosters are immutable: members can no longer be added or
 * removed, so an assignment's fan-out and a result run (A3) always bind to a
 * stable set of students. `currentClassId` is only ever an input to capture —
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

      // Derive members from the class roster (active students in the class).
      if ((dto.source ?? 'derived_current_class') === 'derived_current_class' && dto.classId) {
        const students = await tx.studentProfile.findMany({
          where: { currentClassId: dto.classId, status: 'active', ...(dto.sectionId ? { currentSectionId: dto.sectionId } : {}) },
        });
        if (students.length > 0) {
          await tx.academicRosterMember.createMany({
            data: students.map((s: any) => ({
              organizationId,
              rosterId: roster.id,
              studentProfileId: s.id,
              classId: s.currentClassId,
              sectionId: s.currentSectionId,
              gradeLevelId: klass?.gradeLevelId ?? null,
              joinReason: 'captured_from_current_class',
            })),
          });
        }
      }

      await this.audit.recordInTx(tx, {
        entity: 'AcademicRoster',
        entityId: roster.id,
        action: 'create',
        newValues: { termId: roster.termId, classId: roster.classId, source: roster.source },
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
      const student = await tx.studentProfile.findFirst({ where: { id: dto.studentProfileId } });
      if (!student) throw new NotFoundException(`Student ${dto.studentProfileId} not found`);
      const row = await tx.academicRosterMember.upsert({
        where: { rosterId_studentProfileId: { rosterId, studentProfileId: dto.studentProfileId } },
        create: {
          organizationId: this.tenant.organizationId,
          rosterId,
          studentProfileId: dto.studentProfileId,
          classId: dto.classId ?? student.currentClassId,
          sectionId: dto.sectionId ?? student.currentSectionId,
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
