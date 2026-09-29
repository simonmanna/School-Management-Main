import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { StaffProfile } from '@prisma/client';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { AuditService } from '../../../kernel/audit/audit.service';
import { EventBus } from '../../../kernel/events/event-bus';
import { SequenceService } from '../../../kernel/sequence/sequence.service';
import { BaseCrudService, type CrudDelegate } from '../../../kernel/common/base-crud.service';
import { EVENTS } from '@erp/shared';
import type { CreateStaffDto, UpdateStaffDto } from './dto.types';
import { assertStaffTransition, endTeachingAccess, LEAVING_STATUSES, type StaffStatusValue } from './staff-lifecycle';

/**
 * Staff = Partner (employee) + StaffProfile (school metadata).
 * Same pattern as StudentService: the universal Partner model is reused,
 * and the StaffProfile table adds school-specific fields.
 */
/**
 * What a school reader may see of a colleague (audit 2026-09-29 A02).
 *
 * `school:read` is held by every teacher, so the directory is an explicit
 * allow-list rather than the whole row. `compensation` (legacy salary and bank
 * details — pay lives in HrEmployee behind HR grants) and free-form
 * `customFields` are deliberately absent; a new column stays private until it
 * is named here.
 */
export const STAFF_DIRECTORY_SELECT = {
  id: true,
  organizationId: true,
  partnerId: true,
  employeeNo: true,
  departmentId: true,
  positionId: true,
  campusId: true,
  joinDate: true,
  contractType: true,
  contractEndDate: true,
  status: true,
  staffCategory: true,
  createdAt: true,
  updatedAt: true,
  department: true,
  position: true,
  campus: true,
  partner: { select: { id: true, name: true, email: true, phone: true } },
} as const;

