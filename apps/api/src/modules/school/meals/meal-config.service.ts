/** Meals V1 — configuration: programs, meal types, entitlements, plan assignments. */
import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import type { MealProgram, MealType } from '@prisma/client';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { EventBus } from '../../../kernel/events/event-bus';
import { BaseCrudService, type CrudDelegate } from '../../../kernel/common/base-crud.service';
import { EVENTS } from '@erp/shared';
import type {
  CreateMealProgramDto,
  UpdateMealProgramDto,
  CreateMealTypeDto,
  UpdateMealTypeDto,
  AssignMealPlanDto,
  ChangeAssignmentDto,
} from './dto.types';

@Injectable()
export class MealProgramService extends BaseCrudService<MealProgram, CreateMealProgramDto, UpdateMealProgramDto> {
  protected readonly entityName = 'MealProgram';
  protected readonly searchFields = ['name'];
  protected readonly defaultInclude = { plans: true };
  constructor(private readonly prisma: PrismaService) {
    super(prisma.client.mealProgram as unknown as CrudDelegate);
  }
}

@Injectable()
export class MealTypeService extends BaseCrudService<MealType, CreateMealTypeDto, UpdateMealTypeDto> {
  protected readonly entityName = 'MealType';
  protected readonly searchFields = ['name'];
  protected readonly defaultOrderBy = { order: 'asc' as const };
  constructor(private readonly prisma: PrismaService) {
    super(prisma.client.mealType as unknown as CrudDelegate);
  }
}

/** Which meal types a plan includes. `set` replaces the plan's entitlements atomically. */
@Injectable()
export class MealEntitlementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
  ) {}

  async set(mealPlanId: string, mealTypeIds: string[]) {
    const organizationId = this.tenant.organizationId;
    const uniqueTypeIds = [...new Set(mealTypeIds)];
    return this.prisma.client.$transaction(async (tx: any) => {
      const plan = await tx.mealPlan.findFirst({ where: { id: mealPlanId }, select: { id: true } });
      if (!plan) throw new NotFoundException(`MealPlan ${mealPlanId} not found`);
      await tx.mealPlanEntitlement.deleteMany({ where: { mealPlanId } });
      for (const mealTypeId of uniqueTypeIds) {
        await tx.mealPlanEntitlement.create({
          data: { organizationId, mealPlanId, mealTypeId },
        });
      }
      return tx.mealPlanEntitlement.findMany({
        where: { mealPlanId },
        include: { mealType: true },
      });
    });
  }

  list(mealPlanId: string) {
    return this.prisma.client.mealPlanEntitlement.findMany({
      where: { mealPlanId },
      include: { mealType: true },
    });
  }
}

/**
 * Student ⇄ MealPlan assignments. History is immutable: re-assigning within a
 * term ENDS the current active row and creates a new active one. The partial
 * unique index (status='active') is the DB safety net for "one active per term".
 */
@Injectable()
export class MealAssignmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly events: EventBus,
  ) {}

  async assign(dto: AssignMealPlanDto) {
    const organizationId = this.tenant.organizationId;
    const userId = this.tenant.userId ?? null;
    const startDate = new Date(dto.startDate);

    const created = await this.prisma.client.$transaction(async (tx: any) => {
      const plan = await tx.mealPlan.findFirst({ where: { id: dto.mealPlanId }, select: { id: true } });
      if (!plan) throw new NotFoundException(`MealPlan ${dto.mealPlanId} not found`);

      // End any currently-active assignment for this student+term so the new one
      // is the single active row (preserves history rather than overwriting).
      await tx.mealPlanAssignment.updateMany({
        where: { organizationId, studentProfileId: dto.studentProfileId, termId: dto.termId, status: 'active' },
        data: { status: 'ended', endDate: startDate, updatedBy: userId },
      });

      return tx.mealPlanAssignment.create({
        data: {
          organizationId,
          studentProfileId: dto.studentProfileId,
          mealPlanId: dto.mealPlanId,
          termId: dto.termId,
          startDate,
          endDate: dto.endDate ? new Date(dto.endDate) : null,
          status: 'active',
          reason: dto.reason ?? null,
          createdBy: userId,
          updatedBy: userId,
        },
      });
    });

    this.events.publish(EVENTS.SchoolMealPlanAssigned, {
      organizationId,
      assignmentId: created.id,
      studentProfileId: created.studentProfileId,
      mealPlanId: created.mealPlanId,
      termId: created.termId,
    });
    return created;
  }

  async changeStatus(id: string, dto: ChangeAssignmentDto) {
    const organizationId = this.tenant.organizationId;
    const userId = this.tenant.userId ?? null;
    const existing = await this.prisma.client.mealPlanAssignment.findFirst({ where: { id } });
    if (!existing) throw new NotFoundException(`MealPlanAssignment ${id} not found`);
    if (existing.status === 'ended' || existing.status === 'cancelled') {
      throw new BadRequestException(`Assignment ${id} is already ${existing.status}`);
    }
    const endDate = dto.endDate ? new Date(dto.endDate) : dto.status === 'suspended' ? existing.endDate : new Date();
    await this.prisma.client.mealPlanAssignment.updateMany({
      where: { id },
      data: { status: dto.status, endDate, reason: dto.reason ?? existing.reason, updatedBy: userId },
    });

    this.events.publish(EVENTS.SchoolMealPlanChanged, {
      organizationId,
      assignmentId: id,
      studentProfileId: existing.studentProfileId,
      status: dto.status,
    });
    return this.prisma.client.mealPlanAssignment.findFirst({ where: { id }, include: { mealPlan: true } });
  }

  listByStudent(studentProfileId: string) {
    return this.prisma.client.mealPlanAssignment.findMany({
      where: { studentProfileId },
      include: { mealPlan: true, term: true },
      orderBy: { startDate: 'desc' },
    });
  }

  listByTerm(termId: string, status?: string) {
    return this.prisma.client.mealPlanAssignment.findMany({
      where: { termId, ...(status ? { status: status as any } : {}) },
      include: { mealPlan: true, studentProfile: { include: { partner: true } } },
      orderBy: { startDate: 'desc' },
    });
  }
}
