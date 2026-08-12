import { Injectable, NotFoundException } from '@nestjs/common';
import type {
  Discount,
  FeeSchedule,
  FeeStructure,
  InstallmentPlan,
  PenaltyRule,
  PenaltyRun,
  Scholarship,
  StudentFeeAssignment,
} from '@prisma/client';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { AuditService } from '../../../kernel/audit/audit.service';
import { EventBus } from '../../../kernel/events/event-bus';
import { BaseCrudService, type CrudDelegate } from '../../../kernel/common/base-crud.service';
import { EVENTS } from '@erp/shared';
import type {
  CreateDiscountDto,
  CreateFeeScheduleDto,
  CreateFeeStructureDto,
  CreateInstallmentPlanDto,
  CreatePenaltyRuleDto,
  CreateScholarshipDto,
  CreateStudentFeeAssignmentDto,
  UpdateDiscountDto,
  UpdateFeeScheduleDto,
  UpdateFeeStructureDto,
  UpdateInstallmentPlanDto,
  UpdatePenaltyRuleDto,
  UpdateScholarshipDto,
  UpdateStudentFeeAssignmentDto,
} from './dto.types';

@Injectable()
export class FeeStructureService extends BaseCrudService<FeeStructure, CreateFeeStructureDto, UpdateFeeStructureDto> {
  protected readonly entityName = 'FeeStructure';
  protected readonly searchFields = ['name'];
  protected readonly defaultInclude = { academicYear: true, schedules: true };

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly audit: AuditService,
  ) {
    super(prisma.client.feeStructure as unknown as CrudDelegate);
  }

  async create(dto: CreateFeeStructureDto): Promise<FeeStructure> {
    return this.prisma.client.$transaction(async (tx: any) => {
      const organizationId = this.tenant.organizationId;
      const row = await tx.feeStructure.create({
        data: {
          organizationId,
          name: dto.name,
          academicYearId: dto.academicYearId,
          components: dto.components as any,
          applicableTo: (dto.applicableTo as any) ?? {},
          isActive: dto.isActive ?? true,
        },
      });
      await this.audit.recordInTx(tx, { entity: 'FeeStructure', entityId: row.id, action: 'create', newValues: row });
      return row;
    });
  }
}

@Injectable()
export class FeeScheduleService extends BaseCrudService<FeeSchedule, CreateFeeScheduleDto, UpdateFeeScheduleDto> {
  protected readonly entityName = 'FeeSchedule';
  protected readonly searchFields: string[] = [];
  protected readonly defaultInclude = { term: true, feeStructure: true };

  constructor(private readonly prisma: PrismaService) {
    super(prisma.client.feeSchedule as unknown as CrudDelegate);
  }

  async forTerm(termId: string) {
    return this.prisma.client.feeSchedule.findMany({
      where: { termId },
      include: { feeStructure: true },
    });
  }
}

@Injectable()
export class StudentFeeAssignmentService extends BaseCrudService<StudentFeeAssignment, CreateStudentFeeAssignmentDto, UpdateStudentFeeAssignmentDto> {
  protected readonly entityName = 'StudentFeeAssignment';
  protected readonly searchFields: string[] = [];

  constructor(private readonly prisma: PrismaService) {
    super(prisma.client.studentFeeAssignment as unknown as CrudDelegate);
  }

  async byStudent(studentProfileId: string) {
    return this.prisma.client.studentFeeAssignment.findMany({
      where: { studentProfileId },
      include: { feeStructure: true, term: true },
    });
  }
}

@Injectable()
export class DiscountService extends BaseCrudService<Discount, CreateDiscountDto, UpdateDiscountDto> {
  protected readonly entityName = 'Discount';
  protected readonly searchFields = ['code', 'name'];
  constructor(private readonly prisma: PrismaService) {
    super(prisma.client.discount as unknown as CrudDelegate);
  }
}

@Injectable()
export class ScholarshipService extends BaseCrudService<Scholarship, CreateScholarshipDto, UpdateScholarshipDto> {
  protected readonly entityName = 'Scholarship';
  protected readonly searchFields = ['code', 'name'];

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
  ) {
    super(prisma.client.scholarship as unknown as CrudDelegate);
  }

  async activeForStudent(studentProfileId: string, asOf: Date = new Date()): Promise<Scholarship[]> {
    return this.prisma.client.scholarship.findMany({
      where: {
        studentProfileId,
        isActive: true,
        validFrom: { lte: asOf },
        OR: [{ validTo: null }, { validTo: { gte: asOf } }],
      },
    });
  }
}

@Injectable()
export class InstallmentPlanService extends BaseCrudService<InstallmentPlan, CreateInstallmentPlanDto, UpdateInstallmentPlanDto> {
  protected readonly entityName = 'InstallmentPlan';
  protected readonly searchFields: string[] = [];
  constructor(private readonly prisma: PrismaService) {
    super(prisma.client.installmentPlan as unknown as CrudDelegate);
  }

  async byStudent(studentProfileId: string) {
    return this.prisma.client.installmentPlan.findMany({
      where: { studentProfileId },
      include: { term: true },
    });
  }
}

@Injectable()
export class PenaltyRuleService extends BaseCrudService<PenaltyRule, CreatePenaltyRuleDto, UpdatePenaltyRuleDto> {
  protected readonly entityName = 'PenaltyRule';
  protected readonly searchFields: string[] = [];
  constructor(private readonly prisma: PrismaService) {
    super(prisma.client.penaltyRule as unknown as CrudDelegate);
  }
}

@Injectable()
export class PenaltyRunService {
  protected readonly entityName = 'PenaltyRun';
  protected readonly searchFields: string[] = [];

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly events: EventBus,
  ) {}

  async list() {
    return this.prisma.client.penaltyRun.findMany({
      orderBy: { runAt: 'desc' },
      take: 50,
    });
  }

  async get(id: string) {
    const r = await this.prisma.client.penaltyRun.findFirst({ where: { id } });
    if (!r) throw new NotFoundException(`PenaltyRun ${id} not found`);
    return r;
  }

  async bySchedule(scheduleId: string) {
    return this.prisma.client.penaltyRun.findMany({
      where: { scheduleId },
      orderBy: { runAt: 'desc' },
    });
  }
}