@Injectable()
export class StaffService extends BaseCrudService<StaffProfile, CreateStaffDto, UpdateStaffDto> {
  protected readonly entityName = 'StaffProfile';
  protected readonly searchFields: string[] = ['employeeNo'];
  /**
   * `partner` carries the person's name/email/phone — `StaffProfile` itself has
   * none of them. Omitting it was the root cause of the staff list rendering
   * the employee number in the Name column for every row.
   */
  protected readonly defaultSelect = STAFF_DIRECTORY_SELECT;

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly audit: AuditService,
    private readonly events: EventBus,
    private readonly sequence: SequenceService,
  ) {
    super(prisma.client.staffProfile as unknown as CrudDelegate);
  }

  async create(dto: CreateStaffDto): Promise<StaffProfile> {
    return this.prisma.client.$transaction(async (tx: any) => {
      const organizationId = this.tenant.organizationId;
      const code =
        dto.code ??
        (await this.sequence.next(`staff:${new Date().getUTCFullYear()}`, { prefix: 'EMP-', padding: 6 }, tx));

      const partner = await tx.partner.create({
        data: {
          organizationId,
          code,
          name: dto.name,
          isCompany: dto.isCompany ?? false,
          isEmployee: true,
          email: dto.email ?? null,
          phone: dto.phone ?? null,
          customFields: dto.customFields ?? {},
        },
      });

      const profile = await tx.staffProfile.create({
        data: {
          organizationId,
          partnerId: partner.id,
          employeeNo: dto.employeeNo,
          departmentId: dto.departmentId ?? null,
          positionId: dto.positionId ?? null,
          campusId: dto.campusId ?? null,
          joinDate: new Date(dto.joinDate),
          contractType: dto.contractType ?? 'permanent',
          contractEndDate: dto.contractEndDate ? new Date(dto.contractEndDate) : null,
          // `compensation` is deprecated (Phase 2): HrEmployee.baseSalary is the
          // system of record for pay. Two salary stores is a live hazard, so
          // new rows are created empty and the field is no longer written.
          compensation: {},
          staffCategory: dto.staffCategory ?? 'teaching',
          customFields: dto.customFields ?? {},
        },
      });

      await this.audit.recordInTx(tx, {
        entity: 'StaffProfile',
        entityId: profile.id,
        action: 'create',
        newValues: { partner, profile },
      });

      this.events.publish(EVENTS.SchoolStaffCreated, {
        organizationId,
        staffProfileId: profile.id,
        partnerId: partner.id,
        employeeNo: profile.employeeNo,
      });

      return tx.staffProfile.findFirst({ where: { id: profile.id }, select: STAFF_DIRECTORY_SELECT });
    });
  }

  async update(id: string, dto: UpdateStaffDto): Promise<StaffProfile> {
    if (dto.status && LEAVING_STATUSES.includes(dto.status as StaffStatusValue) && !dto.reason?.trim()) {
      throw new BadRequestException(`Ending employment (${dto.status}) needs a reason.`);
    }
    return this.prisma.client.$transaction(async (tx: any) => {
      const before = await tx.staffProfile.findFirst({ where: { id } });
      if (!before) throw new NotFoundException(`Staff ${id} not found`);

      const partnerUpdates: Record<string, unknown> = {};
      if (dto.name !== undefined) partnerUpdates.name = dto.name;
      if (dto.email !== undefined) partnerUpdates.email = dto.email;
      if (dto.phone !== undefined) partnerUpdates.phone = dto.phone;
      if (Object.keys(partnerUpdates).length > 0) {
        await tx.partner.updateMany({ where: { id: before.partnerId }, data: partnerUpdates });
      }

      if (dto.status && dto.status !== before.status) {
        assertStaffTransition(before.status, dto.status);
        await tx.staffStatusHistory.create({
          data: {
            organizationId: before.organizationId,
            staffProfileId: id,
            fromStatus: before.status,
            toStatus: dto.status,
            reason: dto.reason ?? null,
            changedById: this.tenant.userId ?? null,
          },
        });
        this.events.publish(EVENTS.SchoolStaffStatusChanged, {
          organizationId: this.tenant.organizationId,
          staffProfileId: id,
          fromStatus: before.status,
          toStatus: dto.status,
        });
      }

      const profileUpdates: Record<string, unknown> = {};
      for (const k of [
        'departmentId',
        'positionId',
        'campusId',
        'joinDate',
        'contractType',
        'contractEndDate',
        // 'compensation' deliberately omitted — see create(). Pay changes go
        // through HrEmployee, which records salary history and audits them.
        'staffCategory',
        'customFields',
      ] as const) {
        if (dto[k] !== undefined) profileUpdates[k] = dto[k];
      }
      if (dto.status !== undefined) profileUpdates.status = dto.status;

      await tx.staffProfile.updateMany({ where: { id }, data: profileUpdates });

      // Leaving ends CURRENT access — login, allocations, live lessons, class
      // teacher roles — and rewrites none of the history.
      let ended: Awaited<ReturnType<typeof endTeachingAccess>> | null = null;
      if (
        dto.status &&
        dto.status !== before.status &&
        LEAVING_STATUSES.includes(dto.status as StaffStatusValue)
      ) {
        ended = await endTeachingAccess(tx, before, new Date(), this.tenant.userId ?? null);
      }

      const after = await tx.staffProfile.findFirst({ where: { id } });
      await this.audit.recordInTx(tx, {
        entity: 'StaffProfile',
        entityId: id,
        action: 'update',
        oldValues: before,
        newValues: { ...after, ...(ended ? { employmentEnded: ended } : {}) },
      });
      return (await tx.staffProfile.findFirst({ where: { id }, select: STAFF_DIRECTORY_SELECT })) as StaffProfile;
    });
  }

  /**
   * Delete is for a record created by mistake. A staff member with ANY history —
   * teaching allocations, timetable, marks, attendance, lesson plans — leaves
   * through a status change (terminated / resigned / retired), which keeps every
   * historical record attributable to them.
   */
  async remove(id: string): Promise<void> {
    await this.prisma.client.$transaction(async (tx: any) => {
      const profile = await tx.staffProfile.findFirst({ where: { id } });
      if (!profile) throw new NotFoundException(`Staff ${id} not found`);
      const [allocations, slots, assignments, plans, attendance, assessments] = await Promise.all([
        tx.courseOfferingTeacher.count({ where: { teacherPartnerId: id } }),
        tx.timetableSlot.count({ where: { OR: [{ teacherPartnerId: id }, { substituteTeacherId: id }] } }),
        tx.teacherAssignment.count({ where: { teacherPartnerId: id } }),
        tx.lessonPlan.count({ where: { teacherPartnerId: id } }),
        tx.staffAttendance.count({ where: { staffProfileId: id } }),
        tx.assessment.count({ where: { teacherPartnerId: id } }),
      ]);
      const history = allocations + slots + assignments + plans + attendance + assessments;
      if (history > 0) {
        throw new ConflictException(
          'This staff member has teaching or attendance history and cannot be deleted. ' +
            'End their employment instead (status terminated, resigned or retired).',
        );
      }
      await tx.staffProfile.updateMany({ where: { id }, data: { deletedAt: new Date() } });
      await tx.partner.updateMany({ where: { id: profile.partnerId }, data: { deletedAt: new Date() } });
      await this.audit.recordInTx(tx, { entity: 'StaffProfile', entityId: id, action: 'delete' });
    });
  }

  async listByCampus(campusId: string) {
    return this.prisma.client.staffProfile.findMany({
      where: { campusId, status: 'active' },
      select: STAFF_DIRECTORY_SELECT,
      orderBy: { employeeNo: 'asc' },
    });
  }

  async listByDepartment(departmentId: string) {
    return this.prisma.client.staffProfile.findMany({
      where: { departmentId, status: 'active' },
      select: STAFF_DIRECTORY_SELECT,
      orderBy: { employeeNo: 'asc' },
    });
  }
}